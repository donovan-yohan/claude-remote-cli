import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

const SALT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptEntry {
  count: number;
  lockedUntil: number | null;
}

const attemptMap = new Map<string, AttemptEntry>();

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export function isRateLimited(ip: string): boolean {
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

export function recordFailedAttempt(ip: string): void {
  const entry = attemptMap.get(ip) ?? { count: 0, lockedUntil: null };
  entry.count += 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }

  attemptMap.set(ip, entry);
}

export function clearRateLimit(ip: string): void {
  attemptMap.delete(ip);
}

export function generateCookieToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function _resetForTesting(): void {
  attemptMap.clear();
}
