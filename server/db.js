import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './password.js';
import { uid } from './util.js';

export const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = 30;
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000;

export const db = {
  meta: { version: 1, createdAt: 0 },
  settings: { publicBaseUrl: '' },
  users: [],
  sessions: {},
  activities: [],
  records: [],
};

/* ------------------------------------------------------------------ seed */

const PARTICIPANTS = [
  '陈知微', '苏晚', '顾行舟', '江令仪', '白露', '温言', '陆时衍', '许南枝',
  '宋清和', '叶淮', '林见鹿', '周听澜', '沈照', '裴宴', '阿箬', '程既明',
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i += 1) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `AUR-${s}`;
}

function makePrizes(specs) {
  return specs.map(([name, level, quota, drawn, weight, color]) => ({
    id: uid('pz_'),
    name,
    level,
    quota,
    drawn,
    remaining: quota - drawn,
    weight,
    color,
  }));
}

function buildSeed() {
  const now = Date.now();
  const users = [
    { account: 'admin', name: '周叙白', role: 'owner', password: 'admin123' },
    { account: 'ops', name: '林知夏', role: 'operator', password: 'ops123' },
    { account: 'audit', name: '沈砚', role: 'auditor', password: 'audit123' },
    { account: 'guest', name: '许南枝', role: 'viewer', password: 'guest123' },
  ].map((u, i) => {
    const { salt, hash } = hashPassword(u.password);
    return {
      id: uid('u_'),
      account: u.account,
      name: u.name,
      role: u.role,
      permissions: [],
      enabled: true,
      salt,
      hash,
      createdAt: now - (30 - i) * 86400e3,
      lastLoginAt: now - (i + 1) * 3.4 * 3600e3,
    };
  });

  const gala = {
    id: uid('a_'),
    name: '星光之夜 · 年度答谢',
    subtitle: 'ANNUAL GALA 2026',
    description: '面向年度特邀嘉宾的名单抽奖，奖项名额实时递减，抽完即止。',
    mode: 'quota',
    status: 'active',
    participantLimit: 0,
    missWeight: 0,
    roster: ['林清和', '陈书言', '周慕白', '沈知微', '顾南亭', '苏砚秋', '陆星河', '温以宁'].map((name) => ({
      id: uid('p_'),
      name,
      phone: '',
      campus: '',
      won: false,
      prizeName: '',
      at: 0,
    })),
    createdAt: now - 12 * 86400e3,
    updatedAt: now - 2 * 3600e3,
  };

  const activities = [
    gala,
    {
      id: uid('a_'),
      name: '春日会员日 · 概率抽奖',
      subtitle: 'SPRING MEMBER DAY',
      description: '按权重随机开奖，未中奖进入「谢谢参与」，中奖后对应名额自动扣减。',
      mode: 'probability',
      status: 'active',
      participantLimit: 2,
      missWeight: 45,
      createdAt: now - 6 * 86400e3,
      updatedAt: now - 40 * 60e3,
    },
    {
      id: uid('a_'),
      name: '新品发布 · 抽奖码',
      subtitle: 'LAUNCH EVENT · TICKET DRAW',
      description: '每位到场嘉宾持一枚抽奖码，扫码核销后开奖，一码一次。',
      mode: 'code',
      status: 'active',
      participantLimit: 0,
      missWeight: 0,
      createdAt: now - 2 * 86400e3,
      updatedAt: now - 20 * 60e3,
    },
  ];

  activities[0].prizes = makePrizes([
    ['徕卡 Q3 相机', '特等奖', 1, 1, 1, '#E4C58C'],
    ['iPhone 17 Pro', '一等奖', 3, 1, 3, '#D9B77C'],
    ['大疆 Osmo Pocket 4', '二等奖', 8, 2, 8, '#C9A25F'],
    ['%Arabica 咖啡礼盒', '三等奖', 30, 5, 24, '#B08C55'],
    ['纪念徽章', '阳光普照', 100, 9, 60, '#8C7A5B'],
  ]);

  activities[1].prizes = makePrizes([
    ['戴森 Supersonic 吹风机', '头等奖', 2, 1, 3, '#E4C58C'],
    ['Lululemon 抽绳包', '二等奖', 10, 2, 12, '#C9A25F'],
    ['星巴克中杯券', '三等奖', 50, 5, 35, '#A8844F'],
    ['品牌帆布袋', '参与奖', 200, 12, 30, '#7E6E52'],
  ]);

  activities[2].prizes = makePrizes([
    ['索尼 WH-1000XM6', '现场大奖', 2, 0, 4, '#E4C58C'],
    ['联名香薰礼盒', '幸运奖', 12, 1, 20, '#C9A25F'],
    ['城市咖啡地图', '参与奖', 26, 2, 40, '#7E6E52'],
  ]);

  activities[2].codes = Array.from({ length: 40 }, (_, i) => ({
    code: makeCode(),
    used: false,
    usedAt: 0,
    seq: i + 1,
  }));
  // 保证抽奖码唯一
  const seen = new Set();
  for (const c of activities[2].codes) {
    while (seen.has(c.code)) c.code = makeCode();
    seen.add(c.code);
  }

  const usersForDraw = users.filter((u) => u.role === 'owner' || u.role === 'operator');

  // 全局时间轴：把每个奖项已抽出的次数摊成事件，再统一排序
  const events = [];
  for (const activity of activities) {
    for (const prize of activity.prizes) {
      for (let i = 0; i < prize.drawn; i += 1) {
        events.push({ activity, prize, r: Math.random() });
      }
    }
  }
  events.sort((a, b) => a.r - b.r);

  const start = now - 6.4 * 3600e3;
  const step = (now - 12 * 60e3 - start) / Math.max(1, events.length);
  const counters = new Map();
  const records = [];
  const usedCodeQueue = activities[2].codes.filter((c) => !c.used).slice();

  events.forEach((ev, index) => {
    const at = Math.round(start + index * step + Math.random() * step * 0.6);
    const key = ev.prize.id;
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count);

    const operator = usersForDraw[index % usersForDraw.length];
    const participant = PARTICIPANTS[(index * 7 + 3) % PARTICIPANTS.length];
    const record = {
      id: uid('r_'),
      activityId: ev.activity.id,
      activityName: ev.activity.name,
      mode: ev.activity.mode,
      prizeId: ev.prize.id,
      prizeName: ev.prize.name,
      level: ev.prize.level,
      code: '',
      participant,
      operatorId: operator.id,
      operatorName: operator.name,
      remainingAfter: ev.prize.quota - count,
      hit: true,
      at,
    };

    if (ev.activity.mode === 'code') {
      const code = usedCodeQueue.shift();
      if (code) {
        code.used = true;
        code.usedAt = at;
        record.code = code.code;
        record.participant = '';
      }
    }
    records.push(record);
  });

  records.sort((a, b) => b.at - a.at);

  // 概率活动补几条「谢谢参与」，让统计与流水更接近真实现场
  const probActivity = activities[1];
  for (let i = 0; i < 4; i += 1) {
    const at = Math.round(start + Math.random() * (now - start - 20 * 60e3));
    const operator = usersForDraw[i % usersForDraw.length];
    records.push({
      id: uid('r_'),
      activityId: probActivity.id,
      activityName: probActivity.name,
      mode: 'probability',
      prizeId: '',
      prizeName: '',
      level: '',
      code: '',
      participant: PARTICIPANTS[(i * 5 + 2) % PARTICIPANTS.length],
      operatorId: operator.id,
      operatorName: operator.name,
      remainingAfter: 0,
      hit: false,
      at,
    });
  }
  records.sort((a, b) => b.at - a.at);

  users[0].permissions = [];
  return {
    meta: { version: 1, createdAt: now, seededAt: now },
    users,
    sessions: {},
    activities,
    records,
  };
}

