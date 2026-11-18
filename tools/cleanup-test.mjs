/** 清理我自测时写入七周年活动的记录与名单绑定 */
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
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

const login = await fetch(BASE + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin', password: 'admin123' }),
});
for (const c of login.headers.getSetCookie?.() || []) {
  const pair = c.split(';')[0];
  if (pair.startsWith('aurum_sid=')) cookie = pair;
}

const { data } = await api('/activities');
const act = data.activities.find((a) => a.name.includes('七周年'));
const rec = await api(`/records?activityId=${act.id}&limit=200`);
const mine = rec.data.records.filter((r) => r.participant === '测试甲' || r.participant === '测试丙');
for (const r of mine) {
  const res = await api(`/records/${r.id}`, 'DELETE');
  console.log('撤销测试记录', r.code, r.participant, res.status);
}

const reset = await api(`/activities/${act.id}/codes/bind`, 'POST', { reset: true });
console.log('解除绑定', reset.status, JSON.stringify(reset.data));

const after = await api(`/activities/${act.id}/codes`);
const codes = after.data.codes;
console.log('剩余：已用', codes.filter((c) => c.used).length, '/ 已绑定', codes.filter((c) => c.holder).length, '/ 总', codes.length);
const detail = await api(`/activities/${act.id}`);
console.log('活动状态', detail.data.activity.status, '剩余名额', detail.data.activity.stats.totalRemaining);
