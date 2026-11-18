/** 老师端开奖也要核对手机号：未填 / 填错 / 填对 */
const BASE = process.env.BASE || 'http://127.0.0.1:5193/api';
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
  await api('/activities', 'POST', {
    name: `舞台核验 ${Date.now().toString().slice(-5)}`,
    mode: 'code',
    status: 'active',
    publicRedeem: false,
    phoneRequired: true,
    nameRequired: true,
  })
).data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', { prizes: [{ name: '测试奖', level: '参与奖', quota: 20, weight: 20 }] });
await api(`/activities/${act.id}/codes`, 'POST', { count: 10, prefix: 'TT' });

const issue = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '张三', phone: '13800001111' });
const code = issue.data.code.code;

const noPhone = await api(`/activities/${act.id}/draw`, 'POST', { code });
ok('不填手机号被拒（400 phone_required）', noPhone.status === 400 && noPhone.data.code === 'phone_required', `${noPhone.status} ${noPhone.data?.code}`);

const wrong = await api(`/activities/${act.id}/draw`, 'POST', { code, phone: '13800002222' });
ok('手机号不对被拒（403 phone_mismatch）', wrong.status === 403 && wrong.data.code === 'phone_mismatch', `${wrong.status} ${wrong.data?.code}`);

const right = await api(`/activities/${act.id}/draw`, 'POST', { code, phone: '13800001111' });
ok('手机号正确可开奖（200）', right.status === 200 && right.data.hit === true, `${right.status}`);

const again = await api(`/activities/${act.id}/draw`, 'POST', { code, phone: '13800001111' });
ok('同一码再抽仍被拒（409 code_used）', again.status === 409, `${again.status}`);

// 没登记手机号的码（活动 phoneRequired=false）不需要手机号
const act2 = (
  await api('/activities', 'POST', {
    name: `舞台核验无手机 ${Date.now().toString().slice(-5)}`,
    mode: 'code',
    status: 'active',
    publicRedeem: false,
    phoneRequired: false,
    nameRequired: false,
  })
).data.activity;
await api(`/activities/${act2.id}/prizes`, 'PUT', { prizes: [{ name: '测试奖', level: '参与奖', quota: 5, weight: 5 }] });
await api(`/activities/${act2.id}/codes`, 'POST', { count: 5, prefix: 'UU' });
const plain = (await api(`/activities/${act2.id}/codes/issue`, 'POST', { name: '李四', phone: '' })).data.code.code;
const plainDraw = await api(`/activities/${act2.id}/draw`, 'POST', { code: plain });
ok('没登记手机号的码，不填也能开', plainDraw.status === 200, `${plainDraw.status} ${plainDraw.data?.code}`);

await api(`/activities/${act.id}`, 'DELETE');
await api(`/activities/${act2.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
