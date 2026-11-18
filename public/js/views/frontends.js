import { api } from '../api.js';
import { html, raw, icon, toast } from '../ui.js';

const CARDS = [
  {
    key: 'redeem',
    name: '家长端 · 自助开奖',
    en: 'Parent redeem',
    path: '/redeem',
    desc: '家长扫码或打开链接，输入抽奖码自己开奖。开启时用活动自己的名称与说明；关掉后显示下面的「关闭提示」。',
    noteHint: '关闭后显示在页面上的说明文字',
  },
  {
    key: 'stageLite',
    name: '广告机 · 现场大屏',
    en: 'Kiosk stage',
    path: '/stage-lite',
    desc: '竖屏宣传页 + 现场开奖大屏。开启时大屏显示活动自己的名称与说明（在「活动与奖项」里改）；关掉后显示下面的「关闭提示」。',
    noteHint: '关闭后显示在大屏上的说明文字',
  },
  {
    key: 'm',
    name: '老师手机端 · 发码台',
    en: 'Staff mobile',
    path: '/fama',
    desc: '老师用手机发码、看发码记录。开启时正常使用；关掉后显示下面的「关闭提示」。',
    noteHint: '关闭后显示在手机页面上的说明文字',
  },
];

function cardMarkup(card, value) {
  return html`
    <div class="panel fe-card${value.enabled ? '' : ' is-off'}" data-key="${card.key}">
      <div class="fe-head">
        <div>
          <div class="fe-name">${card.name}</div>
          <div class="fe-en">${card.en}</div>
        </div>
        <span class="switch${value.enabled ? ' is-on' : ''}" role="switch" tabindex="0"
          aria-checked="${value.enabled ? 'true' : 'false'}" data-toggle></span>
      </div>
      <p class="form-note" style="margin:8px 0 14px">${card.desc}</p>
      <p class="form-note" style="margin:-6px 0 12px;color:var(--gold-2)">下面两项只在关闭时显示，开启状态下不生效。</p>
      <div class="field">
        <label>关闭时 · 标题</label>
        <input class="input" data-field="title" maxlength="60" value="${value.title || ''}" placeholder="${card.name}" />
      </div>
      <div class="field">
        <label>关闭时 · 说明</label>
        <textarea class="textarea" data-field="note" maxlength="300" rows="3"
          placeholder="${card.noteHint}">${value.note || ''}</textarea>
      </div>
      <div class="fe-foot">
        <span class="fe-state" data-state>${value.enabled ? '已开启' : '已关闭'}</span>
        <a class="btn btn--ghost btn--sm" href="${card.path}" target="_blank" rel="noopener">
          ${raw(icon('external', 14))} 打开页面
        </a>
      </div>
    </div>
  `;
}

export async function renderFrontends(host, ctx) {
  const canEdit = ctx.can('activity.manage');
  let config = null;

  const load = async () => {
    host.innerHTML = html`<div class="loading"><span class="spinner"></span>读取前台配置</div>`;
    const data = await api.get('/frontends');
    config = data.frontends;
    paint();
  };

  const paint = () => {
    host.innerHTML = html`
      <div class="page">
        <header class="page-head">
          <div>
            <div class="eyebrow">Frontends · 前台页面</div>
            <h1 class="page-title">前台页面</h1>
            <p class="page-sub">三套对外页面的开关与文案在这里统一管理；关掉后页面显示「已关闭」，接口也会拒绝。</p>
          </div>
          <div class="page-actions">
            <button class="btn btn--ghost btn--sm" id="reload-fe" type="button">
              ${raw(icon('refresh', 15))} 刷新
            </button>
            ${canEdit
              ? html`<button class="btn btn--gold btn--sm" id="save-fe" type="button">保存设置</button>`
              : ''}
          </div>
        </header>

        <div class="fe-grid">
          ${CARDS.map((card) => raw(cardMarkup(card, config[card.key] || { enabled: true, title: '', note: '' })))}
        </div>

        ${canEdit
          ? html`<p class="form-note" style="margin-top:16px">保存后立即生效，不需要重启服务。</p>`
          : html`<p class="form-note" style="margin-top:16px">当前账号只能查看，不能修改。</p>`}
      </div>
    `;
    bind();
  };

  const bind = () => {
    host.querySelector('#reload-fe')?.addEventListener('click', () => load().catch((e) => toast(e.message, 'err')));

    host.querySelectorAll('.fe-card').forEach((card) => {
      const key = card.dataset.key;
      const toggle = card.querySelector('[data-toggle]');
      const stateEl = card.querySelector('[data-state]');

      if (!canEdit) {
        card.querySelectorAll('input,textarea').forEach((el) => {
          el.disabled = true;
        });
        if (toggle) toggle.style.pointerEvents = 'none';
        return;
      }

      const sync = (on) => {
        config[key].enabled = on;
        toggle.classList.toggle('is-on', on);
        toggle.setAttribute('aria-checked', on ? 'true' : 'false');
        stateEl.textContent = on ? '已开启' : '已关闭';
        card.classList.toggle('is-off', !on);
      };

      toggle?.addEventListener('click', () => sync(!config[key].enabled));
      toggle?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          sync(!config[key].enabled);
        }
      });

      card.querySelector('[data-field="title"]')?.addEventListener('input', (event) => {
        config[key].title = event.target.value;
      });
      card.querySelector('[data-field="note"]')?.addEventListener('input', (event) => {
        config[key].note = event.target.value;
      });
    });

    host.querySelector('#save-fe')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const payload = {};
        for (const card of CARDS) {
          payload[card.key] = config[card.key];
        }
        const data = await api.put('/frontends', payload);
        config = data.frontends;
        paint();
        toast('前台设置已保存', 'ok');
      } catch (error) {
        toast(error.message || '保存失败', 'err');
      } finally {
        button.disabled = false;
      }
    });
  };

  await load();
}
