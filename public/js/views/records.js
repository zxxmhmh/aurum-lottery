import { api } from '../api.js';
import {
  html,
  raw,
  icon,
  esc,
  toast,
  confirmDialog,
  fmtNumber,
  fmtTime,
  debounce,
} from '../ui.js';

const MODE_LABEL = { quota: '名单抽奖', probability: '概率抽奖', code: '抽奖码' };
const PAGE_SIZE = 50;

/** 列表里手机号打码；导出 CSV 用完整号码 */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : digits;
}

export async function renderRecords(host, ctx) {
  const [{ activities }, initial] = await Promise.all([
    api.get('/activities'),
    api.get(`/records?limit=${PAGE_SIZE}`),
  ]);

  const state = {
    activityId: '',
    mode: '',
    q: '',
    offset: 0,
    total: initial.total,
    records: initial.records,
  };

  host.innerHTML = html`
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Draw log · 抽奖记录</div>
          <h1 class="page-title">抽奖记录</h1>
          <p class="page-sub">每一次开奖的时间、奖项、参与者与操作人都被完整记录。</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost btn--sm" id="refresh-records" type="button">${raw(icon('refresh', 15))} 刷新</button>
          ${ctx.can('record.manage')
            ? html`<button class="btn btn--gold btn--sm" id="export-records" type="button">${raw(icon('download', 15))} 导出 CSV</button>`
            : ''}
        </div>
      </header>

      <div class="toolbar">
        <div class="field">
          <select class="select" id="filter-activity">
            <option value="">全部活动</option>
            ${activities.map((activity) => html`<option value="${activity.id}">${activity.name}</option>`)}
          </select>
        </div>
        <div class="field">
          <select class="select" id="filter-mode">
            <option value="">全部方式</option>
            ${Object.entries(MODE_LABEL).map(([key, label]) => html`<option value="${key}">${label}</option>`)}
          </select>
        </div>
        <div class="search">
          ${raw(icon('search', 15))}
          <input class="input" id="filter-q" placeholder="搜索奖项 / 参与者 / 手机号 / 抽奖码 / 操作人" autocomplete="off" />
        </div>
        <div class="toolbar-spacer"></div>
        <span class="badge badge--mute" id="record-total">${fmtNumber(state.total)} 条</span>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="width:160px">时间</th>
              <th>活动</th>
              <th>奖项</th>
              <th>参与者 / 抽奖码 / 手机号</th>
              <th>操作人</th>
              <th class="right" style="width:110px">抽后剩余</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody id="record-body"></tbody>
        </table>
        <div class="pagination" id="record-pager"></div>
      </div>
    </div>
  `;

  const body = host.querySelector('#record-body');
  const pager = host.querySelector('#record-pager');
  const totalEl = host.querySelector('#record-total');

  const query = () => {
    const params = new URLSearchParams();
    if (state.activityId) params.set('activityId', state.activityId);
    if (state.mode) params.set('mode', state.mode);
    if (state.q) params.set('q', state.q);
    return params.toString();
  };

  const paintRows = () => {
    totalEl.textContent = `${fmtNumber(state.total)} 条`;
    if (!state.records.length) {
      body.innerHTML = html`
        <tr>
          <td colspan="7">
            <div class="empty">${raw(icon('inbox', 28, 1.2))}<b>没有匹配的记录</b><span>换一个筛选条件试试。</span></div>
          </td>
        </tr>
      `;
      pager.innerHTML = '';
      return;
    }

    body.innerHTML = state.records
      .map(
        (record) => html`
          <tr>
            <td class="time">${fmtTime(record.at)}</td>
            <td><span class="mute">${record.activityName}</span></td>
            <td>
              <span class="record-hit">
                ${record.hit === false
                  ? html`<span class="badge badge--mute">谢谢参与</span>`
                  : html`<strong>${record.prizeName}</strong>`}
              </span>
              ${record.level ? html`<span class="tag" style="margin-left:8px">${record.level}</span>` : ''}
            </td>
            <td>
              <div class="rec-people">
                ${record.participant
                  ? html`<span class="rec-person">${record.participant}</span>`
                  : record.code
                    ? ''
                    : html`<span class="mute">—</span>`}
                ${record.code
                  ? html`<span class="tag rec-code">${record.code}</span>`
                  : ''}
                ${record.phone ? html`<span class="rec-phone">${maskPhone(record.phone)}</span>` : ''}
              </div>
            </td>
            <td>${record.operatorName}</td>
            <td class="right">${record.hit === false ? '—' : record.remainingAfter}</td>
            <td class="right">
              ${ctx.can('record.manage')
                ? html`<button class="icon-btn" data-undo="${record.id}" type="button" title="撤销并返还名额">${raw(icon('trash', 14))}</button>`
                : ''}
            </td>
          </tr>
        `,
      )
      .join('');

    body.querySelectorAll('[data-undo]').forEach((button) => {
      button.addEventListener('click', async () => {
        const record = state.records.find((r) => r.id === button.dataset.undo);
        if (!record) return;
        const ok = await confirmDialog({
          eyebrow: 'Undo',
          title: '撤销这条记录',
          message: `撤销后将删除「${record.prizeName || '谢谢参与'}」的开奖记录${
            record.hit === false ? '' : '，并把 1 个名额返还到奖项池'
          }${record.code ? '，抽奖码恢复为未使用' : ''}。`,
          confirmText: '确认撤销',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/records/${record.id}`);
          toast('记录已撤销', 'ok');
          reload(true);
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    const shown = Math.min(state.offset + state.records.length, state.total);
    pager.innerHTML = html`
      <span>已显示 ${fmtNumber(shown)} / ${fmtNumber(state.total)} 条</span>
      <div class="btn-row">
        <button class="btn btn--ghost btn--sm" id="load-more" type="button" ${shown >= state.total ? raw('disabled') : ''}>
          加载更多
        </button>
      </div>
    `;
    pager.querySelector('#load-more')?.addEventListener('click', () => loadMore());
  };

  const reload = async (reset = true) => {
    if (reset) state.offset = 0;
    const data = await api.get(`/records?limit=${PAGE_SIZE}&offset=${state.offset}&${query()}`);
    state.total = data.total;
    state.records = data.records;
    paintRows();
  };

  const loadMore = async () => {
    state.offset += PAGE_SIZE;
    const data = await api.get(`/records?limit=${PAGE_SIZE}&offset=${state.offset}&${query()}`);
    state.total = data.total;
    state.records = state.records.concat(data.records);
    paintRows();
  };

  const softReload = () => reload(true);

  host.querySelector('#filter-activity').addEventListener('change', (event) => {
    state.activityId = event.target.value;
    softReload();
  });
  host.querySelector('#filter-mode').addEventListener('change', (event) => {
    state.mode = event.target.value;
    softReload();
  });
  host.querySelector('#filter-q').addEventListener(
    'input',
    debounce((event) => {
      state.q = event.target.value.trim();
      softReload();
    }, 320),
  );

  host.querySelector('#refresh-records').addEventListener('click', () => softReload());

  host.querySelector('#export-records')?.addEventListener('click', async () => {
    try {
      const suffix = query() ? `?${query()}` : '';
      await api.download(`/records/export${suffix}`, `lottery-records-${new Date().toISOString().slice(0, 10)}.csv`);
      toast('已导出 CSV', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  paintRows();
  return undefined;
}
