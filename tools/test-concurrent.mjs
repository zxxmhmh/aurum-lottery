/** 并发安全自测：同时发码 / 同时抽奖（临时活动，跑完删除） */
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

/* ---------- 1. 40 个老师同时点「发码」 ---------- */
const codeAct = (await api('/activities', 'POST', {
  name: `并发发码 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'active',
  publicRedeem: true,
  campuses: ['海淀校区'],
})).data.activity;
await api(`/activities/${codeAct.id}/prizes`, 'PUT', {
  prizes: [{ name: '并发奖', level: '参与奖', quota: 100, weight: 100 }],
});
await api(`/activities/${codeAct.id}/codes`, 'POST', { count: 60, prefix: 'CON' });

const before = (await api(`/activities/${codeAct.id}/codes/summary`)).data;
const issueReq = Array.from({ length: 40 }, (_, i) =>
  api(`/activities/${codeAct.id}/codes/issue`, 'POST', {
    name: `并发学员${i}`,
    phone: `1390000${String(i).padStart(4, '0')}`,
    campus: '海淀校区',
  }),
);
const issueRes = await Promise.all(issueReq);
const okIssues = issueRes.filter((r) => r.status === 200);
const codes = okIssues.map((r) => r.data.code.code);
ok('40 个并发发码全部成功', okIssues.length === 40, `${okIssues.length}`);
ok('发出的码互不重复', new Set(codes).size === 40, `去重后 ${new Set(codes).size}`);
const after = (await api(`/activities/${codeAct.id}/codes/summary`)).data;
ok('剩余空码精确减少 40', before.free - after.free === 40, `${before.free} → ${after.free}`);
const log = (await api(`/activities/${codeAct.id}/codes/issue-log`)).data;
ok('发码记录也是 40 条', log.total === 40, String(log.total));

/* ---------- 2. 同一个学员被 10 个请求同时发码 ---------- */
const sameReq = Array.from({ length: 10 }, () =>
  api(`/activities/${codeAct.id}/codes/issue`, 'POST', { name: '同一人', phone: '13811112222' }),
);
const sameRes = await Promise.all(sameReq);
const sameOk = sameRes.filter((r) => r.status === 200).length;
ok('同一学员并发只成功 1 次', sameOk === 1, `成功 ${sameOk} 次`);

/* ---------- 3. 同一枚码被 15 个人同时开奖 ---------- */
const target = (await api(`/activities/${codeAct.id}/codes/issue`, 'POST', {
  name: '抢码甲',
  phone: '13700001111',
  campus: '海淀校区',
})).data.code.code;
const redeemReq = Array.from({ length: 15 }, () =>
  fetch(`${BASE}/public/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: target, phone: '13700001111' }),
  }).then((r) => r.status),
);
const redeemRes = await Promise.all(redeemReq);
const wins = redeemRes.filter((s) => s === 200).length;
const conflicts = redeemRes.filter((s) => s === 409).length;
ok('同一枚码并发开奖只成功 1 次', wins === 1, `成功 ${wins}`);
ok('其余 14 次返回 409', conflicts === 14, `409 ${conflicts} 次`);

/* ---------- 4. 一个奖项只剩 10 个名额，30 个人同时抽 ---------- */
const quotaAct = (await api('/activities', 'POST', {
  name: `并发抽奖 ${Date.now().toString().slice(-5)}`,
  mode: 'quota',
  status: 'active',
})).data.activity;
const prize = (await api(`/activities/${quotaAct.id}/prizes`, 'PUT', {
  prizes: [{ name: '限量奖', level: '一等奖', quota: 10, weight: 10 }],
})).data.activity.prizes[0];
const drawReq = Array.from({ length: 30 }, () =>
  api(`/activities/${quotaAct.id}/draw`, 'POST', { prizeId: prize.id }),
);
const drawRes = await Promise.all(drawReq);
const drawOk = drawRes.filter((r) => r.status === 200).length;
const drawFull = drawRes.filter((r) => r.status === 409).length;
ok('30 个并发抽奖只发出 10 个名额', drawOk === 10, `成功 ${drawOk}`);
ok('其余 20 次提示名额抽完', drawFull === 20, `409 ${drawFull} 次`);
const afterQuota = (await api(`/activities/${quotaAct.id}`)).data.activity;
ok('奖项剩余精确为 0', afterQuota.prizes[0].remaining === 0, String(afterQuota.prizes[0].remaining));
const recCount = (await api(`/records?activityId=${quotaAct.id}&limit=100`)).data.total;
ok('开奖记录正好 10 条', recCount === 10, String(recCount));

/* ---------- 清理 ---------- */
await api(`/activities/${quotaAct.id}`, 'DELETE');
await api(`/activities/${codeAct.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败 | 临时活动已删除`);
process.exit(fail ? 1 : 0);
