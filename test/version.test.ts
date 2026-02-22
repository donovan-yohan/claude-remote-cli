import { test } from 'node:test';
import assert from 'node:assert/strict';

function semverLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

test('semverLessThan returns true when major is lower', () => {
  assert.equal(semverLessThan('1.0.0', '2.0.0'), true);
});

test('semverLessThan returns true when minor is lower', () => {
  assert.equal(semverLessThan('1.1.0', '1.2.0'), true);
});

test('semverLessThan returns true when patch is lower', () => {
  assert.equal(semverLessThan('1.1.1', '1.1.2'), true);
});

test('semverLessThan returns false for equal versions', () => {
  assert.equal(semverLessThan('1.1.1', '1.1.1'), false);
});

test('semverLessThan returns false when current is greater', () => {
  assert.equal(semverLessThan('2.0.0', '1.9.9'), false);
});

test('semverLessThan handles major version jumps', () => {
  assert.equal(semverLessThan('1.9.9', '2.0.0'), true);
});

test('semverLessThan handles two-segment versions gracefully', () => {
  assert.equal(semverLessThan('1.0', '1.1'), true);
});
