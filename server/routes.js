import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, persist, ROOT, backupNow } from './db.js';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_MAP,
  COOKIE_NAME,
  SESSION_TTL,
  SESSION_TTL_LONG,
  authenticate,
  can,
  checkCredentials,
  checkLoginRate,
  clearLoginFailures,
  createSession,
  destroySession,
  destroyUserSessions,
  findUserByAccount,
  findUserById,
  noteLoginFailure,
  publicUser,
  requirePermission,
  requireUser,
  resolvePermissions,
  rolePreset,
} from './auth.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  HttpError,
  badRequest,
  clamp,
  dec,
  forbidden,
  int,
  notFound,
  oneOf,
  str,
  uid,
} from './util.js';

export const MODES = [
  {
    key: 'quota',
    label: '名单抽奖',
    short: '名单',
    desc: '手动选择奖项，每抽一次扣减一个名额，名额归零即止。',
  },
  {
    key: 'probability',
    label: '概率抽奖',
    short: '概率',
    desc: '按奖项权重随机开奖，可设置「谢谢参与」概率，中奖后同样扣减名额。',
  },
  {
    key: 'code',
    label: '抽奖码',
    short: '抽奖码',
    desc: '一码一次：输入抽奖码即开奖，码被使用后作废，必中剩余奖项。',
  },
];

const MODE_MAP = new Map(MODES.map((m) => [m.key, m]));
const MAX_RECORDS = 6000;

/* ------------------------------------------------------------------ utils */

const routes = [];

function def(method, path, handler) {
  const keys = [];
  const source = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
}

export function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
    return { params, handler: route.handler };
  }
  return null;
}

function viewActivity(a) {
  const totalQuota = a.prizes.reduce((s, p) => s + p.quota, 0);
  const totalRemaining = a.prizes.reduce((s, p) => s + Math.max(0, p.remaining), 0);
  return {
    id: a.id,
    name: a.name,
    subtitle: a.subtitle || '',
    description: a.description || '',
    mode: a.mode,
    modeLabel: MODE_MAP.get(a.mode)?.label || a.mode,
    status: a.status,
    publicRedeem: Boolean(a.publicRedeem),
    participantLimit: a.participantLimit || 0,
    missWeight: a.missWeight || 0,
    campuses: Array.isArray(a.campuses) ? a.campuses.slice() : [],
    campusRequired: Boolean(a.campusRequired),
    nameRequired: a.nameRequired !== false,
    phoneRequired: a.phoneRequired !== false,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    resetAt: a.resetAt || 0,
    resetBy: a.resetBy || '',
    prizes: a.prizes.map((p) => ({ ...p })),
    codes: a.mode === 'code'
      ? {
          total: a.codes.length,
          used: a.codes.filter((c) => c.used).length,
          issued: a.codes.filter((c) => c.holder).length,
          campuses: Array.from(new Set(a.codes.map((c) => c.campus).filter(Boolean))).length,
        }
      : null,
    roster: rosterSummary(a),
    // 对外展示的「剩余名额」：抽奖码模式按“发码即占位”算，其余模式按奖品名额算
    quotaView: (() => {
      const issued = a.mode === 'code' ? (a.codes || []).filter((c) => c.holder).length : 0;
      const drawn = a.prizes.reduce((s, p) => s + Math.max(0, (p.quota || 0) - (p.remaining || 0)), 0);
      const remaining = a.mode === 'code'
        ? Math.max(0, totalQuota - issued)
        : totalRemaining;
      return {
        total: totalQuota,
        remaining,
        issued,
        drawn,
        codeMode: a.mode === 'code',
      };
    })(),
    stats: {
      totalQuota,
      totalRemaining,
      drawn: totalQuota - totalRemaining,
      prizeCount: a.prizes.length,
      soldOut: a.prizes.filter((p) => p.remaining <= 0).length,
    },
  };
}

function findActivity(id) {
  const activity = db.activities.find((a) => a.id === id);
  if (!activity) throw notFound('活动不存在或已被删除');
  return activity;
}

function findPrizeGlobal(prizeId) {
  for (const activity of db.activities) {
    const prize = activity.prizes.find((p) => p.id === prizeId);
    if (prize) return { activity, prize };
  }
  return null;
}

function touch(activity) {
  activity.updatedAt = Date.now();
}

function sanitizeColor(value, fallback = '#D9B77C') {
  const v = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : fallback;
}

function parsePrizeInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    out.name = str(input.name, { max: 60, label: '奖项名称' });
  }
  if (!partial || input.level !== undefined) {
    out.level = str(input.level ?? '', { max: 20, label: '奖项等级', optional: true }) || '奖项';
  }
  if (!partial || input.quota !== undefined) {
    out.quota = int(input.quota, { min: 0, max: 100000, label: '名额' });
  }
  if (input.weight !== undefined) {
    out.weight = dec(input.weight, { min: 0, max: 10000, label: '权重' });
  }
  if (input.value !== undefined) {
    out.value = int(input.value, { min: 0, max: 10000000, label: '奖品价值' });
  }
  if (input.color !== undefined) {
    out.color = sanitizeColor(input.color);
  }
  if (input.image !== undefined) {
    const image = String(input.image || '').trim();
    if (image && !/^\/uploads\/[A-Za-z0-9._-]+$/.test(image)) {
      throw badRequest('奖项图片地址不合法，请重新上传');
    }
    out.image = image;
  }
  return out;
}

function normalizeParticipant(value) {
  return str(value ?? '', { max: 40, label: '参与者', optional: true });
}

function normalizeCampuses(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\n,，、]/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = String(item ?? '').trim().slice(0, 20);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= 60) break;
  }
  return out;
}

function searchRecords({ activityId = '', mode = '', q = '' } = {}) {
  const keyword = String(q || '').trim().toLowerCase();
  return db.records.filter((r) => {
    if (activityId && r.activityId !== activityId) return false;
    if (mode && r.mode !== mode) return false;
    if (!keyword) return true;
    return [r.prizeName, r.participant, r.phone, r.code, r.operatorName, r.activityName]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(keyword));
  });
}

/** 用系统 CSPRNG 取 0–1 随机数（2^-32 精度），比 Math.random 更难预测 */
function secureRandom() {
  return crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
}

function weightedPick(pool) {
  const total = pool.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
  if (total <= 0) return pool[Math.floor(secureRandom() * pool.length)];
  let roll = secureRandom() * total;
  for (const item of pool) {
    roll -= Math.max(0, Number(item.weight) || 0);
    if (roll < 0) return item;
  }
  return pool[pool.length - 1];
}

function pushRecord(record) {
  db.records.unshift(record);
  if (db.records.length > MAX_RECORDS) db.records.length = MAX_RECORDS;
}

function recordPayload(activity, details) {
  return {
    id: uid('r_'),
    activityId: activity.id,
    activityName: activity.name,
    mode: activity.mode,
    prizeId: details.prizeId || '',
    prizeName: details.prizeName || '',
    level: details.level || '',
    code: details.code || '',
    participant: details.participant || '',
    phone: details.phone || '',
    operatorId: details.operatorId,
    operatorName: details.operatorName,
    remainingAfter: details.remainingAfter ?? 0,
    hit: Boolean(details.prizeId),
    at: Date.now(),
  };
}

/* ------------------------------------------------------- 名单（名单抽奖） */

function rosterOf(activity) {
  if (!Array.isArray(activity.roster)) activity.roster = [];
  return activity.roster;
}

function rosterSummary(activity) {
  const list = rosterOf(activity);
  const won = list.filter((r) => r.won).length;
  return { total: list.length, won, left: list.length - won };
}

/** 解析粘贴的名单：一行一个，支持「姓名 手机号」「姓名,手机号」「姓名」，自动去重 */
function parseRoster(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const raw = line.replace(/\u3000/g, ' ').trim();
    if (!raw) continue;
    const parts = raw.split(/[\s,，、\t;；|]+/).filter(Boolean);
    const name = (parts[0] || '').slice(0, 40);
    if (!name) continue;
    let phone = '';
    for (let i = 1; i < parts.length; i += 1) {
      const digits = parts[i].replace(/\D/g, '');
      if (digits.length >= 7) {
        phone = digits;
        break;
      }
    }
    const key = name.toLowerCase() + '|' + phone;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: uid('p_'),
      name,
      phone,
      campus: '',
      won: false,
      prizeName: '',
      at: 0,
    });
  }
  return out;
}


