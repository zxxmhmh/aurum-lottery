import { api } from '../api.js';
import {
  html,
  raw,
  icon,
  esc,
  toast,
  openDrawer,
  confirmDialog,
  initials,
  timeAgo,
  fmtNumber,
} from '../ui.js';

function permMatrix({ permissions, roles }, selected, { disabled = false } = {}) {
  const groups = [];
  const map = new Map();
  for (const permission of permissions) {
    if (!map.has(permission.group)) {
      map.set(permission.group, []);
      groups.push(permission.group);
    }
    map.get(permission.group).push(permission);
  }
  void roles;
  return groups
    .map(
      (group) => html`
        <div class="perm-group">${group}</div>
        ${map.get(group).map(
          (permission) => html`
            <label class="check">
              <input type="checkbox" value="${permission.key}" data-perm
                ${selected.includes(permission.key) ? raw('checked') : ''}
                ${disabled ? raw('disabled') : ''} />
              <span class="box">${raw(icon('check', 11, 3))}</span>
              <span>${permission.label}</span>
            </label>
          `,
        )}
      `,
    )
    .join('');
}

function openUserEditor({ user, meta, isSelf, onSaved }) {
  const isEdit = Boolean(user);
  const initial = user
    ? {
        name: user.name,
        account: user.account,
        role: user.role,
        permissions: [...user.permissions],
        enabled: user.enabled !== false,
      }
    : {
        name: '',
        account: '',
        role: 'operator',
        permissions: meta.roles.find((r) => r.key === 'operator')?.permissions || [],
        enabled: true,
      };

  const locked = isSelf;
  const ownerTarget = initial.role === 'owner';

  const body = document.createElement('div');
  body.innerHTML = html`
    <form autocomplete="off">
      <div class="form-section">
        <div class="form-grid">
          <div class="field">
            <label>姓名</label>
            <input class="input" name="name" value="${esc(initial.name)}" maxlength="20" placeholder="显示名称" required />
          </div>
          <div class="field">
            <label>登录账号</label>
            <input class="input" name="account" value="${esc(initial.account)}" maxlength="32" placeholder="如 lin.zhixia"
              ${isEdit ? raw('disabled') : ''} required />
          </div>
          <div class="field">
            <label>角色</label>
            <select class="select" name="role" ${locked ? raw('disabled') : ''}>
              ${meta.roles.map(
                (role) => html`<option value="${role.key}"${role.key === initial.role ? raw(' selected') : ''}>${role.label}</option>`,
              )}
            </select>
            <span class="form-note">切换角色会按预设重置下方权限勾选。</span>
          </div>
          <div class="field">
            <label>${isEdit ? '重置密码（选填）' : '初始密码'}</label>
            <input class="input" name="password" type="password" minlength="6" autocomplete="new-password"
              placeholder="${isEdit ? '留空则不修改' : '至少 6 位'}" ${locked ? raw('disabled') : ''} ${isEdit ? '' : raw('required')} />
          </div>
          ${isEdit ? html`` : ''}
          <div class="field span-2">
            <label>账号状态</label>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="switch${initial.enabled ? ' is-on' : ''}" id="enabled-switch" role="switch" tabindex="0"
                aria-checked="${initial.enabled ? 'true' : 'false'}"></span>
              <span class="form-note" id="enabled-note" style="margin:0">
                ${initial.enabled ? '启用中 · 可以正常登录' : '已停用 · 无法登录'}
              </span>
            </div>
          </div>
        </div>
        ${isSelf
          ? html`<p class="form-note" style="color:var(--gold)">这是你自己的账号：角色、权限与状态需由其他管理员调整，密码请用右上角账号面板修改。</p>`
          : ''}
      </div>

      <div class="form-section">
        <div class="form-section-title">权限配置<em>Permissions</em></div>
        <p class="form-note">勾选即生效，与角色预设无关；超级管理员始终拥有全部权限。</p>
        <div class="perm-grid" id="perm-grid">
          ${raw(permMatrix(meta, initial.permissions, { disabled: locked || ownerTarget }))}
        </div>
      </div>
    </form>
  `;

  const roleSelect = body.querySelector('[name="role"]');
  const grid = body.querySelector('#perm-grid');

  let enabled = initial.enabled;
  const switchEl = body.querySelector('#enabled-switch');
  const switchNote = body.querySelector('#enabled-note');
  const toggleEnabled = () => {
    if (locked) return;
    enabled = !enabled;
    switchEl.classList.toggle('is-on', enabled);
    switchEl.setAttribute('aria-checked', enabled ? 'true' : 'false');
    switchNote.textContent = enabled ? '启用中 · 可以正常登录' : '已停用 · 无法登录';
  };
  if (locked) {
    switchEl.style.opacity = '0.45';
    switchEl.style.pointerEvents = 'none';
  } else {
    switchEl.addEventListener('click', toggleEnabled);
    switchEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleEnabled();
      }
    });
  }

  roleSelect?.addEventListener('change', () => {
    const role = meta.roles.find((r) => r.key === roleSelect.value);
    const keys = role ? role.permissions : [];
    grid.querySelectorAll('[data-perm]').forEach((input) => {
      input.checked = keys.includes(input.value);
    });
    if (roleSelect.value === 'owner') {
      grid.querySelectorAll('[data-perm]').forEach((input) => {
        input.checked = true;
      });
    }
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px';
  footer.innerHTML = html`
    <button class="btn btn--ghost btn--sm" type="button" data-cancel>取消</button>
    <button class="btn btn--gold btn--sm" type="button" data-save>${isEdit ? '保存修改' : '创建账号'}</button>
  `;

  const drawer = openDrawer({
    eyebrow: isEdit ? 'Edit account' : 'New account',
    title: isEdit ? '编辑账号' : '新建账号',
    content: body,
    footer,
  });

  footer.querySelector('[data-cancel]').addEventListener('click', () => drawer.close());

  footer.querySelector('[data-save]').addEventListener('click', async () => {
    const form = body.querySelector('form');
    const name = form.querySelector('[name="name"]').value.trim();
    const account = form.querySelector('[name="account"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const role = roleSelect.value;
    const permissions = Array.from(grid.querySelectorAll('[data-perm]')).filter((i) => i.checked).map((i) => i.value);

    if (!name) {
      toast('请填写姓名', 'err');
      return;
    }
    if (!isEdit && !/^[a-zA-Z0-9_.@-]{2,32}$/.test(account)) {
      toast('账号需为 2–32 位字母、数字或 _ . @ -', 'err');
      return;
    }
    if (!isEdit && password.length < 6) {
      toast('初始密码至少 6 位', 'err');
      return;
    }
    if (isEdit && password && password.length < 6) {
      toast('新密码至少 6 位', 'err');
      return;
    }

    const button = footer.querySelector('[data-save]');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      if (isEdit) {
        const payload = { name };
        if (!locked) {
          payload.role = role;
          payload.permissions = permissions;
          payload.enabled = enabled;
        }
        if (password) payload.password = password;
        await api.patch(`/users/${user.id}`, payload);
        toast('账号已更新', 'ok');
      } else {
        await api.post('/users', {
          name,
          account,
          password,
          role,
          permissions,
          enabled,
        });
        toast('账号已创建', 'ok');
      }
      drawer.close();
      onSaved();
    } catch (err) {
      toast(err.message, 'err');
      button.disabled = false;
      button.textContent = isEdit ? '保存修改' : '创建账号';
    }
  });
}

export async function renderAccounts(host, ctx) {
  const load = async () => {
    host.innerHTML = html`<div class="loading"><span class="spinner"></span>读取账号</div>`;
    const [{ users }, meta] = await Promise.all([api.get('/users'), api.get('/meta')]);
    paint(users, meta);
  };

  const paint = (users, meta) => {
    const labelOf = (key) => meta.permissions.find((p) => p.key === key)?.label || key;

    host.innerHTML = html`
      <div class="page">
        <header class="page-head">
          <div>
            <div class="eyebrow">Access control · 账号与权限</div>
            <h1 class="page-title">账号与权限</h1>
            <p class="page-sub">按角色授权，也可逐人微调；权限校验发生在服务端，前端隐藏只是体贴。</p>
          </div>
          <div class="page-actions">
            <button class="btn btn--ghost btn--sm" id="reload-users" type="button">${raw(icon('refresh', 15))} 刷新</button>
            ${ctx.can('account.manage')
              ? html`<button class="btn btn--gold btn--sm" id="new-user" type="button">${raw(icon('plus', 15))} 新建账号</button>`
              : ''}
          </div>
        </header>

        <div class="toolbar">
          <div class="field">
            <select class="select" id="user-role">
              <option value="all">全部角色</option>
              ${meta.roles.map((role) => html`<option value="${role.key}">${role.label}</option>`)}
            </select>
          </div>
          <div class="field">
            <select class="select" id="user-status">
              <option value="all">全部状态</option>
              <option value="on">启用</option>
              <option value="off">已停用</option>
              <option value="pending">待改密码</option>
            </select>
          </div>
          <div class="search">
            ${raw(icon('search', 15))}
            <input class="input" id="user-q" placeholder="搜索姓名 / 账号（手机号）" autocomplete="off" />
          </div>
          <div class="toolbar-spacer"></div>
          <span class="badge badge--mute" id="user-count">共 ${fmtNumber(users.length)} 个账号</span>
        </div>

        <div class="table-wrap">
          <div class="user-row" style="background:rgba(var(--lift-rgb), .022);padding:14px 22px">
            <span class="field-label">成员</span>
            <span class="field-label col-role">角色</span>
            <span class="field-label col-perms">权限</span>
            <span class="field-label col-login">最近登录</span>
            <span class="field-label">状态</span>
            <span></span>
          </div>
          <div class="user-list">
            ${users.map(
              (user) => html`
                <div class="user-row" data-user-row data-name="${user.name}" data-account="${user.account}"
                  data-role="${user.role}" data-enabled="${user.enabled ? '1' : '0'}"
                  data-pending="${user.mustChangePassword ? '1' : '0'}">
                  <div class="user-cell">
                    <span class="avatar" style="${user.role === 'owner' ? '' : ''}">${initials(user.name)}</span>
                    <div style="min-width:0">
                      <div class="user-cell-name">
                        ${user.name}
                        ${user.id === ctx.user.id ? html`<span class="tag" style="margin-left:6px">我</span>` : ''}
                        ${user.mustChangePassword ? html`<span class="tag" style="margin-left:6px;color:var(--gold-2)">待改密码</span>` : ''}
                      </div>
                      <div class="user-cell-account">
                        @${user.account}${user.drawCount ? ` · 开奖 ${fmtNumber(user.drawCount)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="col-role">
                    <span class="role-pill${user.role === 'owner' ? ' is-owner' : ''}">
                      ${user.role === 'owner' ? raw(icon('crown', 12)) : ''}${user.roleLabel}
                    </span>
                  </div>
                  <div class="col-perms">
                    <div class="perm-mini">
                      ${user.permissions.slice(0, 3).map((key) => html`<span>${labelOf(key)}</span>`)}
                      ${user.permissions.length > 3
                        ? html`<span>+${user.permissions.length - 3}</span>`
                        : ''}
                    </div>
                  </div>
                  <div class="col-login mute" style="font-size:11.5px">${timeAgo(user.lastLoginAt)}</div>
                  <div>
                    ${user.enabled
                      ? html`<span class="badge badge--ok"><span class="dot" style="background:#8cb598"></span>启用</span>`
                      : html`<span class="badge badge--mute">已停用</span>`}
                  </div>
                  <div class="btn-row" style="justify-content:flex-end;gap:6px">
                    ${ctx.can('account.manage')
                      ? html`<button class="btn btn--sm btn--ghost" data-edit-user="${user.id}" type="button">${raw(icon('edit', 14))} 编辑</button>`
                      : ''}
                    ${user.id !== ctx.user.id && ctx.can('account.manage')
                      ? html`<button class="icon-btn" data-del-user="${user.id}" type="button" title="删除账号">${raw(icon('trash', 14))}</button>`
                      : ''}
                  </div>
                </div>
              `,
            )}
          </div>
        </div>

        <section class="section" style="margin-top:34px">
          <div class="section-head">
            <div class="section-title">角色预设</div>
            <div class="section-count">05 roles</div>
          </div>
          <div class="act-grid">
            ${meta.roles.map(
              (role) => html`
                <div class="panel" style="padding:20px 22px">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                    <div class="role-pill${role.key === 'owner' ? ' is-owner' : ''}">
                      ${role.key === 'owner' ? raw(icon('crown', 12)) : ''}${role.label}
                    </div>
                    <span class="mute" style="font-family:var(--serif);font-size:11px;letter-spacing:.2em">${role.permissions.length} / ${meta.permissions.length}</span>
                  </div>
                  <p class="form-note" style="margin:12px 0 14px;min-height:34px">${role.desc}</p>
                  <div class="perm-mini">
                    ${role.permissions.slice(0, 4).map((key) => html`<span>${labelOf(key)}</span>`)}
                    ${role.permissions.length > 4 ? html`<span>+${role.permissions.length - 4}</span>` : ''}
                  </div>
                </div>
              `,
            )}
          </div>
        </section>
      </div>
    `;

    host.querySelector('#reload-users')?.addEventListener('click', () => load());
    host.querySelector('#new-user')?.addEventListener('click', () => {
      openUserEditor({ user: null, meta, isSelf: false, onSaved: load });
    });

    host.querySelectorAll('[data-edit-user]').forEach((button) => {
      button.addEventListener('click', () => {
        const user = users.find((u) => u.id === button.dataset.editUser);
        if (!user) return;
        openUserEditor({
          user,
          meta,
          isSelf: user.id === ctx.user.id,
          onSaved: load,
        });
      });
    });

    /* ---- 搜索 / 筛选 ---- */
    const qEl = host.querySelector('#user-q');
    const roleEl = host.querySelector('#user-role');
    const statusEl = host.querySelector('#user-status');
    const countEl = host.querySelector('#user-count');
    const rowEls = Array.from(host.querySelectorAll('[data-user-row]'));

    const applyFilter = () => {
      const q = (qEl?.value || '').trim().toLowerCase();
      const role = roleEl?.value || 'all';
      const status = statusEl?.value || 'all';
      let shown = 0;
      for (const row of rowEls) {
        const hay = `${row.dataset.name} ${row.dataset.account}`.toLowerCase();
        const okQuery = !q || hay.includes(q);
        const okRole = role === 'all' || row.dataset.role === role;
        const okStatus =
          status === 'all'
          || (status === 'on' && row.dataset.enabled === '1')
          || (status === 'off' && row.dataset.enabled === '0')
          || (status === 'pending' && row.dataset.pending === '1');
        const ok = okQuery && okRole && okStatus;
        row.style.display = ok ? '' : 'none';
        if (ok) shown += 1;
      }
      if (countEl) {
        countEl.textContent = shown === rowEls.length
          ? `共 ${fmtNumber(rowEls.length)} 个账号`
          : `共 ${fmtNumber(rowEls.length)} 个 · 显示 ${fmtNumber(shown)} 个`;
      }
    };

    qEl?.addEventListener('input', applyFilter);
    roleEl?.addEventListener('change', applyFilter);
    statusEl?.addEventListener('change', applyFilter);

    host.querySelectorAll('[data-del-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        const user = users.find((u) => u.id === button.dataset.delUser);
        if (!user) return;
        const ok = await confirmDialog({
          eyebrow: 'Remove account',
          title: '删除账号',
          message: `「${user.name}（@${user.account}）」将无法再登录，其历史开奖记录会保留。此操作不可撤销。`,
          confirmText: '删除账号',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/users/${user.id}`);
          toast('账号已删除', 'ok');
          load();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });
  };

  await load();
  return undefined;
}
