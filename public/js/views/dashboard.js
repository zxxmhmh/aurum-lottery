import { api } from '../api.js';
import {
  html,
  raw,
  icon,
  esc,
  fmtDate,
  fmtClock,
  timeAgo,
  pct,
  fmtNumber,
  countUp,
  initials,
  toast,
} from '../ui.js';

const MODE_ART = {
  quota: 'rgba(217, 183, 124, 0.32)',
  probability: 'rgba(126, 148, 178, 0.26)',
  code: 'rgba(186, 132, 120, 0.24)',
};

const STATUS = {
  active: { label: '进行中', cls: 'badge--ok', live: true },
  paused: { label: '已暂停', cls: 'badge--warn' },
  draft: { label: '草稿', cls: 'badge--mute' },
  ended: { label: '已结束', cls: 'badge--mute' },
};

export function activityCard(activity) {
  const status = STATUS[activity.status] || STATUS.draft;
  const drawnPct = pct(activity.stats.drawn, activity.stats.totalQuota);
  const topPrize = activity.prizes[0];
  const soldOut = activity.prizes.filter((p) => p.remaining <= 0).length;
  return html`
    <article class="act-card" data-act="${activity.id}">
      <div class="act-art" style="--art:${MODE_ART[activity.mode] || MODE_ART.quota}">
        <div class="act-art-tags">
          <span class="badge ${status.cls}">
            ${status.live ? raw('<span class="dot dot--live"></span>') : ''}${status.label}
          </span>
          <span class="badge badge--square">${activity.modeLabel}</span>
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
            <span>剩余名额 / ${fmtNumber(activity.stats.totalQuota)}</span>
          </div>
          <div class="act-metric" style="text-align:right">
            <strong>${drawnPct}<small style="font-size:13px;color:var(--mute)">%</small></strong>
            <span>已抽出</span>
          </div>
        </div>
        <div class="bar"><i style="width:${drawnPct}%"></i></div>
        <div class="act-foot">
          <span class="act-prize-hint">
            ${activity.prizes.length} 个奖项${soldOut ? ` · ${soldOut} 个已抽完` : ''}${topPrize ? ` · 头奖 ${topPrize.name}` : ''}
          </span>
          <button class="btn btn--sm btn--ghost" data-go-stage="${activity.id}" type="button">
            进入舞台 ${raw(icon('arrow', 14))}
          </button>
        </div>
      </div>
    </article>
  `;
}

