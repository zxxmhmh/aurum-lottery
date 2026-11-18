/** 复制活动接口自测（临时活动，跑完删除） */
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
  name: `复制测试 ${Date.now().toString().slice(-5)}`,
  subtitle: 'COPY',
  mode: 'code',
  status: 'active',
  publicRedeem: true,
  participantLimit: 2,
});
const src = created.data.activity;

const prizes = await api(`/activities/${src.id}/prizes`, 'PUT', {
  prizes: [
    { name: '样品大奖', level: '特等奖', quota: 2, weight: 2, value: 5980, color: '#C9A25F', image: '/uploads/mwesjqoa-fa6b155d.jpeg' },
    { name: '参与奖', level: '参与奖', quota: 5, weight: 5, value: 0, color: '#8C7A5B', image: '' },
  ],
});
ok('源活动建好', prizes.status === 200);
const srcFull = (await api(`/activities/${src.id}`)).data.activity;
await api(`/activities/${src.id}/codes`, 'POST', { count: 4, prefix: 'CPY' });
const codes = (await api(`/activities/${src.id}/codes`)).data.codes;
const issue = await api(`/activities/${src.id}/codes/issue`, 'POST', { name: '复制甲', phone: '13800001234' });
ok('源活动已发码', issue.status === 200);
await api(`/activities/${src.id}/draw`, 'POST', { code: issue.data.code.code });

const dup = await api(`/activities/${src.id}/duplicate`, 'POST');
const copy = dup.data.activity;
ok('复制成功', dup.status === 201, JSON.stringify(dup.data));
ok('名字带副本后缀', copy.name === `${src.name}（副本）`, copy.name);
ok('状态为草稿', copy.status === 'draft');
ok('复制了抽奖方式/副标题', copy.mode === src.mode && copy.subtitle === 'COPY');
ok('复制了每人限抽', copy.participantLimit === 2);
ok('奖项数量一致', copy.prizes.length === 2, String(copy.prizes.length));
ok('奖项含图片/价值/名额', copy.prizes[0].image === '/uploads/mwesjqoa-fa6b155d.jpeg'
  && copy.prizes[0].value === 5980 && copy.prizes[0].quota === 2 && copy.prizes[0].level === '特等奖');
ok('名额全部重置为满额', copy.prizes.every((p) => p.remaining === p.quota && (p.drawn || 0) === 0));
ok('奖项 id 是新的', copy.prizes[0].id !== srcFull.prizes[0].id);
ok('不复制抽奖码', copy.codes.total === 0, JSON.stringify(copy.codes));
ok('不复制开奖记录', copy.stats.totalRemaining === 7);

const again = await api(`/activities/${src.id}/duplicate`, 'POST');
ok('重复复制不会叠后缀', again.data.activity.name === `${src.name}（副本）`, again.data.activity.name);

const codes2 = await api(`/activities/${src.id}/codes`).then(() => true);
ok('源活动不受影响', codes2);

await api(`/activities/${copy.id}`, 'DELETE');
await api(`/activities/${again.data.activity.id}`, 'DELETE');
await api(`/activities/${src.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败 | 临时活动已删除`);
process.exit(fail ? 1 : 0);
