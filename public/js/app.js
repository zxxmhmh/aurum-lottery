import { api } from './api.js';
import { html, raw, icon, esc, toast, closeAllLayers, initials, openDrawer } from './ui.js';
import { initTheme, bindThemeButtons } from './theme.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderStage } from './views/stage.js';
import { renderActivities } from './views/activities.js';
import { renderRecords } from './views/records.js';
import { renderAccounts } from './views/accounts.js';
import { renderFrontends } from './views/frontends.js';

export const state = {
  user: null,
  meta: null,
};

initTheme();

export const can = (permission) => Boolean(state.user?.permissions?.includes(permission));

const ROUTES = [
  {
    key: 'dashboard',
    path: '#/dashboard',
    label: '总览',
    en: 'Overview',
    icon: 'grid',
    view: renderDashboard,
    permission: 'activity.view',
  },
  {
    key: 'stage',
    path: '#/stage',
    label: '抽奖舞台',
    en: 'Draw stage',
    icon: 'sparkles',
    view: renderStage,
    permission: 'activity.view',
  },
  {
    key: 'activities',
    path: '#/activities',
    label: '活动与奖项',
    en: 'Events & prizes',
    icon: 'ticket',
    view: renderActivities,
    permission: 'activity.view',
  },
  {
    key: 'records',
    path: '#/records',
    label: '抽奖记录',
    en: 'Draw log',
    icon: 'list',
    view: renderRecords,
    permission: 'record.view',
  },
  {
    key: 'accounts',
    path: '#/accounts',
    label: '账号与权限',
    en: 'Access control',
    icon: 'shield',
    view: renderAccounts,
    permission: 'account.view',
  },
  {
    key: 'frontends',
    path: '#/frontends',
    label: '前台页面',
    en: 'Frontends',
    icon: 'grid',
    view: renderFrontends,
    permission: 'activity.view',
  },
];

const app = document.getElementById('app');
let cleanup = null;
let shellMounted = false;

function currentPath() {
  const hash = location.hash || '#/dashboard';
  return hash.split('?')[0];
}

function activeRoute() {
  return ROUTES.find((route) => route.path === currentPath()) || ROUTES[0];
}

export function navigate(path) {
  if (location.hash === path) {
    render();
    return;
  }
  location.hash = path;
}

export function refresh() {
  render();
}

/* --------------------------------------------------------------- 登录页 */

function showLogin(message = '') {
  closeAllLayers();
  shellMounted = false;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  app.innerHTML = '';
  renderLogin(app, {
    message,
    onSuccess: (user) => {
      state.user = user;
      history.replaceState(null, '', '#/dashboard');
      if (user.mustChangePassword) {
        showPasswordGate();
        return;
      }
      mountShell();
      toast(`欢迎回来，${user.name}`, 'ok', 2600);
      api
        .get('/meta')
        .then((meta) => {
          state.meta = meta;
          window.__PERMISSION_LABELS__ = Object.fromEntries(meta.permissions.map((p) => [p.key, p.label]));
        })
        .catch(() => {});
    },
  });
}

/* --------------------------------------------------------------- 主框架 */

function navMarkup() {
  return ROUTES.filter((route) => !state.user || state.user.permissions.includes(route.permission))
    .map(
      (route) => html`
        <a class="nav-item" href="${route.path}" data-nav="${route.key}">
          ${raw(icon(route.icon, 17))}
          <span>${route.label}</span>
        </a>
      `,
    )
    .join('');
}

function mountShell() {
  shellMounted = true;
  app.innerHTML = html`
    <div class="app">
      <aside class="sidebar">
        <a class="brand" href="#/dashboard">
          <span class="brand-mark">智</span>
          <span class="brand-text">
            <span class="brand-en">ZHIXUE</span>
            <span class="brand-cn">内部抽奖系统</span>
          </span>
        </a>
        <nav class="nav">
          <div class="nav-group-label">Workspace</div>
          ${raw(navMarkup())}
        </nav>
        <div class="sidebar-foot">
          <button class="theme-toggle" data-theme-btn type="button"></button>
          <button class="user-chip" id="user-chip" type="button">
            <span class="avatar">${initials(state.user.name)}</span>
            <span class="user-meta">
              <span class="user-name">${state.user.name}</span>
              <span class="user-role">${state.user.roleLabel}</span>
            </span>
            ${raw(icon('dots', 16))}
          </button>
        </div>
      </aside>
      <main class="main">
        <div class="view" id="view"></div>
      </main>
    </div>
  `;

  bindThemeButtons(app);
  app.querySelector('#user-chip').addEventListener('click', openSelfPanel);
  window.addEventListener('hashchange', render);
  render();
}

