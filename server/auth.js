const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const attemptMap = new Map(); // ip -> { count, lockedUntil }

async function hashPin(pin) {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

async function verifyPin(pin, hash) {
  return bcrypt.compare(pin, hash);
}

function isRateLimited(ip) {
  const entry = attemptMap.get(ip);
  if (!entry) return false;

  if (entry.lockedUntil) {
    if (Date.now() < entry.lockedUntil) {
      return true;
    }
    attemptMap.delete(ip);
  }

  return false;
}

function recordFailedAttempt(ip) {
  const entry = attemptMap.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }

  attemptMap.set(ip, entry);
}

function clearRateLimit(ip) {
  attemptMap.delete(ip);
}

function generateCookieToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  hashPin,
  verifyPin,
  recordFailedAttempt,
  isRateLimited,
  clearRateLimit,
  generateCookieToken,
};
