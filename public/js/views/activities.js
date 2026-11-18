import { api } from '../api.js';
import {
  html,
  raw,
  icon,
  esc,
  toast,
  openDrawer,
  openModal,
  confirmDialog,
  fmtNumber,
  pct,
  fmtTime,
} from '../ui.js';
import { qrSvg } from '../qr.js';
import { renderQrPoster, downloadPoster } from '../qr-poster.js';

const MODE_LABEL = { quota: '名单抽奖', probability: '概率抽奖', code: '抽奖码' };
const MODE_ART = {
  quota: 'rgba(217, 183, 124, 0.32)',
  probability: 'rgba(126, 148, 178, 0.26)',
  code: 'rgba(186, 132, 120, 0.24)',
};
const STATUS = {
  active: { label: '进行中', cls: 'badge--ok' },
  paused: { label: '已暂停', cls: 'badge--warn' },
  draft: { label: '草稿', cls: 'badge--mute' },
  ended: { label: '已结束', cls: 'badge--mute' },
};

const COLORS = ['#E4C58C', '#D9B77C', '#C9A25F', '#B08C55', '#8C7A5B', '#A8844F', '#7E6E52'];

function escapeAttr(value) {
  return String(value ?? '').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------ 奖项编辑 */

function prizeRowsMarkup(prizes) {
  return prizes
    .map(
      (prize, index) => html`
        <div class="prize-edit-row" data-row="${index}" data-prize-id="${escapeAttr(prize.id || '')}" data-image="${escapeAttr(prize.image || '')}">
          <input class="swatch-btn" type="color" value="${escapeAttr(prize.color || COLORS[index % COLORS.length])}" data-field="color" title="奖项颜色" />
          <input class="input" data-field="name" value="${escapeAttr(prize.name)}" placeholder="奖项名称，如 一等奖 · iPhone" maxlength="60" />
          <input class="input" data-field="level" value="${escapeAttr(prize.level || '')}" placeholder="等级" maxlength="20" />
          <input class="input" data-field="quota" type="number" min="0" step="1" value="${Number(prize.quota) || 0}" title="名额" />
          <input class="input" data-field="weight" type="number" min="0" step="1" value="${Number(prize.weight) || 0}" title="权重" />
          <input class="input" data-field="value" type="number" min="0" step="1" value="${Number(prize.value) || 0}" title="奖品价值（元）" placeholder="价值" />
          <button class="prize-thumb" type="button" data-upload title="点击上传样品图（右键清除）">
            ${prize.image ? html`<img src="${escapeAttr(prize.image)}" alt="" />` : raw(icon('image', 15))}
          </button>
          <button class="icon-btn" type="button" data-remove="${index}" title="删除该奖项">${raw(icon('trash', 15))}</button>
        </div>
      `,
    )
    .join('');
}

function compressImage(file, max = 900, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请换一张'));
    };
    img.src = url;
  });
}

function collectPrizes(container) {
  return Array.from(container.querySelectorAll('.prize-edit-row'))
    .map((row) => {
      const prize = {
        name: row.querySelector('[data-field="name"]').value.trim(),
        level: row.querySelector('[data-field="level"]').value.trim(),
        quota: Number(row.querySelector('[data-field="quota"]').value) || 0,
        weight: Number(row.querySelector('[data-field="weight"]').value) || 0,
        value: Number(row.querySelector('[data-field="value"]').value) || 0,
        color: row.querySelector('[data-field="color"]').value,
        image: row.dataset.image || '',
      };
      if (row.dataset.prizeId) prize.id = row.dataset.prizeId;
      return prize;
    })
    .filter((prize) => prize.name);
}

/* --------------------------------------------------------------- 抽屉 */