/* ------------------------------------------------------------ 账号面板 */

function openSelfPanel() {
  const user = state.user;
  const permissionLabels = window.__PERMISSION_LABELS__ || {};

  const drawer = openDrawer({
    eyebrow: 'Account',
    title: '当前账号',
    content: html`
      <div style="display:flex;align-items:center;gap:14px;padding-bottom:22px;border-bottom:1px solid var(--line)">
        <span class="avatar" style="width:52px;height:52px;font-size:15px">${initials(user.name)}</span>
        <div>
          <div style="font-size:16px;letter-spacing:.02em">${user.name}</div>
          <div class="mute" style="font-size:11.5px;margin-top:3px;letter-spacing:.08em">
            @${user.account} · ${user.roleLabel}
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">已获得权限 <em>${user.permissions.length} 项</em></div>
        <div class="perm-mini">
          ${user.permissions.map((key) => html`<span>${permissionLabels[key] || key}</span>`)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">修改密码 <em>Password</em></div>
        <form id="pwd-form" class="form-grid">
          <div class="field span-2">
            <label>当前密码</label>
            <input class="input" type="password" name="oldPassword" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label>新密码</label>
            <input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="6" required />
          </div>
          <div class="field">
            <label>确认新密码</label>
            <input class="input" type="password" name="confirm" autocomplete="new-password" minlength="6" required />
          </div>
          <div class="form-note span-2">修改成功后该账号的其他登录会失效，本机会自动续期。</div>
          <div class="span-2">
            <button class="btn btn--gold btn--sm" type="submit">更新密码</button>
          </div>
        </form>
      </div>
    `,
    footer: html`<button class="btn btn--danger btn--sm" id="logout-btn" type="button">${raw(icon('logout', 15))} 退出登录</button>`,
  });

  drawer.body.querySelector('#logout-btn')?.addEventListener('click', logout);
  drawer.footer?.querySelector('#logout-btn')?.addEventListener('click', logout);

  drawer.body.querySelector('#pwd-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get('newPassword') !== data.get('confirm')) {
      toast('两次输入的新密码不一致', 'err');
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api.patch('/auth/password', {
        oldPassword: String(data.get('oldPassword') || ''),
        newPassword: String(data.get('newPassword') || ''),
      });
      toast('密码已更新', 'ok');
      form.reset();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });
}

async function logout() {
  try {
    await api.post('/auth/logout', {});
  } catch {
    /* 忽略 */
  }
  state.user = null;
  closeAllLayers();
  showLogin();
}

/* ---------------------------------------------------------------- 路由 */

function renderForbidden(route) {
  return html`
    <div class="error-state">
      ${raw(icon('lock', 30, 1.2))}
      <div>当前账号没有访问「${route.label}」的权限</div>
      <div class="mute" style="font-size:12px">如需访问，请联系超级管理员在「账号与权限」中调整。</div>
      <a class="btn btn--ghost btn--sm" href="#/dashboard">返回总览</a>
    </div>
  `;
}

async function render() {
  if (!shellMounted || !state.user) return;
  closeAllLayers();
  const route = activeRoute();
  const host = document.getElementById('view');
  if (!host) return;

  app.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.nav === route.key);
  });

  document.title = `${route.label} · 智学内部抽奖`;

  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }

  host.className = 'view view-enter';

  if (!state.user.permissions.includes(route.permission)) {
    host.innerHTML = renderForbidden(route);
    return;
  }

  const ctx = {
    user: state.user,
    can,
    api,
    navigate,
    refresh,
    setCleanup: (fn) => {
      cleanup = typeof fn === 'function' ? fn : null;
    },
  };

  try {
    host.innerHTML = '';
    const result = await route.view(host, ctx);
    if (typeof result === 'function') cleanup = result;
  } catch (err) {
    if (err.status === 401) {
      state.user = null;
      showLogin('登录状态已失效，请重新登录');
      return;
    }
    host.innerHTML = html`
      <div class="error-state">
        ${raw(icon('alert', 28, 1.3))}
        <div>${err.message || '页面加载失败'}</div>
        <button class="btn btn--ghost btn--sm" onclick="location.reload()">重新加载</button>
      </div>
    `;
  }
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- 启动 */

