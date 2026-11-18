/** 校区预设 + 必填自测（临时活动，跑完删除） */
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
  name: `校区测试 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'active',
  campuses: ['海淀校区', '朝阳校区', ' 海淀校区 ', '', '西城校区'],
  campusRequired: false,
});
const act = created.data.activity;
ok('校区去重/去空', JSON.stringify(act.campuses) === JSON.stringify(['海淀校区', '朝阳校区', '西城校区']), JSON.stringify(act.campuses));

await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [{ name: '测试奖', level: '参与奖', quota: 10, weight: 10 }],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 6, prefix: 'CPS' });

const loose = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '松散甲', phone: '13800001111' });
ok('未开启必填时可以不填校区', loose.status === 200);

const turnOn = await api(`/activities/${act.id}`, 'PATCH', { campusRequired: true });
ok('可以开启必填', turnOn.data.activity.campusRequired === true);

const strict = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '严格乙', phone: '13800002222' });
ok('开启后不填校区被拒', strict.status === 400 && strict.data.code === 'campus_required', JSON.stringify(strict.data));

const withCampus = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '严格丙',
  phone: '13800003333',
  campus: '朝阳校区',
});
ok('选了校区可以发', withCampus.status === 200 && withCampus.data.code.campus === '朝阳校区');

const bindBad = await api(`/activities/${act.id}/codes/bind`, 'POST', {
  entries: [{ name: '批量甲', phone: '13800004444' }],
});
ok('批量绑定缺校区被拒', bindBad.status === 400 && bindBad.data.code === 'campus_required');

const bindOk = await api(`/activities/${act.id}/codes/bind`, 'POST', {
  entries: [{ name: '批量乙', phone: '13800005555', campus: '西城校区' }],
});
ok('批量绑定带校区通过', bindOk.status === 200 && bindOk.data.bound === 1);

const copy = await api(`/activities/${act.id}/duplicate`, 'POST');
ok('复制活动带上校区设置', JSON.stringify(copy.data.activity.campuses) === JSON.stringify(act.campuses)
  && copy.data.activity.campusRequired === true);

const turnOff = await api(`/activities/${act.id}`, 'PATCH', { campusRequired: false });
ok('可以关闭必填', turnOff.data.activity.campusRequired === false);

await api(`/activities/${copy.data.activity.id}`, 'DELETE');
await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败 | 临时活动已删除`);
process.exit(fail ? 1 : 0);
