import fs from 'node:fs';
import { qrMatrix } from '../public/js/qr.js';

const expected = JSON.parse(fs.readFileSync(new URL('./qr-expected.json', import.meta.url), 'utf8'));

let fail = 0;
for (const item of expected) {
  const { modules, size } = qrMatrix(item.text, item.version);
  const exp = item.matrix;
  const diffs = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!!exp[r][c] !== !!modules[r][c]) diffs.push([r, c]);
    }
  }
  if (size !== exp.length || diffs.length) {
    fail += 1;
    console.log(`✗ v${item.version} len=${item.text.length} size=${size}/${exp.length} 差异 ${diffs.length} 格`, diffs.slice(0, 6));
  } else {
    console.log(`✓ v${item.version} len=${item.text.length} size=${size} 完全一致`);
  }
}
process.exit(fail ? 1 : 0);
