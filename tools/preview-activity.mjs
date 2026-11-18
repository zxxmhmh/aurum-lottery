/** 建一个临时活动用于截图/演示（跑完删除），并造几条发码记录 */
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

await api('/auth/login', 'POST', { account: 'admin', password: 'admin123' });
const mode = process.argv[2] || 'create';

if (mode === 'cleanup') {
  const { data } = await api('/activities');
  for (const a of data.activities) {
    if (a.name.startsWith('预览')) {
      await api(`/activities/${a.id}`, 'DELETE');
      console.log('已删除', a.name, a.id);
    }
  }
  process.exit(0);
}

const created = await api('/activities', 'POST', {
  name: '预览 · 七周年发码',
  subtitle: 'PREVIEW',
  mode: 'code',
  status: 'active',
  publicRedeem: true,
});
const act = created.data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [
    { name: '安目佳读写台', level: '特等奖', quota: 1, weight: 1 },
    { name: '拍立得', level: '一等奖', quota: 3, weight: 3 },
  ],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 12, prefix: 'PV' });

const entries = [
  { name: '陈知微', phone: '13801234567', campus: '海淀校区' },
  { name: '苏晚', phone: '13905671234', campus: '朝阳校区' },
  { name: '顾行舟', phone: '13709876543', campus: '海淀校区' },
  { name: '江令仪', phone: '13611223344', campus: '西城校区' },
];
for (const entry of entries) {
  await api(`/activities/${act.id}/codes/issue`, 'POST', entry);
}

// 让其中一枚被抽掉，记录里显示「已抽」
const codes = (await api(`/activities/${act.id}/codes`)).data.codes;
const first = codes.find((c) => c.holder === '陈知微');
if (first) await api('/public/redeem', 'POST', { code: first.code, phone: '13801234567' }, false);

console.log(JSON.stringify({ id: act.id, name: act.name, codes: codes.length }));
