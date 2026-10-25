import crypto from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(db, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    now,
    now + SESSION_TTL_MS
  );
  return { token, expiresAt: now + SESSION_TTL_MS };
}

export function sessionValid(db, token, now = Date.now()) {
  if (!token) return false;
  const row = db
    .prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
    .get(sha256(token));
  if (!row) return false;
  if (row.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return false;
  }
  return true;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function purgeSessions(db, now = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

/** 简单的登录失败限速：同一 IP 5 分钟内最多失败 8 次。 */
export function createLoginLimiter({ windowMs = 5 * 60_000, max = 8 } = {}) {
  const failures = new Map();
  return {
    blocked(ip, now = Date.now()) {
      const entry = failures.get(ip);
      if (!entry) return false;
      if (now - entry.first > windowMs) {
        failures.delete(ip);
        return false;
      }
      return entry.count >= max;
    },
    fail(ip, now = Date.now()) {
      const entry = failures.get(ip);
      if (!entry || now - entry.first > windowMs) failures.set(ip, { first: now, count: 1 });
      else entry.count += 1;
    },
    reset(ip) {
      failures.delete(ip);
    },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key) out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