function openActivityEditor({ activity, onSaved }) {
  const isEdit = Boolean(activity);
  const initial = activity
    ? {
        name: activity.name,
        subtitle: activity.subtitle || '',
        description: activity.description || '',
        mode: activity.mode,
        status: activity.status,
        publicRedeem: Boolean(activity.publicRedeem),
        participantLimit: activity.participantLimit || 0,
        missWeight: activity.missWeight ?? 30,
        campuses: activity.campuses || [],
        campusRequired: Boolean(activity.campusRequired),
        nameRequired: activity.nameRequired !== false,
        phoneRequired: activity.phoneRequired !== false,
        prizes: activity.prizes.map((p) => ({ ...p })),
      }
    : {
        name: '',
        subtitle: '',
        description: '',
        mode: 'quota',
        status: 'active',
        publicRedeem: false,
        participantLimit: 0,
        missWeight: 30,
        campuses: [],
        campusRequired: false,
        nameRequired: true,
        phoneRequired: true,
        prizes: [{ name: '', level: '', quota: 1, weight: 1, color: COLORS[0] }],
      };

  const body = document.createElement('div');
  body.innerHTML = html`
    <form id="activity-form" autocomplete="off">
      <div class="form-section">
        <div class="form-grid">
          <div class="field span-2">
            <label>活动名称</label>
            <input class="input" name="name" value="${escapeAttr(initial.name)}" maxlength="40" placeholder="例如：七周年店庆 · 会员抽奖" required />
          </div>
          <div class="field">
            <label>英文副标（选填）</label>
            <input class="input" name="subtitle" value="${escapeAttr(initial.subtitle)}" maxlength="60" placeholder="ANNUAL GALA 2026" />
          </div>
          <div class="field">
            <label>活动状态</label>
            <select class="select" name="status">
              ${['active', 'paused', 'draft', 'ended'].map(
                (key) => html`<option value="${key}"${initial.status === key ? raw(' selected') : ''}>${STATUS[key].label}</option>`,
              )}
            </select>
          </div>
          <div class="field span-2">
            <label>活动说明（选填）</label>
            <textarea class="textarea" name="description" maxlength="200" placeholder="一句话说明现场规则">${initial.description}</textarea>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">抽奖方式<em>Draw mode</em></div>
        <div class="segmented" id="mode-switch">
          ${Object.entries(MODE_LABEL).map(
            ([key, label]) => html`<button type="button" data-mode="${key}" class="${initial.mode === key ? 'is-active' : ''}">${label}</button>`,
          )}
        </div>
        <p class="form-note" id="mode-note"></p>
        <div class="form-grid">
          <div class="field">
            <label>每人限抽次数</label>
            <input class="input" name="participantLimit" type="number" min="0" step="1" value="${initial.participantLimit}" />
            <span class="form-note">0 表示不限；按参与者姓名统计。</span>
          </div>
          <div class="field" id="miss-field">
            <label>谢谢参与权重</label>
            <input class="input" name="missWeight" type="number" min="0" step="1" value="${initial.missWeight}" />
            <span class="form-note">仅概率抽奖生效，越大越容易不中奖。</span>
          </div>
        </div>
        <div class="field" id="public-field">
          <label>学员自助开奖</label>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="switch${initial.publicRedeem ? ' is-on' : ''}" id="public-switch" role="switch" tabindex="0"
              aria-checked="${initial.publicRedeem ? 'true' : 'false'}"></span>
            <span class="form-note" style="margin:0">开启后学员扫码打开 <b>/redeem</b>，输入码即可自行开奖，无需登录。</span>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">发码字段<em>Issue fields</em></div>
        <div class="field">
          <label>预设校区（一行一个，选填）</label>
          <textarea class="textarea" name="campuses" style="min-height:76px"
            placeholder="海淀校区&#10;朝阳校区&#10;西城校区">${initial.campuses.join('\n')}</textarea>
          <span class="form-note">填了之后，发码时的校区会变成「可搜索、只能选不能写」的下拉列表；留空则仍可自由填写。</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>姓名必填</label>
            <span class="switch${initial.nameRequired ? ' is-on' : ''}" id="req-name" role="switch" tabindex="0"
              aria-checked="${initial.nameRequired ? 'true' : 'false'}"></span>
          </div>
          <div class="field">
            <label>手机号必填</label>
            <span class="switch${initial.phoneRequired ? ' is-on' : ''}" id="req-phone" role="switch" tabindex="0"
              aria-checked="${initial.phoneRequired ? 'true' : 'false'}"></span>
          </div>
          <div class="field">
            <label>校区必填</label>
            <span class="switch${initial.campusRequired ? ' is-on' : ''}" id="req-campus" role="switch" tabindex="0"
              aria-checked="${initial.campusRequired ? 'true' : 'false'}"></span>
          </div>
        </div>
        <p class="form-note">关掉某个开关，发码时那一项就可以留空（例如只发码不登记姓名）。</p>
      </div>

      <div class="form-section">
        <div class="form-section-title">
          奖项与名额
          <em>Prizes / quota</em>
        </div>
        <div class="prize-edit-head">
          <span></span><span>奖项名称</span><span>等级</span><span>名额</span><span>权重</span><span>价值</span><span>图</span><span></span>
        </div>
        <div class="prize-editor" id="prize-editor"></div>
        <div>
          <button class="btn btn--ghost btn--sm" type="button" id="add-prize">${raw(icon('plus', 14))} 添加奖项</button>
        </div>
        <p class="form-note">「名额」是名单抽奖的核心：每抽中一次自动减一，减到 0 即显示「已抽完」。</p>
      </div>

      <div class="form-section" id="roster-section" style="display:none">
        <div class="form-section-title">
          参与名单
          <em>Roster</em>
        </div>
        <div class="field">
          <label>名单 <span class="form-note" id="roster-stat" style="margin:0"></span></label>
          <textarea class="textarea" id="roster-text" style="min-height:110px"
            placeholder="一行一个：姓名 手机号（手机号可不填）&#10;张伟 13800001111&#10;李娜"></textarea>
          <span class="form-note">名单抽奖时，每抽一次从这里随机抽一个还没中奖的人；抽中后自动标记，不会重复中奖。</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn--gold btn--sm" type="button" id="roster-save">保存名单</button>
            <button class="btn btn--ghost btn--sm" type="button" id="roster-from-codes">用发码记录生成</button>
            <button class="btn btn--ghost btn--sm" type="button" id="roster-reset">重置中奖状态</button>
            <button class="btn btn--ghost btn--sm" type="button" id="roster-clear">清空名单</button>
          </div>
        </div>
      </div>
    </form>
  `;

  const prizeContainer = body.querySelector('#prize-editor');
  prizeContainer.innerHTML = prizeRowsMarkup(initial.prizes);
  let currentMode = initial.mode;

  /* ---- 参与名单（名单抽奖） ---- */
  const rosterSection = body.querySelector('#roster-section');
  const rosterText = body.querySelector('#roster-text');
  const rosterStat = body.querySelector('#roster-stat');
  const rosterId = activity.id || '';

  const paintRosterStat = (summary) => {
    if (!rosterStat || !summary) return;
    rosterStat.textContent = `名单 ${summary.total} 人 · 已抽 ${summary.won} · 还没抽 ${summary.left}`;
  };

  const loadRoster = async () => {
    if (!rosterId) return;
    try {
      const { roster, summary } = await api.get(`/activities/${rosterId}/roster`);
      rosterText.value = (roster || []).map((r) => (r.phone ? `${r.name} ${r.phone}` : r.name)).join('\n');
      paintRosterStat(summary);
    } catch {
      /* 名单接口不可用时不影响其他编辑 */
    }
  };

  if (rosterId) {
    loadRoster();
    body.querySelector('#roster-save')?.addEventListener('click', async () => {
      try {
        const { summary } = await api.put(`/activities/${rosterId}/roster`, { text: rosterText.value });
        paintRosterStat(summary);
        toast('名单已保存', 'ok');
        loadRoster();
      } catch (error) {
        toast(error.message || '保存失败', 'err');
      }
    });
    body.querySelector('#roster-from-codes')?.addEventListener('click', async () => {
      try {
        const { added, summary } = await api.post(`/activities/${rosterId}/roster/from-codes`, {});
        paintRosterStat(summary);
        toast(`从发码记录补了 ${added} 人`, 'ok');
        loadRoster();
      } catch (error) {
        toast(error.message || '生成失败', 'err');
      }
    });
    body.querySelector('#roster-reset')?.addEventListener('click', async () => {
      try {
        const { summary } = await api.post(`/activities/${rosterId}/roster/reset`, {});
        paintRosterStat(summary);
        toast('中奖状态已重置', 'ok');
      } catch (error) {
        toast(error.message || '重置失败', 'err');
      }
    });
    body.querySelector('#roster-clear')?.addEventListener('click', async () => {
      try {
        const { summary } = await api.del(`/activities/${rosterId}/roster`);
        rosterText.value = '';
        paintRosterStat(summary);
        toast('名单已清空', 'ok');
      } catch (error) {
        toast(error.message || '清空失败', 'err');
      }
    });
  }

  const modeNote = body.querySelector('#mode-note');
  const missField = body.querySelector('#miss-field');
  const publicField = body.querySelector('#public-field');
  const publicSwitch = body.querySelector('#public-switch');
  let publicEnabled = initial.publicRedeem;

  const togglePublic = () => {
    publicEnabled = !publicEnabled;
    publicSwitch.classList.toggle('is-on', publicEnabled);
    publicSwitch.setAttribute('aria-checked', publicEnabled ? 'true' : 'false');
  };
  publicSwitch.addEventListener('click', togglePublic);
  publicSwitch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePublic();
    }
  });

  const reqState = {
    name: initial.nameRequired,
    phone: initial.phoneRequired,
    campus: initial.campusRequired,
  };
  const bindReqSwitch = (selector, key) => {
    const el = body.querySelector(selector);
    const toggle = () => {
      reqState[key] = !reqState[key];
      el.classList.toggle('is-on', reqState[key]);
      el.setAttribute('aria-checked', String(reqState[key]));
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  };
  bindReqSwitch('#req-name', 'name');
  bindReqSwitch('#req-phone', 'phone');
  bindReqSwitch('#req-campus', 'campus');

  const paintModeUi = () => {
    const notes = {
      quota: '名单抽奖：操作者手动选择奖项，每次从参与名单里随机抽一人，抽中即得该奖、名额减一，抽完即止。',
      probability: '概率抽奖：按奖项权重随机开奖，命中后同样扣减名额；可设置「谢谢参与」。',
      code: '抽奖码：为每位参与者生成一枚码，输入即开奖，一码一次、必中剩余奖项。',
    };
    modeNote.textContent = notes[currentMode];
    missField.style.display = currentMode === 'probability' ? '' : 'none';
    publicField.style.display = currentMode === 'code' ? '' : 'none';
    if (rosterSection) rosterSection.style.display = currentMode === 'quota' && rosterId ? '' : 'none';
    prizeContainer.querySelectorAll('[data-field="weight"]').forEach((input) => {
      input.disabled = currentMode !== 'probability';
      input.style.opacity = currentMode === 'probability' ? '1' : '0.35';
    });
  };

  body.querySelectorAll('#mode-switch button').forEach((button) => {
    button.addEventListener('click', () => {
      currentMode = button.dataset.mode;
      body.querySelectorAll('#mode-switch button').forEach((b) => b.classList.toggle('is-active', b === button));
      paintModeUi();
    });
  });

  const bindRemove = () => {
    prizeContainer.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        if (prizeContainer.children.length <= 1) {
          toast('至少保留一个奖项', 'err');
          return;
        }
        button.closest('.prize-edit-row').remove();
      });
    });
  };

  body.querySelector('#add-prize').addEventListener('click', () => {
    const index = prizeContainer.children.length;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = prizeRowsMarkup([{ name: '', level: '', quota: 1, weight: 1, color: COLORS[index % COLORS.length] }]);
    prizeContainer.appendChild(wrapper.firstElementChild);
    bindRemove();
    paintModeUi();
    prizeContainer.lastElementChild.querySelector('[data-field="name"]').focus();
  });

  paintModeUi();
  bindRemove();

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  body.appendChild(fileInput);
  let uploadRow = null;

  prizeContainer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-upload]');
    if (!button) return;
    uploadRow = button.closest('.prize-edit-row');
    fileInput.value = '';
    fileInput.click();
  });

  prizeContainer.addEventListener('contextmenu', (event) => {
    const button = event.target.closest('[data-upload]');
    if (!button) return;
    event.preventDefault();
    const row = button.closest('.prize-edit-row');
    row.dataset.image = '';
    button.innerHTML = icon('image', 15);
    toast('已清除样品图', 'info');
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file || !uploadRow) return;
    const row = uploadRow;
    const button = row.querySelector('[data-upload]');
    uploadRow = null;
    button.classList.add('is-loading');
    try {
      const dataUrl = await compressImage(file);
      const res = await api.post('/uploads', { dataUrl });
      row.dataset.image = res.url;
      button.innerHTML = `<img src="${res.url}" alt="" />`;
      toast('样品图已上传', 'ok');
    } catch (err) {
      toast(err.message || '上传失败', 'err');
    } finally {
      button.classList.remove('is-loading');
    }
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px';
  footer.innerHTML = html`
    <button class="btn btn--ghost btn--sm" type="button" data-cancel>取消</button>
    <button class="btn btn--gold btn--sm" type="button" data-save>${isEdit ? '保存配置' : '创建活动'}</button>
  `;

  const drawer = openDrawer({
    eyebrow: isEdit ? 'Configure event' : 'New event',
    title: isEdit ? '配置活动' : '新建活动',
    content: body,
    footer,
    className: 'drawer--wide',
  });

  footer.querySelector('[data-cancel]').addEventListener('click', () => drawer.close());

  footer.querySelector('[data-save]').addEventListener('click', async () => {
    const form = body.querySelector('#activity-form');
    const name = form.querySelector('[name="name"]').value.trim();
    if (!name) {
      toast('请填写活动名称', 'err');
      form.querySelector('[name="name"]').focus();
      return;
    }
    const prizes = collectPrizes(prizeContainer);
    if (!prizes.length) {
      toast('请至少填写一个奖项名称', 'err');
      return;
    }
    const payload = {
      name,
      subtitle: form.querySelector('[name="subtitle"]').value.trim(),
      description: form.querySelector('[name="description"]').value.trim(),
      mode: currentMode,
      status: form.querySelector('[name="status"]').value,
      publicRedeem: currentMode === 'code' ? publicEnabled : false,
      participantLimit: Number(form.querySelector('[name="participantLimit"]').value) || 0,
      missWeight: Number(form.querySelector('[name="missWeight"]').value) || 0,
      campuses: form
        .querySelector('[name="campuses"]')
        .value.split(/\n|,|，|、/)
        .map((item) => item.trim())
        .filter(Boolean),
      campusRequired: reqState.campus,
      nameRequired: reqState.name,
      phoneRequired: reqState.phone,
    };

    const saveButton = footer.querySelector('[data-save]');
    saveButton.disabled = true;
    saveButton.textContent = '保存中…';
    try {
      let activityId = activity?.id;
      if (activityId) {
        await api.patch(`/activities/${activityId}`, payload);
      } else {
        const created = await api.post('/activities', payload);
        activityId = created.activity.id;
      }
      await api.put(`/activities/${activityId}/prizes`, { prizes });
      toast(isEdit ? '活动已更新' : '活动已创建', 'ok');
      drawer.close();
      onSaved();
    } catch (err) {
      toast(err.message, 'err');
      saveButton.disabled = false;
      saveButton.textContent = isEdit ? '保存配置' : '创建活动';
    }
  });
}

