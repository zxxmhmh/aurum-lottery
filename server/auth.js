import crypto from 'node:crypto';
import { db, persist } from './db.js';
import { verifyPassword } from './password.js';
import { forbidden, unauthorized } from './util.js';

export const PERMISSIONS = [
  { key: 'activity.view', label: '查看活动', group: '活动' },
  { key: 'activity.manage', label: '创建 / 编辑活动', group: '活动' },
  { key: 'prize.manage', label: '配置奖项与名额', group: '活动' },
  { key: 'draw.execute', label: '执行抽奖', group: '抽奖' },
  { key: 'record.view', label: '查看抽奖记录', group: '抽奖' },
  { key: 'record.manage', label: '撤销记录 / 导出', group: '抽奖' },
  { key: 'quota.reset', label: '重置名额与抽奖码', group: '抽奖' },
  { key: 'account.view', label: '查看账号', group: '账号' },
  { key: 'account.manage', label: '账号与权限管理', group: '账号' },
  { key: 'backup.manage', label: '数据备份与下载', group: '账号' },
];

export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

export const ROLES = [
  {
    key: 'owner',
    label: '超级管理员',
    desc: '拥有全部权限，包括账号与权限配置',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'admin',
    label: '管理员',
    desc: '可以管理活动、奖项与抽奖，不能管理账号',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'account.manage' && p !== 'backup.manage'),
  },
  {
    key: 'operator',
    label: '抽奖执行',
    desc: '在活动现场执行抽奖并查看记录',
    permissions: ['activity.view', 'draw.execute', 'record.view'],
  },
  {
    key: 'auditor',
    label: '审核员',
    desc: '核对记录、导出与撤销，不参与抽奖',
    permissions: ['activity.view', 'record.view', 'record.manage'],
  },
  {
    key: 'viewer',
    label: '观察员',
    desc: '只读：查看活动与记录',
    permissions: ['activity.view', 'record.view'],
  },
];

export const ROLE_MAP = new Map(ROLES.map((r) => [r.key, r]));

export const SESSION_TTL = 12 * 3600e3;
export const SESSION_TTL_LONG = 30 * 24 * 3600e3;
export const COOKIE_NAME = 'aurum_sid';

export function rolePreset(role) {
  const r = ROLE_MAP.get(role);
  return r ? [...r.permissions] : ['activity.view'];
}

export function resolvePermissions(user) {
  if (!user) return [];
  if (user.role === 'owner') return [...ALL_PERMISSIONS];
  const stored = Array.isArray(user.permissions) ? user.permissions : [];
  if (!stored.length) return rolePreset(user.role).filter((p) => ALL_PERMISSIONS.includes(p));
  return stored.filter((p) => ALL_PERMISSIONS.includes(p));
}

export function can(user, permission) {
  return resolvePermissions(user).includes(permission);
}

export function requirePermission(user, permission) {
  if (!can(user, permission)) {
    throw forbidden(`缺少「${PERMISSIONS.find((p) => p.key === permission)?.label || permission}」权限`);
  }
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    account: user.account,
    name: user.name,
    role: user.role,
    roleLabel: ROLE_MAP.get(user.role)?.label || user.role,
    permissions: resolvePermissions(user),
    enabled: user.enabled !== false,
    mustChangePassword: user.mustChangePassword === true,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || 0,
  };
}

export function findUserByAccount(account) {
  const target = String(account || '').trim().toLowerCase();
  return db.users.find((u) => String(u.account).toLowerCase() === target) || null;
}

export function findUserById(id) {
  return db.users.find((u) => u.id === id) || null;
}

/* --------------------------------------------------------------- sessions */

export function createSession(user, { ttl = SESSION_TTL } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId: user.id, exp: Date.now() + ttl, createdAt: Date.now() };
  user.lastLoginAt = Date.now();
  persist();
  return token;
}

export function destroySession(token) {
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    persist();
  }
}

export function destroyUserSessions(userId) {
  let changed = false;
  for (const [token, session] of Object.entries(db.sessions)) {
    if (session.userId === userId) {
      delete db.sessions[token];
      changed = true;
    }
  }
  if (changed) persist();
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return { token: '', user: null };
  const session = db.sessions[token];
  if (!session) return { token, user: null };
  if (session.exp <= Date.now()) {
    delete db.sessions[token];
    persist();
    return { token, user: null };
  }
  const user = findUserById(session.userId);
  if (!user || user.enabled === false) return { token, user: null };
  return { token, user };
}

export function requireUser(req) {
  const { user } = authenticate(req);
  if (!user) throw unauthorized();
  return user;
}

/* ---------------------------------------------------------- login guards */

const attempts = new Map();
const WINDOW = 5 * 60e3;
const MAX_ATTEMPTS = 8;

export function checkLoginRate(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return;
  if (entry.count >= MAX_ATTEMPTS) {
    const remain = Math.ceil((entry.resetAt - now) / 1000);
    throw forbidden(`尝试次数过多，请 ${remain} 秒后再试`, 'rate_limited');
  }
}

export function noteLoginFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}

export function checkCredentials(account, password) {
  const user = findUserByAccount(account);
  if (!user) return null;
  if (user.enabled === false) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  return user;
}
