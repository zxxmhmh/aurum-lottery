/** 同一个码反复抽：并发 + 连点，验证服务端只认一次 */
const BASE = process.env.BASE || 'http://127.0.0.1:5195/api';
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
const me = await api('/auth/me');
if (me.status !== 200) {
  console.log('登录失败');
  process.exit(2);
}

const act = (
  await api('/activities', 'POST', {
    name: `并发验收 ${Date.now().toString().slice(-5)}`,
    mode: 'code',
    status: 'active',
    publicRedeem: true,
  })
).data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [{ name: '验收奖', level: '参与奖', quota: 50, weight: 50 }],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 20, prefix: 'CC' });
const issued = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '并发员', phone: '13800001234' });
const code = issued.data.code.code;

const redeem = (c) =>
  fetch(`${BASE}/public/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: c, phone: '13800001234' }),
  }).then((r) => r.status);

const burst = await Promise.all(Array.from({ length: 30 }, () => redeem(code)));
const seq = [];
for (let i = 0; i < 10; i += 1) seq.push(await redeem(code));

const all = [...burst, ...seq];
const success = all.filter((s) => s === 200).length;
const conflict = all.filter((s) => s === 409).length;
ok('40 次请求只成功 1 次', success === 1, `成功 ${success}`);
ok('其余 39 次都是 409', conflict === 39, `409 ${conflict}`);

const rec = (await api(`/records?activityId=${act.id}&limit=50`)).data;
ok('开奖记录只有 1 条', rec.total === 1, `记录 ${rec.total}`);
const prize = (await api(`/activities/${act.id}`)).data.activity.prizes[0];
ok('只扣了 1 个名额', prize.remaining === 49, `剩余 ${prize.remaining}`);

// 管理员舞台用同一枚码再抽，也应被拒
const stageDraw = await api(`/activities/${act.id}/draw`, 'POST', { code });
ok('舞台端同一枚码再抽被拒', stageDraw.status === 409, `状态 ${stageDraw.status}`);

await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败（临时活动已删除）`);
process.exit(fail ? 1 : 0);
