/* 开奖礼花：Canvas 粒子，只在有粒子时跑循环 */

const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let particles = [];
let raf = null;
let last = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

resize();
window.addEventListener('resize', resize);

const PALETTES = {
  light: ['#b0792d', '#8a5a1c', '#d0a45c', '#e7cb95', '#a9772f', '#f2dfba'],
  dark: ['#f6e8c6', '#e3c288', '#cda868', '#b78f4f', '#fff8e7', '#f0d9a8'],
};

function palette() {
  return document.documentElement.dataset.theme === 'dark' ? PALETTES.dark : PALETTES.light;
}

function spawn(x, y, count, colors, power) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.9 + Math.random() * 4.4) * power;
    const rect = Math.random() > 0.45;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.6 * power,
      gravity: 0.055 + Math.random() * 0.05,
      drag: 0.985,
      size: rect ? 3 + Math.random() * 5 : 1.4 + Math.random() * 2.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.24,
      life: 1,
      decay: 0.0075 + Math.random() * 0.008,
      shape: rect ? 'rect' : 'dot',
    });
  }
}

function frame(now) {
  const dt = Math.min(34, now - last || 16);
  last = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 60);
  for (const p of particles) {
    const step = dt / 16.67;
    p.vy += p.gravity * step;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.rotation += p.vr * step;
    p.life -= p.decay * step;

    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  if (particles.length) {
    raf = requestAnimationFrame(frame);
  } else {
    raf = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function burstAt(x, y, { count = 120, colors = palette(), power = 1 } = {}) {
  spawn(x, y, count, colors, power);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

export function celebrate() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = w / 2;
  const y = h * 0.42;
  burstAt(x, y, { count: 90, power: 1.15 });
  setTimeout(() => burstAt(x - w * 0.18, y + 40, { count: 44, power: 0.85 }), 120);
  setTimeout(() => burstAt(x + w * 0.18, y + 40, { count: 44, power: 0.85 }), 220);
}
