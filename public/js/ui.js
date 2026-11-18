/* 通用 UI 工具：安全模板、图标、提示、抽屉、确认框、格式化 */

const RAW = Symbol('raw');
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const raw = (value) => ({ [RAW]: String(value) });
export const isRaw = (value) => Boolean(value) && typeof value === 'object' && RAW in value;
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

function flatten(value, out) {
  if (isRaw(value)) out.push(value[RAW]);
  else if (Array.isArray(value)) value.forEach((v) => flatten(v, out));
  else if (value === null || value === undefined || value === false) out.push('');
  else out.push(esc(value));
}

/** 安全模板：插值自动转义，嵌套模板保持原样，`raw()` 跳过转义 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    const parts = [];
    flatten(values[i], parts);
    out += parts.join('') + strings[i + 1];
  }
  return { [RAW]: out, toString: () => out };
}

/* ----------------------------------------------------------------- 图标 */

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  sparkles:
    '<path d="M12 3.2l1.95 5.25L19.2 10.4l-5.25 1.95L12 17.6l-1.95-5.25L4.8 10.4l5.25-1.95z"/><path d="M18.4 15.2l.75 1.9 1.9.75-1.9.75-.75 1.9-.75-1.9-1.9-.75 1.9-.75z"/>',
  ticket:
    '<path d="M3 9.4A2.4 2.4 0 0 1 5.4 7h13.2A2.4 2.4 0 0 1 21 9.4v1.1a2.4 2.4 0 0 0 0 4.8v1.1a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 16.4v-1.1a2.4 2.4 0 0 0 0-4.8z"/><path d="M13.2 9.4v2M13.2 14.2v1.6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.2" cy="6" r="1.1"/><circle cx="4.2" cy="12" r="1.1"/><circle cx="4.2" cy="18" r="1.1"/>',
  shield:
    '<path d="M12 3l7.4 2.7v5.3c0 4.6-3.05 7.6-7.4 9.05C7.65 18.6 4.6 15.6 4.6 11V5.7z"/><path d="M9.1 11.7l2.05 2.05 3.75-3.9"/>',
  users:
    '<circle cx="9" cy="8.2" r="3.1"/><path d="M3.6 20a5.4 5.4 0 0 1 10.8 0"/><path d="M15.8 5.4a3.1 3.1 0 0 1 0 5.9"/><path d="M17.4 14.6a5.4 5.4 0 0 1 3 4.9"/>',
  logout:
    '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12.6 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17z"/><path d="M13.6 5.6l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9.4 7V4.7h5.2V7"/><path d="M6.4 7l1 13.3h9.2l1-13.3"/>',
  download: '<path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M4.5 19.5h15"/>',
  copy: '<rect x="8.4" y="8.4" width="11.2" height="12" rx="2.2"/><path d="M15.6 8.4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9.6a2 2 0 0 0 2 2h2.4"/>',
  check: '<path d="M4.5 12.6l4.9 4.9L19.5 6.4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8L20.5 20.5"/>',
  refresh: '<path d="M20.4 12.6a8.4 8.4 0 1 1-2.5-7.2"/><path d="M20.4 4.4v5.2h-5.2"/>',
  play: '<path d="M8.5 5.6l10.5 6.4-10.5 6.4z"/>',
  volume:
    '<path d="M4.5 9.6h3.1L12 5.8v12.4l-4.4-3.8H4.5z"/><path d="M15.4 9.2a3.9 3.9 0 0 1 0 5.6"/><path d="M18 6.8a7.2 7.2 0 0 1 0 10.4"/>',
  muted:
    '<path d="M4.5 9.6h3.1L12 5.8v12.4l-4.4-3.8H4.5z"/><path d="M15.6 10.2l4 4M19.6 10.2l-4 4"/>',
  crown: '<path d="M3.8 8.2l3.6 3.1L12 4.9l4.6 6.4 3.6-3.1-1.6 10.3H5.4z"/><path d="M5.4 18.5h13.2"/>',
  clock: '<circle cx="12" cy="12" r="8.1"/><path d="M12 7.4V12l3.1 2"/>',
  lock: '<rect x="4.6" y="10" width="14.8" height="10" rx="2.6"/><path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10"/>',
  key: '<circle cx="8.2" cy="12" r="3.6"/><path d="M11.8 12h8.7"/><path d="M17.2 12v3M20.2 12v2.2"/>',
  eye: '<path d="M2.6 12S6.1 5.6 12 5.6 21.4 12 21.4 12 17.9 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.9"/>',
  arrow: '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
  expand:
    '<path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9"/><path d="M15 4h3.4A1.6 1.6 0 0 1 20 5.6V9"/><path d="M20 15v3.4a1.6 1.6 0 0 1-1.6 1.6H15"/><path d="M9 20H5.6A1.6 1.6 0 0 1 4 18.4V15"/>',
  alert: '<path d="M12 4.4l8.8 15.7H3.2z"/><path d="M12 10v4.4M12 17.2v.6"/>',
  info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.2M12 7.8v.6"/>',
  inbox:
    '<path d="M4 13.4l2.5-7.2h11L20 13.4v5.1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13.4h4.6l1.2 2.2h4.4l1.2-2.2H20"/>',
  sliders: '<path d="M4 7.2h9.4M18.4 7.2H20M4 16.8h3.4M12.4 16.8H20"/><circle cx="16" cy="7.2" r="2.2"/><circle cx="9.8" cy="16.8" r="2.2"/>',
  trophy: '<circle cx="12" cy="9.2" r="4.8"/><path d="M8.9 13.2L7.4 20.6l4.6-2.4 4.6 2.4-1.5-7.4"/>',
  gift: '<rect x="3.8" y="8.4" width="16.4" height="11.8" rx="2"/><path d="M3.8 12.6h16.4M12 8.4v11.8"/><path d="M12 8.4S10.8 4 8.6 4a2.2 2.2 0 0 0 0 4.4zM12 8.4S13.2 4 15.4 4a2.2 2.2 0 0 1 0 4.4z"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  sun:
    '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.3M12 19.1v2.3M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.3M19.1 12h2.3M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
  moon: '<path d="M20.2 14.4A8.4 8.4 0 0 1 9.6 3.8 8.4 8.4 0 1 0 20.2 14.4z"/>',
  image:
    '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.6" cy="10" r="1.6"/><path d="M4 17.2l5-4.6 4 3.6 3-2.6 4 3.6"/>',
};

