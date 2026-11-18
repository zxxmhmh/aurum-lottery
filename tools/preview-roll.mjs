/** 临时活动：验证手动开始/停止 + 学员端滚动动画 */
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
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

await api('/auth/login', 'POST', { account: 'admin', password: 'admin123' });

if (process.argv[2] === 'cleanup') {
  const { data } = await api('/activities');
  for (const a of data.activities) {
    if (a.name.startsWith('预览 · 滚动')) {
      await api(`/activities/${a.id}`, 'DELETE');
      console.log('deleted', a.id);
    }
  }
  process.exit(0);
}

const created = await api('/activities', 'POST', {
  name: '预览 · 滚动测试',
  subtitle: 'ROLL TEST',
  mode: 'code',
  status: 'active',
  publicRedeem: true,
});
const act = created.data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [
    { name: '安目佳读写台', level: '特等奖', quota: 1, weight: 1, color: '#C9A25F' },
    { name: '拍立得', level: '一等奖', quota: 2, weight: 2, color: '#B8863B' },
    { name: '握力器', level: '参与奖', quota: 7, weight: 7, color: '#8C7A5B' },
  ],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 10, prefix: 'TST' });
const issued = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '陈知微',
  phone: '13801234567',
  campus: '海淀校区',
});
console.log(JSON.stringify({ id: act.id, code: issued.data.code.code }));
