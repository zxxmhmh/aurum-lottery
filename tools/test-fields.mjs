/** 发码字段必填开关自测（临时活动，跑完删除） */
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
  for (const c of res.headers.getSetCookie?.() || []) {
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
  name: `字段测试 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'active',
  campuses: ['海淀校区'],
});
const act = created.data.activity;
ok('默认姓名/手机号必填、校区选填', act.nameRequired === true && act.phoneRequired === true && act.campusRequired === false);
await api(`/activities/${act.id}/prizes`, 'PUT', { prizes: [{ name: '测试奖', level: '参与奖', quota: 20, weight: 20 }] });
await api(`/activities/${act.id}/codes`, 'POST', { count: 10, prefix: 'FLD' });

const noName = await api(`/activities/${act.id}/codes/issue`, 'POST', { phone: '13800001111' });
ok('默认缺姓名被拒', noName.status === 400 && noName.data.code === 'name_required', JSON.stringify(noName.data));

const noPhone = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '某甲' });
ok('默认缺手机号被拒', noPhone.status === 400 && noPhone.data.code === 'phone_required');

const relaxed = await api(`/activities/${act.id}`, 'PATCH', { nameRequired: false, phoneRequired: false });
ok('两个开关都能关', relaxed.data.activity.nameRequired === false && relaxed.data.activity.phoneRequired === false);

const bare = await api(`/activities/${act.id}/codes/issue`, 'POST', {});
ok('两项都关时可以只发码', bare.status === 200 && bare.data.code.holder === '', JSON.stringify(bare.data));

const nameOnly = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '只有名' });
ok('只填姓名也能发', nameOnly.status === 200 && nameOnly.data.code.holder === '只有名');

const phoneOnly = await api(`/activities/${act.id}/codes/issue`, 'POST', { phone: '13800002222' });
ok('只填手机号也能发', phoneOnly.status === 200 && phoneOnly.data.code.phone === '13800002222');

const badFormat = await api(`/activities/${act.id}/codes/issue`, 'POST', { phone: '123' });
ok('填了就要格式正确', badFormat.status === 400, JSON.stringify(badFormat.data));

const strictAgain = await api(`/activities/${act.id}`, 'PATCH', { phoneRequired: true });
ok('可以单独打开手机号必填', strictAgain.data.activity.phoneRequired === true && strictAgain.data.activity.nameRequired === false);

const bindBad = await api(`/activities/${act.id}/codes/bind`, 'POST', { entries: [{ name: '批量甲' }] });
ok('开启必填后批量绑定缺手机被拒', bindBad.status === 400 && bindBad.data.code === 'phone_required');

const copy = await api(`/activities/${act.id}/duplicate`, 'POST');
ok('复制带上必填开关', copy.data.activity.phoneRequired === true && copy.data.activity.nameRequired === false);

/* 保存配置（奖项不带 id）不能把名额清零 */
const quotaAct = (await api('/activities', 'POST', { name: `保存保护 ${Date.now().toString().slice(-5)}`, mode: 'quota', status: 'active' })).data.activity;
const p0 = (await api(`/activities/${quotaAct.id}/prizes`, 'PUT', { prizes: [{ name: '保护奖', level: '一等奖', quota: 10, weight: 10 }] })).data.activity.prizes[0];
await api(`/activities/${quotaAct.id}/draw`, 'POST', { prizeId: p0.id });
const afterDraw = (await api(`/activities/${quotaAct.id}`)).data.activity.prizes[0];
ok('抽一次后剩余 9', afterDraw.remaining === 9, String(afterDraw.remaining));
const resaved = (await api(`/activities/${quotaAct.id}/prizes`, 'PUT', {
  prizes: [{ name: '保护奖', level: '一等奖', quota: 10, weight: 10 }],
})).data.activity.prizes[0];
ok('保存配置（无 id）不会重置名额', resaved.remaining === 9, String(resaved.remaining));
const resavedWithId = (await api(`/activities/${quotaAct.id}/prizes`, 'PUT', {
  prizes: [{ id: p0.id, name: '保护奖', level: '一等奖', quota: 10, weight: 10 }],
})).data.activity.prizes[0];
ok('带 id 保存同样保留名额', resavedWithId.remaining === 9, String(resavedWithId.remaining));
await api(`/activities/${quotaAct.id}`, 'DELETE');

await api(`/activities/${copy.data.activity.id}`, 'DELETE');
await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败 | 临时活动已删除`);
process.exit(fail ? 1 : 0);
