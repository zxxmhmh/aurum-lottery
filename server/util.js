import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = 'bad_request') => new HttpError(400, message, code);
export const unauthorized = (message = '请先登录', code = 'unauthorized') => new HttpError(401, message, code);
export const forbidden = (message = '没有权限执行该操作', code = 'forbidden') => new HttpError(403, message, code);
export const notFound = (message = '内容不存在', code = 'not_found') => new HttpError(404, message, code);

export const uid = (prefix = '') => prefix + crypto.randomBytes(8).toString('hex');
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function str(value, { min = 1, max = 200, label = '内容', optional = false } = {}) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (!s) {
    if (optional) return '';
    throw badRequest(`${label}不能为空`);
  }
  if (s.length < min) throw badRequest(`${label}至少需要 ${min} 个字符`);
  if (s.length > max) throw badRequest(`${label}不能超过 ${max} 个字符`);
  return s;
}

export function int(value, { min = 0, max = 1_000_000, label = '数值', fallback } = {}) {
  if (value === null || value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${label}不能为空`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${label}必须是数字`);
  const v = Math.round(n);
  if (v < min) throw badRequest(`${label}不能小于 ${min}`);
  if (v > max) throw badRequest(`${label}不能大于 ${max}`);
  return v;
}

export function dec(value, { min = 0, max = 1000, label = '数值' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${label}必须是数字`);
  if (n < min) throw badRequest(`${label}不能小于 ${min}`);
  if (n > max) throw badRequest(`${label}不能大于 ${max}`);
  return Math.round(n * 100) / 100;
}

export function oneOf(value, list, label = '选项') {
  if (!list.includes(value)) throw badRequest(`${label}不合法`);
  return value;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
