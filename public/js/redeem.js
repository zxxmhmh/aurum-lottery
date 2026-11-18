import { celebrate } from './fx.js';
import { saveWinnerCard } from './winner-card.js';

const byId = (id) => document.getElementById(id);
const states = {
  form: byId('state-form'),
  loading: byId('state-loading'),
  result: byId('state-result'),
};

const form = byId('redeem-form');
const input = byId('code');
const submit = byId('submit');
const hint = byId('hint');
const again = byId('again');
const phoneWrap = byId('phone-wrap');
const phoneInput = byId('phone');

function show(name) {
  Object.entries(states).forEach(([key, el]) => el.classList.toggle('is-hidden', key !== name));
}

function setHint(text, isError = false) {
  hint.textContent = text;
  hint.classList.toggle('is-error', isError);
}

function showPhone(showIt) {
  phoneWrap.classList.toggle('is-hidden', !showIt);
  if (!showIt) phoneInput.value = '';
}

let lastResult = null;
let busy = false;

function setQuota(remaining, total) {
  const box = byId('quota');
  if (!box) return;
  const left = Number(remaining);
  const all = Number(total);
  if (!Number.isFinite(left) || !Number.isFinite(all) || all <= 0) {
    box.classList.add('is-hidden');
    return;
  }

  const done = Math.max(0, all - left);
  byId('quota-value').textContent = `${left.toLocaleString('zh-CN')} / ${all.toLocaleString('zh-CN')}`;
  byId('quota-text').textContent = left > 0 ? `仅剩 ${left.toLocaleString('zh-CN')} 份 · 抽完即止` : '已抽完 · 下次再来';
  byId('quota-fill').style.width = `${Math.min(100, Math.max(0, (done / all) * 100))}%`;
  box.classList.toggle('is-urgent', left > 0 && left <= Math.max(20, all * 0.1));
  box.classList.toggle('is-empty', left <= 0);
  box.classList.remove('is-hidden');
}

let prizePool = [];
let rollTimer = null;
let rollIndex = 0;

function paintRoll() {
  const pool = prizePool.length ? prizePool : [{ level: '正在揭晓', name: '……' }];
  const prize = pool[rollIndex % pool.length];
  byId('roll-level').textContent = prize.level || '正在揭晓';
  const nameEl = byId('roll-name');
  nameEl.textContent = prize.name || '……';
  nameEl.classList.remove('is-tick');
  void nameEl.offsetWidth;
  nameEl.classList.add('is-tick');
}

function startRoll() {
  rollIndex = Math.floor(Math.random() * Math.max(1, prizePool.length));
  paintRoll();
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    rollIndex += 1;
    paintRoll();
  }, 84);
}

function stopRoll() {
  clearInterval(rollTimer);
  rollTimer = null;
}

function setEventName(name) {
  const el = byId('event-name');
  if (!el) return;
  const value = String(name || '').trim();
  if (!value) {
    el.classList.add('is-hidden');
    return;
  }
  el.innerHTML = `本次抽奖<b>${value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])}</b>`;
  el.classList.remove('is-hidden');
}

async function refreshQuota() {
  try {
    const res = await fetch('/api/public/summary', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const list = data.activities || [];
    const pool = list.flatMap((item) => item.prizes || []);
    if (pool.length) prizePool = pool;
    if (list.length === 1) {
      setQuota(list[0].remaining, list[0].total);
      if (list[0].name) setEventName(list[0].name);
    }
  } catch {
    /* 网络抖动时保持上一次的数字 */
  }
}

refreshQuota();
const quotaTimer = setInterval(() => {
  if (!document.hidden) refreshQuota();
}, 8000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshQuota();
});
window.addEventListener('pagehide', () => clearInterval(quotaTimer));

