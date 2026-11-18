import { icon } from './ui.js';

const KEY = 'aurum.theme';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme, { persist = true } = {}) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  if (persist) {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* 隐私模式下忽略 */
    }
  }
  syncButtons();
  window.dispatchEvent(new CustomEvent('aurum:theme', { detail: next }));
}

export function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  applyTheme(saved === 'dark' ? 'dark' : 'light', { persist: false });
}

function syncButtons(root = document) {
  const dark = currentTheme() === 'dark';
  const label = dark ? '切换浅色' : '切换深色';
  root.querySelectorAll('[data-theme-btn]').forEach((button) => {
    button.innerHTML = `${icon(dark ? 'sun' : 'moon', 15)}<span>${label}</span>`;
    button.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
    button.title = dark ? '切换到浅色主题' : '切换到深色主题';
  });
}

export function bindThemeButtons(root = document) {
  root.querySelectorAll('[data-theme-btn]').forEach((button) => {
    if (button.dataset.themeBound) return;
    button.dataset.themeBound = '1';
    button.addEventListener('click', toggleTheme);
  });
  syncButtons(root);
}
