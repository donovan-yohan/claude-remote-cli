import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrainstormPrompt, buildPlanPrompt, buildExecutionPrompt, buildReviewPrompt, buildStuckPrompt } from '../server/belayer/prompts.js';
import type { TaskSpec, Verdict } from '../server/belayer/types.js';

const testTask: TaskSpec = {
  source: 'text',
  title: 'Add CSV export',
  description: 'Users should be able to export data as CSV files',
  acceptanceCriteria: ['Export button visible', 'CSV downloads correctly'],
};

test('buildBrainstormPrompt includes task title and description', () => {
  const prompt = buildBrainstormPrompt(testTask);
  assert.ok(prompt.includes('Add CSV export'));
  assert.ok(prompt.includes('export data as CSV files'));
});

test('buildBrainstormPrompt includes acceptance criteria when present', () => {
  const prompt = buildBrainstormPrompt(testTask);
  assert.ok(prompt.includes('Export button visible'));
  assert.ok(prompt.includes('CSV downloads correctly'));
});

test('buildPlanPrompt includes PRD content', () => {
  const prompt = buildPlanPrompt(testTask, '# PRD\n## Goals\nExport CSV');
  assert.ok(prompt.includes('# PRD'));
  assert.ok(prompt.includes('Export CSV'));
});

test('buildExecutionPrompt includes plan content', () => {
  const prompt = buildExecutionPrompt(testTask, '# Plan\n## Task 1\nCreate export button');
  assert.ok(prompt.includes('# Plan'));
  assert.ok(prompt.includes('Create export button'));
});

test('buildExecutionPrompt includes verdict feedback on retry', () => {
  const verdict: Verdict = {
    goalName: 'CSV Export',
    pass: false,
    criteriaResults: [{ criterion: 'Export works', met: false, reason: 'Button missing' }],
    summary: 'Export button not found',
    timestamp: new Date().toISOString(),
  };
  const prompt = buildExecutionPrompt(testTask, '# Plan', [verdict]);
  assert.ok(prompt.includes('PREVIOUS REVIEW FEEDBACK'));
  assert.ok(prompt.includes('Button missing'));
});

test('buildReviewPrompt includes task spec and acceptance criteria', () => {
  const prompt = buildReviewPrompt(testTask, '/tmp/worktree');
  assert.ok(prompt.includes('Add CSV export'));
  assert.ok(prompt.includes('Export button visible'));
});

test('buildReviewPrompt instructs verdict.json output', () => {
  const prompt = buildReviewPrompt(testTask, '/tmp/worktree');
  assert.ok(prompt.includes('verdict.json'));
});

test('buildStuckPrompt includes attempt count and verdicts', () => {
  const verdicts: Verdict[] = [
    { goalName: 'test', pass: false, criteriaResults: [], summary: 'Failed attempt 1', timestamp: '' },
    { goalName: 'test', pass: false, criteriaResults: [], summary: 'Failed attempt 2', timestamp: '' },
  ];
  const prompt = buildStuckPrompt(testTask, verdicts, 2);
  assert.ok(prompt.includes('2'));
  assert.ok(prompt.includes('Failed attempt 1'));
  assert.ok(prompt.includes('Failed attempt 2'));
});