/* ------------------------------------------------------------ 抽奖码 */

function downloadPng(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openQrModal({ title, url, note, filename, activityName = '', subtitle = '', code = '' }) {
  const canvas = renderQrPoster({
    url,
    activityName,
    subtitle,
    code,
    hint: code ? '让学员扫这个码开奖' : '扫码进入 · 输入抽奖码开奖',
  });
  const dataUrl = canvas.toDataURL('image/png');
  const content = html`
    <div class="qr-modal">
      <div class="qr-poster"><img src="${dataUrl}" alt="二维码海报" /></div>
      <p class="qr-url">${url}</p>
      ${note ? html`<p class="form-note" style="text-align:center;margin-top:8px">${note}</p>` : ''}
    </div>
  `;
  openModal({
    eyebrow: 'QR poster',
    title,
    content,
    actions: [
      {
        label: '下载图片 PNG',
        variant: 'btn--gold',
        onClick: () => downloadPoster(canvas, (filename || '活动二维码.png').replace(/\.svg$/i, '.png')),
      },
      { label: '关闭', onClick: ({ close }) => close() },
    ],
  });
}

function parseRoster(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,，\t]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      return { name: parts[0], phone: parts[1] || '', campus: parts[2] || '' };
    })
    .filter((entry) => entry.name);
}

function bindCombo(root) {
  const input = root.querySelector('input');
  const list = root.querySelector('.combo-list');
  const empty = root.querySelector('.combo-empty');
  const options = Array.from(list.querySelectorAll('[data-value]'));
  let committed = input.dataset.value || '';

  const render = () => {
    const keyword = input.value.trim().toLowerCase();
    let hits = 0;
    for (const option of options) {
      const hit = !keyword || option.dataset.value.toLowerCase().includes(keyword);
      option.classList.toggle('is-hidden', !hit);
      if (hit) hits += 1;
    }
    empty.classList.toggle('is-hidden', hits > 0);
  };
  const open = () => {
    list.classList.remove('is-hidden');
    render();
  };
  const close = () => list.classList.add('is-hidden');
  const choose = (option) => {
    committed = option.dataset.value;
    input.value = committed;
    input.dataset.value = committed;
    close();
  };

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', open);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const first = options.find((option) => !option.classList.contains('is-hidden'));
      if (first) choose(first);
    } else if (event.key === 'Escape') {
      input.value = committed;
      input.dataset.value = committed;
      close();
      event.stopImmediatePropagation();
    }
  });
  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      const typed = input.value.trim();
      const match = options.find((option) => option.dataset.value === typed);
      if (match) committed = match.dataset.value;
      input.value = committed;
      input.dataset.value = committed;
      close();
    }, 140);
  });
  input.addEventListener('change', () => {
    const typed = input.value.trim();
    const match = options.find((option) => option.dataset.value === typed);
    committed = match ? match.dataset.value : committed;
    input.value = committed;
    input.dataset.value = committed;
  });
  for (const option of options) {
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      choose(option);
    });
  }
}

function codeTitle(code) {
  if (!code.holder) return '未绑定 · 点击查看二维码';
  return [code.holder, code.phone ? maskPhone(code.phone) : code.tail ? `尾号 ${code.tail}` : '', code.campus, code.prizeName ? `中奖 ${code.prizeName}` : '']
    .filter(Boolean)
    .join(' · ');
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : digits || '—';
}

