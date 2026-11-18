import fs from 'node:fs';
import { qrMatrix } from '../public/js/qr.js';

const expected = JSON.parse(fs.readFileSync(new URL('../.tmp/qr-expected.json', import.meta.url), 'utf8'));
const item = expected[1];
const { modules, size } = qrMatrix(item.text, item.version);
const exp = item.matrix;

const fmtPositions = [
  ...Array.from({ length: 6 }, (_, i) => [8, i]),
  [8, 7],
  [8, 8],
  [7, 8],
  ...Array.from({ length: 6 }, (_, i) => [5 - i, 8]),
];

console.log('size', size);
fmtPositions.forEach(([r, c], i) => {
  const mine = modules[r][c] ? 1 : 0;
  const theirs = exp[r][c] ? 1 : 0;
  console.log(`bit${i} @(${r},${c}) mine=${mine} py=${theirs} ${mine === theirs ? '' : '  <<<'}`);
});

const diffs = [];
for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (!!exp[r][c] !== !!modules[r][c]) diffs.push(`(${r},${c})`);
console.log('all diffs:', diffs.join(' '));
