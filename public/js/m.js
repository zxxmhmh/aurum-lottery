/**
 * 手机端发码台：登录 → 选活动 → 填姓名/手机号/校区 → 确认 → 出码+二维码
 * 只调用现有接口，不新增服务端能力。
 */
import { qrPngDataUrl } from './qr.js';

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const error = new Error(data?.error || '请求失败，请稍后再试');
    error.code = data?.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

const state = {
  user: null,
  activities: [],
  activity: null,
  timer: null,
  busy: false,
};

const maskPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : digits;
};

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function showError(id, message) {
  const el = $(id);
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

let sheetResolver = null;
let sheetHideTimer = null;
function openSheet(html, { dismissible = true } = {}) {
  const sheet = $('sheet');
  clearTimeout(sheetHideTimer);
  $('sheet-card').innerHTML = html;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  return new Promise((resolve) => {
    sheetResolver = (value) => {
      sheet.classList.remove('is-open');
      clearTimeout(sheetHideTimer);
      sheetHideTimer = setTimeout(() => {
        sheet.hidden = true;
        $('sheet-card').innerHTML = '';
      }, 240);
      sheetResolver = null;
      resolve(value);
    };
    if (dismissible) {
      sheet.querySelector('.m-sheet-mask').addEventListener('click', () => sheetResolver?.(false), { once: true });
    }
  });
}

function closeSheet(value) {
  sheetResolver?.(value);
}

function confirmSheet({ title, rows = [], note = '', confirmText = '确认', cancelText = '取消' }) {
  const body = rows
    .map((row) => `<li><span>${esc(row.label)}</span><b>${esc(row.value)}</b></li>`)
    .join('');
  const promise = openSheet(`
    <h3 class="m-sheet-title">${esc(title)}</h3>
    ${note ? `<p class="m-note">${esc(note)}</p>` : ''}
    ${body ? `<ul class="m-sheet-rows">${body}</ul>` : ''}
    <div class="m-sheet-actions">
      <button class="m-btn m-btn--ghost" type="button" data-cancel>${esc(cancelText)}</button>
      <button class="m-btn m-btn--primary" type="button" data-ok>${esc(confirmText)}</button>
    </div>
  `);
  $('sheet-card').querySelector('[data-cancel]').addEventListener('click', () => closeSheet(false));
  $('sheet-card').querySelector('[data-ok]').addEventListener('click', () => closeSheet(true));
  return promise;
}

async function showResult(code) {
  const url = `${location.origin}/redeem?code=${encodeURIComponent(code)}`;
  openSheet(`
    <h3 class="m-sheet-title">已发出</h3>
    <div class="m-code-big">${esc(code)}</div>
    <div class="m-qr"><img src="${qrPngDataUrl(url, { size: 640, margin: 3 })}" alt="抽奖码二维码" /></div>
    <p class="m-qr-note">让学员直接扫这个码，或把抽奖码抄给他</p>
    <div class="m-sheet-actions">
      <button class="m-btn m-btn--ghost" type="button" data-copy>复制码</button>
      <button class="m-btn m-btn--primary" type="button" data-ok>完成</button>
    </div>
  `);
  const card = $('sheet-card');
  card.querySelector('[data-ok]').addEventListener('click', () => closeSheet(true));
  card.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('已复制');
    } catch {
      toast('长按上面的码复制');
    }
  });
}

/* ------------------------------------------------------------ 登录 */

function showLogin(message = '') {
  $('login-card').hidden = false;
  $('act-card').hidden = true;
  $('issue-card').hidden = true;
  $('log-card').hidden = true;
  $('auth-btn').hidden = true;
  showError('login-error', message);
  $('who').textContent = '未登录';
}

async function doLogin() {
  const account = $('login-account').value.trim();
  const password = $('login-password').value;
  if (!account || !password) {
    showError('login-error', '请填写账号和密码');
    return;
  }
  $('login-btn').disabled = true;
  showError('login-error', '');
  try {
    await api('/auth/login', { method: 'POST', body: { account, password } });
    $('login-password').value = '';
    await boot();
  } catch (err) {
    showError('login-error', err.message);
  } finally {
    $('login-btn').disabled = false;
  }
}

/* ------------------------------------------------------------ 主流程 */

async function boot() {
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    if (user.mustChangePassword) {
      showPasswordGate(user);
      return;
    }
    enterApp();
  } catch {
    state.user = null;
    showLogin();
  }
}

function showPasswordGate(user) {
  $('login-card').hidden = true;
  $('pwd-card').hidden = false;
  $('act-card').hidden = true;
  $('issue-card').hidden = true;
  $('log-card').hidden = true;
  $('auth-btn').hidden = false;
  $('auth-btn').textContent = '退出';
  $('who').textContent = `${user.name || user.account} · 待改密码`;
  showError('pw-error', '');
  setTimeout(() => $('pw-old').focus(), 120);
}

