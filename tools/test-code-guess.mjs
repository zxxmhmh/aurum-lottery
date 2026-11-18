/** 抽奖码防猜：码长度、重新发码、失败限流 */
const BASE = process.env.BASE || 'http://127.0.0.1:5190/api';
const PUBLIC = BASE.replace('/api', '');
let cookie = '';

async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const p = c.split(';')[0];
    if (p.startsWith('aurum_sid=')) cookie = p;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

await api('/auth/login', 'POST', { account: 'admin', password: 'admin123' });
const act = (
  await api('/activities', 'POST', { name: `防猜 ${Date.now().toString().slice(-5)}`, mode: 'code', status: 'active', publicRedeem: true })
).data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', { prizes: [{ name: '测试奖', level: '参与奖', quota: 30, weight: 30 }] });

const g4 = await api(`/activities/${act.id}/codes`, 'POST', { count: 5, prefix: 'GG', length: 4 });
ok('指定 4 位 → 生成为 4 位', g4.data.codes.every((c) => c.code.split('-')[1].length === 4), JSON.stringify(g4.data.codes.map((c) => c.code)));

const g6 = await api(`/activities/${act.id}/codes`, 'POST', { count: 5, prefix: 'GG' });
const newOnes = g6.data.codes.slice(5);
ok('默认生成 → 6 位', newOnes.every((c) => c.code.split('-')[1].length === 6), JSON.stringify(newOnes.map((c) => c.code)));

const regen = await api(`/activities/${act.id}/codes/regenerate`, 'POST', { count: 12, length: 6, prefix: 'GG' });
ok('重新发码 → 12 枚且都是 6 位', regen.data.total === 12 && regen.data.length === 6, JSON.stringify(regen.data));

const code = g6.data.codes[0].code;
await api(`/activities/${act.id}/codes/regenerate`, 'POST', { count: 12, length: 6, prefix: 'GG' });

// 失败限流：一分钟内 20 次失败之后应当 429
let limited = 0;
let last = 0;
for (let i = 0; i < 26; i += 1) {
  const res = await fetch(`${PUBLIC}/api/public/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: `GG-${String(i).padStart(6, '0')}` }),
  });
  last = res.status;
  if (res.status === 429) {
    limited += 1;
  }
}
ok('连续猜错会被限流（出现 429）', limited > 0, `最后状态 ${last}`);
const limitBody = await (
  await fetch(`${PUBLIC}/api/public/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'GG-000000' }),
  })
).json();
ok('限流提示明确', String(limitBody.code || '').includes('too_many_attempts') || limitBody.code === 'rate_limited', JSON.stringify(limitBody));

await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败（临时活动已删除）`);
process.exit(fail ? 1 : 0);