export function icon(name, size = 18, stroke = 1.5) {
  const body = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* --------------------------------------------------------------- DOM 帮手 */

export function frag(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup).trim();
  return template.content;
}

export function node(markup) {
  return frag(markup).firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(root, eventName, selector, handler) {
  root.addEventListener(eventName, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

/* ----------------------------------------------------------------- 提示 */

const TOAST_ICON = { ok: 'check', err: 'alert', info: 'info' };

export function toast(message, type = 'info', duration = 3400) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = node(html`
    <div class="toast toast--${type}">
      ${raw(icon(TOAST_ICON[type] || 'info', 16))}
      <span>${message}</span>
    </div>
  `);
  host.appendChild(el);
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 380);
  };
  const timer = setTimeout(close, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    close();
  });
}

/* ------------------------------------------------------- 抽屉 / 弹层管理 */

const layers = [];

function layerRoot() {
  return document.getElementById('layers');
}

export function closeAllLayers() {
  while (layers.length) {
    const layer = layers.pop();
    layer.close();
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !layers.length) return;
  const top = layers[layers.length - 1];
  if (top.dismissible !== false) top.close();
});

function addLayer(entry) {
  layers.push(entry);
  return entry;
}

export function openDrawer({ eyebrow = '', title = '', content, footer = null, className = '', onClose } = {}) {
  const root = layerRoot();
  const scrim = node('<div class="scrim"></div>');
  const drawer = node(html`
    <aside class="drawer ${className}" role="dialog" aria-modal="true">
      <header class="drawer-head">
        <div>
          ${eyebrow ? raw(`<div class="eyebrow">${esc(eyebrow)}</div>`) : ''}
          <h2 class="drawer-title">${title}</h2>
        </div>
        <button class="icon-btn" data-close type="button" aria-label="关闭">${raw(icon('x', 18))}</button>
      </header>
      <div class="drawer-body"></div>
      ${footer ? raw('<footer class="drawer-foot"></footer>') : ''}
    </aside>
  `);
  const body = drawer.querySelector('.drawer-body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (isRaw(content)) body.innerHTML = String(content);
  else if (content) body.appendChild(content);
  const footerEl = drawer.querySelector('.drawer-foot');
  if (footerEl && footer) {
    if (typeof footer === 'string') footerEl.innerHTML = footer;
    else if (isRaw(footer)) footerEl.innerHTML = String(footer);
    else footerEl.appendChild(footer);
  }
  root.appendChild(scrim);
  root.appendChild(drawer);
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    drawer.classList.add('is-open');
    const first = drawer.querySelector('input:not([type=hidden]), textarea, select');
    if (first) setTimeout(() => first.focus(), 220);
  });

  let closed = false;
  const entry = {
    dismissible: true,
    close() {
      if (closed) return;
      closed = true;
      scrim.classList.remove('is-open');
      drawer.classList.remove('is-open');
      const index = layers.indexOf(entry);
      if (index >= 0) layers.splice(index, 1);
      setTimeout(() => {
        scrim.remove();
        drawer.remove();
      }, 480);
      if (onClose) onClose();
    },
  };
  scrim.addEventListener('click', () => entry.close());
  drawer.querySelector('[data-close]').addEventListener('click', () => entry.close());
  addLayer(entry);
  return { el: drawer, body, footer: footerEl, close: entry.close };
}