/* ---------------------------------------------------------------- routing */

/* --- auth --- */

/** 反代到 https 时给会话 cookie 加 Secure（本机 http 访问不受影响） */
function cookieSecure(ctx) {
  const proto = String(ctx.req?.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' ? '; Secure' : '';
}

def('POST', '/api/auth/login', async (ctx) => {
  const account = str(ctx.body.account, { max: 40, label: '账号' });
  const password = str(ctx.body.password, { max: 120, label: '密码' });
  const key = account.toLowerCase();
  checkLoginRate(key);
  const user = checkCredentials(account, password);
  if (!user) {
    noteLoginFailure(key);
    throw new HttpError(401, '账号或密码不正确', 'invalid_credentials');
  }
  clearLoginFailures(key);
  // 广告机/大屏这类长期登录的设备：勾选后给 30 天会话
  const remember = ctx.body.remember === true;
  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL;
  const token = createSession(user, { ttl });
  ctx.setCookie(`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${cookieSecure(ctx)}; Max-Age=${Math.floor(ttl / 1000)}`);
  ctx.status = 200;
  return { user: publicUser(user) };
});

def('POST', '/api/auth/logout', async (ctx) => {
  destroySession(ctx.token);
  ctx.setCookie(`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${cookieSecure(ctx)}; Max-Age=0`);
  return { ok: true };
});

def('GET', '/api/auth/me', async (ctx) => {
  const user = requireUser(ctx.req);
  return { user: publicUser(user) };
});

def('PATCH', '/api/auth/password', async (ctx) => {
  const user = requireUser(ctx.req);
  const oldPassword = str(ctx.body.oldPassword, { max: 120, label: '当前密码' });
  const newPassword = str(ctx.body.newPassword, { min: 6, max: 120, label: '新密码' });
  if (!verifyPassword(oldPassword, user.salt, user.hash)) throw badRequest('当前密码不正确');
  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.hash = hash;
  user.mustChangePassword = false;
  destroyUserSessions(user.id);
  const token = createSession(user);
  ctx.setCookie(`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${cookieSecure(ctx)}; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
  persist();
  return { ok: true };
});

/* --- meta --- */

def('GET', '/api/meta', async (ctx) => {
  requireUser(ctx.req);
  return {
    permissions: PERMISSIONS,
    roles: ROLES,
    modes: MODES,
  };
});

/* --- activities --- */

def('GET', '/api/activities', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.view');
  const order = { active: 0, paused: 1, draft: 2, ended: 3 };
  const list = [...db.activities]
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.updatedAt - a.updatedAt)
    .map(viewActivity);
  return { activities: list };
});

def('GET', '/api/activities/:id', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.view');
  const activity = findActivity(ctx.params.id);
  return { activity: viewActivity(activity) };
});

def('POST', '/api/activities', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const activity = {
    id: uid('a_'),
    name: str(ctx.body.name, { max: 40, label: '活动名称' }),
    subtitle: str(ctx.body.subtitle ?? '', { max: 60, label: '副标题', optional: true }),
    description: str(ctx.body.description ?? '', { max: 200, label: '活动说明', optional: true }),
    mode: oneOf(ctx.body.mode || 'quota', MODES.map((m) => m.key), '抽奖方式'),
    status: oneOf(ctx.body.status || 'draft', ['draft', 'active', 'paused', 'ended'], '活动状态'),
    publicRedeem: Boolean(ctx.body.publicRedeem),
    participantLimit: int(ctx.body.participantLimit ?? 0, { min: 0, max: 10000, label: '每人限抽次数' }),
    missWeight: dec(ctx.body.missWeight ?? 0, { min: 0, max: 10000, label: '谢谢参与权重' }),
    campuses: normalizeCampuses(ctx.body.campuses),
    campusRequired: Boolean(ctx.body.campusRequired),
    nameRequired: ctx.body.nameRequired !== false,
    phoneRequired: ctx.body.phoneRequired !== false,
    prizes: [],
    codes: [],
    issueLog: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.activities.push(activity);
  persist();
  ctx.status = 201;
  return { activity: viewActivity(activity) };
});

def('POST', '/api/activities/:id/duplicate', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const source = findActivity(ctx.params.id);

  const baseName = String(source.name || '').replace(/（副本\d*）$/, '').trim();
  const activity = {
    id: uid('a_'),
    name: `${baseName}（副本）`.slice(0, 40),
    subtitle: source.subtitle || '',
    description: source.description || '',
    mode: source.mode,
    status: 'draft',
    publicRedeem: Boolean(source.publicRedeem),
    participantLimit: source.participantLimit || 0,
    missWeight: source.missWeight || 0,
    campuses: normalizeCampuses(source.campuses || []),
    campusRequired: Boolean(source.campusRequired),
    nameRequired: source.nameRequired !== false,
    phoneRequired: source.phoneRequired !== false,
    prizes: (source.prizes || []).map((prize) => ({
      id: uid('p_'),
      name: prize.name,
      level: prize.level,
      quota: prize.quota,
      weight: prize.weight,
      value: prize.value || 0,
      color: prize.color,
      image: prize.image || '',
      remaining: prize.quota,
      drawn: 0,
    })),
    codes: [],
    issueLog: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.activities.push(activity);
  persist();
  ctx.status = 201;
  return { activity: viewActivity(activity) };
});

def('PATCH', '/api/activities/:id', async (ctx) => {
  const user = requireUser(ctx.req);
  const activity = findActivity(ctx.params.id);
  const body = ctx.body;

  if (body.name !== undefined || body.status !== undefined || body.mode !== undefined
      || body.subtitle !== undefined || body.description !== undefined
      || body.publicRedeem !== undefined || body.campuses !== undefined
      || body.campusRequired !== undefined) {
    requirePermission(user, 'activity.manage');
  }
  if (body.participantLimit !== undefined || body.missWeight !== undefined) {
    requirePermission(user, 'prize.manage');
  }

  if (body.name !== undefined) activity.name = str(body.name, { max: 40, label: '活动名称' });
  if (body.subtitle !== undefined) activity.subtitle = str(body.subtitle, { max: 60, label: '副标题', optional: true });
  if (body.description !== undefined) activity.description = str(body.description, { max: 200, label: '活动说明', optional: true });
  if (body.mode !== undefined) activity.mode = oneOf(body.mode, MODES.map((m) => m.key), '抽奖方式');
  if (body.status !== undefined) activity.status = oneOf(body.status, ['draft', 'active', 'paused', 'ended'], '活动状态');
  if (body.publicRedeem !== undefined) activity.publicRedeem = Boolean(body.publicRedeem);
  if (body.participantLimit !== undefined) activity.participantLimit = int(body.participantLimit, { min: 0, max: 10000, label: '每人限抽次数' });
  if (body.missWeight !== undefined) activity.missWeight = dec(body.missWeight, { min: 0, max: 10000, label: '谢谢参与权重' });
  if (body.campuses !== undefined) activity.campuses = normalizeCampuses(body.campuses);
  if (body.campusRequired !== undefined) activity.campusRequired = Boolean(body.campusRequired);
  if (body.nameRequired !== undefined) activity.nameRequired = Boolean(body.nameRequired);
  if (body.phoneRequired !== undefined) activity.phoneRequired = Boolean(body.phoneRequired);

  touch(activity);
  persist();
  return { activity: viewActivity(activity) };
});

def('GET', '/api/trash', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  let files = [];
  try {
    files = fs.readdirSync(TRASH_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return { items: [] };
  }
  const items = [];
  for (const name of files) {
    try {
      const full = path.join(TRASH_DIR, name);
      const stat = fs.statSync(full);
      const snapshot = JSON.parse(fs.readFileSync(full, 'utf8'));
      items.push({
        file: name,
        activityName: snapshot.activity?.name || '(未知活动)',
        mode: snapshot.activity?.mode || '',
        prizes: snapshot.activity?.prizes?.length || 0,
        records: Array.isArray(snapshot.records) ? snapshot.records.length : 0,
        deletedAt: snapshot.deletedAt || stat.mtimeMs,
        deletedBy: snapshot.deletedBy || '',
        bytes: stat.size,
      });
    } catch {
      /* 坏文件跳过 */
    }
  }
  items.sort((a, b) => b.deletedAt - a.deletedAt);
  return { items };
});

def('POST', '/api/trash/restore', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const file = str(ctx.body.file, { max: 200, label: '备份文件' });
  const safe = path.basename(file);
  if (safe !== file || !safe.endsWith('.json')) throw badRequest('备份文件不合法');
  const full = path.join(TRASH_DIR, safe);
  if (!fs.existsSync(full)) throw notFound('找不到这份备份');

  const snapshot = JSON.parse(fs.readFileSync(full, 'utf8'));
  const activity = snapshot.activity;
  if (!activity || !activity.id) throw badRequest('备份内容损坏');
  if (db.activities.some((a) => a.id === activity.id)) {
    throw new HttpError(409, '这个活动已经存在（可能恢复过了）', 'already_exists');
  }

  db.activities.push(activity);
  const known = new Set(db.records.map((r) => r.id));
  let added = 0;
  for (const record of snapshot.records || []) {
    if (!record || !record.id || known.has(record.id)) continue;
    db.records.push(record);
    known.add(record.id);
    added += 1;
  }
  db.records.sort((a, b) => (b.at || 0) - (a.at || 0));
  persist();
  return { activity: viewActivity(activity), records: added };
});

def('DELETE', '/api/activities/:id', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const activity = findActivity(ctx.params.id);
  const records = db.records.filter((r) => r.activityId === activity.id);

  // 删除前留一份快照，误删还能人工恢复
  let backupName = '';
  try {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = String(activity.name || 'activity').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    backupName = `${safe}-${activity.id}-${stamp}.json`;
    fs.writeFileSync(
      path.join(TRASH_DIR, backupName),
      JSON.stringify({ activity, records, deletedAt: Date.now(), deletedBy: user.name }, null, 2),
    );
    const files = fs.readdirSync(TRASH_DIR).filter((f) => f.endsWith('.json')).sort();
    for (const name of files.slice(0, Math.max(0, files.length - 30))) {
      fs.unlinkSync(path.join(TRASH_DIR, name));
    }
  } catch {
    backupName = '';
  }

  db.activities = db.activities.filter((a) => a.id !== activity.id);
  db.records = db.records.filter((r) => r.activityId !== activity.id);
  persist();
  return { ok: true, id: activity.id, records: records.length, backup: backupName };
});

def('PUT', '/api/activities/:id/prizes', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'prize.manage');
  const activity = findActivity(ctx.params.id);
  const input = Array.isArray(ctx.body.prizes) ? ctx.body.prizes : null;
  if (!input) throw badRequest('缺少奖项列表');
  if (input.length > 60) throw badRequest('单个活动最多 60 个奖项');

  const existing = new Map(activity.prizes.map((p) => [p.id, p]));
  const next = [];
  const names = new Set();

  for (const raw of input) {
    const data = parsePrizeInput(raw);
    if (names.has(data.name)) throw badRequest(`奖项名称重复：「${data.name}」`);
    names.add(data.name);

    // 没带 id 时按名称兜底匹配，避免保存配置把名额重置掉
    let matched = null;
    if (raw.id && existing.has(raw.id)) {
      matched = existing.get(raw.id);
    } else if (!raw.id) {
      matched = [...existing.values()].find((p) => p.name === data.name) || null;
    }
    if (matched) existing.delete(matched.id);
    if (matched) {
      const prize = matched;
      const previousQuota = prize.quota;
      const drawn = clamp(previousQuota - prize.remaining, 0, previousQuota);
      prize.name = data.name;
      prize.level = data.level;
      prize.quota = data.quota;
      prize.weight = data.weight ?? prize.weight ?? 1;
      prize.color = data.color ?? prize.color;
      if (data.value !== undefined) prize.value = data.value;
      if (data.image !== undefined) prize.image = data.image;
      // 名额变化后保持「已抽数」不变，剩余自动跟随
      prize.remaining = Math.max(0, prize.quota - Math.min(drawn, prize.quota));
      next.push(prize);
    } else {
      next.push({
        id: uid('pz_'),
        name: data.name,
        level: data.level,
        quota: data.quota,
        drawn: 0,
        remaining: data.quota,
        weight: data.weight ?? 1,
        value: data.value ?? 0,
        color: data.color ?? '#D9B77C',
        image: data.image ?? '',
      });
    }
  }

  activity.prizes = next;
  if (activity.mode === 'code' && !Array.isArray(activity.codes)) activity.codes = [];
  touch(activity);
  persist();
  return { activity: viewActivity(activity) };
});

def('POST', '/api/activities/:id/reset', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'quota.reset');
  const activity = findActivity(ctx.params.id);
  const scope = oneOf(ctx.body.scope || 'quota', ['quota', 'all'], '重置范围');
  for (const prize of activity.prizes) {
    prize.remaining = prize.quota;
    prize.drawn = 0;
  }
  if (scope === 'all') {
    db.records = db.records.filter((r) => r.activityId !== activity.id);
    if (Array.isArray(activity.codes)) {
      for (const code of activity.codes) {
        code.used = false;
        code.usedAt = 0;
      }
    }
  }
  activity.resetAt = Date.now();
  activity.resetBy = user.name;
  touch(activity);
  persist();
  return { activity: viewActivity(activity), recordsRemoved: scope === 'all' };
});

/* --- prize quick edit --- */

def('PATCH', '/api/prizes/:id', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'prize.manage');
  const found = findPrizeGlobal(ctx.params.id);
  if (!found) throw notFound('奖项不存在');
  const { activity, prize } = found;
  const data = parsePrizeInput(ctx.body, { partial: true });
  const drawn = clamp(prize.quota - prize.remaining, 0, prize.quota);
  Object.assign(prize, data);
  if (data.quota !== undefined) {
    prize.remaining = Math.max(0, data.quota - Math.min(drawn, data.quota));
    prize.drawn = Math.min(drawn, data.quota);
  }
  touch(activity);
  persist();
  return { activity: viewActivity(activity) };
});

/* --- codes --- */

def('GET', '/api/activities/:id/codes', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'quota.reset');
  const activity = findActivity(ctx.params.id);
  const prizeByCode = new Map();
  for (const record of db.records) {
    if (record.activityId !== activity.id || !record.code) continue;
    prizeByCode.set(record.code, record.prizeName || '谢谢参与');
  }
  return {
    codes: (activity.codes || []).map((c) => ({
      ...c,
      prizeName: prizeByCode.get(c.code) || '',
    })),
  };
});

/* --- 参与名单（名单抽奖） --- */

def('GET', '/api/activities/:id/roster', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.view');
  const activity = findActivity(ctx.params.id);
  const list = rosterOf(activity);
  return {
    roster: list.map((r) => ({ ...r })),
    summary: rosterSummary(activity),
  };
});

def('PUT', '/api/activities/:id/roster', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const activity = findActivity(ctx.params.id);
  const text = String(ctx.body.text ?? '').slice(0, 500000);
  if (!text.trim() && ctx.body.text !== undefined) {
    activity.roster = [];
    touch(activity);
    persist();
    return { ok: true, summary: rosterSummary(activity) };
  }
  const parsed = parseRoster(text);
  if (!parsed.length) throw badRequest('名单还是空的，一行一个姓名（可带手机号）');
  // 保留已经中奖的人，避免重导名单后重复中奖
  const kept = rosterOf(activity).filter((r) => r.won);
  const keptKeys = new Set(kept.map((r) => r.name.toLowerCase() + '|' + (r.phone || '')));
  const merged = kept.concat(parsed.filter((r) => !keptKeys.has(r.name.toLowerCase() + '|' + (r.phone || ''))));
  activity.roster = merged;
  touch(activity);
  persist();
  return { ok: true, summary: rosterSummary(activity) };
});

def('POST', '/api/activities/:id/roster/from-codes', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const activity = findActivity(ctx.params.id);
  const codes = (activity.codes || []).filter((c) => c.holder && c.holder.trim());
  if (!codes.length) throw badRequest('还没有发过码，没有姓名可以生成名单');
  const list = rosterOf(activity);
  const seen = new Set(list.map((r) => r.name.toLowerCase() + '|' + (r.phone || '')));
  let added = 0;
  for (const c of codes) {
    const key = c.holder.trim().toLowerCase() + '|' + (c.phone || '');
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: uid('p_'),
      name: c.holder.trim().slice(0, 40),
      phone: c.phone || '',
      campus: c.campus || '',
      won: false,
      prizeName: '',
      at: 0,
    });
    added += 1;
  }
  touch(activity);
  persist();
  return { ok: true, added, summary: rosterSummary(activity) };
});

def('POST', '/api/activities/:id/roster/reset', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const activity = findActivity(ctx.params.id);
  for (const r of rosterOf(activity)) {
    r.won = false;
    r.prizeName = '';
    r.at = 0;
  }
  touch(activity);
  persist();
  return { ok: true, summary: rosterSummary(activity) };
});

def('DELETE', '/api/activities/:id/roster', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const activity = findActivity(ctx.params.id);
  activity.roster = [];
  touch(activity);
  persist();
  return { ok: true, summary: rosterSummary(activity) };
});

def('GET', '/api/activities/:id/codes/summary', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'draw.execute');
  const activity = findActivity(ctx.params.id);
  const codes = activity.codes || [];
  const campusMap = new Map();
  for (const code of codes) {
    if (!code.campus) continue;
    campusMap.set(code.campus, (campusMap.get(code.campus) || 0) + 1);
  }
  return {
    total: codes.length,
    used: codes.filter((c) => c.used).length,
    issued: codes.filter((c) => c.holder).length,
    free: codes.filter((c) => !c.used && !c.holder).length,
    campuses: [...campusMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
});

def('POST', '/api/activities/:id/codes', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'quota.reset');
  const activity = findActivity(ctx.params.id);
  if (activity.mode !== 'code') throw badRequest('只有「抽奖码」活动可以生成码');
  const count = int(ctx.body.count, { min: 1, max: 500, label: '生成数量' });
  if (!Array.isArray(activity.codes)) activity.codes = [];
  const rawPrefix = ctx.body.prefix === undefined
    ? ''
    : str(ctx.body.prefix, { max: 6, label: '码前缀', optional: true });
  const prefix = (rawPrefix || activity.codePrefix || 'AUR')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'ZX';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // 4 位只有 104 万种组合，500 枚码时被猜中的概率约 1/2000；默认 6 位（10 亿种）更稳
  const bodyLength = Math.min(8, Math.max(4, Number(ctx.body.length) || 6));
  const existing = new Set(activity.codes.map((c) => c.code));
  let added = 0;
  let guard = 0;
  while (added < count && guard < count * 40) {
    guard += 1;
    let body = '';
    for (let i = 0; i < bodyLength; i += 1) body += alphabet[Math.floor(secureRandom() * alphabet.length)];
    const code = `${prefix}-${body}`;
    if (existing.has(code)) continue;
    existing.add(code);
    activity.codes.push({ code, used: false, usedAt: 0, seq: activity.codes.length + 1 });
    added += 1;
  }
  touch(activity);
  persist();
  return { added, codes: activity.codes.map((c) => ({ ...c })) };
});

// 重新发一批码：清掉旧码（活动上线前换成长码用）
def('POST', '/api/activities/:id/codes/regenerate', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'quota.reset');
  const activity = findActivity(ctx.params.id);
  if (activity.mode !== 'code') throw badRequest('只有「抽奖码」活动可以重新发码');
  const used = (activity.codes || []).filter((c) => c.used).length;
  if (used > 0 && ctx.body.force !== true) {
    throw new HttpError(409, `已有 ${used} 枚码开过奖，重新发码会清空这些记录`, 'used_codes_exist');
  }
  const count = Math.min(2000, Math.max(1, Number(ctx.body.count) || 500));
  const length = Math.min(8, Math.max(4, Number(ctx.body.length) || 6));
  const prefix = String(ctx.body.prefix || activity.codePrefix || 'ZX')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'ZX';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  activity.codes = [];
  activity.issueLog = [];
  const seen = new Set();
  let guard = 0;
  while (activity.codes.length < count && guard < count * 40) {
    guard += 1;
    let body = '';
    for (let i = 0; i < length; i += 1) body += alphabet[Math.floor(secureRandom() * alphabet.length)];
    const code = `${prefix}-${body}`;
    if (seen.has(code)) continue;
    seen.add(code);
    activity.codes.push({ code, used: false, usedAt: 0, seq: activity.codes.length + 1 });
  }
  if (used > 0) {
    db.records = db.records.filter((r) => r.activityId !== activity.id);
  }
  activity.codePrefix = prefix;
  touch(activity);
  persist();
  return { total: activity.codes.length, length, prefix, clearedUsed: used };
});

/* --- 图片上传（奖项样品图） --- */

const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const TRASH_DIR = path.join(ROOT, 'data', 'trash');const UPLOAD_LIMIT = 3 * 1024 * 1024;

def('POST', '/api/uploads', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'prize.manage');
  const raw = String(ctx.body.dataUrl || '');
  const matched = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!matched) throw badRequest('图片格式只支持 JPG / PNG / WebP');
  const buffer = Buffer.from(matched[2], 'base64');
  if (!buffer.length) throw badRequest('图片内容为空');
  if (buffer.length > UPLOAD_LIMIT) throw badRequest('图片不能超过 3MB');
  const ext = matched[1] === 'jpg' ? 'jpeg' : matched[1];
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { url: `/uploads/${name}`, bytes: buffer.length };
});

/* --- 收费即发码：单笔领取一枚 --- */

function normalizePhone(rawPhone, label = '手机号') {
  const raw = rawPhone === undefined || rawPhone === null ? '' : String(rawPhone).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw badRequest(`请填写${label}`);
  if (!/^1[3-9]\d{9}$/.test(digits)) throw badRequest(`${label}格式不对，需要 11 位手机号`);
  return digits;
}

function logIssue(activity, entry) {
  if (!Array.isArray(activity.issueLog)) activity.issueLog = [];
  activity.issueLog.push({ id: uid('il_'), ...entry, at: Date.now() });
  if (activity.issueLog.length > 5000) activity.issueLog.splice(0, activity.issueLog.length - 5000);
}

def('POST', '/api/activities/:id/codes/issue', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'draw.execute');
  const activity = findActivity(ctx.params.id);
  if (activity.mode !== 'code') throw badRequest('只有「抽奖码」活动可以发码');
  if (activity.status === 'ended') throw new HttpError(409, '活动已结束，不能再发码', 'event_ended');
  if (!Array.isArray(activity.codes)) activity.codes = [];

  const name = str(ctx.body.name ?? '', { max: 20, label: '学员姓名', optional: true });
  if (activity.nameRequired !== false && !name) {
    throw badRequest('请填写学员姓名', 'name_required');
  }
  const campus = str(ctx.body.campus ?? '', { max: 20, label: '校区', optional: true });
  if (activity.campusRequired && !campus) {
    throw badRequest('请选择学员所在校区', 'campus_required');
  }
  const rawPhone = ctx.body.phone ?? ctx.body.tail;
  const phone = rawPhone ? normalizePhone(rawPhone) : '';
  if (activity.phoneRequired !== false && !phone) {
    throw badRequest('请填写 11 位手机号', 'phone_required');
  }

  const matchesPhone = (code) =>
    Boolean(phone) && (code.phone ? code.phone === phone : Boolean(code.tail) && code.tail === phone.slice(-4));
  const exact = name && activity.codes.find((c) => c.holder === name && matchesPhone(c));
  if (exact) {
    throw new HttpError(409, `「${name}」已经领过 ${exact.code}（同名同手机号），不能重复发放`, 'duplicate_exact');
  }
  const sameName = name ? activity.codes.find((c) => c.holder === name) : null;
  const samePhone = activity.codes.find((c) => c.holder && matchesPhone(c));
  const conflict = sameName || samePhone;
  if (conflict && !ctx.body.force) {
    const message = sameName
      ? `已有同名学员「${name}」领过 ${sameName.code}，确定不是同一位学生吗？`
      : `该手机号已为「${samePhone.holder}」发过 ${samePhone.code}，确定不是同一位学生吗？`;
    throw new HttpError(409, message, 'duplicate_partial');
  }

  const target = activity.codes.find((c) => !c.used && !c.holder);
  if (!target) throw new HttpError(409, '码已发完，请先补充生成', 'no_codes');

  target.holder = name;
  target.phone = phone;
  delete target.tail;
  target.campus = campus;
  target.issuedAt = Date.now();
  target.issuedBy = user.name;
  logIssue(activity, { code: target.code, name, phone, campus, by: user.name, channel: 'issue' });

  touch(activity);
  persist();

  const freeLeft = activity.codes.filter((c) => !c.used && !c.holder).length;
  return {
    code: { ...target },
    freeLeft,
    duplicateWarning: conflict ? `已强制发放：${conflict.code} 存在同名或同号记录` : '',
  };
});

def('GET', '/api/activities/:id/codes/issue-log', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'draw.execute');
  const activity = findActivity(ctx.params.id);
  const log = Array.isArray(activity.issueLog) ? activity.issueLog : [];
  const codeMap = new Map((activity.codes || []).map((c) => [c.code, c]));
  const entries = log
    .slice(-500)
    .reverse()
    .map((entry) => ({
      ...entry,
      used: Boolean(codeMap.get(entry.code)?.used),
      bound: Boolean(codeMap.get(entry.code)?.holder),
    }));
  return { total: log.length, entries };
});

// 舞台输入码后先查一下这枚码：是否登记了手机号、是不是已经抽过
def('GET', '/api/activities/:id/codes/:code/lookup', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'draw.execute');
  const activity = findActivity(ctx.params.id);
  const raw = String(ctx.params.code || '').trim().toUpperCase();
  const entry = resolveCodeEntry(activity, raw);
  if (!entry) throw notFound('没有找到这枚抽奖码', 'code_not_found');
  const phone = String(entry.phone || '');
  const masked = phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '';
  return {
    code: entry.code,
    used: Boolean(entry.used),
    holder: entry.holder || '',
    campus: entry.campus || '',
    needsPhone: Boolean(entry.phone || entry.tail),
    phoneMask: masked || (entry.tail ? `尾号 ${entry.tail}` : ''),
  };
});

def('POST', '/api/activities/:id/codes/bind', async (ctx) => {  const user = requireUser(ctx.req);
  requirePermission(user, 'quota.reset');
  const activity = findActivity(ctx.params.id);
  if (activity.mode !== 'code') throw badRequest('只有「抽奖码」活动可以绑定名单');
  if (!Array.isArray(activity.codes)) activity.codes = [];

  if (ctx.body.reset) {
    let cleared = 0;
    for (const code of activity.codes) {
      if (!code.used && code.holder) {
        delete code.holder;
        delete code.phone;
        delete code.tail;
        delete code.campus;
        delete code.issuedAt;
        delete code.issuedBy;
        cleared += 1;
      }
    }
    touch(activity);
    persist();
    return { cleared, reset: true };
  }

  const entries = Array.isArray(ctx.body.entries) ? ctx.body.entries : [];
  if (!entries.length) throw badRequest('名单为空，请一行一个「姓名,手机号,校区」');
  if (entries.length > 2000) throw badRequest('一次最多绑定 2000 条');
  const free = activity.codes.filter((c) => !c.used && !c.holder);
  if (!free.length) throw new HttpError(409, '没有可绑定的空码了，请先生成新码', 'no_free_codes');

  let bound = 0;
  let cursor = 0;
  let duplicated = 0;
  let line = 0;
  for (const entry of entries) {
    line += 1;
    if (cursor >= free.length) break;
    const name = str(entry.name ?? '', { max: 20, label: `第 ${line} 位学员姓名`, optional: true });
    if (activity.nameRequired !== false && !name) {
      throw badRequest(`第 ${line} 位学员缺少姓名`, 'name_required');
    }
    const campus = str(entry.campus ?? '', { max: 20, label: '校区', optional: true });
    if (activity.campusRequired && !campus) {
      throw badRequest(`第 ${line} 位学员缺少校区`, 'campus_required');
    }
    const rawPhone = entry.phone;
    const phone = rawPhone ? normalizePhone(rawPhone, `第 ${line} 位手机号`) : '';
    if (activity.phoneRequired !== false && !phone) {
      throw badRequest(`第 ${line} 位学员缺少手机号`, 'phone_required');
    }

    const exists = name && activity.codes.find(
      (c) => c.holder === name && ((phone && c.phone === phone) || (phone && c.tail && c.tail === phone.slice(-4))),
    );
    if (exists) {
      duplicated += 1;
      continue;
    }

    const code = free[cursor];
    cursor += 1;
    code.holder = name;
    code.phone = phone;
    delete code.tail;
    code.campus = campus;
    code.issuedAt = Date.now();
    code.issuedBy = user.name;
    logIssue(activity, { code: code.code, name, phone, campus, by: user.name, channel: 'bind' });
    bound += 1;
  }

  touch(activity);
  persist();
  return {
    bound,
    duplicated,
    skipped: Math.max(0, entries.length - bound - duplicated),
    freeLeft: free.length - bound,
  };
});

/* --- public redeem：学员自助核销（无需登录） --- */

const REDEEM_WINDOW = 10 * 60e3;
const REDEEM_MAX = 600;
const redeemHits = new Map();

// 「猜码」防护：只有失败（码不存在 / 已抽过 / 手机号不对）才计数，
// 正常开奖不占用额度，所以一屋子学生同时开奖不会被误伤。
const REDEEM_FAIL_WINDOWS = [
  { ms: 60e3, max: 20, label: '一分钟' },
  { ms: 60 * 60e3, max: 120, label: '一小时' },
];
const redeemFails = new Map();

function redeemRateLimit(ip) {
  const now = Date.now();
  if (redeemHits.size > 3000) {
    for (const [key, entry] of redeemHits) {
      if (entry.resetAt <= now) redeemHits.delete(key);
    }
  }
  const entry = redeemHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    redeemHits.set(ip, { count: 1, resetAt: now + REDEEM_WINDOW });
    return;
  }
  entry.count += 1;
  if (entry.count > REDEEM_MAX) {
    throw new HttpError(429, '操作太频繁了，请十分钟后再试', 'rate_limited');
  }
}

function noteRedeemFailure(ip) {
  const now = Date.now();
  let entry = redeemFails.get(ip);
  if (!entry) {
    entry = { slots: REDEEM_FAIL_WINDOWS.map((w) => ({ count: 0, resetAt: now + w.ms })) };
    redeemFails.set(ip, entry);
  }
  REDEEM_FAIL_WINDOWS.forEach((w, index) => {
    const slot = entry.slots[index];
    if (slot.resetAt <= now) {
      slot.count = 0;
      slot.resetAt = now + w.ms;
    }
    slot.count += 1;
    if (slot.count > w.max) {
      throw new HttpError(429, `尝试次数过多了，请${w.label}后再试`, 'too_many_attempts');
    }
  });
  if (redeemFails.size > 5000) {
    for (const [key, value] of redeemFails) {
      if (value.slots.every((s) => s.resetAt <= now)) redeemFails.delete(key);
    }
  }
}

// 输码容错：完整码（ZX-ABC123）、去掉横线的完整码（ZXABC123）、或只输 6 位主体（ABC123）都能认
function resolveCodeEntry(activity, input) {
  const raw = String(input || '').toUpperCase().replace(/\s+/g, '');
  if (!raw) return null;
  const codes = activity.codes || [];
  const exact = codes.find((c) => c.code === raw);
  if (exact) return exact;
  const compact = codes.find((c) => c.code.replace(/-/g, '') === raw);
  if (compact) return compact;
  const dash = raw.indexOf('-');
  const bare = dash >= 0 ? raw.slice(dash + 1) : raw;
  if (!bare || bare.length < 4) return null;
  return codes.find((c) => {
    const idx = c.code.indexOf('-');
    return idx >= 0 && c.code.slice(idx + 1) === bare;
  }) || null;
}

function activityQuota(activity) {
  const prizeRemaining = activity.prizes.reduce((sum, p) => sum + Math.max(0, p.remaining), 0);
  const total = activity.prizes.reduce((sum, p) => sum + p.quota, 0);
  // 抽奖码模式：发码即占位，剩余 = 总名额 - 已发码数（不少于 0）
  if (activity.mode === 'code') {
    const issued = (activity.codes || []).filter((c) => c.holder).length;
    return { remaining: Math.max(0, total - issued), total, issued, prizeRemaining };
  }
  return { remaining: prizeRemaining, total, issued: 0, prizeRemaining };
}

const SUMMARY_WINDOW = 10 * 60e3;
const SUMMARY_MAX = 6000;
const summaryHits = new Map();

function summaryRateLimit(ip) {
  const now = Date.now();
  if (summaryHits.size > 4000) {
    for (const [key, entry] of summaryHits) {
      if (entry.resetAt <= now) summaryHits.delete(key);
    }
  }
  const entry = summaryHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    summaryHits.set(ip, { count: 1, resetAt: now + SUMMARY_WINDOW });
    return;
  }
  entry.count += 1;
  if (entry.count > SUMMARY_MAX) {
    throw new HttpError(429, '刷新太频繁了，请稍后再试', 'rate_limited');
  }
}

function clientIp(ctx) {
  return String(ctx.req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || ctx.req.socket.remoteAddress
    || 'local';
}

/* ---- 前台页面开关（家长端 / 广告机 / 老师手机端） ---- */

const FRONTEND_DEFAULTS = {
  redeem: {
    enabled: true,
    title: '学员自助开奖',
    note: '输入门店发给你的 6 位抽奖码，即可查看结果',
  },
  stageLite: {
    enabled: true,
    title: '',
    note: '',
  },
  m: {
    enabled: true,
    title: '发码台',
    note: '',
  },
};

const FRONTEND_KEYS = Object.keys(FRONTEND_DEFAULTS);

function frontendsConfig() {
  if (!db.settings) db.settings = {};
  const saved = db.settings.frontends && typeof db.settings.frontends === 'object' ? db.settings.frontends : {};
  const out = {};
  for (const key of FRONTEND_KEYS) {
    const base = FRONTEND_DEFAULTS[key];
    const cur = saved[key] && typeof saved[key] === 'object' ? saved[key] : {};
    out[key] = {
      enabled: cur.enabled === undefined ? base.enabled : Boolean(cur.enabled),
      title: String(cur.title === undefined ? base.title : cur.title).slice(0, 60),
      note: String(cur.note === undefined ? base.note : cur.note).slice(0, 300),
    };
  }
  return out;
}

function frontendClosed(key) {
  return new HttpError(403, '这个页面暂时关闭了，请联系门店老师', `frontend_closed:${key}`);
}

def('GET', '/api/public/frontends', async () => frontendsConfig());

def('PUT', '/api/frontends', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  const input = ctx.body || {};
  if (!db.settings) db.settings = {};
  const next = frontendsConfig();
  for (const key of FRONTEND_KEYS) {
    if (input[key] === undefined) continue;
    const patch = input[key] || {};
    if (patch.enabled !== undefined) next[key].enabled = Boolean(patch.enabled);
    if (patch.title !== undefined) next[key].title = String(patch.title).slice(0, 60);
    if (patch.note !== undefined) next[key].note = String(patch.note).slice(0, 300);
  }
  db.settings.frontends = next;
  persist();
  return { frontends: next };
});

def('GET', '/api/frontends', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.view');
  return { frontends: frontendsConfig() };
});

def('GET', '/api/public/summary', async (ctx) => {
  if (!frontendsConfig().redeem.enabled) throw frontendClosed('redeem');
  summaryRateLimit(clientIp(ctx));
  const list = db.activities.filter(
    (a) => a.mode === 'code' && a.publicRedeem && a.status === 'active',
  );
  return {
    activities: list.map((a) => ({
      name: a.name,
      ...activityQuota(a),
      prizes: a.prizes
        .filter((p) => (p.level || p.name) && p.quota > 0)
        .map((p) => ({ level: p.level || '', name: p.name || '' })),
    })),
  };
});

const CARD_DIR = path.join(ROOT, 'data', 'cards');
const CARD_LIMIT = 4 * 1024 * 1024;

def('POST', '/api/public/card', async (ctx) => {
  redeemRateLimit(clientIp(ctx));
  const raw = String(ctx.body.dataUrl || '');
  const matched = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!matched) throw badRequest('图片格式不支持');
  const buffer = Buffer.from(matched[2], 'base64');
  if (!buffer.length) throw badRequest('图片内容为空');
  if (buffer.length > CARD_LIMIT) throw badRequest('图片过大');
  fs.mkdirSync(CARD_DIR, { recursive: true });

  // 顺手清掉两天前的旧卡片，避免堆积
  try {
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(CARD_DIR)) {
      const file = path.join(CARD_DIR, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch {
    /* 清理失败不影响主流程 */
  }

  const name = `card-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(CARD_DIR, name), buffer);
  return { url: `/cards/${name}` };
});

def('POST', '/api/public/redeem', async (ctx) => {
  if (!frontendsConfig().redeem.enabled) throw frontendClosed('redeem');
  const forwarded = String(ctx.req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || ctx.req.socket.remoteAddress || 'local';
  redeemRateLimit(ip);

  const raw = str(ctx.body.code, { max: 32, label: '抽奖码' }).toUpperCase();
  const code = raw.replace(/\s+/g, '');

  let found = null;
  for (const activity of db.activities) {
    if (activity.mode !== 'code' || !activity.publicRedeem || activity.status !== 'active') continue;
    const entry = resolveCodeEntry(activity, code);
    if (entry) {
      found = { activity, entry };
      break;
    }
  }
  if (!found) {
    noteRedeemFailure(ip);
    throw notFound('没有找到这枚抽奖码，请核对后重试', 'code_not_found');
  }

  const { activity, entry } = found;
  // 码池里还没发出去的码：没人、没手机号，谁猜到谁就能开走 → 必须拦住
  if (activity.phoneRequired !== false && !entry.phone && !entry.tail) {
    noteRedeemFailure(ip);
    throw new HttpError(409, '这枚码还没有发放，请联系门店领取或开奖', 'code_unissued');
  }
  if (entry.used) {
    noteRedeemFailure(ip);
    throw new HttpError(409, '这枚码已经抽过了，请联系门店查询结果', 'code_used');
  }

  if (entry.phone || entry.tail) {
    const supplied = String(ctx.body.phone ?? ctx.body.tail ?? '').replace(/\D/g, '');
    if (!supplied) throw new HttpError(400, '请输入登记手机号', 'phone_required');
    const matched = entry.phone ? supplied === entry.phone : supplied.slice(-4) === entry.tail;
    if (!matched) {
      noteRedeemFailure(ip);
      throw new HttpError(403, '手机号与登记的不一致', 'phone_mismatch');
    }
  }

  const pool = activity.prizes.filter((p) => p.remaining > 0);
  if (!pool.length) throw new HttpError(409, '奖品已经全部抽完，请联系门店', 'quota_empty');

  const prize = weightedPick(pool);
  prize.remaining = Math.max(0, prize.remaining - 1);
  prize.drawn = (prize.drawn || 0) + 1;
  entry.used = true;
  entry.usedAt = Date.now();

  const record = recordPayload(activity, {
    prizeId: prize.id,
    prizeName: prize.name,
    level: prize.level,
    code: entry.code,
    participant: entry.holder || '',
    phone: entry.phone || '',
    operatorId: 'public',
    operatorName: '学员自助',
    remainingAfter: prize.remaining,
  });
  pushRecord(record);
  touch(activity);
  persist();

  return {
    hit: true,
    activityName: activity.name,
    holder: entry.holder || '',
    phone: entry.phone || '',
    prize: {
      name: prize.name,
      level: prize.level,
      color: prize.color || '#C9A25F',
      image: prize.image || '',
      value: Number(prize.value) || 0,
    },
    code: entry.code,
    at: record.at,
    ...activityQuota(activity),
  };
});

/* --- draw --- */

def('POST', '/api/activities/:id/draw', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'draw.execute');
  const activity = findActivity(ctx.params.id);
  if (activity.status !== 'active') {
    throw new HttpError(409, activity.status === 'paused' ? '活动已暂停，无法抽奖' : '活动尚未开始或已结束', 'not_active');
  }
  if (!activity.prizes.length) throw new HttpError(409, '该活动还没有配置奖项', 'no_prizes');

  const participant = normalizeParticipant(ctx.body.participant);
  let prize = null;
  let code = null;
  let winner = null;

  if (activity.mode === 'quota') {
    // 名单抽奖：先定奖项，再从名单里随机抽一个人
    if (!ctx.body.prizeId) throw badRequest('请先选择要抽取的奖项');
    prize = activity.prizes.find((p) => p.id === ctx.body.prizeId);
    if (!prize) throw badRequest('所选奖项不属于该活动');
    if (prize.remaining <= 0) throw new HttpError(409, `「${prize.name}」名额已抽完`, 'quota_empty');
    const list = rosterOf(activity);
    if (!list.length) throw new HttpError(409, '名单还是空的，请先在「参与名单」里导入', 'roster_empty');
    const pool = list.filter((r) => !r.won);
    if (!pool.length) throw new HttpError(409, '名单里的人都已经中过奖了', 'roster_exhausted');
    winner = pool[Math.floor(secureRandom() * pool.length)] || pool[0];
  } else if (activity.mode === 'probability') {
    const pool = activity.prizes.filter((p) => p.remaining > 0);
    if (!pool.length) throw new HttpError(409, '所有奖项名额已抽完', 'quota_empty');
    const missWeight = Math.max(0, Number(activity.missWeight) || 0);
    const totalWeight = pool.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0) + missWeight;
    const roll = secureRandom() * totalWeight;
    if (roll >= totalWeight - missWeight && missWeight > 0) {
      prize = null;
    } else {
      prize = weightedPick(pool);
    }
  } else if (activity.mode === 'code') {
    const raw = str(ctx.body.code ?? '', { max: 40, label: '抽奖码' }).toUpperCase();
    code = resolveCodeEntry(activity, raw);
    if (!code) throw notFound('抽奖码不存在，请核对后再试', 'code_not_found');
    if (code.used) throw new HttpError(409, '该抽奖码已被使用', 'code_used');
    // 还没发放的码（没登记手机号）先拦下，避免拿池子里猜来的码直接开奖
    if (activity.phoneRequired !== false && !code.phone && !code.tail) {
      throw new HttpError(409, '这枚码还没发放，请先在「收费即发码」里登记学员', 'code_unissued');
    }
    // 发码时登记过手机号的码：老师端开奖也要核对，防止开错人
    if (code.phone || code.tail) {
      const supplied = String(ctx.body.phone ?? ctx.body.tail ?? '').replace(/\D/g, '');
      if (!supplied) throw new HttpError(400, '这枚码登记了手机号，请先填写再开奖', 'phone_required');
      const matched = code.phone ? supplied === code.phone : supplied.slice(-4) === code.tail;
      if (!matched) throw new HttpError(403, '手机号与这枚码登记的不一致', 'phone_mismatch');
    }
    const pool = activity.prizes.filter((p) => p.remaining > 0);
    if (!pool.length) throw new HttpError(409, '所有奖项名额已抽完', 'quota_empty');
    prize = weightedPick(pool);
  }

  if (participant && activity.participantLimit > 0 && activity.mode !== 'code') {
    const used = db.records.filter(
      (r) => r.activityId === activity.id && r.participant && r.participant.toLowerCase() === participant.toLowerCase(),
    ).length;
    if (used >= activity.participantLimit) {
      throw new HttpError(409, `「${participant}」已达到每人 ${activity.participantLimit} 次的抽取上限`, 'participant_limit');
    }
  }

  let remainingAfter = 0;
  if (prize) {
    prize.remaining = Math.max(0, prize.remaining - 1);
    prize.drawn = (prize.drawn || 0) + 1;
    remainingAfter = prize.remaining;
  }

  if (code) {
    code.used = true;
    code.usedAt = Date.now();
  }

  if (winner && prize) {
    winner.won = true;
    winner.prizeName = prize.name;
    winner.at = Date.now();
  }

  const record = recordPayload(activity, {
    prizeId: prize?.id,
    prizeName: prize?.name,
    level: prize?.level,
    code: code?.code,
    participant: winner ? winner.name : participant || code?.holder || '',
    phone: winner ? winner.phone : code?.phone || '',
    operatorId: user.id,
    operatorName: user.name,
    remainingAfter,
  });

  pushRecord(record);
  touch(activity);
  persist();

  return {
    record,
    hit: Boolean(prize),
    prize: prize ? { ...prize } : null,
    holder: winner ? winner.name : code?.holder || '',
    phone: winner ? winner.phone : code?.phone || '',
    winner: winner
      ? {
          name: winner.name,
          phone: winner.phone,
          phoneMasked: winner.phone && winner.phone.length === 11
            ? `${winner.phone.slice(0, 3)}****${winner.phone.slice(-4)}`
            : winner.phone || '',
        }
      : null,
    roster: rosterSummary(activity),
    activity: viewActivity(activity),
    message: prize ? `恭喜获得「${prize.name}」` : '谢谢参与，再来一次',
  };
});

