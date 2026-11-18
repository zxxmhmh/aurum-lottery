/** 一次性脚本：按七周年海报建活动、写奖项、生成 500 枚抽奖码 */
const BASE = 'http://127.0.0.1:5180/api';

let cookie = '';
async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    if (pair.startsWith('aurum_sid=')) cookie = pair;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const PRIZES = [
  { name: '安目佳读写台', level: '特等奖', quota: 2, weight: 2, color: '#B8863B' },
  { name: '拍立得', level: '一等奖', quota: 5, weight: 5, color: '#C99A4E' },
  { name: '华为蓝牙耳机', level: '二等奖', quota: 20, weight: 20, color: '#D3AC6A' },
  { name: '自习券 3 次', level: '三等奖', quota: 100, weight: 100, color: '#B79B77' },
  { name: '智学钛杯', level: '四等奖', quota: 100, weight: 100, color: '#A08868' },
  { name: '智学活页本', level: '五等奖', quota: 100, weight: 100, color: '#8C7A5B' },
  { name: '握力器', level: '参与奖', quota: 173, weight: 173, color: '#7E6E52' },
];

const MODE = process.argv[2] || 'create';

await api('/auth/login', 'POST', { account: 'admin', password: 'admin123' });

if (MODE === 'cleanup') {
  const { activities } = await api('/activities');
  for (const a of activities) {
    if (a.name.includes('七周年') || a.name.includes('??????')) {
      await api(`/activities/${a.id}`, 'DELETE');
      console.log('已删除:', a.name);
    }
  }
  process.exit(0);
}

// 避免重复创建
const { activities } = await api('/activities');
for (const a of activities) {
  if (a.name.includes('七周年')) {
    console.log('已存在同名活动，先跳过创建:', a.id);
    process.exit(0);
  }
}

const created = await api('/activities', 'POST', {
  name: '智学时光书房 · 七周年店庆',
  subtitle: '7TH ANNIVERSARY',
  description: '会员加赠抽奖一次：500 份奖品、500 个名额，一码一次、人人有奖。',
  mode: 'code',
  status: 'draft',
  participantLimit: 0,
  missWeight: 0,
});
const id = created.activity.id;

const saved = await api(`/activities/${id}/prizes`, 'PUT', { prizes: PRIZES });
const codes = await api(`/activities/${id}/codes`, 'POST', { count: 500, prefix: 'ZX' });

console.log(JSON.stringify({ id, name: saved.activity.name, mode: saved.activity.mode, status: saved.activity.status, totalQuota: saved.activity.stats.totalQuota, prizes: saved.activity.prizes.map((p) => `${p.level} ${p.name} ×${p.quota}`), codes: codes.codes.length, sample: codes.codes.slice(0, 3).map((c) => c.code) }, null, 2));