window.addEventListener('aurum:unauthorized', () => {
  if (!state.user) return;
  state.user = null;
  showLogin('登录状态已失效，请重新登录');
});

/* 初始密码未改：先逼着改密码，改完才进主界面 */
function showPasswordGate() {
  closeAllLayers();
  shellMounted = false;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px';
  wrap.innerHTML = html`
    <div style="width:min(420px,100%);background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:26px;box-shadow:0 30px 60px -50px rgba(74,52,24,.6)">
      <div class="eyebrow">First sign-in</div>
      <h2 style="margin:8px 0 6px;font-size:22px">请先修改初始密码</h2>
      <p class="form-note" style="margin:0 0 16px">
        你的账号当前是初始密码（手机号后 6 位），为了安全必须先改成自己的密码才能进入。
      </p>
      <label class="form-note" style="display:block;margin-bottom:6px">当前密码</label>
      <input class="input" id="pg-old" type="password" autocomplete="current-password" placeholder="手机号后 6 位" style="width:100%;margin-bottom:12px" />
      <label class="form-note" style="display:block;margin-bottom:6px">新密码（至少 6 位）</label>
      <input class="input" id="pg-new" type="password" autocomplete="new-password" style="width:100%;margin-bottom:12px" />
      <label class="form-note" style="display:block;margin-bottom:6px">再输一次</label>
      <input class="input" id="pg-new2" type="password" autocomplete="new-password" style="width:100%;margin-bottom:16px" />
      <button class="btn btn--gold btn--block" id="pg-save" type="button">保存并进入</button>
      <p class="form-note" id="pg-err" style="color:#a63b2a;min-height:18px;margin:10px 0 0"></p>
      <p class="form-note" style="margin:14px 0 0">
        <a href="#" id="pg-logout" style="color:var(--dim)">退出登录</a>
      </p>
    </div>
  `;
  app.appendChild(wrap);

  const err = (message) => {
    wrap.querySelector('#pg-err').textContent = message || '';
  };

  wrap.querySelector('#pg-save').addEventListener('click', async (event) => {
    const oldPassword = wrap.querySelector('#pg-old').value;
    const newPassword = wrap.querySelector('#pg-new').value;
    const again = wrap.querySelector('#pg-new2').value;
    if (!oldPassword || !newPassword) return err('请把密码填完整');
    if (newPassword.length < 6) return err('新密码至少 6 位');
    if (newPassword !== again) return err('两次输入的新密码不一致');
    if (newPassword === oldPassword) return err('新密码不能和初始密码一样');
    const button = event.currentTarget;
    button.disabled = true;
    err('');
    try {
      await api.patch('/auth/password', { oldPassword, newPassword });
      toast('密码已更新', 'ok');
      state.user = { ...state.user, mustChangePassword: false };
      if (!location.hash) history.replaceState(null, '', '#/dashboard');
      mountShell();
      api
        .get('/meta')
        .then((meta) => {
          state.meta = meta;
          window.__PERMISSION_LABELS__ = Object.fromEntries(meta.permissions.map((p) => [p.key, p.label]));
        })
        .catch(() => {});
    } catch (error) {
      err(error.message || '修改失败');
      button.disabled = false;
    }
  });

  wrap.querySelector('#pg-logout').addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await api.post('/auth/logout');
    } catch {
      /* 忽略 */
    }
    showLogin();
  });
}

async function boot() {
  try {
    const { user } = await api.get('/auth/me');
    state.user = user;
    if (user.mustChangePassword) {
      showPasswordGate();
      return;
    }
    if (!location.hash) {
      history.replaceState(null, '', '#/dashboard');
    }
    mountShell();
    api
      .get('/meta')
      .then((meta) => {
        state.meta = meta;
        window.__PERMISSION_LABELS__ = Object.fromEntries(meta.permissions.map((p) => [p.key, p.label]));
      })
      .catch(() => {});
  } catch {
    showLogin();
  }
}

boot();
