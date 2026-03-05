import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PIPELINE_CONFIG, VALID_TRANSITIONS } from '../server/belayer/types.js';
import type { PipelineState, TaskSpec, Pipeline, Verdict } from '../server/belayer/types.js';

test('DEFAULT_PIPELINE_CONFIG has expected defaults', () => {
  assert.deepEqual(DEFAULT_PIPELINE_CONFIG.models, { brainstorm: 'opus', execute: 'opus', review: 'sonnet' });
  assert.equal(DEFAULT_PIPELINE_CONFIG.maxAttempts, 3);
  assert.equal(DEFAULT_PIPELINE_CONFIG.autoPush, true);
  assert.equal(DEFAULT_PIPELINE_CONFIG.targetRepo, '');
  assert.equal(DEFAULT_PIPELINE_CONFIG.baseBranch, 'main');
});

test('VALID_TRANSITIONS covers all states', () => {
  const allStates: PipelineState[] = [
    'intake', 'brainstorming', 'prd_review', 'planning', 'plan_review',
    'executing', 'reviewing', 'retry', 'stuck', 'pr_created',
    'ci_monitoring', 'ready_for_review', 'done', 'failed',
  ];
  for (const state of allStates) {
    assert.ok(state in VALID_TRANSITIONS, `Missing transitions for state: ${state}`);
  }
});

test('done state has no valid transitions', () => {
  assert.deepEqual(VALID_TRANSITIONS.done, []);
});

test('all active states can transition to failed', () => {
  const allStates = Object.keys(VALID_TRANSITIONS) as PipelineState[];
  for (const state of allStates) {
    if (state === 'done' || state === 'failed') continue;
    assert.ok(
      VALID_TRANSITIONS[state]!.includes('failed'),
      `State ${state} should be able to transition to failed`,
    );
  }
});

test('failed can only transition to intake (restart)', () => {
  assert.deepEqual(VALID_TRANSITIONS.failed, ['intake']);
});

test('TaskSpec type accepts text source', () => {
  const spec: TaskSpec = {
    source: 'text',
    title: 'Test task',
    description: 'A test description',
  };
  assert.equal(spec.source, 'text');
  assert.equal(spec.title, 'Test task');
});

test('Pipeline type has correct shape', () => {
  const pipeline: Pipeline = {
    id: 'test-id',
    state: 'intake',
    task: { source: 'text', title: 'Test', description: 'Desc' },
    config: DEFAULT_PIPELINE_CONFIG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 3,
    verdicts: [],
  };
  assert.equal(pipeline.state, 'intake');
  assert.equal(pipeline.attempts, 0);
});

test('Verdict type has correct shape', () => {
  const verdict: Verdict = {
    goalName: 'Feature X',
    pass: true,
    criteriaResults: [{ criterion: 'Tests pass', met: true }],
    summary: 'All good',
    timestamp: new Date().toISOString(),
  };
  assert.equal(verdict.pass, true);
  assert.equal(verdict.criteriaResults.length, 1);
});