function downloadListCsv(codes, base = location.origin) {
  const rows = [['抽奖码', '姓名', '校区', '手机号', '状态', '奖项', '发放时间', '自助链接']];
  for (const code of codes) {
    rows.push([
      code.code,
      code.holder || '',
      code.campus || '',
      code.phone || (code.tail ? `尾号${code.tail}` : ''),
      code.used ? '已使用' : '未使用',
      code.prizeName || '',
      code.issuedAt ? new Date(code.issuedAt).toLocaleString('zh-CN') : '',
      `${base}/redeem?code=${encodeURIComponent(code.code)}`,
    ]);
  }
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `抽奖码名单-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function openTrash(onRestored) {
  const { items } = await api.get('/trash');
  const rows = items.length
    ? items
        .map(
          (item) => html`
            <tr>
              <td>
                <strong>${item.activityName}</strong>
                <div class="mute" style="font-size:11px;margin-top:2px">
                  ${MODE_LABEL[item.mode] || item.mode}${item.prizes ? ` · ${item.prizes} 个奖项` : ''}
                </div>
              </td>
              <td class="time">${fmtTime(item.deletedAt)}</td>
              <td>${item.deletedBy || '—'}</td>
              <td>${item.records} 条</td>
              <td>${Math.max(1, Math.round(item.bytes / 1024))} KB</td>
              <td class="right">
                <button class="btn btn--ghost btn--sm" data-restore="${escapeAttr(item.file)}" type="button">恢复</button>
              </td>
            </tr>
          `,
        )
        .join('')
    : '<tr><td colspan="6"><div class="empty">还没有可恢复的备份</div></td></tr>';

  const body = document.createElement('div');
  body.innerHTML = html`
    <div class="table-wrap" style="max-height:56vh;overflow:auto">
      <table class="table log-table">
        <thead>
          <tr>
            <th>活动</th>
            <th style="width:150px">删除时间</th>
            <th style="width:90px">删除人</th>
            <th style="width:70px">记录</th>
            <th style="width:70px">大小</th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>
    <p class="form-note" style="margin-top:12px">
      删除活动时自动生成，保留最近 30 份。恢复后活动回到列表，开奖记录一并还原（抽奖码、发码记录也在备份里）。
    </p>
  `;

  const drawer = openDrawer({
    eyebrow: 'Trash',
    title: '回收站 · 已删除的活动',
    content: body,
    className: 'drawer--wide',
  });

  body.querySelectorAll('[data-restore]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = items.find((entry) => entry.file === button.dataset.restore);
      if (!item) return;
      const confirmed = await confirmDialog({
        eyebrow: 'Restore',
        title: '恢复这个活动？',
        message: `将恢复「${item.activityName}」及其 ${item.records} 条开奖记录。\n\n恢复后活动会回到列表，状态与删除前一致。`,
        confirmText: '确认恢复',
      });
      if (!confirmed) return;
      button.disabled = true;
      try {
        const res = await api.post('/trash/restore', { file: item.file });
        toast(`已恢复「${res.activity.name}」，带回 ${res.records} 条记录`, 'ok', 4200);
        drawer.close();
        onRestored?.();
      } catch (err) {
        toast(err.message, 'err');
        button.disabled = false;
      }
    });
  });
}

async function openIssueLog(activity) {
  const { entries, total } = await api.get(`/activities/${activity.id}/codes/issue-log`);
  const campuses = [...new Set(entries.map((e) => e.campus).filter(Boolean))];

  const body = document.createElement('div');
  body.innerHTML = html`
    <div class="toolbar" style="margin-bottom:14px">
      <div class="search">
        ${raw(icon('search', 15))}
        <input class="input" id="log-q" placeholder="搜索姓名 / 手机号 / 抽奖码" autocomplete="off" />
      </div>
      <div class="field">
        <select class="select" id="log-campus">
          <option value="">全部校区</option>
          ${campuses.map((name) => html`<option value="${name}">${name}</option>`)}
        </select>
      </div>
      <div class="toolbar-spacer"></div>
      <span class="badge badge--mute" id="log-count">${entries.length} 条</span>
    </div>
    <div class="table-wrap" style="max-height:54vh;overflow:auto">
      <table class="table log-table">
        <thead>
          <tr>
            <th style="width:150px">发放时间</th>
            <th>抽奖码</th>
            <th>姓名</th>
            <th>手机号</th>
            <th>校区</th>
            <th>发放人</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody id="log-body"></tbody>
      </table>
    </div>
    <p class="form-note" style="margin-top:10px">展示最近 ${entries.length} 条，累计 ${total} 条；发放记录不会被解绑清除。</p>
  `;

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px';
  footer.innerHTML = html`
    <button class="btn btn--ghost btn--sm" type="button" id="log-export">导出记录 CSV</button>
    <button class="btn btn--ghost btn--sm" type="button" id="log-close">关闭</button>
  `;

  const drawer = openDrawer({
    eyebrow: 'Issue log',
    title: `${activity.name} · 发码记录`,
    content: body,
    footer,
    className: 'drawer--wide',
  });

  const tbody = drawer.body.querySelector('#log-body');
  const countEl = drawer.body.querySelector('#log-count');
  const queryEl = drawer.body.querySelector('#log-q');
  const campusEl = drawer.body.querySelector('#log-campus');

  let filtered = entries;

  const paintRows = () => {
    countEl.textContent = `${filtered.length} 条`;
    tbody.innerHTML = filtered.length
      ? filtered
          .map(
            (entry) => html`
              <tr>
                <td class="time">${fmtTime(entry.at)}</td>
                <td><strong style="font-family:var(--mono);font-size:11.5px">${entry.code}</strong></td>
                <td><strong>${entry.name}</strong></td>
                <td style="font-family:var(--mono);font-size:11.5px">${maskPhone(entry.phone)}</td>
                <td>${entry.campus || '—'}</td>
                <td>${entry.by || '—'}</td>
                <td>
                  ${entry.used
                    ? html`<span class="badge badge--ok">已抽</span>`
                    : entry.bound
                      ? html`<span class="badge badge--gold">待抽</span>`
                      : html`<span class="badge badge--mute">已解绑</span>`}
                </td>
              </tr>
            `,
          )
          .join('')
      : html`<tr><td colspan="7"><div class="empty">没有匹配的记录</div></td></tr>`;
  };

  const applyFilter = () => {
    const q = queryEl.value.trim().toLowerCase();
    const campus = campusEl.value;
    filtered = entries.filter((entry) => {
      if (campus && entry.campus !== campus) return false;
      if (!q) return true;
      return [entry.name, entry.code, entry.phone, entry.campus].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
    paintRows();
  };

  queryEl.addEventListener('input', applyFilter);
  campusEl.addEventListener('change', applyFilter);

  footer.querySelector('#log-close').addEventListener('click', () => drawer.close());
  footer.querySelector('#log-export').addEventListener('click', () => {
    const rows = [['发放时间', '抽奖码', '姓名', '手机号', '校区', '发放人', '状态']];
    for (const entry of filtered) {
      rows.push([
        new Date(entry.at).toLocaleString('zh-CN'),
        entry.code,
        entry.name,
        entry.phone,
        entry.campus || '',
        entry.by || '',
        entry.used ? '已抽' : entry.bound ? '待抽' : '已解绑',
      ]);
    }
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `发码记录-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('发码记录已导出', 'ok');
  });

  paintRows();
}

