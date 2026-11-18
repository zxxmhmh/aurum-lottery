/**
 * 极简二维码生成器（字节模式 / 纠错等级 M / 版本 1–6 / 掩码 0）
 * 只依赖标准库，输出布尔矩阵或 SVG 字符串；已用 Python qrcode 做过逐格比对。
 */

const EC_BLOCKS_M = {
  1: [[1, 26, 16]],
  2: [[1, 44, 28]],
  3: [[1, 70, 44]],
  4: [[2, 50, 32]],
  5: [[2, 67, 43]],
  6: [[4, 43, 27]],
};

const ALIGN_POS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

/* ---------------------------------------------------------------- GF(256) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const res = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecCount; i += 1) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

/* ------------------------------------------------------------------ data */

function buildCodewords(bytes, version) {
  const blocks = EC_BLOCKS_M[version];
  const totalData = blocks.reduce((sum, [count, , dataCount]) => sum + count * dataCount, 0);

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);

  const capacity = totalData * 8;
  if (bits.length > capacity) throw new Error('内容过长，无法生成二维码');
  for (let i = 0; i < Math.min(4, capacity - bits.length); i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  const pad = [0xec, 0x11];
  while (data.length < totalData) data.push(pad[(data.length - bits.length / 8) % 2]);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, totalCount, dataCount] of blocks) {
    const ecCount = totalCount - dataCount;
    for (let i = 0; i < count; i += 1) {
      const chunk = data.slice(offset, offset + dataCount);
      offset += dataCount;
      dataBlocks.push(chunk);
      ecBlocks.push(rsEncode(chunk, ecCount));
    }
  }

  const result = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  const maxEc = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEc; i += 1) {
    for (const block of ecBlocks) if (i < block.length) result.push(block[i]);
  }
  return result;
}

/* ---------------------------------------------------------------- matrix */

function pickVersion(byteLength) {
  for (let version = 1; version <= 6; version += 1) {
    const dataCount = EC_BLOCKS_M[version].reduce((sum, [count, , size]) => sum + count * size, 0);
    if (4 + 8 + byteLength * 8 <= dataCount * 8) return version;
  }
  throw new Error('内容过长，无法生成二维码');
}

function makeMatrix(text, forcedVersion) {
  const bytes = new TextEncoder().encode(String(text));
  const version = forcedVersion || pickVersion(bytes.length);
  const size = 17 + version * 4;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (row, col, dark) => {
    modules[row][col] = dark;
    reserved[row][col] = true;
  };

  // 定位图形（7×7，含 1 格白边分隔符）
  const drawFinder = (r0, c0) => {
    for (let i = 0; i < 7; i += 1) {
      for (let j = 0; j < 7; j += 1) {
        const dark = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        set(r0 + i, c0 + j, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 分隔符（白色 1 格）
  const white = (r, c) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    if (reserved[r][c]) return;
    set(r, c, false);
  };
  for (let i = 0; i < 8; i += 1) {
    white(7, i); // 左上：下方
    white(i, 7); // 左上：右侧
    white(7, size - 1 - i); // 右上：下方
    white(i, size - 8); // 右上：左侧
    white(size - 8, i); // 左下：上方
    white(size - 1 - i, 7); // 左下：右侧
  }

  // 定时图形
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // 校正图形
  const positions = ALIGN_POS[version];
  for (const r of positions) {
    for (const c of positions) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          set(r + dr, c + dc, dark);
        }
      }
    }
  }

  // 固定的深浅模块 + 预留格式信息区
  set(size - 8, 8, true);
  const reserveFormat = () => {
    for (let i = 0; i <= 8; i += 1) {
      if (!reserved[8][i]) {
        modules[8][i] = false;
        reserved[8][i] = true;
      }
      if (!reserved[i][8]) {
        modules[i][8] = false;
        reserved[i][8] = true;
      }
    }
    for (let i = 0; i < 8; i += 1) {
      if (!reserved[8][size - 1 - i]) {
        modules[8][size - 1 - i] = false;
        reserved[8][size - 1 - i] = true;
      }
      if (!reserved[size - 1 - i][8]) {
        modules[size - 1 - i][8] = false;
        reserved[size - 1 - i][8] = true;
      }
    }
  };
  reserveFormat();

  // 数据位填充（之字形）
  const codewords = buildCodewords(bytes, version);
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((cw >> i) & 1);

  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    const rows = upward ? [...Array(size).keys()].reverse() : [...Array(size).keys()];
    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        bitIndex += 1;
        // 掩码 0：(row + col) % 2 === 0 时翻转
        modules[row][c] = (row + c) % 2 === 0 ? !bit : bit;
      }
    }
    upward = !upward;
  }

  // 格式信息：纠错等级 M(00) + 掩码 000
  const formatData = 0b00000;
  let rem = formatData << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  const formatBits = ((formatData << 10) | (rem & 0x3ff)) ^ 0x5412;

  const bitAt = (n) => ((formatBits >> (14 - n)) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) modules[8][i] = bitAt(i);
  modules[8][7] = bitAt(6);
  modules[8][8] = bitAt(7);
  modules[7][8] = bitAt(8);
  for (let i = 9; i <= 14; i += 1) modules[14 - i][8] = bitAt(i);
  for (let i = 0; i <= 7; i += 1) modules[size - 1 - i][8] = bitAt(i);
  for (let i = 8; i <= 14; i += 1) modules[8][size - 15 + i] = bitAt(i);
  modules[size - 8][8] = true;

  return { modules, size, version };
}

/* ---------------------------------------------------------------- public */

export function qrMatrix(text, version) {
  return makeMatrix(text, version);
}

export function qrSvg(text, { size = 220, margin = 4, dark = '#241d15', light = 'none', version } = {}) {
  const { modules, size: n } = makeMatrix(text, version);
  const total = n + margin * 2;
  const parts = [];
  for (let r = 0; r < n; r += 1) {
    let run = 0;
    for (let c = 0; c <= n; c += 1) {
      const on = c < n && modules[r][c];
      if (on) {
        run += 1;
      } else if (run) {
        parts.push(`M${c - run + margin} ${r + margin}h${run}v1h-${run}z`);
        run = 0;
      }
    }
  }
  const bg = light === 'none' ? '' : `<rect width="${total}" height="${total}" fill="${light}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">${bg}<path d="${parts.join('')}" fill="${dark}"/></svg>`;
}

/** 位图二维码（PNG）：普通用户能直接打开、拖进 Word/微信，不像 SVG 那样尴尬 */
export function qrPngDataUrl(text, { size = 1024, margin = 4, dark = '#241d15', light = '#ffffff', version } = {}) {
  const { modules, size: n } = makeMatrix(text, version);
  const total = n + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dark;
  const cell = size / total;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!modules[r][c]) continue;
      const x0 = Math.round((c + margin) * cell);
      const x1 = Math.round((c + margin + 1) * cell);
      const y0 = Math.round((r + margin) * cell);
      const y1 = Math.round((r + margin + 1) * cell);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  return canvas.toDataURL('image/png');
}
