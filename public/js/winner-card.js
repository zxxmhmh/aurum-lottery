/**
 * 中奖卡片：用 Canvas 画一张 1080×1440 的领奖图，导出 JPG。
 * 不依赖任何库，字体用系统字体。
 */

const W = 1080;
const H = 1440;
const SERIF = '"Songti SC", "SimSun", Georgia, serif';
const SANS = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const char of Array.from(String(text || ''))) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(ctx, text, { maxWidth, size, minSize, font, color, maxLines = 2, lineHeight = 1.25 }) {
  let current = size;
  while (current > minSize) {
    ctx.font = `${font.weight || 600} ${current}px ${font.family || SANS}`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { lines, size: current };
    current -= 4;
  }
  ctx.font = `${font.weight || 600} ${current}px ${font.family || SANS}`;
  return { lines: wrapText(ctx, text, maxWidth), size: current };
}

function drawDashedLine(ctx, x1, y, x2, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function spaced(ctx, text, x, y, spacing) {
  let cursor = x;
  for (const char of Array.from(text)) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

export async function renderWinnerCard({
  activityName = '',
  level = '',
  prizeName = '',
  image = '',
  value = 0,
  holder = '',
  code = '',
  at = Date.now(),
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fffdf8');
  bg.addColorStop(0.55, '#faf3e6');
  bg.addColorStop(1, '#f2e5cf');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 金色光晕
  const glow = ctx.createRadialGradient(W / 2, 120, 40, W / 2, 120, 620);
  glow.addColorStop(0, 'rgba(201, 160, 92, 0.32)');
  glow.addColorStop(1, 'rgba(201, 160, 92, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 760);

  // 装饰圆环
  ctx.save();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(W - 60, 80, 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.1)';
  ctx.beginPath();
  ctx.arc(W - 60, 80, 380, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 品牌
  ctx.fillStyle = '#a9772f';
  ctx.font = `500 26px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText('ZHIXUE', 80, 104);
  ctx.fillStyle = '#8a7f6d';
  ctx.font = `400 24px ${SANS}`;
  ctx.fillText('内部抽奖', 80, 144);

  // 顶部小标题
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9a8f7d';
  ctx.font = `400 26px ${SANS}`;
  spaced(ctx, 'LUCKY WINNER', W / 2 - 118, 232, 6);

  // 恭喜中奖
  const headline = ctx.createLinearGradient(0, 260, 0, 360);
  headline.addColorStop(0, '#7c5220');
  headline.addColorStop(1, '#b9863c');
  ctx.fillStyle = headline;
  ctx.font = `600 86px ${SANS}`;
  ctx.fillText('恭喜你中奖啦', W / 2, 352);

  // 奖品图
  const img = await loadImage(image);
  const frameY = 410;
  const frameW = 640;
  const frameH = 380;
  const frameX = (W - frameW) / 2;
  if (img) {
    ctx.save();
    ctx.shadowColor = 'rgba(120, 88, 36, 0.18)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, frameX, frameY, frameW, frameH, 28);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, frameX + 10, frameY + 10, frameW - 20, frameH - 20, 20);
    ctx.clip();
    const scale = Math.min((frameW - 24) / img.width, (frameH - 24) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, frameX + (frameW - dw) / 2, frameY + (frameH - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(169, 119, 47, 0.08)';
    roundRect(ctx, frameX, frameY, frameW, frameH, 28);
    ctx.fill();
    ctx.fillStyle = '#b7a689';
    ctx.font = `400 26px ${SANS}`;
    ctx.fillText('奖品实物以门店为准', W / 2, frameY + frameH / 2 + 9);
    ctx.restore();
  }

  // 等级胶囊（有标价就一起显示）
  const chipY = 838;
  const chipText = Number(value) > 0
    ? `${level} · ¥${Number(value).toLocaleString('zh-CN')}`
    : level;
  if (chipText) {
    ctx.font = `500 30px ${SANS}`;
    const chipW = Math.max(160, ctx.measureText(chipText).width + 76);
    ctx.fillStyle = 'rgba(169, 119, 47, 0.12)';
    roundRect(ctx, (W - chipW) / 2, chipY, chipW, 58, 29);
    ctx.fill();
    ctx.strokeStyle = 'rgba(169, 119, 47, 0.42)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, (W - chipW) / 2, chipY, chipW, 58, 29);
    ctx.stroke();
    ctx.fillStyle = '#8f6224';
    ctx.textAlign = 'center';
    ctx.fillText(chipText, W / 2, chipY + 39);
  }

  // 奖品名（放不下自动缩）
  const name = fitText(ctx, prizeName, {
    maxWidth: W - 200,
    size: 64,
    minSize: 40,
    font: { weight: 600, family: SANS },
    maxLines: 2,
  });
  const nameGrad = ctx.createLinearGradient(0, 940, 0, 1030);
  nameGrad.addColorStop(0, '#7c5220');
  nameGrad.addColorStop(1, '#b9863c');
  ctx.fillStyle = nameGrad;
  ctx.textAlign = 'center';
  name.lines.forEach((line, index) => {
    ctx.fillText(line, W / 2, 966 + index * Math.round(name.size * 1.26));
  });

  // 活动名
  const activityY = 1064;
  ctx.fillStyle = '#8a7f6d';
  ctx.font = `400 28px ${SANS}`;
  ctx.fillText(activityName, W / 2, activityY);

  // 分割虚线
  drawDashedLine(ctx, 120, 1108, W - 120, 'rgba(58, 42, 22, 0.22)');

  // 码 / 持码人 / 时间（没有持码人就跳过，不留空行）
  const rows = [{ label: '抽奖码', value: code || '—', size: 34, serif: true }];
  if (holder) rows.push({ label: '持码人', value: holder, size: 30, serif: false });
  rows.push({ label: '开奖时间', value: whenText(at), size: 26, serif: false });

  let rowY = 1160;
  for (const row of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9a8f7d';
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText(row.label, 120, rowY);

    ctx.textAlign = 'right';
    ctx.fillStyle = row.serif ? '#3a2a14' : '#4a3a26';
    ctx.font = `500 ${row.size}px ${row.serif ? SERIF : SANS}`;
    ctx.fillText(row.value, W - 120, rowY + (row.serif ? 2 : 0));
    rowY += 56;
  }

  // 底部提示
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(169, 119, 47, 0.1)';
  roundRect(ctx, 110, 1308, W - 220, 84, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.35)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 110, 1308, W - 220, 84, 18);
  ctx.stroke();
  ctx.fillStyle = '#8f6224';
  ctx.font = `500 28px ${SANS}`;
  ctx.fillText('请出示本图到门店前台领取奖品', W / 2, 1361);

  ctx.fillStyle = '#b7a689';
  ctx.font = `400 20px ${SANS}`;
  ctx.fillText('ZHIXUE LOTTERY · 奖品以门店实物为准', W / 2, 1424);

  return canvas;
}

export function downloadCanvas(canvas, filename = 'winner.jpg') {
  const url = canvas.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 微信 / iOS 里 <a download> 不生效，改成「显示大图 + 长按保存」 */
export function needsSaveSheet() {
  const ua = navigator.userAgent || '';
  if (/MicroMessenger/i.test(ua)) return true;
  if (/iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return true;
  return false;
}

async function uploadCard(dataUrl) {
  try {
    const res = await fetch('/api/public/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.url || '';
  } catch {
    return '';
  }
}

function whenText(at) {
  const date = new Date(Number(at) || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function showSaveSheet(url, when = '') {
  const root = document.createElement('div');
  root.className = 'save-sheet';
  root.innerHTML = `
    <div class="save-sheet-mask"></div>
    <div class="save-sheet-body">
      <img src="${url}" alt="领奖图" />
      ${when ? `<p class="save-sheet-date">${when}</p>` : ''}
      <p class="save-sheet-hint">长按图片 → 保存到相册</p>
      <button class="btn btn--ghost btn--sm" type="button" data-close>关闭</button>
    </div>
  `;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('is-open'));
  const close = () => {
    root.classList.remove('is-open');
    setTimeout(() => root.remove(), 220);
  };
  root.querySelector('[data-close]').addEventListener('click', close);
  root.querySelector('.save-sheet-mask').addEventListener('click', close);
}

export async function saveWinnerCard(data, filename) {
  const canvas = await renderWinnerCard(data);
  if (needsSaveSheet()) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const url = (await uploadCard(dataUrl)) || dataUrl;
    showSaveSheet(url, whenText(data.at));
    return 'sheet';
  }
  downloadCanvas(canvas, filename || `中奖-${data.code || ''}.jpg`);
  return 'download';
}