/* ------------------------------------------------------------- persistence */

let saveTimer = null;
let dirty = false;

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    console.error('[db] 保存失败:', err.message);
  }
}

export function persist() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirty) saveNow();
  }, 150);
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of Object.entries(db.sessions)) {
    if (!session || session.exp <= now) delete db.sessions[token];
  }
}

/** 手动/自动备份 db.json，返回备份文件路径（失败返回空串） */
export function backupNow(reason = 'auto') {
  try {
    if (!fs.existsSync(DB_PATH)) return '';
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const target = path.join(BACKUP_DIR, `db-${stamp}-${reason}.json`);
    fs.copyFileSync(DB_PATH, target);
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort();
    for (const name of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      fs.unlinkSync(path.join(BACKUP_DIR, name));
    }
    return target;
  } catch {
    return '';
  }
}

/** 启动时若无近 12 小时的备份则先备一份，之后每 6 小时检查一次 */
export function startAutoBackup() {
  const check = () => {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort();
      const newest = files.length
        ? fs.statSync(path.join(BACKUP_DIR, files[files.length - 1])).mtimeMs
        : 0;
      if (Date.now() - newest > 12 * 60 * 60 * 1000) {
        const file = backupNow('auto');
        if (file) console.log('[db] 已自动备份 →', path.relative(ROOT, file));
      }
    } catch {
      /* 备份失败不影响服务 */
    }
  };
  check();
  const timer = setInterval(check, BACKUP_INTERVAL);
  timer.unref?.();
}

export function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    Object.assign(db, buildSeed());
    saveNow();
    console.log('[db] 已生成初始演示数据:', DB_PATH);
    return db;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    Object.assign(db, {
      meta: raw.meta || { version: 1 },
      users: raw.users || [],
      sessions: raw.sessions || {},
      activities: raw.activities || [],
      records: raw.records || [],
      settings: { publicBaseUrl: '', ...(raw.settings || {}) },
    });
    pruneSessions();
    console.log(`[db] 已加载 ${db.users.length} 个账号 / ${db.activities.length} 个活动 / ${db.records.length} 条记录`);
  } catch (err) {
    const backup = `${DB_PATH}.broken-${Date.now()}`;
    try { fs.copyFileSync(DB_PATH, backup); } catch { /* ignore */ }
    console.error(`[db] 数据文件损坏，已备份到 ${backup}，重新生成演示数据:`, err.message);
    Object.assign(db, buildSeed());
    saveNow();
  }
  return db;
}