/* --- 全局设置（对外地址等） --- */

def('GET', '/api/settings', async (ctx) => {
  requireUser(ctx.req);
  return {
    publicBaseUrl: db.settings?.publicBaseUrl || '',
  };
});

def('PUT', '/api/settings', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.manage');
  if (!db.settings) db.settings = { publicBaseUrl: '' };
  if (ctx.body.publicBaseUrl !== undefined) {
    let value = String(ctx.body.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (value && !/^https?:\/\/[^\s/]+/i.test(value)) {
      throw badRequest('对外地址要以 http:// 或 https:// 开头');
    }
    if (value.length > 200) throw badRequest('对外地址太长');
    db.settings.publicBaseUrl = value;
  }
  touch(db.meta || {});
  persist();
  return { publicBaseUrl: db.settings.publicBaseUrl };
});

/* --- records --- */

def('GET', '/api/records', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'record.view');
  const { query } = ctx;
  const limit = clamp(Number(query.get('limit') || 50) || 50, 1, 500);
  const offset = Math.max(0, Number(query.get('offset') || 0) || 0);
  const list = searchRecords({
    activityId: query.get('activityId') || '',
    mode: query.get('mode') || '',
    q: query.get('q') || '',
  });
  return {
    total: list.length,
    limit,
    offset,
    records: list.slice(offset, offset + limit),
  };
});

