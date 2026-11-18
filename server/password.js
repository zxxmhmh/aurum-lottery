import crypto from 'node:crypto';

const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (typeof salt !== 'string' || typeof hash !== 'string') return false;
  try {
    const candidate = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT);
    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== candidate.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
