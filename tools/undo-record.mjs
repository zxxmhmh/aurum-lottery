/** 撤销 test-redeem 误抽的真实记录（按 code 精确匹配，只删最新一条） */
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
const code = process.argv[2];
if (!code) {
  console.log('usage: node tools/undo-record.mjs <CODE>');
  process.exit(1);
}
const { data } = await api('/activities');
const act = data.activities[0];
const rec = await api(`/records?activityId=${act.id}&q=${encodeURIComponent(code)}&limit=20`);
const target = (rec.data.records || []).find((r) => r.code === code);
if (!target) {
  console.log('没有找到该码的记录');
  process.exit(0);
}
const del = await api(`/records/${target.id}`, 'DELETE');
console.log('已撤销', code, target.prizeName, del.status);