def('DELETE', '/api/records/:id', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'record.manage');
  const record = db.records.find((r) => r.id === ctx.params.id);
  if (!record) throw notFound('记录不存在');
  const activity = db.activities.find((a) => a.id === record.activityId);
  if (activity && record.prizeId) {
    const prize = activity.prizes.find((p) => p.id === record.prizeId);
    if (prize) {
      prize.remaining = clamp(prize.remaining + 1, 0, prize.quota);
      prize.drawn = Math.max(0, (prize.drawn || 0) - 1);
    }
  }
  if (activity && record.code) {
    const code = (activity.codes || []).find((c) => c.code === record.code);
    if (code) {
      code.used = false;
      code.usedAt = 0;
    }
  }
  db.records = db.records.filter((r) => r.id !== record.id);
  if (activity) touch(activity);
  persist();
  return { ok: true, id: record.id, refunded: Boolean(record.prizeId) };
});

def('GET', '/api/records/export', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'record.manage');
  const { query } = ctx;
  const list = searchRecords({
    activityId: query.get('activityId') || '',
    mode: query.get('mode') || '',
    q: query.get('q') || '',
  });
  const header = ['时间', '活动', '抽奖方式', '奖项', '等级', '参与者', '手机号', '抽奖码', '操作人', '抽后剩余'];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const stamp = (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const rows = list.map((r) => [
    stamp(r.at),
    r.activityName,
    MODE_MAP.get(r.mode)?.label || r.mode,
    r.prizeName || '谢谢参与',
    r.level || '',
    r.participant || '',
    r.phone || '',
    r.code || '',
    r.operatorName || '',
    r.hit ? String(r.remainingAfter) : '-',
  ]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')}`;
  const filename = `lottery-records-${new Date().toISOString().slice(0, 10)}.csv`;
  ctx.sendFile(csv, filename);
  return null;
});

