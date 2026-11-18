/** 学员自助核销接口自测（自建临时活动，跑完删除） */
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
  name: `核销测试 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'active',
  publicRedeem: true,
});
const act = created.data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [{ name: '核销测试奖', level: '一等奖', quota: 2, weight: 2 }],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 3, prefix: 'RDM' });
const issued = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '核销测试员',
  phone: '13800001234',
  campus: '测试校区',
});
const code = issued.data.code.code;

const noPhone = await api('/public/redeem', 'POST', { code }, false);
ok('缺手机号 → 400', noPhone.status === 400 && noPhone.data.code === 'phone_required', JSON.stringify(noPhone.data));

const wrongPhone = await api('/public/redeem', 'POST', { code, phone: '13900009999' }, false);
ok('手机号不符 → 403', wrongPhone.status === 403 && wrongPhone.data.code === 'phone_mismatch');

const good = await api('/public/redeem', 'POST', { code, phone: '13800001234' }, false);
ok('正常开奖', good.status === 200 && Boolean(good.data.prize), JSON.stringify(good.data));
ok('结果含活动名/码/持码人', Boolean(good.data.activityName && good.data.code && good.data.holder === '核销测试员'));
ok('结果带手机号', good.data.phone === '13800001234', good.data.phone);
ok('结果带开奖时间', Number(good.data.at) > 0);

const replay = await api('/public/redeem', 'POST', { code, phone: '13800001234' }, false);
ok('已用码 → 409', replay.status === 409 && replay.data.code === 'code_used');

const notFound = await api('/public/redeem', 'POST', { code: 'RDM-ZZZZ', phone: '13800001234' }, false);
ok('无效码 → 404', notFound.status === 404);

const records = await api(`/records?activityId=${act.id}&limit=5`);
ok('记录写入', records.data.total >= 1 && records.data.records[0].operatorName === '学员自助');

await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败 | 临时活动已删除`);
process.exit(fail ? 1 : 0);
