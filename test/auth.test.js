const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const AUTH_MODULE_PATH = path.resolve(__dirname, '../server/auth.js');

function freshAuth() {
  delete require.cache[AUTH_MODULE_PATH];
  return require(AUTH_MODULE_PATH);
}

test('hashPin returns bcrypt hash starting with $2b$', async () => {
  const auth = freshAuth();
  const hash = await auth.hashPin('1234');
  assert.ok(hash.startsWith('$2b$'), `Expected hash to start with $2b$, got: ${hash}`);
});

test('verifyPin returns true for correct PIN', async () => {
  const auth = freshAuth();
  const hash = await auth.hashPin('1234');
  const result = await auth.verifyPin('1234', hash);
  assert.strictEqual(result, true);
});

test('verifyPin returns false for wrong PIN', async () => {
  const auth = freshAuth();
  const hash = await auth.hashPin('1234');
  const result = await auth.verifyPin('9999', hash);
  assert.strictEqual(result, false);
});

test('rate limiter blocks after 5 failures', () => {
  const auth = freshAuth();
  const ip = '127.0.0.1';

  for (let i = 0; i < 5; i++) {
    auth.recordFailedAttempt(ip);
  }

  assert.strictEqual(auth.isRateLimited(ip), true);
});

test('rate limiter allows under threshold', () => {
  const auth = freshAuth();
  const ip = '127.0.0.1';

  for (let i = 0; i < 4; i++) {
    auth.recordFailedAttempt(ip);
  }

  assert.strictEqual(auth.isRateLimited(ip), false);
});

test('generateCookieToken returns non-empty string', () => {
  const auth = freshAuth();
  const token = auth.generateCookieToken();
  assert.ok(typeof token === 'string' && token.length > 0);
});