/* --- stats --- */

def('GET', '/api/stats', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'activity.view');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayRecords = db.records.filter((r) => r.at >= startOfDay.getTime());
  const totalQuota = db.activities.reduce((s, a) => s + a.prizes.reduce((x, p) => x + p.quota, 0), 0);
  const totalRemaining = db.activities.reduce((s, a) => s + a.prizes.reduce((x, p) => x + Math.max(0, p.remaining), 0), 0);
  return {
    activities: {
      total: db.activities.length,
      active: db.activities.filter((a) => a.status === 'active').length,
    },
    quota: { total: totalQuota, remaining: totalRemaining, drawn: totalQuota - totalRemaining },
    today: {
      draws: todayRecords.length,
      wins: todayRecords.filter((r) => r.hit !== false).length,
    },
    records: db.records.length,
    participants: new Set(db.records.map((r) => r.participant).filter(Boolean)).size,
  };
});

/* --- accounts --- */

def('GET', '/api/users', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'account.view');
  return {
    users: db.users.map((u) => ({
      ...publicUser(u),
      drawCount: db.records.filter((r) => r.operatorId === u.id).length,
    })),
  };
});

def('POST', '/api/users', async (ctx) => {
  const actor = requireUser(ctx.req);
  requirePermission(actor, 'account.manage');
  const account = str(ctx.body.account, { min: 2, max: 32, label: '登录账号' }).toLowerCase();
  if (!/^[a-z0-9_.@-]+$/.test(account)) throw badRequest('账号只能包含字母、数字与 _ . @ -');
  if (findUserByAccount(account)) throw badRequest('该账号已存在', 'duplicate_account');
  const name = str(ctx.body.name, { max: 20, label: '姓名' });
  const role = oneOf(ctx.body.role || 'viewer', ROLES.map((r) => r.key), '角色');
  const password = str(ctx.body.password, { min: 6, max: 120, label: '初始密码' });
  const permissions = Array.isArray(ctx.body.permissions)
    ? ctx.body.permissions.filter((p) => ALL_PERMISSIONS.includes(p))
    : rolePreset(role);
  const { salt, hash } = hashPassword(password);
  const user = {
    id: uid('u_'),
    account,
    name,
    role,
    permissions,
    enabled: ctx.body.enabled !== false,
    mustChangePassword: ctx.body.mustChangePassword !== false,
    salt,
    hash,
    createdAt: Date.now(),
    lastLoginAt: 0,
  };
  db.users.push(user);
  persist();
  ctx.status = 201;
  return { user: publicUser(user) };
});

