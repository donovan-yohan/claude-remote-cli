import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPipeline, getPipeline, listPipelines, transitionPipeline, deletePipeline, loadAllPipelines, setPipelinesDir, clearPipelines } from '../server/belayer/pipeline.js';
import type { TaskSpec } from '../server/belayer/types.js';
import { DEFAULT_PIPELINE_CONFIG } from '../server/belayer/types.js';

let tmpDir!: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belayer-pipeline-test-'));
  setPipelinesDir(tmpDir);
});

afterEach(() => {
  // Clean up in-memory and disk state between tests
  clearPipelines();
  for (const entry of fs.readdirSync(tmpDir)) {
    const fullPath = path.join(tmpDir, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const testTask: TaskSpec = {
  source: 'text',
  title: 'Test Task',
  description: 'A test task description',
};

test('createPipeline creates a pipeline in intake state', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  assert.equal(pipeline.state, 'intake');
  assert.equal(pipeline.task.title, 'Test Task');
  assert.equal(pipeline.attempts, 0);
  assert.ok(pipeline.id);
  assert.ok(pipeline.createdAt);
});

test('createPipeline persists to disk', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  const filePath = path.join(tmpDir, pipeline.id + '.json');
  assert.ok(fs.existsSync(filePath));
  const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(loaded.id, pipeline.id);
});

test('getPipeline returns a stored pipeline', () => {
  const created = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  const fetched = getPipeline(created.id);
  assert.ok(fetched);
  assert.equal(fetched!.id, created.id);
  assert.equal(fetched!.state, 'intake');
});

test('getPipeline returns null for unknown id', () => {
  assert.equal(getPipeline('nonexistent'), null);
});

test('listPipelines returns all pipelines', () => {
  createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  createPipeline({ ...testTask, title: 'Second' }, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  const list = listPipelines();
  assert.equal(list.length, 2);
});

test('transitionPipeline moves to valid next state', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  const updated = transitionPipeline(pipeline.id, 'brainstorming');
  assert.equal(updated.state, 'brainstorming');
});

test('transitionPipeline rejects invalid transition', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  assert.throws(
    () => transitionPipeline(pipeline.id, 'executing'),
    /Invalid transition from intake to executing/,
  );
});

test('transitionPipeline persists state change', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  transitionPipeline(pipeline.id, 'brainstorming');
  const filePath = path.join(tmpDir, pipeline.id + '.json');
  const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(loaded.state, 'brainstorming');
});

test('transitionPipeline updates updatedAt timestamp', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  const before = pipeline.updatedAt;
  // Small delay to ensure timestamp differs
  const updated = transitionPipeline(pipeline.id, 'brainstorming');
  assert.ok(updated.updatedAt >= before);
});

test('deletePipeline removes pipeline from memory and disk', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  deletePipeline(pipeline.id);
  assert.equal(getPipeline(pipeline.id), null);
  const filePath = path.join(tmpDir, pipeline.id + '.json');
  assert.ok(!fs.existsSync(filePath));
});

test('loadAllPipelines restores from disk', () => {
  const p1 = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  const p2 = createPipeline({ ...testTask, title: 'Other' }, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  // Clear in-memory state
  deletePipeline(p1.id);
  deletePipeline(p2.id);
  // Write files back manually to simulate server restart
  fs.writeFileSync(path.join(tmpDir, 'fake-id.json'), JSON.stringify({ ...p1, id: 'fake-id' }));
  loadAllPipelines();
  const loaded = getPipeline('fake-id');
  assert.ok(loaded);
  assert.equal(loaded!.task.title, 'Test Task');
});

test('transitionPipeline to retry increments attempts', () => {
  const pipeline = createPipeline(testTask, { ...DEFAULT_PIPELINE_CONFIG, targetRepo: '/tmp/repo' });
  transitionPipeline(pipeline.id, 'brainstorming');
  transitionPipeline(pipeline.id, 'prd_review');
  transitionPipeline(pipeline.id, 'planning');
  transitionPipeline(pipeline.id, 'plan_review');
  transitionPipeline(pipeline.id, 'executing');
  transitionPipeline(pipeline.id, 'reviewing');
  const retried = transitionPipeline(pipeline.id, 'retry');
  assert.equal(retried.attempts, 1);
});
