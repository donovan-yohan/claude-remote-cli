import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrTitle, buildPrBody } from '../server/belayer/pr-lifecycle.js';
import type { TaskSpec } from '../server/belayer/types.js';

const testTask: TaskSpec = {
  source: 'text',
  title: 'Add CSV export',
  description: 'Users should be able to export data as CSV files',
};

test('buildPrTitle returns formatted title', () => {
  const title = buildPrTitle(testTask);
  assert.equal(title, 'feat: Add CSV export');
});

test('buildPrBody includes task description', () => {
  const body = buildPrBody(testTask, '# PRD content', 1);
  assert.ok(body.includes('Add CSV export'));
  assert.ok(body.includes('export data as CSV files'));
});

test('buildPrBody includes attempt count', () => {
  const body = buildPrBody(testTask, '# PRD', 2);
  assert.ok(body.includes('2'));
});

test('buildPrBody includes PRD content in collapsible section', () => {
  const body = buildPrBody(testTask, '# My PRD', 1);
  assert.ok(body.includes('<details>'));
  assert.ok(body.includes('# My PRD'));
});
