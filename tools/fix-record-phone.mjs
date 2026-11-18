/** 一次性回填：老的开奖记录没有 phone 字段，从对应抽奖码上补。需要先停服务器。 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('data/db.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

let filled = 0;
for (const activity of db.activities || []) {
  const byCode = new Map();
  for (const code of activity.codes || []) byCode.set(code.code, code);
  for (const record of db.records || []) {
    if (record.activityId !== activity.id) continue;
    if (record.phone) continue;
    if (!record.code) continue;
    const phone = byCode.get(record.code)?.phone || '';
    if (phone) {
      record.phone = phone;
      filled += 1;
    } else if (!('phone' in record)) {
      record.phone = '';
    }
  }
}

fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log(`补手机号 ${filled} 条`);