function formatTime(at) {
  const date = new Date(Number(at) || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showResult(data) {
  lastResult = data;
  if (data.remaining !== undefined) setQuota(data.remaining, data.total);
  byId('result-level').textContent = data.prize.level || '奖项';
  byId('result-name').textContent = data.prize.name || '奖品';
  byId('result-activity').textContent = data.activityName || '';
  if (data.activityName) setEventName(data.activityName);
  byId('result-code').textContent = data.code || '';
  byId('result-time').textContent = formatTime(data.at);

  const imageEl = byId('result-image');
  if (data.prize.image) {
    imageEl.querySelector('img').src = data.prize.image;
    imageEl.classList.remove('is-hidden');
  } else {
    imageEl.classList.add('is-hidden');
  }

  const valueEl = byId('result-value');
  if (Number(data.prize.value) > 0) {
    valueEl.textContent = `价值 ¥${Number(data.prize.value).toLocaleString('zh-CN')}`;
    valueEl.classList.remove('is-hidden');
  } else {
    valueEl.classList.add('is-hidden');
  }

  const holderRow = byId('result-holder-row');
  if (data.holder) {
    byId('result-holder').textContent = data.holder;
    holderRow.classList.remove('is-hidden');
  } else {
    holderRow.classList.add('is-hidden');
  }

  const phoneRow = byId('result-phone-row');
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length >= 7) {
    byId('result-phone').textContent = `${digits.slice(0, 3)}****${digits.slice(-4)}`;
    phoneRow.classList.remove('is-hidden');
  } else {
    phoneRow.classList.add('is-hidden');
  }
  show('result');
  const card = byId('card');
  card.classList.remove('is-pop');
  void card.offsetWidth;
  card.classList.add('is-pop');
  celebrate();
}

const params = new URLSearchParams(location.search);
const preset = (params.get('code') || '').trim().toUpperCase();
if (preset) {
  input.value = preset;
  setHint('已自动填入抽奖码，确认后点「开奖」');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const code = input.value.trim().toUpperCase();
  if (!code) {
    setHint('请输入抽奖码', true);
    input.focus();
    return;
  }

  busy = true;
  submit.disabled = true;
  submit.textContent = '核验中…';
  const started = Date.now();
  try {
    const phone = phoneInput.value.replace(/\D/g, '');
    const res = await fetch('/api/public/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(phone ? { code, phone } : { code }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const error = new Error(data.error || '开奖失败，请稍后再试');
      error.code = data.code;
      throw error;
    }

    // 码有效且没抽过，才开始滚动揭晓（已用/无效的码不会闪一下抽奖动画）
    submit.textContent = '开奖中…';
    show('loading');
    startRoll();

    const elapsed = Date.now() - started;
    if (elapsed < 1600) await new Promise((resolve) => setTimeout(resolve, 1600 - elapsed));
    stopRoll();
    byId('roll-level').textContent = data.prize?.level || '奖项';
    byId('roll-name').textContent = data.prize?.name || '奖品';
    await new Promise((resolve) => setTimeout(resolve, 420));
    showResult(data);
  } catch (err) {
    stopRoll();
    const elapsed = Date.now() - started;
    if (elapsed < 300) await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
    show('form');
    setHint(err.message || '开奖失败，请稍后再试', true);
    if (err.code === 'phone_required') {
      showPhone(true);
      phoneInput.focus();
    } else if (err.code === 'phone_mismatch') {
      showPhone(true);
      phoneInput.select();
    } else {
      input.select();
    }
  } finally {
    busy = false;
    submit.disabled = false;
    submit.textContent = '开 奖';
  }
});

again.addEventListener('click', () => {
  input.value = '';
  showPhone(false);
  setHint('一码一次 · 请勿转发给他人');
  show('form');
  input.focus();
});

byId('save-card').addEventListener('click', async (event) => {
  if (!lastResult) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await saveWinnerCard(
      {
        activityName: lastResult.activityName,
        level: lastResult.prize.level,
        prizeName: lastResult.prize.name,
        image: lastResult.prize.image,
        value: lastResult.prize.value,
        holder: lastResult.holder,
        code: lastResult.code,
        at: lastResult.at,
      },
      `中奖-${lastResult.code}.jpg`,
    );
  } catch (err) {
    setHint('生成图片失败，请截图保存', true);
  } finally {
    button.disabled = false;
  }
});

input.addEventListener('input', () => {
  const caret = input.selectionStart;
  input.value = input.value.toUpperCase();
  input.setSelectionRange(caret, caret);
});

input.focus();

/* 前台开关：家长端被关闭时，直接把卡片换成“已关闭”提示 */
(async function gate() {
  try {
    const res = await fetch('/api/public/frontends', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return;
    const cfg = (await res.json()) || {};
    const fe = cfg.redeem || {};
    if (fe.enabled === false) {
      const card = byId('card');
      if (!card) return;
      card.textContent = '';
      const wrap = document.createElement('div');
      wrap.className = 'redeem-state';
      const eyebrow = document.createElement('div');
      eyebrow.className = 'eyebrow';
      eyebrow.textContent = 'Closed';
      const title = document.createElement('h1');
      title.className = 'redeem-title';
      title.textContent = fe.title || '自助开奖已关闭';
      const sub = document.createElement('p');
      sub.className = 'redeem-sub';
      sub.textContent = fe.note || '请联系门店老师，由工作人员帮你开奖。';
      wrap.appendChild(eyebrow);
      wrap.appendChild(title);
      wrap.appendChild(sub);
      card.appendChild(wrap);
      const eventEl = byId('event-name');
      if (eventEl) eventEl.classList.add('is-hidden');
      return;
    }
    if (fe.note) {
      const sub = document.querySelector('.redeem-sub');
      if (sub) sub.textContent = fe.note;
    }
  } catch {
    /* 读不到配置就按默认显示 */
  }
})();