function enterApp() {
  $('login-card').hidden = true;
  $('auth-btn').hidden = false;
  $('auth-btn').textContent = '退出';
  $('who').textContent = `${state.user.name || state.user.account} · ${state.user.roleLabel || state.user.role}`;
  if (!state.user.permissions?.includes('draw.execute')) {
    $('act-card').hidden = false;
    $('act-select').innerHTML = '<option>无发码权限</option>';
    showLogin('这个账号没有「执行抽奖」权限，找管理员开通后再用。');
    return;
  }
  loadActivities();
}

async function loadActivities() {
  try {
    const { activities } = await api('/activities');
    state.activities = activities.filter((a) => a.mode === 'code');
    if (!state.activities.length) {
      $('act-card').hidden = false;
      $('act-select').innerHTML = '<option>暂无可发码的活动</option>';
      $('issue-card').hidden = true;
      $('log-card').hidden = true;
      return;
    }
    const preferred = localStorage.getItem('m.activity') || '';
    const active = state.activities.find((a) => a.id === preferred)
      || state.activities.find((a) => a.status === 'active')
      || state.activities[0];
    $('act-select').innerHTML = state.activities
      .map((a) => `<option value="${esc(a.id)}"${a.id === active.id ? ' selected' : ''}>${esc(a.name)}</option>`)
      .join('');
    $('act-card').hidden = false;
    $('issue-card').hidden = false;
    $('log-card').hidden = false;
    await selectActivity(active.id);
  } catch (err) {
    toast(err.message);
  }
}

async function selectActivity(id) {
  const activity = state.activities.find((a) => a.id === id);
  if (!activity) return;
  state.activity = activity;
  localStorage.setItem('m.activity', id);
  renderForm(activity);
  await refreshAll();
  startAutoRefresh();
}

function renderForm(activity) {
  $('req-name').hidden = activity.nameRequired === false;
  $('req-phone').hidden = activity.phoneRequired === false;
  $('req-campus').hidden = !activity.campusRequired;
  $('f-name').placeholder = activity.nameRequired === false ? '可不填' : '张三';
  $('f-phone').placeholder = activity.phoneRequired === false ? '可不填' : '务必填写与学生订单一样的手机号';

  const presets = Array.isArray(activity.campuses) ? activity.campuses : [];
  const wrap = $('campus-wrap');
  if (presets.length) {
    wrap.innerHTML = `
      <select class="m-select" id="f-campus">
        <option value="">${activity.campusRequired ? '请选择校区' : '不填写'}</option>
        ${presets.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
      </select>
    `;
  } else {
    wrap.innerHTML = '<input class="m-input" id="f-campus" maxlength="20" placeholder="校区（可不填）" />';
  }
  showError('issue-error', '');
}

async function refreshAll() {
  if (!state.activity) return;
  try {
    const [summary, log] = await Promise.all([
      api(`/activities/${state.activity.id}/codes/summary`),
      api(`/activities/${state.activity.id}/codes/issue-log`).catch(() => ({ entries: [] })),
    ]);
    $('stat-free').textContent = summary.free;
    $('stat-issued').textContent = summary.issued;
    $('stat-used').textContent = summary.used;
    renderLog(log.entries || []);
  } catch (err) {
    if (err.status === 401) showLogin('登录已过期，请重新登录');
  }
}

function renderLog(entries) {
  const list = $('log-list');
  if (!entries.length) {
    list.innerHTML = '<li class="m-log-empty">还没有发过码</li>';
    return;
  }
  list.innerHTML = entries
    .slice(0, 12)
    .map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const stateText = entry.used ? '已开奖' : entry.bound ? '待开奖' : '已解绑';
      return `
        <li>
          <div class="m-log-main">
            <b>${esc(entry.name || entry.holder || '（未填姓名）')} · ${esc(entry.campus || '未填校区')}</b>
            <span>${esc(entry.code)} · ${time}</span>
          </div>
          <span class="m-log-state">${stateText}</span>
        </li>
      `;
    })
    .join('');
}

function startAutoRefresh() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (document.hidden || !$('sheet').hidden) return;
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    refreshAll();
  }, 10000);
}

/* ------------------------------------------------------------ 发码 */