async function openCodes(activity, ctx) {
  const canManage = Boolean(ctx?.can?.('quota.reset'));
  const [summary, codesPayload] = await Promise.all([
    api.get(`/activities/${activity.id}/codes/summary`),
    canManage ? api.get(`/activities/${activity.id}/codes`) : Promise.resolve({ codes: [] }),
  ]);
  const codes = codesPayload.codes || [];
  const used = summary.used;
  const bound = summary.issued;
  const total = summary.total;
  let freeLeft = summary.free;
  const campuses = (summary.campuses || []).map((c) => c.name);
  const campusCount = new Map((summary.campuses || []).map((c) => [c.name, c.count]));
  const campusPresets = Array.isArray(activity.campuses) ? activity.campuses : [];
  const campusRequired = Boolean(activity.campusRequired);
  const nameRequired = activity.nameRequired !== false;
  const phoneRequired = activity.phoneRequired !== false;
  const settings = await api.get('/settings').catch(() => ({ publicBaseUrl: '' }));
  let publicBase = String(settings.publicBaseUrl || location.origin).replace(/\/+$/, '');
  let publicLink = `${publicBase}/redeem`;
  const savedCampus = localStorage.getItem('aurum.campus') || '';

  const body = document.createElement('div');
  body.innerHTML = html`
    <div class="form-section">
      <div class="form-section-title">学员自助链接<em>Public</em></div>
      <div class="qr-row">
        <div class="qr-mini" id="campaign-qr">${raw(qrSvg(publicLink, { size: 108, margin: 2 }))}</div>
        <div class="qr-side">
          <input class="input" readonly id="public-link" value="${publicLink}"
            style="height:38px;font-family:var(--mono);font-size:12px" />
          <div class="btn-row" style="margin-top:8px">
            <button class="btn btn--ghost btn--sm" id="copy-link" type="button">复制链接</button>
            <button class="btn btn--ghost btn--sm" id="save-qr" type="button">下载二维码</button>
            <a class="btn btn--ghost btn--sm" href="/redeem" target="_blank" rel="noopener">预览</a>
            <a class="btn btn--ghost btn--sm" href="/fama" target="_blank" rel="noopener" title="老师手机上发码用">手机发码页</a>
          </div>
          <p class="form-note" style="margin-top:8px">${activity.publicRedeem
            ? '学员扫码打开，输入码即可自行开奖（无需登录）。'
            : '未开启：先关闭本窗口，在「配置 → 学员自助开奖」里打开开关。'}</p>
        </div>
      </div>
      ${canManage
        ? html`<div class="base-url-row">
            <span class="form-note" style="margin:0;white-space:nowrap">对外地址</span>
            <input class="input" id="base-url" value="${escapeAttr(publicBase)}"
              placeholder="https://lucky.yourdomain.com" style="height:32px;font-size:12px" />
            <button class="btn btn--ghost btn--sm" id="save-base" type="button">保存</button>
          </div>
          <p class="form-note" style="margin-top:6px">二维码和导出的链接会用这个地址；留空或填错会印出打不开的码，上线前务必确认。</p>`
        : ''}
    </div>

    <div class="form-section">
      <div class="form-section-title">收费即发码<em id="issue-free">Issue on payment · 剩余空码 ${freeLeft}</em></div>
      <div class="form-grid">
        <div class="field">
          <label>学员姓名${nameRequired ? raw(' <b style="color:var(--danger);font-weight:500">*</b>') : ''}</label>
          <input class="input" id="issue-name" maxlength="20" placeholder="张三" />
        </div>
        <div class="field">
          <label>手机号${phoneRequired ? raw(' <b style="color:var(--danger);font-weight:500">*</b>') : ''}</label>
          <input class="input" id="issue-phone" maxlength="11" inputmode="numeric" placeholder="务必填写与学生订单一样的手机号" />
        </div>
        <div class="field">
          <label>校区${campusRequired ? raw(' <b style="color:var(--danger);font-weight:500">*</b>') : ''}</label>
          ${campusPresets.length
            ? html`<div class="combo" id="campus-combo">
                <input class="input" id="issue-campus" data-combo="1" autocomplete="off"
                  placeholder="${campusRequired ? '搜索并选择校区' : '点此选择校区（可跳过）'}"
                  value="${campusPresets.includes(savedCampus) ? savedCampus : ''}"
                  data-value="${campusPresets.includes(savedCampus) ? savedCampus : ''}" />
                <div class="combo-list is-hidden">
                  ${campusPresets.map(
                    (name) => html`<button type="button" class="combo-option" data-value="${escapeAttr(name)}">${name}</button>`,
                  )}
                  <div class="combo-empty is-hidden">没有匹配的校区</div>
                </div>
              </div>`
            : html`<input class="input" id="issue-campus" maxlength="20" list="campus-list" value="${savedCampus}" placeholder="选择或输入校区" />
                <datalist id="campus-list">
                  ${campuses.map((name) => html`<option value="${name}"></option>`)}
                </datalist>`}
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn btn--gold btn--sm" id="issue-btn" type="button" style="height:44px">发一枚码</button>
        </div>
      </div>
      <div class="issue-result is-hidden" id="issue-result">
        <div class="issue-code" id="issue-code">—</div>
        <div class="issue-meta" id="issue-meta"></div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn--ghost btn--sm" id="issue-copy" type="button">复制码</button>
          <button class="btn btn--ghost btn--sm" id="issue-qr" type="button">专属二维码</button>
        </div>
      </div>
      <p class="form-note">缴费现场用：填姓名与手机号，系统从空码里按顺序取一枚发给他，学员扫码开奖时用同一手机号核验。</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn--ghost btn--sm" id="issue-log-btn" type="button">${raw(icon('list', 14))} 查看发码记录</button>
      </div>
    </div>

    <div class="form-section" id="campus-section"${campuses.length ? '' : raw(' style="display:none"')}>
      <div class="form-section-title">校区发放<em id="campus-count">${campuses.length} 个校区</em></div>
      <div class="campus-chips" id="campus-chips">
        ${campuses.map((name) => html`<span class="campus-chip">${name}<b>${campusCount.get(name)}</b></span>`)}
      </div>
    </div>

    ${canManage
      ? html`
          <div class="form-section">
            <div class="form-section-title">批量绑名单<em id="bind-count">已绑定 ${bound} / 共 ${total}</em></div>
            <textarea class="textarea" id="bind-rows" style="min-height:96px"
              placeholder="已有名单时用：一行一位「张三,13800001234,${campusRequired ? '必填校区' : '校区（选填）'}」&#10;按顺序绑到未使用的空码上"></textarea>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn--ghost btn--sm" id="bind-btn" type="button">按顺序绑定</button>
              <button class="btn btn--ghost btn--sm" id="bind-reset" type="button">解除未使用的绑定</button>
              <button class="btn btn--ghost btn--sm" id="export-list" type="button">导出名单 CSV</button>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">抽奖码池<em id="grid-count">${used} / ${total} 已使用</em></div>
            <p class="form-note">每枚码只能开奖一次；点击任意码可查看它的专属二维码。仅管理员可见。</p>
            <div class="code-grid" id="code-grid"></div>
          </div>

          <div class="form-section">
            <div class="form-section-title">批量生成<em>Generate</em></div>
            <div class="form-grid" style="align-items:flex-end">
              <div class="field">
                <label>生成数量</label>
                <input class="input" id="code-count" type="number" min="1" max="500" value="50" />
              </div>
              <div class="field">
                <label>码前缀</label>
                <input class="input" id="code-prefix" maxlength="6" placeholder="ZX" style="text-transform:uppercase" />
              </div>
              <div class="field">
                <label>码长度</label>
                <select class="select" id="code-length">
                  <option value="6" selected>6 位（推荐 · 10 亿种）</option>
                  <option value="4">4 位（好念 · 104 万种）</option>
                  <option value="8">8 位（最保险）</option>
                </select>
              </div>
              <div class="field span-2">
                <button class="btn btn--gold btn--sm" id="gen-codes" type="button" style="height:44px">${raw(icon('plus', 15))} 生成</button>
                <button class="btn btn--ghost btn--sm" id="regen-codes" type="button" style="height:44px;margin-left:8px">重新发码（换成 6 位长码）</button>
                <span class="form-note" style="margin-top:8px">按校区/批次用不同前缀（如 BJ01、SH02），避免多场活动之间码重复。码越短越好念，但越容易被猜。</span>
              </div>
            </div>
          </div>
        `
      : html`
          <div class="form-section">
            <div class="form-section-title">码池状态<em>仅管理员可查看明细</em></div>
            <p class="form-note">为防止码外泄，普通账号看不到未发放的码；请通过上方「收费即发码」现场领取。已发出的码与发码记录可随时查看。</p>
          </div>
        `}
  `;

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px';
  footer.innerHTML = html`
    ${canManage
      ? html`<button class="btn btn--ghost btn--sm" type="button" data-copy>${raw(icon('copy', 14))} 复制未使用</button>`
      : ''}
    <button class="btn btn--ghost btn--sm" type="button" data-close>关闭</button>
  `;

  let stopLiveHook = () => {};
  const drawer = openDrawer({
    eyebrow: '抽奖码 · Ticket codes',
    title: activity.name,
    content: body,
    footer,
    onClose: () => stopLiveHook(),
  });

  const campusCombo = drawer.body.querySelector('#campus-combo');
  if (campusCombo) bindCombo(campusCombo);

  let currentCodes = codes;
  let liveTimer = null;
  let syncing = false;

  function paintGrid(list) {
    const grid = drawer.body.querySelector('#code-grid');
    if (!grid) return;
    grid.innerHTML = list.length
      ? list
          .map(
            (code) => html`
              <div class="code-chip${code.used ? ' is-used' : ''}${code.holder ? ' is-bound' : ''}"
                data-code="${code.code}" title="${codeTitle(code)}">
                <span>${code.code}</span>
                ${code.holder ? html`<em>${code.holder}</em>` : ''}
              </div>
            `,
          )
          .join('')
      : html`<div class="stage-empty" style="grid-column:1/-1">还没有抽奖码，先批发生成</div>`;
  }

  function paintCampuses(list) {
    const section = drawer.body.querySelector('#campus-section');
    if (!section) return;
    section.style.display = list.length ? '' : 'none';
    drawer.body.querySelector('#campus-count').textContent = `${list.length} 个校区`;
    drawer.body.querySelector('#campus-chips').innerHTML = list
      .map((item) => html`<span class="campus-chip">${item.name}<b>${item.count}</b></span>`)
      .join('');
  }

  async function syncLive() {
    if (syncing || document.hidden) return;
    syncing = true;
    try {
      const [summary, payload] = await Promise.all([
        api.get(`/activities/${activity.id}/codes/summary`),
        canManage ? api.get(`/activities/${activity.id}/codes`) : Promise.resolve({ codes: null }),
      ]);
      freeLeft = summary.free;
      const freeEl = drawer.body.querySelector('#issue-free');
      if (freeEl) freeEl.textContent = `Issue on payment · 剩余空码 ${freeLeft}`;
      paintCampuses(summary.campuses || []);
      if (canManage && payload.codes) {
        currentCodes = payload.codes;
        paintGrid(currentCodes);
        const usedNow = currentCodes.filter((c) => c.used).length;
        const boundNow = currentCodes.filter((c) => c.holder).length;
        const gridCount = drawer.body.querySelector('#grid-count');
        if (gridCount) gridCount.textContent = `${usedNow} / ${currentCodes.length} 已使用`;
        const bindCount = drawer.body.querySelector('#bind-count');
        if (bindCount) bindCount.textContent = `已绑定 ${boundNow} / 共 ${currentCodes.length}`;
      }
    } catch {
      /* 单次失败忽略，下一轮再来 */
    } finally {
      syncing = false;
    }
  }

  if (canManage) paintGrid(currentCodes);
  liveTimer = setInterval(syncLive, 6000);
  const onVisible = () => {
    if (!document.hidden) syncLive();
  };
  document.addEventListener('visibilitychange', onVisible);
  const stopLive = () => {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    document.removeEventListener('visibilitychange', onVisible);
  };
  stopLiveHook = stopLive;

  const reload = async () => {
    drawer.close();
    openCodes(await api.get(`/activities/${activity.id}`).then((r) => r.activity), ctx);
  };

  footer.querySelector('[data-close]').addEventListener('click', () => drawer.close());

  let lastIssued = null;
  const issueBtn = drawer.body.querySelector('#issue-btn');
  const issueResult = drawer.body.querySelector('#issue-result');
  const issueCodeEl = drawer.body.querySelector('#issue-code');
  const issueMetaEl = drawer.body.querySelector('#issue-meta');

  issueBtn.addEventListener('click', async () => {
    const name = drawer.body.querySelector('#issue-name').value.trim();
    const phone = drawer.body.querySelector('#issue-phone').value.trim();
    const campusField = drawer.body.querySelector('#issue-campus');
    const campus = campusField.dataset.combo
      ? String(campusField.dataset.value || '')
      : campusField.value.trim();
    if (nameRequired && !name) {
      toast('请填写学员姓名', 'err');
      drawer.body.querySelector('#issue-name').focus();
      return;
    }
    if (phoneRequired && !phone) {
      toast('请填写 11 位手机号', 'err');
      drawer.body.querySelector('#issue-phone').focus();
      return;
    }
    if (phone && !/^1[3-9]\d{9}$/.test(phone.replace(/\D/g, ''))) {
      toast('请填写 11 位手机号', 'err');
      drawer.body.querySelector('#issue-phone').focus();
      return;
    }
    if (campusRequired && !campus) {
      toast('请选择学员所在校区', 'err');
      drawer.body.querySelector('#issue-campus').focus();
      return;
    }

    issueBtn.disabled = true;
    const confirmed = await confirmDialog({
      eyebrow: 'Issue code',
      title: '确认发放这枚抽奖码？',
      message: `姓名：${name}\n手机号：${maskPhone(phone)}\n校区：${campus || '未填写'}\n\n确认后从空码池按顺序发放 1 枚，学员凭此码开奖。`,
      confirmText: '确认发放',
    });
    if (!confirmed) {
      issueBtn.disabled = false;
      return;
    }

    issueBtn.disabled = true;
    const applyIssued = (res) => {
      lastIssued = res.code;
      issueResult.classList.remove('is-hidden');
      issueCodeEl.textContent = res.code.code;
      issueMetaEl.textContent = [res.code.campus, res.code.holder, maskPhone(res.code.phone)].filter(Boolean).join(' · ');
      freeLeft = res.freeLeft;
      drawer.body.querySelector('#issue-free').textContent = `Issue on payment · 剩余空码 ${freeLeft}`;
      const chip = drawer.body.querySelector(`.code-chip[data-code="${res.code.code}"]`);
      if (chip) {
        chip.classList.add('is-bound');
        chip.title = codeTitle(res.code);
        if (!chip.querySelector('em')) {
          const em = document.createElement('em');
          em.textContent = res.code.holder;
          chip.appendChild(em);
        }
      }
      toast(`已发 ${res.code.code}`, 'ok');
      if (res.duplicateWarning) toast(res.duplicateWarning, 'info', 5200);
      drawer.body.querySelector('#issue-name').value = '';
      drawer.body.querySelector('#issue-phone').value = '';
      drawer.body.querySelector('#issue-name').focus();
    };

    try {
      const res = await api.post(`/activities/${activity.id}/codes/issue`, { name, phone, campus, force: false });
      if (campus) localStorage.setItem('aurum.campus', campus);
      applyIssued(res);
    } catch (err) {
      if (err.code === 'duplicate_exact') {
        toast(err.message, 'err', 6200);
      } else if (err.code === 'duplicate_partial') {
        const confirmed = await confirmDialog({
          eyebrow: '疑似重复',
          title: '已有同名 / 同手机号的记录',
          message: err.message,
          confirmText: '确认不是同一位',
          danger: true,
        });
        if (confirmed) {
          try {
            const res = await api.post(`/activities/${activity.id}/codes/issue`, { name, phone, campus, force: true });
            if (campus) localStorage.setItem('aurum.campus', campus);
            applyIssued(res);
          } catch (retryErr) {
            toast(retryErr.message, 'err', 6200);
          }
        }
      } else {
        toast(err.message, 'err');
      }
    } finally {
      issueBtn.disabled = false;
    }
  });

  ['#issue-name', '#issue-phone', '#issue-campus'].forEach((selector) => {
    drawer.body.querySelector(selector).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        issueBtn.click();
      }
    });
  });

  drawer.body.querySelector('#issue-copy')?.addEventListener('click', async () => {
    if (!lastIssued) return;
    try {
      await navigator.clipboard.writeText(lastIssued.code);
      toast('已复制抽奖码', 'ok');
    } catch {
      toast('浏览器不允许访问剪贴板', 'err');
    }
  });

  drawer.body.querySelector('#issue-qr')?.addEventListener('click', () => {
    if (!lastIssued) return;
    openQrModal({
      title: lastIssued.code,
      url: `${publicLink}?code=${encodeURIComponent(lastIssued.code)}`,
      note: [lastIssued.holder, lastIssued.campus, maskPhone(lastIssued.phone)].filter(Boolean).join(' · '),
      filename: `${lastIssued.code}.png`,
      activityName: activity.name,
      subtitle: activity.subtitle || '',
      code: lastIssued.code,
    });
  });

  drawer.body.querySelector('#issue-log-btn')?.addEventListener('click', () => {
    openIssueLog(activity);
  });

  drawer.body.querySelector('#copy-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      toast('自助链接已复制', 'ok');
    } catch {
      toast('浏览器不允许访问剪贴板，请手动复制', 'err');
    }
  });

  drawer.body.querySelector('#save-qr')?.addEventListener('click', () => {
    downloadPoster(
      renderQrPoster({ url: publicLink, activityName: activity.name, subtitle: activity.subtitle || '' }),
      '活动二维码.png',
    );
  });

  drawer.body.querySelector('#campaign-qr')?.addEventListener('click', () => {
    openQrModal({
      title: '活动二维码',
      url: publicLink,
      note: '打印在海报上，学员扫码进入后输入抽奖码。',
      filename: '活动二维码.png',
      activityName: activity.name,
      subtitle: activity.subtitle || '',
    });
  });

  drawer.body.querySelector('#code-grid')?.addEventListener('click', (event) => {
    const chip = event.target.closest('.code-chip');
    if (!chip) return;
    const code = chip.dataset.code;
    const entry = currentCodes.find((c) => c.code === code);
    openQrModal({
      title: code,
      url: `${publicLink}?code=${encodeURIComponent(code)}`,
      note: entry?.holder
        ? `${entry.holder}${entry.tail ? ` · 手机尾号 ${entry.tail}` : ''}`
        : '专属二维码：扫码后自动填入这枚码。',
      filename: `${code}.png`,
      activityName: activity.name,
      subtitle: activity.subtitle || '',
      code,
    });
  });

  footer.querySelector('[data-copy]')?.addEventListener('click', async () => {
    const list = currentCodes
      .filter((c) => !c.used)
      .map((c) => c.code)
      .join('\n');
    if (!list) {
      toast('没有未使用的抽奖码', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(list);
      toast(`已复制 ${list.split('\n').length} 枚抽奖码`, 'ok');
    } catch {
      toast('浏览器不允许访问剪贴板', 'err');
    }
  });

  drawer.body.querySelector('#export-list')?.addEventListener('click', () => {
    downloadListCsv(currentCodes, publicBase);
    toast('名单已导出', 'ok');
  });

  drawer.body.querySelector('#save-base')?.addEventListener('click', async (event) => {
    const input = drawer.body.querySelector('#base-url');
    const value = input.value.trim().replace(/\/+$/, '');
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const res = await api.put('/settings', { publicBaseUrl: value });
      publicBase = String(res.publicBaseUrl || location.origin).replace(/\/+$/, '');
      publicLink = `${publicBase}/redeem`;
      input.value = res.publicBaseUrl || '';
      drawer.body.querySelector('#public-link').value = publicLink;
      drawer.body.querySelector('#campaign-qr').innerHTML = qrSvg(publicLink, { size: 108, margin: 2 });
      toast(res.publicBaseUrl ? '对外地址已保存' : '已恢复为当前访问地址', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  drawer.body.querySelector('#bind-btn')?.addEventListener('click', async (event) => {
    const entries = parseRoster(drawer.body.querySelector('#bind-rows').value);
    if (!entries.length) {
      toast('请先粘贴名单，一行一位学员', 'err');
      return;
    }

    const preview = entries.slice(0, 5).map((entry) => entry.name).join('、');
    const more = entries.length > 5 ? ` 等 ${entries.length} 位` : '';
    const confirmed = await confirmDialog({
      eyebrow: 'Bulk bind',
      title: `确认绑定 ${entries.length} 位学员？`,
      message: `${preview}${more}\n\n确认后按顺序绑定到未使用的空码上，名单里已经发过的学员会自动跳过。`,
      confirmText: '确认绑定',
    });
    if (!confirmed) return;

    const button = event.currentTarget;
    button.disabled = true;
    try {
      const res = await api.post(`/activities/${activity.id}/codes/bind`, { entries });
      toast(
        `已绑定 ${res.bound} 位${res.duplicated ? `，跳过 ${res.duplicated} 位已发放过的学员` : ''}${
          res.skipped ? `，${res.skipped} 位没有可用码` : ''
        }`,
        'ok',
        5200,
      );
      await reload();
    } catch (err) {
      toast(err.message, 'err');
      button.disabled = false;
    }
  });

  drawer.body.querySelector('#bind-reset')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      eyebrow: 'Unbind',
      title: '解除绑定',
      message: '将清空所有「未使用」抽奖码上的姓名与手机尾号，已使用的记录不受影响。',
      confirmText: '解除绑定',
    });
    if (!ok) return;
    try {
      const res = await api.post(`/activities/${activity.id}/codes/bind`, { reset: true });
      toast(`已解除 ${res.cleared} 条绑定`, 'ok');
      await reload();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  drawer.body.querySelector('#gen-codes')?.addEventListener('click', async (event) => {
    const count = Number(drawer.body.querySelector('#code-count').value) || 0;
    if (count < 1) {
      toast('请输入生成数量', 'err');
      return;
    }
    const prefix = drawer.body.querySelector('#code-prefix').value.trim() || undefined;
    const length = Number(drawer.body.querySelector('#code-length').value) || 6;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.post(`/activities/${activity.id}/codes`, { count, prefix, length });
      toast(`已生成 ${count} 枚抽奖码`, 'ok');
      await reload();
    } catch (err) {
      toast(err.message, 'err');
      button.disabled = false;
    }
  });

  drawer.body.querySelector('#regen-codes')?.addEventListener('click', async (event) => {
    const total = activity.codes?.total || 0;
    const used = activity.codes?.used || 0;
    if (!total) {
      toast('还没有抽奖码，先用「生成」发一批', 'err');
      return;
    }
    const confirmed = await confirmDialog({
      eyebrow: 'Regenerate',
      title: '重新生成全部抽奖码？',
      message: `会把当前的 ${total} 枚码全部作废（含已发出的），按 6 位重新生成 ${total} 枚。${used ? `\n\n已有 ${used} 枚码开过奖，对应的开奖记录也会一起清空。` : ''}\n\n建议在上线前做这一步，换成长码后就不容易被猜到了。`,
      confirmText: '确认重发',
      danger: true,
    });
    if (!confirmed) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const res = await api.post(`/activities/${activity.id}/codes/regenerate`, {
        count: total,
        length: 6,
        prefix: activity.codePrefix,
        force: true,
      });
      toast(`已重新生成 ${res.total} 枚 ${res.length} 位码`, 'ok', 3600);
      await reload();
    } catch (err) {
      toast(err.message, 'err');
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------- 主视图 */

export async function renderActivities(host, ctx) {
  const load = async () => {
    host.innerHTML = html`<div class="loading"><span class="spinner"></span>读取活动</div>`;
    const { activities } = await api.get('/activities');
    paint(activities);
  };

  const paint = (activities) => {
    host.innerHTML = html`
      <div class="page">
        <header class="page-head">
          <div>
            <div class="eyebrow">Events · 活动与奖项</div>
            <h1 class="page-title">活动与奖项</h1>
            <p class="page-sub">配置抽奖方式、奖项名额与开奖权重；名额即库存，抽中即扣减。</p>
          </div>
          <div class="page-actions">
            <button class="btn btn--ghost btn--sm" id="reload-activities" type="button">${raw(icon('refresh', 15))} 刷新</button>
            ${ctx.can('activity.manage')
              ? html`<button class="btn btn--ghost btn--sm" id="open-trash" type="button">${raw(icon('inbox', 15))} 回收站</button>`
              : ''}
            ${ctx.can('activity.manage')
              ? html`<button class="btn btn--gold btn--sm" id="new-activity" type="button">${raw(icon('plus', 15))} 新建活动</button>`
              : ''}
          </div>
        </header>

        ${activities.length
          ? html`<div class="act-grid">${activities.map((activity) => managementCard(activity, ctx))}</div>`
          : html`
              <div class="panel">
                <div class="empty">
                  ${raw(icon('gift', 30, 1.2))}
                  <b>还没有活动</b>
                  <span>创建一场活动，配置好奖项名额就能开奖。</span>
                </div>
              </div>
            `}
      </div>
    `;

    host.querySelector('#reload-activities')?.addEventListener('click', () => load());
    host.querySelector('#new-activity')?.addEventListener('click', () => {
      openActivityEditor({ activity: null, onSaved: load });
    });

    host.querySelector('#open-trash')?.addEventListener('click', () => openTrash(load));

    host.querySelectorAll('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const activity = activities.find((a) => a.id === button.dataset.edit);
        if (activity) {
          openActivityEditor({ activity, onSaved: load });
        }
      });
    });

    host.querySelectorAll('[data-codes]').forEach((button) => {
      button.addEventListener('click', () => {
        const activity = activities.find((a) => a.id === button.dataset.codes);
        if (activity) openCodes(activity, ctx);
      });
    });

    host.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        const activity = activities.find((a) => a.id === button.dataset.copy);
        if (!activity) return;
        const ok = await confirmDialog({
          eyebrow: 'Duplicate',
          title: '复制这个活动？',
          message: `将复制「${activity.name}」的奖项（名称、等级、名额、权重、价值、样品图）和全部配置。\n\n抽奖码与开奖记录不会复制，新活动是「草稿」状态，改好名字再启用。`,
          confirmText: '确认复制',
        });
        if (!ok) return;
        try {
          const { activity: copy } = await api.post(`/activities/${activity.id}/duplicate`);
          toast('已复制，记得改个名字', 'ok', 3600);
          await load();
          openActivityEditor({ activity: copy, onSaved: load });
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    host.querySelectorAll('[data-reset]').forEach((button) => {
      button.addEventListener('click', async () => {
        const activity = activities.find((a) => a.id === button.dataset.reset);
        if (!activity) return;
        const ok = await confirmDialog({
          eyebrow: 'Reset quota',
          title: '重置名额',
          message: `将「${activity.name}」全部奖项的剩余名额恢复为总数，已产生的开奖记录将保留。`,
          confirmText: '确认重置',
        });
        if (!ok) return;
        try {
          await api.post(`/activities/${activity.id}/reset`, { scope: 'quota' });
          toast('名额已重置', 'ok');
          load();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    host.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const activity = activities.find((a) => a.id === button.dataset.delete);
        if (!activity) return;
        const ok = await confirmDialog({
          eyebrow: 'Delete event',
          title: '删除活动',
          message: `「${activity.name}」及其全部开奖记录、抽奖码、发码记录都将被删除。\n\n服务器会自动留一份备份（data/trash，保留最近 30 份），需要时可以人工恢复，但界面上没有撤销按钮。`,
          confirmText: '确认删除',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api.del(`/activities/${activity.id}`);
          toast(
            `活动已删除${res.records ? `，${res.records} 条记录已备份` : ''}`,
            'ok',
            4200,
          );
          load();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    host.querySelectorAll('[data-stage]').forEach((button) => {
      button.addEventListener('click', () => ctx.navigate(`#/stage?act=${button.dataset.stage}`));
    });
  };

  await load();
  return undefined;
}

function managementCard(activity, ctx) {
  const status = STATUS[activity.status] || STATUS.draft;
  const drawnPct = pct(activity.stats.drawn, activity.stats.totalQuota);
  return html`
    <article class="act-card">
      <div class="act-art" style="--art:${MODE_ART[activity.mode] || MODE_ART.quota}">
        <div class="act-art-tags">
          <span class="badge ${status.cls}">${status.label}</span>
          <span class="badge badge--square">${MODE_LABEL[activity.mode]}</span>
          ${activity.mode === 'code' && activity.publicRedeem
            ? html`<span class="badge badge--gold">学员自助</span>`
            : ''}
          ${activity.mode === 'code' && activity.codes
            ? html`<span class="badge badge--mute">已发 ${activity.codes.issued ?? 0}/${activity.codes.total}</span>`
            : ''}
        </div>
        <span class="act-monogram">${String(activity.name).slice(0, 1)}</span>
      </div>
      <div class="act-body">
        <div>
          <h3 class="act-title">${activity.name}</h3>
          <div class="act-sub">${activity.subtitle || '内部抽奖活动'}</div>
        </div>
        <div class="act-metrics">
          <div class="act-metric">
            <strong>${fmtNumber(activity.quotaView ? activity.quotaView.remaining : activity.stats.totalRemaining)}</strong>
            <span>剩余 / ${fmtNumber(activity.stats.totalQuota)}</span>
          </div>
          <div class="act-metric" style="text-align:right">
            <strong>${drawnPct}<small style="font-size:13px;color:var(--mute)">%</small></strong>
            <span>已抽出</span>
          </div>
        </div>
        <div class="bar"><i style="width:${drawnPct}%"></i></div>
        <div class="mini-prizes">
          ${activity.prizes.slice(0, 4).map(
            (prize) => html`
              <div class="mini-prize${prize.remaining <= 0 ? ' is-empty' : ''}">
                <span class="mini-dot" style="background:${/^#[0-9a-fA-F]{6}$/.test(prize.color || '') ? prize.color : '#C9A25F'}"></span>
                <span class="mini-name">${prize.name}</span>
                <span class="mini-count">${prize.remaining}<em>/${prize.quota}</em></span>
              </div>
            `,
          )}
          ${activity.prizes.length > 4
            ? html`<div class="mini-more">还有 ${activity.prizes.length - 4} 个奖项</div>`
            : ''}
        </div>
        <div class="act-foot" style="border-top:none;padding-top:4px">
          <span class="act-prize-hint">${activity.prizes.length} 个奖项 · 更新于 ${fmtTime(activity.updatedAt)}${activity.resetAt ? ` · 重置于 ${fmtTime(activity.resetAt)}` : ''}</span>
          <div class="btn-row" style="gap:6px">
            <button class="btn btn--sm btn--ghost" data-stage="${activity.id}" type="button" title="进入舞台">${raw(icon('sparkles', 14))}</button>
            ${ctx.can('prize.manage') || ctx.can('activity.manage')
              ? html`<button class="btn btn--sm btn--ghost" data-edit="${activity.id}" type="button">${raw(icon('sliders', 14))} 配置</button>`
              : ''}
          </div>
        </div>
      </div>
      <div class="panel-foot" style="display:flex;gap:6px;justify-content:flex-end;border-top:1px solid var(--line)">
        ${activity.mode === 'code' && (ctx.can('draw.execute') || ctx.can('quota.reset'))
          ? html`<button class="btn btn--quiet btn--sm" data-codes="${activity.id}" type="button">抽奖码</button>`
          : ''}
        ${ctx.can('quota.reset')
          ? html`<button class="btn btn--quiet btn--sm" data-reset="${activity.id}" type="button">重置名额</button>`
          : ''}
        ${ctx.can('activity.manage')
          ? html`<button class="btn btn--quiet btn--sm" data-copy="${activity.id}" type="button" title="复制这个活动">${raw(icon('copy', 13))} 复制</button>`
          : ''}
        ${ctx.can('activity.manage')
          ? html`<button class="icon-btn" data-delete="${activity.id}" type="button" title="删除活动">${raw(icon('trash', 15))}</button>`
          : ''}
      </div>
    </article>
  `;
}