export function openModal({ eyebrow = '', title = '', content, actions = [], className = '' } = {}) {
  const root = layerRoot();
  const scrim = node('<div class="scrim"></div>');
  const modal = node(html`
    <div class="modal ${className}" role="dialog" aria-modal="true">
      ${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : ''}
      <h3>${title}</h3>
      <div class="modal-body"></div>
      <div class="modal-actions"></div>
    </div>
  `);
  const body = modal.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (isRaw(content)) body.innerHTML = String(content);
  else if (content) body.appendChild(content);

  const actionsEl = modal.querySelector('.modal-actions');
  let closed = false;
  const entry = {
    dismissible: true,
    close() {
      if (closed) return;
      closed = true;
      scrim.classList.remove('is-open');
      modal.classList.remove('is-open');
      const index = layers.indexOf(entry);
      if (index >= 0) layers.splice(index, 1);
      setTimeout(() => {
        scrim.remove();
        modal.remove();
      }, 420);
    },
  };

  for (const action of actions) {
    const button = node(html`<button class="btn ${action.variant || 'btn--ghost'} btn--sm" type="button">${action.label}</button>`);
    button.addEventListener('click', () => action.onClick ? action.onClick({ close: entry.close }) : entry.close());
    actionsEl.appendChild(button);
    if (action.el !== false) action.el = button;
  }
  if (!actions.length) actionsEl.remove();

  root.appendChild(scrim);
  root.appendChild(modal);
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    modal.classList.add('is-open');
  });
  scrim.addEventListener('click', () => entry.close());
  addLayer(entry);

  return { el: modal, body, close: entry.close, actions };
}

export function confirmDialog({  eyebrow = '请确认',
  title = '确认操作',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const root = layerRoot();
    const scrim = node('<div class="scrim"></div>');
    const modal = node(html`
      <div class="modal" role="dialog" aria-modal="true">
        <div class="eyebrow">${eyebrow}</div>
        <h3>${title}</h3>
        <p class="modal-message">${message}</p>
        <div class="modal-actions">
          <button class="btn btn--ghost btn--sm" data-cancel type="button">${cancelText}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--gold'} btn--sm" data-ok type="button">${confirmText}</button>
        </div>
      </div>
    `);
    root.appendChild(scrim);
    root.appendChild(modal);
    requestAnimationFrame(() => {
      scrim.classList.add('is-open');
      modal.classList.add('is-open');
    });

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      scrim.classList.remove('is-open');
      modal.classList.remove('is-open');
      const index = layers.indexOf(entry);
      if (index >= 0) layers.splice(index, 1);
      setTimeout(() => {
        scrim.remove();
        modal.remove();
      }, 420);
      resolve(value);
    };
    const entry = { dismissible: true, close: () => finish(false) };
    addLayer(entry);
    scrim.addEventListener('click', () => finish(false));
    modal.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    modal.querySelector('[data-ok]').addEventListener('click', () => finish(true));
    setTimeout(() => modal.querySelector('[data-ok]').focus(), 240);
  });
}

/* --------------------------------------------------------------- 格式化 */

const pad = (n) => String(n).padStart(2, '0');

export function fmtNumber(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('zh-CN');
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ts) {
  const d = ts ? new Date(ts) : new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${week}`;
}

export function timeAgo(ts) {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function initials(name) {
  const text = String(name || '?').trim();
  if (!text) return '?';
  if (/^[\x00-\x7F]+$/.test(text)) return text.slice(0, 2).toUpperCase();
  return text.slice(-2);
}

export function pct(part, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

export function countUp(el, target, duration = 900) {
  const from = 0;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtNumber(Math.round(from + (target - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function debounce(fn, wait = 260) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
