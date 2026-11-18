/** 把抽出来的奖项样品图上传，并挂到活动的 7 个奖项上（按等级匹配） */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:5180/api';
const DIR = path.resolve('.tmp/prize-images');
let cookie = '';

async function api(p, method = 'GET', body) {
  const res = await fetch(BASE + p, {
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
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin', password: 'admin123' }),
});
for (const c of login.headers.getSetCookie?.() || []) {
  const pair = c.split(';')[0];
  if (pair.startsWith('aurum_sid=')) cookie = pair;
}

const { activities } = await api('/activities');
const activity = activities.find((a) => a.mode === 'code') || activities[0];
console.log('活动:', activity.name, '| 奖项', activity.prizes.length);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort();
const byLevel = new Map();
for (const file of files) {
  const level = file.replace(/^\d+-/, '').replace(/\.jpg$/, '');
  byLevel.set(level, path.join(DIR, file));
}

const uploaded = new Map();
for (const [level, file] of byLevel) {
  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  const res = await api('/uploads', 'POST', { dataUrl });
  uploaded.set(level, res.url);
  console.log(`上传 ${level}: ${res.url} (${Math.round(res.bytes / 1024)}KB)`);
}

const prizes = activity.prizes.map((p) => ({
  id: p.id,
  name: p.name,
  level: p.level,
  quota: p.quota,
  weight: p.weight,
  color: p.color,
  image: uploaded.get(p.level) || p.image || '',
}));

const missing = prizes.filter((p) => !p.image);
const saved = await api(`/activities/${activity.id}/prizes`, 'PUT', { prizes });
console.log('已挂图:', saved.activity.prizes.filter((p) => p.image).length, '/', saved.activity.prizes.length);
if (missing.length) console.log('没匹配到图片的奖项:', missing.map((p) => p.level + ' ' + p.name).join(', '));
console.log(
  saved.activity.prizes.map((p) => `  ${p.level} ${p.name} → ${p.image || '（无图）'}`).join('\n'),
);