def('PATCH', '/api/users/:id', async (ctx) => {
  const actor = requireUser(ctx.req);
  requirePermission(actor, 'account.manage');
  const target = findUserById(ctx.params.id);
  if (!target) throw notFound('账号不存在');
  const body = ctx.body;
  const isSelf = target.id === actor.id;

  if (body.name !== undefined) target.name = str(body.name, { max: 20, label: '姓名' });
  if (body.role !== undefined && body.role !== target.role) {
    if (isSelf) throw badRequest('不能修改自己的角色，请联系其他管理员');
    target.role = oneOf(body.role, ROLES.map((r) => r.key), '角色');
    target.permissions = rolePreset(target.role);
    destroyUserSessions(target.id);
  }
  if (body.permissions !== undefined) {
    if (isSelf) throw badRequest('不能修改自己的权限');
    if (!Array.isArray(body.permissions)) throw badRequest('权限格式不正确');
    target.permissions = body.permissions.filter((p) => ALL_PERMISSIONS.includes(p));
  }
  if (body.enabled !== undefined) {
    if (isSelf) throw badRequest('不能停用自己的账号');
    if (target.role === 'owner' && body.enabled === false) {
      const owners = db.users.filter((u) => u.role === 'owner' && u.enabled !== false);
      if (owners.length <= 1) throw badRequest('至少需要保留一个启用中的超级管理员');
    }
    target.enabled = Boolean(body.enabled);
    if (!target.enabled) destroyUserSessions(target.id);
  }
  if (body.password !== undefined && body.password !== '') {
    if (isSelf) throw badRequest('请通过右上角「修改密码」更新自己的密码');
    const password = str(body.password, { min: 6, max: 120, label: '新密码' });
    const { salt, hash } = hashPassword(password);
    target.salt = salt;
    target.hash = hash;
    // 管理员重置密码后，默认要求本人下次登录先改掉
    target.mustChangePassword = body.mustChangePassword !== false;
    destroyUserSessions(target.id);
  } else if (body.mustChangePassword !== undefined) {
    target.mustChangePassword = Boolean(body.mustChangePassword);
    if (target.mustChangePassword) destroyUserSessions(target.id);
  }
  persist();
  return { user: publicUser(target) };
});