async function issueOnce(force) {
  const activity = state.activity;
  const name = $('f-name').value.trim();
  const rawPhone = $('f-phone').value.replace(/\D/g, '');
  const campusEl = $('f-campus');
  const campus = (campusEl?.value || '').trim();

  if (activity.nameRequired !== false && !name) {
    showError('issue-error', '请填写学员姓名');
    $('f-name').focus();
    return;
  }
  if (activity.phoneRequired !== false && !rawPhone) {
    showError('issue-error', '请填写手机号');
    $('f-phone').focus();
    return;
  }
  if (rawPhone && !/^1[3-9]\d{9}$/.test(rawPhone)) {
    showError('issue-error', '手机号要是 11 位');
    $('f-phone').focus();
    return;
  }
  if (activity.campusRequired && !campus) {
    showError('issue-error', '请选择校区');
    campusEl?.focus();
    return;
  }

  const button = $('issue-btn');
  if (!force) {
    button.disabled = true;
    const ok = await confirmSheet({
      title: '确认发放这枚抽奖码？',
      rows: [
        { label: '姓名', value: name || '（不填）' },
        { label: '手机号', value: rawPhone ? maskPhone(rawPhone) : '（不填）' },
        { label: '校区', value: campus || '（不填）' },
        { label: '剩余空码', value: `${$('stat-free').textContent} 枚` },
      ],
      note: '确认后从空码池按顺序取一枚，学员凭码开奖。',
      confirmText: '确认发放',
    });
    if (!ok) {
      button.disabled = false;
      return;
    }
  }

  button.disabled = true;
  showError('issue-error', '');
  try {
    const res = await api(`/activities/${activity.id}/codes/issue`, {
      method: 'POST',
      body: { name, phone: rawPhone, campus, force: Boolean(force) },
    });
    $('f-name').value = '';
    $('f-phone').value = '';
    if (campusEl) campusEl.value = '';
    await refreshAll();
    await showResult(res.code.code);
    $('f-name').focus();
  } catch (err) {
    if (err.code === 'duplicate_partial') {
      const forced = await confirmSheet({
        title: '已有同名 / 同号记录',
        rows: [{ label: '提示', value: err.message }],
        confirmText: '确认不是同一位',
        cancelText: '算了',
      });
      if (forced) {
        button.disabled = false;
        await issueOnce(true);
        return;
      }
    } else {
      showError('issue-error', err.message);
      if (err.status === 401) showLogin('登录已过期，请重新登录');
    }
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------ 事件 */

$('login-btn').addEventListener('click', doLogin);
$('login-password').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') doLogin();
});
$('pw-save').addEventListener('click', async (event) => {
  const oldPassword = $('pw-old').value;
  const newPassword = $('pw-new').value;
  const again = $('pw-new2').value;
  if (!oldPassword || !newPassword) return showError('pw-error', '请把密码填完整');
  if (newPassword.length < 6) return showError('pw-error', '新密码至少 6 位');
  if (newPassword !== again) return showError('pw-error', '两次输入的新密码不一致');
  if (newPassword === oldPassword) return showError('pw-error', '新密码不能和初始密码一样');
  const button = event.currentTarget;
  button.disabled = true;
  showError('pw-error', '');
  try {
    await api('/auth/password', { method: 'PATCH', body: { oldPassword, newPassword } });
    toast('密码已更新');
    $('pw-old').value = '';
    $('pw-new').value = '';
    $('pw-new2').value = '';
    $('pwd-card').hidden = true;
    await boot();
  } catch (err) {
    showError('pw-error', err.message);
  } finally {
    button.disabled = false;
  }
});
$('act-select').addEventListener('change', (event) => selectActivity(event.target.value));
$('issue-btn').addEventListener('click', () => issueOnce(false));
$('log-refresh').addEventListener('click', () => refreshAll());
$('auth-btn').addEventListener('click', async () => {
  if (!state.user) return;
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* 忽略 */
  }
  state.user = null;
  if (state.timer) clearInterval(state.timer);
  location.reload();
});

boot();

/* 前台开关：老师手机端被关闭时，整页换成“已关闭”提示 */
(async function gate() {
  try {
    const res = await fetch('/api/public/frontends', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return;
    const cfg = (await res.json()) || {};
    const fe = cfg.m || {};
    if (fe.enabled === false) {
      const main = document.querySelector('.m-main');
      if (!main) return;
      main.textContent = '';
      const box = document.createElement('section');
      box.className = 'm-card';
      const title = document.createElement('h2');
      title.className = 'm-card-title';
      title.textContent = fe.title || '发码台已关闭';
      const note = document.createElement('p');
      note.className = 'm-note';
      note.textContent = fe.note || '管理员已关闭手机端，请联系管理员开启。';
      box.appendChild(title);
      box.appendChild(note);
      main.appendChild(box);
      const authBtn = document.getElementById('auth-btn');
      if (authBtn) authBtn.hidden = true;
    }
  } catch {
    /* 忽略 */
  }
})();