/** 上传 + 奖项样品图 + 中奖卡 自测（临时活动） */
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

const raw = fs.readFileSync(new URL('../.tmp/sample.jpg', import.meta.url));
const dataUrl = `data:image/jpeg;base64,${raw.toString('base64')}`;
const upload = await api('/uploads', 'POST', { dataUrl });
ok('上传图片', upload.status === 200 && /^\/uploads\/.+\.jpeg$/.test(upload.data.url), JSON.stringify(upload.data));

const imgRes = await fetch(`http://127.0.0.1:5180${upload.data.url}`);
ok('图片可访问', imgRes.status === 200 && String(imgRes.headers.get('content-type')).includes('image/jpeg'));

const bad = await api('/uploads', 'POST', { dataUrl: 'data:text/plain;base64,aGk=' });
ok('非图片被拒', bad.status === 400);

const created = await api('/activities', 'POST', {
  name: `图片测试 ${Date.now().toString().slice(-5)}`,
  mode: 'code',
  status: 'active',
  publicRedeem: true,
});
const act = created.data.activity;

const prizes = await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [
    { name: '样品大奖', level: '一等奖', quota: 2, weight: 2, color: '#C9A25F', image: upload.data.url },
    { name: '无图奖品', level: '参与奖', quota: 3, weight: 3 },
  ],
});
ok('奖项写入样品图', prizes.data.activity.prizes[0].image === upload.data.url);
ok('无图奖项不会被写脏', prizes.data.activity.prizes[1].image === '');

const badImage = await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [{ name: '坏图', level: '一等奖', quota: 1, weight: 1, image: 'https://evil.example/x.jpg' }],
});
ok('非法图片地址被拒', badImage.status === 400, JSON.stringify(badImage.data));

// 恢复奖项
await api(`/activities/${act.id}/prizes`, 'PUT', {
  prizes: [
    { name: '样品大奖', level: '一等奖', quota: 2, weight: 2, color: '#C9A25F', image: upload.data.url },
    { name: '无图奖品', level: '参与奖', quota: 3, weight: 3 },
  ],
});
await api(`/activities/${act.id}/codes`, 'POST', { count: 4, prefix: 'IMG' });
const codes = (await api(`/activities/${act.id}/codes`)).data.codes.filter((c) => !c.used && !c.holder);
const issue = await api(`/activities/${act.id}/codes/issue`, 'POST', {
  name: '图片测试员',
  phone: '13800001234',
  campus: '海淀校区',
});
ok('发码成功', issue.status === 200, JSON.stringify(issue.data));

const redeem = await api('/public/redeem', 'POST', { code: issue.data.code.code, phone: '13800001234' }, false);
ok('开奖结果带奖品图', redeem.status === 200 && redeem.data.prize.image === upload.data.url, JSON.stringify(redeem.data?.prize));
ok('结果带活动名/码/时间', Boolean(redeem.data.activityName && redeem.data.code && redeem.data.at));

await api(`/activities/${act.id}`, 'DELETE');
console.log(`\n结果：${pass} 通过 / ${fail} 失败 | 临时活动已删除`);
process.exit(fail ? 1 : 0);
