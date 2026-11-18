/** 名单绑定 + 完整手机号核验自测（临时活动，跑完删除） */
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

const created = await api('/activities', 'POST', {
  name: `绑定测试 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'draft',
});
const act = created.data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [{ name: '测试奖', level: '参与奖', quota: 5, weight: 5 }],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 5, prefix: 'BND' });

const bind = await api(`/activities/${act.id}/codes/bind`, 'POST', {
  entries: [
    { name: '绑定甲', phone: '13800001234', campus: '海淀' },
    { name: '绑定乙', phone: '13900005678', campus: '朝阳' },
  ],
});
ok('批量绑定成功', bind.status === 200 && bind.data.bound === 2, JSON.stringify(bind.data));

const rebind = await api(`/activities/${act.id}/codes/bind`, 'POST', {
  entries: [
    { name: '绑定甲', phone: '13800001234' },
    { name: '绑定丙', phone: '13700001111', campus: '西城' },
  ],
});
ok('名单里重复的学员会被跳过', rebind.status === 200 && rebind.data.bound === 1 && rebind.data.duplicated === 1, JSON.stringify(rebind.data));

const codes = (await api(`/activities/${act.id}/codes`)).data.codes;
const c1 = codes.find((c) => c.holder === '绑定甲');
const c2 = codes.find((c) => c.holder === '绑定乙');
ok('完整手机号已写入', c1.phone === '13800001234' && c2.phone === '13900005678');
ok('校区已写入', c1.campus === '海淀' && c2.campus === '朝阳');

const badBind = await api(`/activities/${act.id}/codes/bind`, 'POST', {
  entries: [{ name: '缺号', phone: '' }],
});
ok('批量绑定缺手机号被拒', badBind.status === 400, JSON.stringify(badBind.data));

const log = await api(`/activities/${act.id}/codes/issue-log`);
ok('批量绑定也进发码记录', log.status === 200 && log.data.total === 3, String(log.data.total));

// 开启自助 + 上架，测核验
await api(`/activities/${act.id}`, 'PATCH', { status: 'active', publicRedeem: true });

const noPhone = await api('/public/redeem', 'POST', { code: c1.code }, false);
ok('不填手机 → 400 phone_required', noPhone.status === 400 && noPhone.data.code === 'phone_required', JSON.stringify(noPhone.data));

const wrong = await api('/public/redeem', 'POST', { code: c1.code, phone: '13800009999' }, false);
ok('手机号不符 → 403 phone_mismatch', wrong.status === 403 && wrong.data.code === 'phone_mismatch');

const good = await api('/public/redeem', 'POST', { code: c1.code, phone: '13800001234' }, false);
ok('手机号正确 → 开奖', good.status === 200 && Boolean(good.data.prize), JSON.stringify(good.data));
ok('结果带回持码人', good.data.holder === '绑定甲');

const replay = await api('/public/redeem', 'POST', { code: c1.code, phone: '13800001234' }, false);
ok('已用码不可复用', replay.status === 409);

const afterLog = await api(`/activities/${act.id}/codes/issue-log`);
ok('记录带 usage 状态', afterLog.data.entries.find((e) => e.code === c1.code)?.used === true);

const reset = await api(`/activities/${act.id}/codes/bind`, 'POST', { reset: true });
ok('解除未使用绑定', reset.status === 200 && reset.data.cleared === 2, JSON.stringify(reset.data));
const afterReset = (await api(`/activities/${act.id}/codes`)).data.codes;
ok('解绑清掉姓名/手机/校区', !afterReset.find((c) => c.code === c2.code).holder);
ok('发码记录不被解绑清除', (await api(`/activities/${act.id}/codes/issue-log`)).data.total === 3);

await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
