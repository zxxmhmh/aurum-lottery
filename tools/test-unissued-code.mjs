/** 码池里没发放的码（无手机号）不能直接开奖，猜中也没用 */
const BASE = process.env.BASE || 'http://127.0.0.1:5189/api';
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

const redeem = (code, phone) =>
  fetch(`${PUBLIC}/api/public/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(phone ? { code, phone } : { code }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

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
  await api('/activities', 'POST', {
    name: `未发放拦截 ${Date.now().toString().slice(-5)}`,
    mode: 'code',
    status: 'active',
    publicRedeem: true,
    phoneRequired: true,
    nameRequired: true,
  })
).data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', { prizes: [{ name: '测试奖', level: '参与奖', quota: 10, weight: 10 }] });
const gen = await api(`/activities/${act.id}/codes`, 'POST', { count: 5, prefix: 'NS' });
const poolCode = gen.data.codes[0].code;

const guess = await redeem(poolCode);
ok('池子里未发放的码 → 拒绝（code_unissued）', guess.status === 409 && guess.body.code === 'code_unissued', `${guess.status} ${JSON.stringify(guess.body)}`);

const prizeAfter = (await api(`/activities/${act.id}`)).data.activity.prizes[0];
ok('被拒绝后名额没被扣', prizeAfter.remaining === 10, `剩余 ${prizeAfter.remaining}`);

const issued = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '张三', phone: '13800001111' });
const issuedCode = issued.data.code.code;

const noPhone = await redeem(issuedCode);
ok('已发放但没填手机号 → 要求手机号', noPhone.status === 400 && noPhone.body.code === 'phone_required', `${noPhone.status}`);

const okDraw = await redeem(issuedCode, '13800001111');
ok('已发放 + 手机号对 → 开奖成功', okDraw.status === 200 && okDraw.body.hit === true, `${okDraw.status}`);

// 舞台端同样拦
const stageGuess = await api(`/activities/${act.id}/draw`, 'POST', { code: gen.data.codes[1].code });
ok('舞台端拿未发放的码开奖 → 拒绝', stageGuess.status === 409 && stageGuess.data.code === 'code_unissued', `${stageGuess.status} ${JSON.stringify(stageGuess.data)}`);

await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败（临时活动已删除）`);
process.exit(fail ? 1 : 0);
