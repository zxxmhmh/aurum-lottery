import { api } from '../api.js';
import { html, raw, icon, esc, fmtNumber, fmtClock, toast, pct } from '../ui.js';
import { sfx, playResult } from '../sfx.js';
import { celebrate, burstAt } from '../fx.js';
import { saveWinnerCard } from '../winner-card.js';

const MODE_LABEL = { quota: '名单抽奖', probability: '概率抽奖', code: '抽奖码' };
const MODE_EN = { quota: 'Quota draw', probability: 'Weighted draw', code: 'Ticket draw' };
const STATUS_LABEL = { active: '进行中', paused: '已暂停', draft: '草稿', ended: '已结束' };

const safeColor = (value, fallback = '#D9B77C') =>
  /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : fallback;

export async function renderStage(host, ctx) {
  const { activities } = await api.get('/activities');

  if (!activities.length) {
    host.innerHTML = html`
      <div class="page">
        <header class="page-head">
          <div>
            <div class="eyebrow">Draw stage · 抽奖舞台</div>
            <h1 class="page-title">抽奖舞台</h1>
            <p class="page-sub">还没有可用的抽奖活动</p>
          </div>
        </header>
        <div class="panel">
          <div class="empty">
            ${raw(icon('sparkles', 30, 1.2))}
            <b>先去创建一场活动</b>
            <span>配置奖项与名额之后，舞台才会亮起来。</span>
            ${ctx.can('activity.manage') ? raw('<a class="btn btn--gold btn--sm" href="#/activities">前往配置</a>') : ''}
          </div>
        </div>
      </div>
    `;
    return undefined;
  }

  const params = new URLSearchParams((location.hash.split('?')[1] || '').trim());
  const wanted = params.get('act') || localStorage.getItem('aurum.stage.activity') || '';
  const state = {
    activities,
    current: activities.find((a) => a.id === wanted)
      || activities.find((a) => a.status === 'active')
      || activities[0],
    selectedPrizeId: '',
    drawing: false,
    rolling: false,
    shuffle: null,
    pendingBody: null,
    feed: [],
    lastResult: null,
    canDraw: ctx.can('draw.execute'),
    timers: [],
  };

  const firstAvailable = state.current.prizes.find((p) => p.remaining > 0);
  state.selectedPrizeId = firstAvailable ? firstAvailable.id : '';

  host.innerHTML = html`
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Draw stage · 抽奖舞台</div>
          <h1 class="page-title">抽奖舞台</h1>
          <p class="page-sub">选择活动与奖项，按下开奖。结果实时进入记录，不可伪造。</p>
        </div>
        <div class="page-actions">
          <select class="select" id="act-switch" aria-label="切换活动" style="width:238px">
            ${activities.map(
              (a) => html`<option value="${a.id}"${a.id === state.current.id ? raw(' selected') : ''}>${a.name}</option>`,
            )}
          </select>
          <button class="btn btn--ghost btn--sm" id="sound-btn" type="button" title="开奖音效">
            ${raw(icon(sfx.enabled ? 'volume' : 'muted', 15))} <span id="sound-label">${sfx.enabled ? '音效开' : '音效关'}</span>
          </button>
          <button class="btn btn--ghost btn--sm" id="cinema-btn" type="button">
            ${raw(icon('expand', 15))} 大屏模式
          </button>
        </div>
      </header>

      <div class="stage-grid">
        <section class="stage-main stage" id="stage-main">
          <div id="stage-head"></div>

          <div class="halo-wrap">
            <div class="halo">
              <div class="ring ring--outer"></div>
              <div class="ring ring--dashed"></div>
              <div class="ring ring--fine"></div>
              <div class="halo-core" id="halo-core">
                <div class="reveal-eyebrow" id="reveal-eyebrow">READY TO DRAW</div>
                <div class="reveal-name" id="reveal-name">等待开奖</div>
                <div class="reveal-meta" id="reveal-meta">按下「开始抽奖」</div>
              </div>
            </div>
          </div>

          <div class="draw-zone" id="draw-zone"></div>
        </section>

        <aside class="stage-side">
          <div class="panel prize-panel">
            <div class="panel-head">
              <div class="panel-title">奖项池<span class="en">Prize pool</span></div>
              <span class="badge" id="pool-badge">—</span>
            </div>
            <div class="panel-body">
              <div class="prize-list" id="prize-list"></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div class="panel-title">本场开奖<span class="en">Live feed</span></div>
              <span class="badge badge--mute" id="feed-badge">0 条</span>
            </div>
            <div class="panel-body feed-scroll" id="feed" style="padding-top:6px;padding-bottom:8px;max-height:286px;overflow:auto"></div>          </div>
        </aside>
      </div>
    </div>
  `;

  const els = {
    stageMain: host.querySelector('#stage-main'),
    head: host.querySelector('#stage-head'),
    zone: host.querySelector('#draw-zone'),
    prizeList: host.querySelector('#prize-list'),
    poolBadge: host.querySelector('#pool-badge'),
    feed: host.querySelector('#feed'),
    feedBadge: host.querySelector('#feed-badge'),
    revealName: host.querySelector('#reveal-name'),
    revealMeta: host.querySelector('#reveal-meta'),
    revealEyebrow: host.querySelector('#reveal-eyebrow'),
    core: host.querySelector('#halo-core'),
    switcher: host.querySelector('#act-switch'),
  };

  const currentPrize = () => state.current.prizes.find((p) => p.id === state.selectedPrizeId) || null;

  /* --------------------------------------------------------- 渲染分区 */

  function paintHead() {
    const activity = state.current;
    const remaining = activity.quotaView ? activity.quotaView.remaining : activity.stats.totalRemaining;
    const statusCls = activity.status === 'active' ? 'badge--ok' : activity.status === 'paused' ? 'badge--warn' : 'badge--mute';
    els.head.innerHTML = html`
      <div class="stage-head">
        <div>
          <div class="stage-topline">
            <span class="badge ${statusCls}">
              ${activity.status === 'active' ? raw('<span class="dot dot--live"></span>') : ''}${STATUS_LABEL[activity.status] || activity.status}
            </span>
            <span class="badge badge--square badge--gold">${MODE_LABEL[activity.mode] || activity.mode}</span>
            ${activity.mode === 'probability' && activity.missWeight > 0
              ? html`<span class="badge badge--mute">谢谢参与 ${activity.missWeight}</span>`
              : ''}
          </div>
          <h2 class="stage-title">${activity.name}</h2>
          <div class="stage-sub">${activity.subtitle || MODE_EN[activity.mode] || 'LOTTERY'}</div>
        </div>
        <div style="text-align:right">
          <div class="mute" style="font-size:10px;letter-spacing:.24em;text-transform:uppercase">剩余名额</div>
          <div class="num grad-num" style="font-size:34px;line-height:1.1;margin-top:6px">
            ${fmtNumber(remaining)}<span class="grad-num-unit">/ ${fmtNumber(activity.stats.totalQuota)}</span>
          </div>
          <div class="stage-bar-note">仅剩 ${fmtNumber(remaining)} 份 · 抽完即止</div>
        </div>
      </div>
    `;
  }

  function paintPrizeList() {
    const activity = state.current;
    const selectable = activity.mode === 'quota' && state.canDraw;
    els.poolBadge.textContent = `${activity.prizes.length} 项 · 剩 ${fmtNumber(activity.quotaView ? activity.quotaView.remaining : activity.stats.totalRemaining)}`;
    if (!activity.prizes.length) {
      els.prizeList.innerHTML = html`<div class="stage-empty">尚未配置奖项</div>`;
      return;
    }
    els.prizeList.innerHTML = activity.prizes
      .map((prize) => {
        const empty = prize.remaining <= 0;
        const active = selectable && prize.id === state.selectedPrizeId && !empty;
        return html`
          <button
            class="prize-row${active ? ' is-active' : ''}${empty ? ' is-empty' : ''}"
            type="button"
            data-prize="${prize.id}"
            ${empty || !selectable ? raw('disabled') : ''}
          >
            <span class="prize-swatch${prize.image ? ' prize-swatch--photo' : ''}" style="${prize.image ? '' : `background:${safeColor(prize.color)}`}">
              ${prize.image ? html`<img src="${prize.image}" alt="" />` : String(prize.level || prize.name).slice(0, 1)}
            </span>
            <span class="prize-info">
              <span class="prize-name">${prize.name}</span>
              <span class="prize-meta">${prize.level}${Number(prize.value) > 0 ? ` · 价值 ¥${fmtNumber(prize.value)}` : ''}${empty ? ' · 已抽完' : ''}</span>
              <span class="bar prize-bar"><i style="width:${pct(prize.remaining, prize.quota)}%"></i></span>
            </span>
            <span class="prize-count">${prize.remaining}<span>/${prize.quota}</span></span>
          </button>
        `;
      })
      .join('');

    if (selectable) {
      els.prizeList.querySelectorAll('[data-prize]:not([disabled])').forEach((row) => {
        row.addEventListener('click', () => {
          if (state.drawing) return;
          state.selectedPrizeId = row.dataset.prize;
          paintPrizeList();
          paintDrawZone();
        });
      });
    }
  }

  function paintFeed() {
    els.feedBadge.textContent = `${state.feed.length} 条`;
    if (!state.feed.length) {
      els.feed.innerHTML = html`<div class="empty" style="padding:30px 8px">${raw(icon('inbox', 24, 1.2))}本场还没有开奖</div>`;
      return;
    }
    els.feed.innerHTML = html`
      <div class="feed">
        ${state.feed.map(
          (record) => html`
            <div class="feed-item">
              <span class="feed-dot${record.hit === false ? ' is-miss' : ''}"></span>
              <div class="feed-main">
                <div class="feed-title">${record.hit === false ? '谢谢参与' : record.prizeName}</div>
                <div class="feed-meta">
                  <span>${record.participant || record.code || '匿名'}</span>
                  <span class="sep"></span>
                  <span>${fmtClock(record.at)}</span>
                  <span class="sep"></span>
                  <span>${record.operatorName}</span>
                </div>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  function hintText() {
    const activity = state.current;
    if (activity.status !== 'active') return `活动当前为「${STATUS_LABEL[activity.status]}」，开奖已暂停`;
    if (activity.mode === 'quota') {
      const prize = currentPrize();
      if (!prize) return '点击右侧奖项，选择本次要抽取的名额';
      if (prize.remaining <= 0) return `「${prize.name}」名额已抽完，请选择其他奖项`;
      return `本次抽取「${prize.name}」 · 剩余 ${prize.remaining} / ${prize.quota}`;
    }
    if (activity.mode === 'probability') {
      return `按权重随机开奖 · 谢谢参与权重 ${activity.missWeight || 0} · 抽中后扣减对应名额`;
    }
    const used = activity.codes?.used || 0;
    const total = activity.codes?.total || 0;
    const phoneTip = activity.phoneRequired === false ? '' : ' · 发码时登记过手机号的需核对手机号';
    return `一码一次 · 已使用 ${used} / ${total} 枚抽奖码${phoneTip}`;
  }

  function drawDisabled() {
    const activity = state.current;
    if (!state.canDraw || state.drawing) return true;
    if (activity.status !== 'active') return true;
    if (activity.stats.totalRemaining <= 0) return true;
    if (activity.mode === 'quota') {
      const prize = currentPrize();
      return !prize || prize.remaining <= 0;
    }
    return false;
  }

  function paintDrawZone() {
    const activity = state.current;
    const participantField =
      activity.mode === 'code'
        ? html`
            <div class="field">
              <label for="code-input">抽奖码 / Ticket</label>
              <input class="input" id="code-input" placeholder="输入 6 位码即可" autocomplete="off" spellcheck="false"
                style="text-transform:uppercase;letter-spacing:.22em;font-family:var(--mono);text-align:center" />
            </div>
            <div class="field" id="code-phone-field" style="display:none">
              <label for="code-phone">核对手机号 / Phone</label>
              <input class="input" id="code-phone" inputmode="numeric" maxlength="11" autocomplete="off"
                placeholder="这枚码登记的手机号" style="letter-spacing:.08em;font-family:var(--mono);text-align:center" />
              <span class="form-note" id="code-phone-note" style="display:block;text-align:center;margin-top:6px"></span>
            </div>
          `
        : activity.mode === 'quota'
          ? html`
              <div class="field">
                <label>参与名单 / Roster</label>
                <div class="form-note" style="text-align:center;width:100%;margin:0">
                  名单 ${activity.roster?.total || 0} 人 · 已抽 ${activity.roster?.won || 0} · 还没抽 ${activity.roster?.left || 0}
                  ${(activity.roster?.total || 0) === 0 ? ' · 请先在活动编辑里导入名单' : ''}
                </div>
              </div>
            `
          : html`
            <div class="field">
              <label for="participant">参与者 / Guest</label>
              <input class="input" id="participant" placeholder="姓名或工号（选填）" autocomplete="off" maxlength="40" style="text-align:center" />
            </div>
          `;

    els.zone.innerHTML = html`
      <form class="stage-form" id="stage-form">
        ${participantField}
        <button class="draw-btn${state.rolling ? ' is-stop' : ''}" id="draw-btn" type="submit" ${drawDisabled() ? raw('disabled') : ''}>
          <span id="draw-btn-label">${state.drawing ? '揭晓中' : state.rolling ? '停止' : '开始抽奖'}</span>
          <kbd class="kbd">Space</kbd>
        </button>
      </form>
      <p class="draw-hint" id="draw-hint">${state.rolling ? '滚动中 · 再按一次「停止」揭晓结果' : hintText()}</p>
      ${state.canDraw && state.lastResult
        ? html`<button class="btn btn--ghost btn--sm" id="save-win" type="button" style="margin-top:2px">
            ${raw(icon('download', 14))} 保存获奖图
          </button>`
        : ''}
      ${!state.canDraw ? html`<p class="draw-hint" style="color:var(--danger)">当前账号没有「执行抽奖」权限</p>` : ''}
    `;

    els.zone.querySelector('#stage-form').addEventListener('submit', (event) => {
      event.preventDefault();
      toggleDraw();
    });

    // 输入抽奖码后先查这枚码：登记了手机号才把手机号框弹出来
    const codeInput = els.zone.querySelector('#code-input');
    if (codeInput) {
      let timer = null;
      const schedule = (silent) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const code = codeInput.value.trim().toUpperCase();
          if (code.length < 4) {
            state.codeLookup = null;
            hidePhoneField();
            return;
          }
          lookupCode(code, { silent });
        }, silent ? 420 : 260);
      };
      codeInput.addEventListener('input', () => {
        state.codeLookup = null;
        hidePhoneField();
        schedule(true);
      });
      codeInput.addEventListener('blur', () => schedule(true));
    }

    els.zone.querySelector('#save-win')?.addEventListener('click', async () => {
      const last = state.lastResult;
      if (!last) return;
      try {
        await saveWinnerCard(last, `中奖-${last.code || 'award'}.jpg`);
      } catch {
        toast('生成图片失败，请截图保存', 'err');
      }
    });
  }

  /* ------------------------------------------------------------- 开奖 */

  function revealPhoneField(info) {
    const field = els.zone.querySelector('#code-phone-field');
    if (!field) return;
    field.style.display = 'flex';
    const note = els.zone.querySelector('#code-phone-note');
    if (note) {
      const who = [info.holder, info.phoneMask].filter(Boolean).join(' · ');
      note.textContent = who ? `这枚码登记：${who}` : '这枚码登记了手机号';
    }
  }

  function hidePhoneField() {
    const field = els.zone.querySelector('#code-phone-field');
    if (field) field.style.display = 'none';
    const input = els.zone.querySelector('#code-phone');
    if (input) input.value = '';
    const note = els.zone.querySelector('#code-phone-note');
    if (note) note.textContent = '';
  }

  async function lookupCode(code, { silent } = {}) {
    const activity = state.current;
    if (!activity || activity.mode !== 'code') return null;
    try {
      const info = await api.get(`/activities/${activity.id}/codes/${encodeURIComponent(code)}/lookup`);
      state.codeLookup = info;
      if (info.needsPhone) revealPhoneField(info);
      else hidePhoneField();
      if (!silent && info.used) toast('这枚码已经抽过了', 'err');
      return info;
    } catch (err) {
      state.codeLookup = null;
      hidePhoneField();
      if (!silent) toast(err.message || '没有找到这枚抽奖码', 'err');
      return null;
    }
  }

  async function ensureCodeLookup(code) {
    if (state.codeLookup && state.codeLookup.code === code) return state.codeLookup;
    return lookupCode(code, { silent: false });
  }

  function setReveal({ eyebrow, name, meta, gold = false }) {
    els.revealEyebrow.textContent = eyebrow;
    els.revealName.textContent = name;
    els.revealMeta.innerHTML = meta;
    els.revealName.classList.toggle('is-gold', gold);
    els.core.classList.remove('reveal-pop');
    void els.core.offsetWidth;
    els.core.classList.add('reveal-pop');
  }

  function startShuffle() {
    const pool = state.current.prizes.map((p) => p.name);
    const el = els.revealName;
    el.classList.remove('is-gold');
    const timer = setInterval(() => {
      const pick = pool[Math.floor(Math.random() * Math.max(1, pool.length))] || '？？？';
      el.textContent = pick;
    }, 70);
    state.timers.push(timer);
    els.revealEyebrow.textContent = 'DRAWING';
    els.revealMeta.textContent = '正在揭晓…';
    return timer;
  }

  function stopTimers() {
    state.timers.forEach((t) => clearInterval(t));
    state.timers = [];
  }

  async function buildDrawBody() {
    const activity = state.current;
    const body = {};
    if (activity.mode === 'quota') {
      const prize = currentPrize();
      if (!prize || prize.remaining <= 0) {
        toast('请先选择一个仍有名额的奖项', 'err');
        return null;
      }
      body.prizeId = prize.id;
    }
    if (activity.mode === 'code') {
      const input = els.zone.querySelector('#code-input');
      const code = (input?.value || '').trim().toUpperCase();
      if (!code) {
        toast('请输入抽奖码', 'err');
        input?.focus();
        return null;
      }
      // 先查这枚码：不存在 / 已抽过 / 是否登记了手机号 —— 查清楚再转，和学员页一个逻辑
      const info = await ensureCodeLookup(code);
      if (!info) {
        input?.focus();
        input?.select();
        return null;
      }
      if (info.used) {
        toast('这枚码已经抽过了，不能再开奖', 'err');
        input?.focus();
        input?.select();
        return null;
      }
      if (info.needsPhone) {
        const phoneInput = els.zone.querySelector('#code-phone');
        const phone = (phoneInput?.value || '').replace(/\D/g, '');
        if (!phone) {
          revealPhoneField(info);
          phoneInput?.focus();
          toast('这枚码登记了手机号，请核对后再开奖', 'err');
          return null;
        }
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          toast('手机号要填 11 位', 'err');
          phoneInput?.focus();
          return null;
        }
        body.phone = phone;
      }
      body.code = code;
    } else {
      const input = els.zone.querySelector('#participant');
      if (input?.value.trim()) body.participant = input.value.trim();
    }
    return body;
  }

  function setDrawButton(label, { disabled = false, stop = false } = {}) {
    const button = els.zone.querySelector('#draw-btn');
    const labelEl = els.zone.querySelector('#draw-btn-label');
    if (button) {
      button.disabled = disabled;
      button.classList.toggle('is-stop', stop);
    }
    if (labelEl) labelEl.textContent = label;
  }

  /** 第一次点击开始滚，再点一次停止并揭晓 */
  function toggleDraw() {
    if (state.rolling) {
      stopRolling();
      return;
    }
    startRolling();
  }

  async function startRolling() {
    if (state.drawing || state.rolling || !state.canDraw) return;
    const body = await buildDrawBody();
    if (!body) return;

    state.pendingBody = body;
    state.rolling = true;
    state.shuffle = startShuffle();
    els.stageMain.classList.add('is-drawing');
    els.zone.querySelector('input')?.setAttribute('disabled', '');
    setDrawButton('停止', { stop: true });
    const hint = els.zone.querySelector('#draw-hint');
    if (hint) hint.textContent = '滚动中 · 再按一次「停止」揭晓结果';
  }

  async function stopRolling() {
    if (!state.rolling) return;
    state.rolling = false;
    if (state.shuffle) {
      clearInterval(state.shuffle);
      state.timers = state.timers.filter((t) => t !== state.shuffle);
      state.shuffle = null;
    }
    state.drawing = true;
    setDrawButton('揭晓中', { disabled: true });
    els.revealEyebrow.textContent = 'SETTLING';
    els.revealMeta.textContent = '正在揭晓…';

    const activity = state.current;
    const body = state.pendingBody || {};
    state.pendingBody = null;

    try {
      const result = await api.post(`/activities/${activity.id}/draw`, body);
      finishDraw(result);
    } catch (err) {
      state.drawing = false;
      els.stageMain.classList.remove('is-drawing');
      setReveal({
        eyebrow: 'NOT THIS TIME',
        name: '未能开奖',
        meta: esc(err.message),
        gold: false,
      });
      toast(err.message, 'err');
      paintDrawZone();
      paintPrizeList();
      if (err.code === 'phone_required' || err.code === 'phone_mismatch') {
        els.zone.querySelector('#code-phone')?.focus();
      }
    }
  }

  function finishDraw(result) {
    state.drawing = false;
    state.rolling = false;
    state.shuffle = null;
    state.codeLookup = null;
    if (!els.core.isConnected) return;
    els.stageMain.classList.remove('is-drawing');

    const beforeName = result.hit ? result.prize.name : '谢谢参与';
    const winner = result.record?.participant || result.holder || '';
    setReveal({
      eyebrow: result.hit ? 'CONGRATULATIONS' : 'THANKS FOR PLAYING',
      name: beforeName,
      meta: result.hit
        ? [esc(result.prize.level), winner ? esc(winner) : '', `剩余 ${result.prize.remaining} / ${result.prize.quota}`]
            .filter(Boolean)
            .join(' · ')
        : '本次没有抽中，名额未扣减',
      gold: Boolean(result.hit),
    });

    if (result.hit) {
      const rect = els.core.getBoundingClientRect();
      burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 110, power: 1.05 });
      setTimeout(celebrate, 180);
      playResult(true);
    } else {
      playResult(false);
    }

    state.current = result.activity;
    state.feed.unshift(result.record);
    state.feed = state.feed.slice(0, 12);

    if (result.hit) {
      state.lastResult = {
        activityName: result.activity.name,
        level: result.prize.level,
        prizeName: result.prize.name,
        image: result.prize.image || '',
        value: result.prize.value || 0,
        holder: winner,
        phone: result.phone || '',
        code: result.record.code || '',
        at: result.record.at,
      };
    }

    if (result.hit) {
      const hitPrize = state.current.prizes.find((p) => p.id === result.record.prizeId);
      if (hitPrize && hitPrize.remaining <= 0) {
        const next = state.current.prizes.find((p) => p.remaining > 0);
        state.selectedPrizeId = next ? next.id : '';
      }
    }

    paintHead();
    paintPrizeList();
    paintFeed();
    paintDrawZone();

    toast(result.message, result.hit ? 'ok' : 'info', 3200);

    const activitySelect = host.querySelector('#act-switch');
    if (activitySelect) {
      const option = Array.from(activitySelect.options).find((o) => o.value === state.current.id);
      if (option) option.textContent = state.current.name;
    }
  }

  /* ------------------------------------------------------------- 数据 */

  async function loadFeed() {
    if (!ctx.can('record.view')) {
      state.feed = [];
      paintFeed();
      return;
    }
    try {
      const { records } = await api.get(`/records?activityId=${encodeURIComponent(state.current.id)}&limit=10`);
      state.feed = records;
    } catch {
      state.feed = [];
    }
    paintFeed();
  }

  function schedulePaint() {
    paintHead();
    paintPrizeList();
    paintDrawZone();
    loadFeed();
  }

  /* 每 6 秒同步一次：名额/金额/奖项池/开奖记录，不用手动刷新 */
  async function syncLive() {
    if (document.hidden || state.drawing || !state.current) return;
    try {
      const { activity } = await api.get(`/activities/${state.current.id}`);
      state.current = activity;
      paintHead();
      paintPrizeList();
      if (ctx.can('record.view')) {
        const { records } = await api.get(
          `/records?activityId=${encodeURIComponent(activity.id)}&limit=10`,
        );
        state.feed = records;
        paintFeed();
      }
    } catch {
      /* 断网或权限变化时保持现状 */
    }
  }

  /* ------------------------------------------------------------- 事件 */

  els.switcher.addEventListener('change', () => {
    const next = state.activities.find((a) => a.id === els.switcher.value);
    if (!next || next.id === state.current.id) return;
    state.current = next;
    state.rolling = false;
    state.drawing = false;
    state.pendingBody = null;
    stopTimers();
    const available = next.prizes.find((p) => p.remaining > 0);
    state.selectedPrizeId = available ? available.id : '';
    localStorage.setItem('aurum.stage.activity', next.id);
    history.replaceState(null, '', `#/stage?act=${next.id}`);
    setReveal({
      eyebrow: 'READY TO DRAW',
      name: '等待开奖',
      meta: '按下「开始抽奖」',
      gold: false,
    });
    schedulePaint();
  });

  host.querySelector('#sound-btn').addEventListener('click', (event) => {
    const on = sfx.toggle();
    const button = event.currentTarget;
    button.innerHTML = `${icon(on ? 'volume' : 'muted', 15)} <span id="sound-label">${on ? '音效开' : '音效关'}</span>`;
  });

  host.querySelector('#cinema-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const enable = !document.body.classList.contains('is-cinema');
    document.body.classList.toggle('is-cinema', enable);
    button.innerHTML = enable
      ? `${icon('x', 15)} 退出大屏`
      : `${icon('expand', 15)} 大屏模式`;
    try {
      if (enable && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      if (!enable && document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      /* 全屏可能被浏览器策略拒绝，CSS 大屏仍然生效 */
    }
  });

  const onFullscreenChange = () => {
    if (!document.fullscreenElement) {
      document.body.classList.remove('is-cinema');
      const button = host.querySelector('#cinema-btn');
      if (button) button.innerHTML = `${icon('expand', 15)} 大屏模式`;
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);

  const onKeydown = (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    const tag = (event.target?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
    if (document.getElementById('layers')?.children.length) return;
    event.preventDefault();
    toggleDraw();
  };
  document.addEventListener('keydown', onKeydown);

  schedulePaint();

  const liveTimer = setInterval(syncLive, 6000);
  const onVisible = () => {
    if (!document.hidden) syncLive();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopTimers();
    clearInterval(liveTimer);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.body.classList.remove('is-cinema');
  };
}
