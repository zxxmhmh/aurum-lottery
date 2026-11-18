/**
 * 活动二维码海报：1080×1440 竖版，直接能发微信 / 打印贴前台。
 * 纯 Canvas 绘制，不依赖图片资源；二维码用 qr.js 的矩阵逐格画。
 */
import { qrMatrix } from './qr.js';

const W = 1080;
const H = 1440;
const SERIF = '"Songti SC", "SimSun", Georgia, serif';
const SANS = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif';
const INK = '#2b2117';

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

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of Array.from(String(text || ''))) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 在指定矩形内画二维码（白底 + 黑模块），返回实际边长 */
function drawQr(ctx, text, { x, y, size, margin = 3, dark = '#1f1913' }) {
  const { modules, size: n } = qrMatrix(text);
  const total = n + margin * 2;
  const cell = size / total;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!modules[r][c]) continue;
      const x0 = Math.round(x + (c + margin) * cell);
      const x1 = Math.round(x + (c + margin + 1) * cell);
      const y0 = Math.round(y + (r + margin) * cell);
      const y1 = Math.round(y + (r + margin + 1) * cell);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.restore();
  return size;
}

function spaced(ctx, text, x, y, spacing) {
  let cursor = x;
  for (const ch of Array.from(text)) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

/**
 * 生成海报 canvas。
 * @param {{url:string, activityName?:string, subtitle?:string, code?:string, hint?:string}} data
 */
export function renderQrPoster({ url, activityName = '', subtitle = '', code = '', hint = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fffdf8');
  bg.addColorStop(0.55, '#faf3e6');
  bg.addColorStop(1, '#f0e2c9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 90, 30, W / 2, 90, 620);
  glow.addColorStop(0, 'rgba(201, 160, 92, 0.30)');
  glow.addColorStop(1, 'rgba(201, 160, 92, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 760);

  // 装饰圆环
  ctx.save();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(W - 40, 40, 280, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.09)';
  ctx.beginPath();
  ctx.arc(W - 40, 40, 370, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.08)';
  ctx.beginPath();
  ctx.arc(30, H - 40, 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 品牌
  ctx.save();
  roundRect(ctx, 84, 78, 66, 66, 16);
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#a9772f';
  ctx.font = `500 34px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('智', 84 + 33, 78 + 35);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3a2a14';
  ctx.font = `500 30px ${SERIF}`;
  spaced(ctx, 'ZHIXUE', 176, 106, 4);
  ctx.fillStyle = '#8a7f6d';
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText('内部抽奖 · 学员自助开奖', 176, 140);

  // 活动名
  const titleY = 250;
  ctx.textAlign = 'center';
  const titleLines = activityName ? wrapLines(ctx, activityName, W - 220) : [];
  if (titleLines.length) {
    let size = 62;
    while (size > 40) {
      ctx.font = `600 ${size}px ${SANS}`;
      if (wrapLines(ctx, activityName, W - 220).length <= 2) break;
      size -= 4;
    }
    ctx.font = `600 ${size}px ${SANS}`;
    const lines = wrapLines(ctx, activityName, W - 220);
    const titleGrad = ctx.createLinearGradient(0, titleY - 60, 0, titleY + 40);
    titleGrad.addColorStop(0, '#7c5220');
    titleGrad.addColorStop(1, '#b9863c');
    ctx.fillStyle = titleGrad;
    lines.forEach((line, index) => {
      ctx.fillText(line, W / 2, titleY + index * Math.round(size * 1.25));
    });
    if (subtitle) {
      ctx.fillStyle = '#9a8f7d';
      ctx.font = `400 24px ${SANS}`;
      ctx.fillText(subtitle, W / 2, titleY + lines.length * Math.round(size * 1.25) + 6);
    }
  }

  // 二维码白卡
  const qrSize = code ? 460 : 520;
  const cardPad = 46;
  const cardSize = qrSize + cardPad * 2;
  const cardX = (W - cardSize) / 2;
  const cardY = activityName ? (code ? 430 : 470) : (code ? 360 : 380);

  ctx.save();
  ctx.shadowColor = 'rgba(120, 88, 36, 0.22)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cardX, cardY, cardSize, cardSize, 34);
  ctx.fill();
  ctx.restore();

  // 金色内框
  ctx.save();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, cardX + 14, cardY + 14, cardSize - 28, cardSize - 28, 24);
  ctx.stroke();
  ctx.restore();

  drawQr(ctx, url, { x: cardX + cardPad, y: cardY + cardPad, size: qrSize });

  // 码字（单码海报）
  let cursorY = cardY + cardSize;
  if (code) {
    cursorY += 70;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9a8f7d';
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText('抽奖码', W / 2, cursorY - 34);
    ctx.fillStyle = '#8f6224';
    ctx.font = `600 56px ${SERIF}`;
    ctx.fillText(code, W / 2, cursorY + 24);
    cursorY += 40;
  }

  // 提示
  cursorY = code ? cursorY + 66 : Math.max(cursorY + 74, 1100);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `600 38px ${SANS}`;
  ctx.fillText(hint || '扫码进入 · 输入抽奖码开奖', W / 2, cursorY);

  ctx.fillStyle = '#8a7f6d';
  ctx.font = `400 24px ${SANS}`;
  ctx.fillText('一码一次 · 请勿转发给他人', W / 2, cursorY + 48);

  // 底部提示条
  const barW = W - 200;
  const barY = H - 150;
  ctx.save();
  ctx.fillStyle = 'rgba(169, 119, 47, 0.09)';
  roundRect(ctx, (W - barW) / 2, barY, barW, 74, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(169, 119, 47, 0.28)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, (W - barW) / 2, barY, barW, 74, 16);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#8f6224';
  ctx.font = `400 25px ${SANS}`;
  ctx.fillText('奖品以门店实物为准', W / 2, barY + 46);

  ctx.fillStyle = '#b7a689';
  ctx.font = `400 18px ${SANS}`;
  ctx.fillText('ZHIXUE LOTTERY', W / 2, H - 34);

  return canvas;
}

export function downloadPoster(canvas, filename = '活动二维码.png') {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
