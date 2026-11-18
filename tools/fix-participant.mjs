/**
 * 一次性修数据：老记录里 participant 被写成了「抽奖码 ZX-XXXX」，
 * 改成该码绑定的持码人姓名（散码则清空）。需要先停服务器再跑。
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('data/db.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

let fixed = 0;
let cleared = 0;

for (const activity of db.activities || []) {
  const byCode = new Map();
  for (const code of activity.codes || []) byCode.set(code.code, code);
  for (const record of db.records || []) {
    if (record.activityId !== activity.id) continue;
    if (!String(record.participant || '').startsWith('抽奖码 ')) continue;
    const code = byCode.get(record.code);
    const holder = code?.holder || '';
    record.participant = holder;
    if (holder) fixed += 1;
    else cleared += 1;
  }
}

fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log(`改名 ${fixed} 条，清空 ${cleared} 条（散码）`);
