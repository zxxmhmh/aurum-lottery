/** 收费即发码 + 发码记录自测（临时活动，跑完删除） */
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
  name: `发码测试 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'draft',
  publicRedeem: false,
});
const act = created.data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [{ name: '测试奖', level: '参与奖', quota: 10, weight: 10 }],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 6, prefix: 'TST' });

const free0 = (await api(`/activities/${act.id}/codes`)).data.codes.filter((c) => !c.used && !c.holder).length;
ok('初始空码 6 枚', free0 === 6, String(free0));

const issued = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '发码测试甲',
  phone: '13812345678',
  campus: '海淀校区',
});
ok('发码成功', issued.status === 200 && /^TST-/.test(issued.data.code.code), JSON.stringify(issued.data));
ok('完整手机号写入', issued.data.code.phone === '13812345678');
ok('校区写入', issued.data.code.campus === '海淀校区');
ok('剩余空码 -1', issued.data.freeLeft === free0 - 1);

const exact = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '发码测试甲',
  phone: '138 1234 5678',
  campus: '海淀校区',
});
ok('同名同号 → 直接拒绝', exact.status === 409 && exact.data.code === 'duplicate_exact', JSON.stringify(exact.data));

const sameName = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '发码测试甲',
  phone: '13700001111',
  campus: '海淀校区',
});
ok('仅同名 → 提醒确认', sameName.status === 409 && sameName.data.code === 'duplicate_partial' && /同名学员/.test(sameName.data.error), JSON.stringify(sameName.data));

const forced = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '发码测试甲',
  phone: '13700001111',
  campus: '海淀校区',
  force: true,
});
ok('确认后可以发', forced.status === 200 && /强制发放/.test(forced.data.duplicateWarning), JSON.stringify(forced.data));

const samePhone = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '发码测试乙',
  phone: '13700001111',
  campus: '朝阳校区',
});
ok('仅同手机号 → 提醒确认', samePhone.status === 409 && samePhone.data.code === 'duplicate_partial' && /该手机号/.test(samePhone.data.error), JSON.stringify(samePhone.data));

const noName = await api(`/activities/${act.id}/codes/issue`, 'POST', { phone: '13812345678' });
ok('缺姓名被拒', noName.status === 400, JSON.stringify(noName.data));

const badPhone = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '测试乙', phone: '12' });
ok('手机号格式不对被拒', badPhone.status === 400, JSON.stringify(badPhone.data));

const noPhone = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '测试丙', campus: '朝阳校区' });
ok('缺手机号被拒', noPhone.status === 400, JSON.stringify(noPhone.data));

// 发码记录
const log = await api(`/activities/${act.id}/codes/issue-log`);
ok('发码记录可查', log.status === 200 && log.data.total === 2, JSON.stringify(log.data?.total));
ok('记录含码/姓名/手机/校区/发放人', (() => {
  const first = log.data.entries[0];
  return first.code && first.name === '发码测试甲' && first.phone === '13700001111' && first.campus === '海淀校区' && first.by;
})(), JSON.stringify(log.data.entries[0]));
ok('记录按时间倒序', log.data.entries[0].name === '发码测试甲');

// 权限
async function loginCookie(account, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  let c = '';
  for (const raw of res.headers.getSetCookie?.() || []) {
    const pair = raw.split(';')[0];
    if (pair.startsWith('aurum_sid=')) c = pair;
  }
  return c;
}
async function issueAs(account, password, body) {
  const c = await loginCookie(account, password);
  const res = await fetch(`${BASE}/activities/${act.id}/codes/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: c },
    body: JSON.stringify(body),
  });
  return res.status;
}
ok('抽奖执行角色可以发码', (await issueAs('ops', 'ops123', { name: '运营发的码', phone: '13900001111', campus: '西城校区' })) === 200);
ok('观察员不能发码', (await issueAs('guest', 'guest123', { name: '观察员', phone: '13900002222' })) === 403);

const codesNow = (await api(`/activities/${act.id}/codes`)).data.codes;
ok('校区统计正确', codesNow.filter((c) => c.campus === '海淀校区').length === 2);

const view = (await api(`/activities/${act.id}`)).data.activity;
ok('活动返回已发数量', view.codes.issued >= 3, JSON.stringify(view.codes));

await api(`/activities/${act.id}`, 'PATCH', { status: 'ended' });
const ended = await api(`/activities/${act.id}/codes/issue`, 'POST', { name: '结束后', phone: '13900003333' });
ok('已结束活动不能发码', ended.status === 409, JSON.stringify(ended.data));

await api(`/activities/${act.id}`, 'DELETE');
ok('临时活动已删除', (await api(`/activities/${act.id}`)).status === 404);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
