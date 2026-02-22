import { test } from 'node:test';
import assert from 'node:assert';
import {
  hashPin,
  verifyPin,
  isRateLimited,
  recordFailedAttempt,
  generateCookieToken,
  _resetForTesting,
} from '../server/auth.js';

test('hashPin returns bcrypt hash starting with $2b$', async () => {
  _resetForTesting();
  const hash = await hashPin('1234');
  assert.ok(hash.startsWith('$2b$'), `Expected hash to start with $2b$, got: ${hash}`);
});

test('verifyPin returns true for correct PIN', async () => {
  _resetForTesting();
  const hash = await hashPin('1234');
  const result = await verifyPin('1234', hash);
  assert.strictEqual(result, true);
});

test('verifyPin returns false for wrong PIN', async () => {
  _resetForTesting();
  const hash = await hashPin('1234');
  const result = await verifyPin('9999', hash);
  assert.strictEqual(result, false);
});

test('rate limiter blocks after 5 failures', () => {
  _resetForTesting();
  const ip = '127.0.0.1';

  for (let i = 0; i < 5; i++) {
    recordFailedAttempt(ip);
  }

  assert.strictEqual(isRateLimited(ip), true);
});

test('rate limiter allows under threshold', () => {
  _resetForTesting();
  const ip = '127.0.0.1';

  for (let i = 0; i < 4; i++) {
    recordFailedAttempt(ip);
  }

  assert.strictEqual(isRateLimited(ip), false);
});

test('generateCookieToken returns non-empty string', () => {
  _resetForTesting();
  const token = generateCookieToken();
  assert.ok(typeof token === 'string' && token.length > 0);
});
