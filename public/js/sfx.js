/* 极轻量的合成音效：开奖提示音，无外部音频文件 */

let audio = null;
let enabled = localStorage.getItem('aurum.sound') !== 'off';

function context() {
  if (!enabled) return null;
  if (!audio) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function tone(ctx, { freq, start = 0, duration = 0.6, gain = 0.06, type = 'sine', detune = 0 }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  amp.gain.setValueAtTime(0, ctx.currentTime + start);
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

export const sfx = {
  get enabled() {
    return enabled;
  },
  toggle() {
    enabled = !enabled;
    localStorage.setItem('aurum.sound', enabled ? 'on' : 'off');
    if (enabled) this.tick();
    return enabled;
  },
  tick() {
    const ctx = context();
    if (!ctx) return;
    tone(ctx, { freq: 880, duration: 0.12, gain: 0.03 });
  },
  win() {
    const ctx = context();
    if (!ctx) return;
    const notes = [659.25, 830.61, 987.77, 1318.51];
    notes.forEach((freq, i) => {
      tone(ctx, { freq, start: i * 0.09, duration: 1.5 - i * 0.15, gain: 0.055 - i * 0.006 });
      tone(ctx, { freq: freq / 2, start: i * 0.09, duration: 1.2, gain: 0.016, type: 'triangle' });
    });
  },
  miss() {
    const ctx = context();
    if (!ctx) return;
    tone(ctx, { freq: 196, duration: 0.5, gain: 0.05, type: 'sine' });
    tone(ctx, { freq: 146.83, start: 0.09, duration: 0.6, gain: 0.035, type: 'triangle' });
  },
};

/* 兼容后端返回的错误提示 */
export function playResult(hit) {
  if (hit) sfx.win();
  else sfx.miss();
}
