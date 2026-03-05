import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs, parseVerdictFile } from '../server/belayer/executor.js';
import type { Verdict } from '../server/belayer/types.js';

test('buildClaudeArgs includes -p and --dangerously-skip-permissions', () => {
  const args = buildClaudeArgs('opus');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--dangerously-skip-permissions'));
});

test('buildClaudeArgs includes --model flag', () => {
  const args = buildClaudeArgs('sonnet');
  const modelIdx = args.indexOf('--model');
  assert.ok(modelIdx >= 0);
  assert.equal(args[modelIdx + 1], 'sonnet');
});

test('parseVerdictFile parses valid verdict JSON', () => {
  const json = JSON.stringify({
    goalName: 'Test',
    pass: true,
    criteriaResults: [{ criterion: 'Works', met: true }],
    summary: 'All good',
    timestamp: '2026-03-05T00:00:00.000Z',
  });
  const verdict = parseVerdictFile(json);
  assert.ok(verdict);
  assert.equal(verdict!.pass, true);
  assert.equal(verdict!.goalName, 'Test');
});

test('parseVerdictFile returns null for invalid JSON', () => {
  assert.equal(parseVerdictFile('not json'), null);
});

test('parseVerdictFile returns null for missing required fields', () => {
  assert.equal(parseVerdictFile(JSON.stringify({ pass: true })), null);
});
