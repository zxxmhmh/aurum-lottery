/** 建一个带样品图的临时活动，用于截图 */
import fs from 'node:fs';

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
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

await api('/auth/login', 'POST', { account: 'admin', password: 'admin123' });

if (process.argv[2] === 'cleanup') {
  const { data } = await api('/activities');
  for (const a of data.activities) {
    if (a.name.startsWith('预览')) await api(`/activities/${a.id}`, 'DELETE');
  }
  console.log('cleaned');
  process.exit(0);
}

const raw = fs.readFileSync(new URL('../.tmp/sample.jpg', import.meta.url));
const dataUrl = `data:image/jpeg;base64,${raw.toString('base64')}`;
const upload = await api('/uploads', 'POST', { dataUrl });

const created = await api('/activities', 'POST', {
  name: '预览 · 七周年抽奖',
  subtitle: 'PREVIEW',
  mode: 'code',
  status: 'active',
  publicRedeem: true,
});
const act = created.data.activity;
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [
    { name: '安目佳读写台', level: '特等奖', quota: 1, weight: 1, color: '#C9A25F', image: upload.data.url },
    { name: '拍立得', level: '一等奖', quota: 3, weight: 3, color: '#B8863B', image: upload.data.url },
    { name: '握力器', level: '参与奖', quota: 20, weight: 20, color: '#8C7A5B' },
  ],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 10, prefix: 'PV' });
const issued = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '陈知微',
  phone: '13801234567',
  campus: '海淀校区',
});
const redeem = await fetch(`${BASE}/public/redeem`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: issued.data.code.code, phone: '13801234567' }),
}).then((r) => r.json());

console.log(JSON.stringify({ id: act.id, code: issued.data.code.code, image: upload.data.url, prize: redeem.prize }));