export async function renderDashboard(host, ctx) {
  host.innerHTML = html`<div class="loading"><span class="spinner"></span>正在读取数据</div>`;

  const [stats, { activities }, feed] = await Promise.all([
    api.get('/stats'),
    api.get('/activities'),
    ctx.can('record.view') ? api.get('/records?limit=9') : Promise.resolve({ records: [] }),
  ]);

  const active = activities.filter((a) => a.status === 'active');

  host.innerHTML = html`
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Overview · 总览</div>
          <h1 class="page-title">欢迎回来，${ctx.user.name}</h1>
          <p class="page-sub">
            ${fmtDate()} · 当前有 <b>${active.length}</b> 场活动进行中
          </p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost btn--sm" id="reload" type="button">${raw(icon('refresh', 15))} 刷新</button>
          <button class="btn btn--gold btn--sm" id="to-stage" type="button">${raw(icon('sparkles', 15))} 进入抽奖舞台</button>
        </div>
      </header>

      <section class="stat-row">
        <article class="stat">
          <div class="stat-label">进行中活动</div>
          <div class="stat-value"><span data-count="${stats.activities.active}">0</span><small>场</small></div>
          <div class="stat-foot">累计创建 <em>${stats.activities.total}</em> 场活动</div>
        </article>
        <article class="stat">
          <div class="stat-label">剩余名额</div>
          <div class="stat-value"><span data-count="${stats.quota.remaining}">0</span></div>
          <div class="stat-foot">已抽出 <em>${fmtNumber(stats.quota.drawn)}</em> / 总名额 ${fmtNumber(stats.quota.total)}</div>
        </article>
        <article class="stat">
          <div class="stat-label">今日开奖</div>
          <div class="stat-value"><span data-count="${stats.today.draws}">0</span><small>次</small></div>
          <div class="stat-foot">其中中奖 <em>${fmtNumber(stats.today.wins)}</em> 次</div>
        </article>
        <article class="stat">
          <div class="stat-label">参与人次</div>
          <div class="stat-value"><span data-count="${stats.participants}">0</span><small>人</small></div>
          <div class="stat-foot">累计记录 <em>${fmtNumber(stats.records)}</em> 条</div>
        </article>
      </section>

      <div class="split">
        <section>
          <div class="section-head">
            <div class="section-title">活动列表</div>
            <div class="section-count">${String(activities.length).padStart(2, '0')} events</div>
          </div>
          ${activities.length
            ? html`<div class="act-grid">${activities.map(activityCard)}</div>`
            : html`
                <div class="panel">
                  <div class="empty">
                    ${raw(icon('gift', 30, 1.2))}
                    <b>还没有活动</b>
                    <span>创建第一场抽奖，配置奖项与名额后即可开奖。</span>
                    ${ctx.can('activity.manage')
                      ? raw('<a class="btn btn--gold btn--sm" href="#/activities">新建活动</a>')
                      : ''}
                  </div>
                </div>
              `}
        </section>

        <aside class="col-rail">
          <div class="panel">
            <div class="panel-head">
              <div class="panel-title">最近开奖<span class="en">Latest results</span></div>
              <span class="badge badge--mute">${feed.records.length} 条</span>
            </div>
            <div class="panel-body" style="padding-top:8px;padding-bottom:10px">
              ${feed.records.length
                ? html`
                    <div class="feed">
                      ${feed.records.map(
                        (record) => html`
                          <div class="feed-item">
                            <span class="feed-dot${record.hit === false ? ' is-miss' : ''}"></span>
                            <div class="feed-main">
                              <div class="feed-title">${record.hit === false ? '谢谢参与' : record.prizeName}</div>
                              <div class="feed-meta">
                                <span>${record.participant || record.code || '匿名参与者'}</span>
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
                  `
                : html`<div class="empty" style="padding:34px 10px">${raw(icon('inbox', 26, 1.2))}暂无开奖记录</div>`}
            </div>
            ${ctx.can('record.view')
              ? html`<div class="panel-foot" style="padding:12px 24px">
                  <a class="btn btn--quiet btn--sm" href="#/records" style="padding:0;letter-spacing:.08em">
                    查看全部记录 ${raw(icon('arrow', 14))}
                  </a>
                </div>`
              : ''}
          </div>

          <div class="panel" style="margin-top:18px">
            <div class="panel-head">
              <div class="panel-title">快捷操作<span class="en">Shortcuts</span></div>
            </div>
            <div class="panel-body" style="display:flex;flex-direction:column;gap:8px;padding-top:16px">
              <a class="btn btn--ghost btn--sm" href="#/stage" style="justify-content:flex-start">
                ${raw(icon('sparkles', 15))} 打开抽奖舞台
              </a>
              ${ctx.can('activity.manage')
                ? html`<a class="btn btn--ghost btn--sm" href="#/activities" style="justify-content:flex-start">
                    ${raw(icon('ticket', 15))} 管理活动与奖项
                  </a>`
                : ''}
              ${ctx.can('account.view')
                ? html`<a class="btn btn--ghost btn--sm" href="#/accounts" style="justify-content:flex-start">
                    ${raw(icon('shield', 15))} 账号与权限
                  </a>`
                : ''}
            </div>
          </div>

          ${ctx.can('backup.manage')
            ? html`
                <div class="panel" style="margin-top:18px">
                  <div class="panel-head">
                    <div class="panel-title">数据备份<span class="en">Backup</span></div>
                    <span class="badge badge--mute" id="backup-count">—</span>
                  </div>
                  <div class="panel-body" style="padding-top:14px;display:flex;flex-direction:column;gap:10px">
                    <div class="feed-meta" id="backup-meta">读取备份列表…</div>
                    <div style="display:flex;gap:8px">
                      <button class="btn btn--ghost btn--sm" id="backup-now" style="flex:1">立即备份</button>
                      <button class="btn btn--quiet btn--sm" id="backup-dl" style="flex:1" disabled>下载最新</button>
                    </div>
                    <div class="feed-meta" style="opacity:.72">每小时自动打包一份到服务器，保留 7 天</div>
                  </div>
                </div>
              `
            : ''}
        </aside>
      </div>
    </div>
  `;

  host.querySelectorAll('[data-count]').forEach((el) => {
    countUp(el, Number(el.dataset.count) || 0, 1000);
  });

  host.querySelector('#reload')?.addEventListener('click', () => ctx.refresh());
  host.querySelector('#to-stage')?.addEventListener('click', () => ctx.navigate('#/stage'));

  host.querySelectorAll('[data-go-stage]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      ctx.navigate(`#/stage?act=${button.dataset.goStage}`);
    });
  });

  host.querySelectorAll('[data-act]').forEach((card) => {
    card.addEventListener('click', () => ctx.navigate(`#/stage?act=${card.dataset.act}`));
    card.style.cursor = 'pointer';
  });

  /* ---- 数据备份 ---- */
  if (ctx.can('backup.manage')) {
    const countEl = host.querySelector('#backup-count');
    const metaEl = host.querySelector('#backup-meta');
    const nowBtn = host.querySelector('#backup-now');
    const dlBtn = host.querySelector('#backup-dl');
    let latest = null;

    const describe = (b) =>
      b
        ? `${fmtDate(b.at)} ${fmtClock(b.at)} · ${(b.size / 1024).toFixed(0)} KB`
        : '还没有备份';

    const loadBackups = async () => {
      try {
        const data = await api.get('/system/backups');
        const list = data.backups || [];
        latest = list[0] || null;
        if (countEl) countEl.textContent = `${list.length} 份`;
        if (metaEl) metaEl.textContent = describe(latest);
        if (dlBtn) dlBtn.disabled = !latest;
      } catch (error) {
        if (metaEl) metaEl.textContent = error.message || '读取失败';
      }
    };

    nowBtn?.addEventListener('click', async () => {
      nowBtn.disabled = true;
      nowBtn.textContent = '备份中…';
      try {
        const data = await api.post('/system/backups');
        toast(`已生成备份 ${data.backup.name}`, 'ok');
        await loadBackups();
      } catch (error) {
        toast(error.message || '备份失败', 'err');
      } finally {
        nowBtn.disabled = false;
        nowBtn.textContent = '立即备份';
      }
    });

    dlBtn?.addEventListener('click', async () => {
      if (!latest) return;
      dlBtn.disabled = true;
      dlBtn.textContent = '准备中…';
      try {
        const data = await api.get(`/system/backups/${encodeURIComponent(latest.name)}`);
        const blob = new Blob([data.content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = latest.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('已开始下载备份', 'ok');
      } catch (error) {
        toast(error.message || '下载失败', 'err');
      } finally {
        dlBtn.disabled = !latest;
        dlBtn.textContent = '下载最新';
      }
    });

    loadBackups();
  }
}