def('DELETE', '/api/users/:id', async (ctx) => {
  const actor = requireUser(ctx.req);
  requirePermission(actor, 'account.manage');
  const target = findUserById(ctx.params.id);
  if (!target) throw notFound('账号不存在');
  if (target.id === actor.id) throw badRequest('不能删除自己的账号');
  if (target.role === 'owner') {
    const owners = db.users.filter((u) => u.role === 'owner');
    if (owners.length <= 1) throw badRequest('至少需要保留一个超级管理员');
  }
  db.users = db.users.filter((u) => u.id !== target.id);
  destroyUserSessions(target.id);
  persist();
  return { ok: true, id: target.id };
});

/* -------------------------------------------------------------- 数据备份 */

const BACKUP_NAME_RE = /^db-\d{8}-\d{6}-[a-z0-9_]+\.json$/;

function backupDir() {
  return path.join(ROOT, 'data', 'backups');
}

function listBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => BACKUP_NAME_RE.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, size: stat.size, at: stat.mtimeMs };
    })
    .sort((a, b) => b.at - a.at);
}

def('GET', '/api/system/backups', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'backup.manage');
  return { backups: listBackups().slice(0, 30) };
});

def('POST', '/api/system/backups', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'backup.manage');
  const file = backupNow('manual');
  if (!file) throw new HttpError(500, '备份生成失败', 'backup_failed');
  const stat = fs.statSync(file);
  return { backup: { name: path.basename(file), size: stat.size, at: stat.mtimeMs } };
});

// 返回快照内容（约 170KB），前端拼成 Blob 下载，避免改动响应管线的二进制支持
def('GET', '/api/system/backups/:name', async (ctx) => {
  const user = requireUser(ctx.req);
  requirePermission(user, 'backup.manage');
  const name = String(ctx.params.name || '');
  if (!BACKUP_NAME_RE.test(name)) throw badRequest('备份文件名不合法');
  const full = path.join(backupDir(), name);
  if (!fs.existsSync(full)) throw notFound('备份不存在');
  return { name, content: fs.readFileSync(full, 'utf8') };
});

/* -------------------------------------------------------------- dispatch */

export async function handle(ctx, method, pathname) {
  const matched = matchRoute(method, pathname);
  if (!matched) throw notFound('接口不存在');
  ctx.params = matched.params;
  const result = await matched.handler(ctx);
  return result;
}
