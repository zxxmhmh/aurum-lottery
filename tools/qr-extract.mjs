import fs from 'node:fs';
import { qrMatrix } from '../public/js/qr.js';

const expected = JSON.parse(fs.readFileSync(new URL('../.tmp/qr-expected.json', import.meta.url), 'utf8'));

function extract(matrix, version) {
  const size = matrix.length;
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => {
    if (r >= 0 && r < size && c >= 0 && c < size) reserved[r][c] = true;
  };
  for (let i = 0; i < 7; i += 1) for (let j = 0; j < 7; j += 1) { mark(i, j); mark(i, size - 7 + j); mark(size - 7 + i, j); }
  for (let i = 0; i < 8; i += 1) { mark(7, i); mark(i, 7); mark(7, size - 1 - i); mark(i, size - 8); mark(size - 8, i); mark(size - 1 - i, 7); }
  for (let i = 8; i < size - 8; i += 1) { mark(6, i); mark(i, 6); }
  const positions = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] }[version] || [];
  for (const r of positions) for (const c of positions) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
  }
  mark(size - 8, 8);
  for (let i = 0; i <= 8; i += 1) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i += 1) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }

  const bits = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    const rows = upward ? [...Array(size).keys()].reverse() : [...Array(size).keys()];
    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        let bit = matrix[row][c] ? 1 : 0;
        if ((row + c) % 2 === 0) bit ^= 1;
        bits.push(bit);
      }
    }
    upward = !upward;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  return bytes;
}

for (const item of expected) {
  const py = extract(item.matrix, item.version);
  const mine = qrMatrix(item.text, item.version);
  const my = extract(mine.modules.map((r) => r.map((v) => (v ? 1 : 0))), item.version);
  const firstDiff = py.findIndex((v, i) => v !== my[i]);
  console.log(
    `v${item.version} len=${item.text.length} py[0..6]=${py.slice(0, 6)} my=${my.slice(0, 6)} firstDiff=${firstDiff}`,
  );
}
