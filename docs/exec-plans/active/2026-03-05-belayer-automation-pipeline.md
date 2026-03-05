# Belayer Automation Pipeline Implementation Plan

> **Status**: Completed | **Created**: 2026-03-05 | **Completed**: 2026-03-05
> **Design Doc**: `docs/design-docs/2026-03-05-belayer-automation-pipeline-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan. REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a server-side "Belayer" module that automates the path from text task intake through brainstorm → PRD review → plan → plan review → execute → review → PR creation, with a Svelte 5 frontend for pipeline monitoring and human gate approvals.

**Architecture:** New `server/belayer/` module directory containing seven files (types, pipeline state machine, intake adapters, prompt templates, executor, reviewer, PR lifecycle). REST API routes added to `server/index.ts`. Pipeline state changes broadcast over existing `/ws/events` WebSocket channel. Frontend adds a fourth sidebar tab ("Pipelines") with pipeline list, detail view, intake dialog, and review components. v1 MVP scope: TextSource only, single pipeline at a time, file-based JSON persistence.

**Tech Stack:** TypeScript + ESM, Express, node-pty (existing), WebSocket (existing), Svelte 5 runes, `gh` CLI for PR creation.

---

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-05 | Design | Server module, not plugin | Plugins can't run persistent background processes or render rich UI |
| 2026-03-05 | Design | Reuse existing PTY infrastructure | Agent sessions are PTY sessions managed by sessions.ts |
| 2026-03-05 | Design | Pipeline state machine on disk (JSON files) | Simple persistence, atomic writes, resume on restart |
| 2026-03-05 | Design | Human gates at PRD and plan | Brainstorm/plan produce artifacts user approves before execution |
| 2026-03-05 | Design | Independent reviewer in separate PTY | Same isolation principle as lead's reviewer |
| 2026-03-05 | Design | TextSource only for v1 | MVP scope — Jira/Linear/GitHub adapters in v2 |
| 2026-03-05 | Design | Single pipeline at a time for v1 | Reduces complexity; concurrent pipelines in v2 |
| 2026-03-05 | Design | No DAG engine — linear state machine | Pipeline is sequential with a single retry loop |
| 2026-03-05 | Design | WebSocket pipeline events over existing `/ws/events` | No new WebSocket channel needed |
| 2026-03-05 | Retrospective | Plan completed — 17 tasks, 4 drift entries, 0 surprises | Full v1 MVP implemented with parallel agent execution |

## Progress

- [x] Task 1: Belayer types _(completed 2026-03-05)_
- [x] Task 2: Pipeline state machine + persistence _(completed 2026-03-05)_
- [x] Task 3: TextSource adapter _(completed 2026-03-05)_
- [x] Task 4: Prompt templates _(completed 2026-03-05)_
- [x] Task 5: Executor (headless PTY spawning) _(completed 2026-03-05)_
- [x] Task 6: PR lifecycle _(completed 2026-03-05)_
- [x] Task 7: PR lifecycle — skipped (wiring in Task 8)
- [x] Task 8: REST API routes _(completed 2026-03-05)_
- [x] Task 9: WebSocket pipeline events — covered by Task 8
- [x] Task 10: Frontend types + API client _(completed 2026-03-05)_
- [x] Task 11: Frontend pipeline state module _(completed 2026-03-05)_
- [x] Task 12: Pipeline sidebar tab + PipelineList component _(completed 2026-03-05)_
- [x] Task 13: IntakeDialog component _(completed 2026-03-05)_
- [x] Task 14: PipelineView + state visualization _(completed 2026-03-05)_
- [x] Task 15: PRDReview + PlanReview components _(completed 2026-03-05)_
- [x] Task 16: ExecutionMonitor + VerdictView + StuckReport components _(completed 2026-03-05)_
- [x] Task 17: Integration wiring + build verification _(completed 2026-03-05)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

| Task | Plan said | Actually happened | Why |
|------|-----------|-------------------|-----|
| Task 1 | Test checks `failed` can transition to `failed` | Skipped `failed` in the "all states can transition to failed" test | `failed` only transitions to `intake` (restart), not to itself — correct fix |
| Task 2 | No `clearPipelines()` export | Added `clearPipelines()` for test isolation | `afterEach` disk cleanup left stale in-memory map entries |
| Task 5 | `resumeFromStuck` double-transitions to `executing` | Added guard `if (pipeline.state !== 'executing')` in `startExecution` | `resumeFromStuck` already transitions to `executing` before calling `startExecution` |
| Task 12 | Only SessionList mentioned for tab wiring | Propagated `onSelectPipeline` through App→Sidebar→SessionList→PipelineList | Component prop chain requires upstream plumbing |

---

### Task 1: Belayer types

**Files:**
- Create: `server/belayer/types.ts`
- Test: `test/belayer-types.test.ts`

**Step 1: Create the types file with all interfaces**

Create `server/belayer/types.ts`:

```typescript
export type PipelineState =
  | 'intake'
  | 'brainstorming'
  | 'prd_review'
  | 'planning'
  | 'plan_review'
  | 'executing'
  | 'reviewing'
  | 'retry'
  | 'stuck'
  | 'pr_created'
  | 'ci_monitoring'
  | 'ready_for_review'
  | 'done'
  | 'failed';

export interface TaskSpec {
  source: 'jira' | 'linear' | 'github' | 'text';
  externalId?: string | undefined;
  externalUrl?: string | undefined;
  title: string;
  description: string;
  acceptanceCriteria?: string[] | undefined;
  labels?: string[] | undefined;
  priority?: 'low' | 'medium' | 'high' | 'critical' | undefined;
  assignee?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface PipelineConfig {
  models: {
    brainstorm: string;
    execute: string;
    review: string;
  };
  maxAttempts: number;
  autoPush: boolean;
  targetRepo: string;
  baseBranch: string;
}

export interface Verdict {
  goalName: string;
  pass: boolean;
  criteriaResults: Array<{
    criterion: string;
    met: boolean;
    reason?: string | undefined;
  }>;
  summary: string;
  suggestions?: string[] | undefined;
  timestamp: string;
}

export interface Pipeline {
  id: string;
  state: PipelineState;
  task: TaskSpec;
  config: PipelineConfig;
  createdAt: string;
  updatedAt: string;
  prdContent?: string | undefined;
  planContent?: string | undefined;
  worktreePath?: string | undefined;
  branchName?: string | undefined;
  prNumber?: number | undefined;
  prUrl?: string | undefined;
  attempts: number;
  maxAttempts: number;
  verdicts: Verdict[];
  stuckReport?: string | undefined;
  activeSessionId?: string | undefined;
  error?: string | undefined;
}

export interface TaskSource {
  readonly name: string;
  fetch(input: string): Promise<TaskSpec>;
  canHandle(input: string): boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  models: { brainstorm: 'opus', execute: 'opus', review: 'sonnet' },
  maxAttempts: 3,
  autoPush: true,
  targetRepo: '',
  baseBranch: 'main',
};

export const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  intake: ['brainstorming', 'failed'],
  brainstorming: ['prd_review', 'failed'],
  prd_review: ['planning', 'brainstorming', 'failed'],
  planning: ['plan_review', 'failed'],
  plan_review: ['executing', 'planning', 'failed'],
  executing: ['reviewing', 'failed'],
  reviewing: ['pr_created', 'retry', 'stuck', 'failed'],
  retry: ['executing', 'stuck', 'failed'],
  stuck: ['executing', 'failed'],
  pr_created: ['ci_monitoring', 'done', 'failed'],
  ci_monitoring: ['ready_for_review', 'failed'],
  ready_for_review: ['done', 'failed'],
  done: [],
  failed: ['intake'],
};
```

**Step 2: Write the type validation test**

Create `test/belayer-types.test.ts`:

```typescript
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

test('all states except done can transition to failed', () => {
  const allStates = Object.keys(VALID_TRANSITIONS) as PipelineState[];
  for (const state of allStates) {
    if (state === 'done') continue;
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
```

**Step 3: Run test to verify it passes**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-types.test.js`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add server/belayer/types.ts test/belayer-types.test.ts
git commit -m "feat(belayer): add types module with pipeline state machine definitions"
```

---

### Task 2: Pipeline state machine + persistence

**Files:**
- Create: `server/belayer/pipeline.ts`
- Test: `test/belayer-pipeline.test.ts`

**Step 1: Write the failing test for pipeline creation and transitions**

Create `test/belayer-pipeline.test.ts`:

```typescript
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPipeline, getPipeline, listPipelines, transitionPipeline, deletePipeline, loadAllPipelines, setPipelinesDir } from '../server/belayer/pipeline.js';
import type { TaskSpec } from '../server/belayer/types.js';
import { DEFAULT_PIPELINE_CONFIG } from '../server/belayer/types.js';

let tmpDir!: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belayer-pipeline-test-'));
  setPipelinesDir(tmpDir);
});

afterEach(() => {
  // Clean up pipeline files between tests
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
```

**Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-pipeline.test.js`
Expected: FAIL — module not found

**Step 3: Implement the pipeline module**

Create `server/belayer/pipeline.ts`:

```typescript
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Pipeline, PipelineConfig, PipelineState, TaskSpec } from './types.js';
import { VALID_TRANSITIONS } from './types.js';

const pipelines = new Map<string, Pipeline>();

let pipelinesDir = path.join(
  os.homedir(),
  '.config',
  'claude-remote-cli',
  'pipelines',
);

export function setPipelinesDir(dir: string): void {
  pipelinesDir = dir;
}

function ensureDir(): void {
  if (!fs.existsSync(pipelinesDir)) {
    fs.mkdirSync(pipelinesDir, { recursive: true });
  }
}

function persist(pipeline: Pipeline): void {
  ensureDir();
  const filePath = path.join(pipelinesDir, pipeline.id + '.json');
  fs.writeFileSync(filePath, JSON.stringify(pipeline, null, 2), 'utf8');
}

export function createPipeline(task: TaskSpec, config: PipelineConfig): Pipeline {
  const now = new Date().toISOString();
  const pipeline: Pipeline = {
    id: crypto.randomBytes(8).toString('hex'),
    state: 'intake',
    task,
    config,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    maxAttempts: config.maxAttempts,
    verdicts: [],
  };
  pipelines.set(pipeline.id, pipeline);
  persist(pipeline);
  return pipeline;
}

export function getPipeline(id: string): Pipeline | null {
  return pipelines.get(id) ?? null;
}

export function listPipelines(): Pipeline[] {
  return Array.from(pipelines.values()).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function transitionPipeline(id: string, newState: PipelineState): Pipeline {
  const pipeline = pipelines.get(id);
  if (!pipeline) throw new Error('Pipeline not found: ' + id);

  const allowed = VALID_TRANSITIONS[pipeline.state];
  if (!allowed || !allowed.includes(newState)) {
    throw new Error(`Invalid transition from ${pipeline.state} to ${newState}`);
  }

  pipeline.state = newState;
  pipeline.updatedAt = new Date().toISOString();

  if (newState === 'retry') {
    pipeline.attempts += 1;
  }

  pipelines.set(id, pipeline);
  persist(pipeline);
  return pipeline;
}

export function updatePipeline(id: string, updates: Partial<Omit<Pipeline, 'id' | 'state'>>): Pipeline {
  const pipeline = pipelines.get(id);
  if (!pipeline) throw new Error('Pipeline not found: ' + id);

  Object.assign(pipeline, updates);
  pipeline.updatedAt = new Date().toISOString();
  pipelines.set(id, pipeline);
  persist(pipeline);
  return pipeline;
}

export function deletePipeline(id: string): void {
  pipelines.delete(id);
  const filePath = path.join(pipelinesDir, id + '.json');
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }
}

export function loadAllPipelines(): void {
  ensureDir();
  const files = fs.readdirSync(pipelinesDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(pipelinesDir, file), 'utf8');
      const pipeline = JSON.parse(raw) as Pipeline;
      pipelines.set(pipeline.id, pipeline);
    } catch {
      // Skip malformed files
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-pipeline.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/belayer/pipeline.ts test/belayer-pipeline.test.ts
git commit -m "feat(belayer): add pipeline state machine with disk persistence"
```

---

### Task 3: TextSource adapter

**Files:**
- Create: `server/belayer/intake.ts`
- Test: `test/belayer-intake.test.ts`

**Step 1: Write the failing test**

Create `test/belayer-intake.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextSource, resolveTaskSource } from '../server/belayer/intake.js';

test('TextSource.canHandle returns true for any non-empty string', () => {
  const source = new TextSource();
  assert.equal(source.canHandle('hello world'), true);
  assert.equal(source.canHandle(''), false);
});

test('TextSource.name is "text"', () => {
  const source = new TextSource();
  assert.equal(source.name, 'text');
});

test('TextSource.fetch extracts title from first line', async () => {
  const source = new TextSource();
  const spec = await source.fetch('Add expense export feature\nShould export to CSV and PDF');
  assert.equal(spec.source, 'text');
  assert.equal(spec.title, 'Add expense export feature');
  assert.equal(spec.description, 'Should export to CSV and PDF');
});

test('TextSource.fetch handles single-line input', async () => {
  const source = new TextSource();
  const spec = await source.fetch('Fix the login bug');
  assert.equal(spec.title, 'Fix the login bug');
  assert.equal(spec.description, 'Fix the login bug');
});

test('TextSource.fetch trims whitespace', async () => {
  const source = new TextSource();
  const spec = await source.fetch('  Trim me  \n  Some description  ');
  assert.equal(spec.title, 'Trim me');
  assert.equal(spec.description, 'Some description');
});

test('TextSource.fetch handles multi-line descriptions', async () => {
  const source = new TextSource();
  const spec = await source.fetch('Title\nLine 1\nLine 2\nLine 3');
  assert.equal(spec.title, 'Title');
  assert.equal(spec.description, 'Line 1\nLine 2\nLine 3');
});

test('resolveTaskSource returns TextSource for plain text', () => {
  const source = resolveTaskSource('Just some text');
  assert.equal(source.name, 'text');
});

test('resolveTaskSource throws for empty input', () => {
  assert.throws(() => resolveTaskSource(''), /No task source can handle empty input/);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-intake.test.js`
Expected: FAIL — module not found

**Step 3: Implement the intake module**

Create `server/belayer/intake.ts`:

```typescript
import type { TaskSource, TaskSpec } from './types.js';

export class TextSource implements TaskSource {
  readonly name = 'text';

  canHandle(input: string): boolean {
    return input.trim().length > 0;
  }

  async fetch(input: string): Promise<TaskSpec> {
    const lines = input.trim().split('\n').map((l) => l.trim());
    const title = lines[0] || '';
    const description = lines.length > 1 ? lines.slice(1).join('\n') : title;

    return {
      source: 'text',
      title,
      description,
    };
  }
}

const sources: TaskSource[] = [new TextSource()];

export function resolveTaskSource(input: string): TaskSource {
  if (!input.trim()) {
    throw new Error('No task source can handle empty input');
  }
  for (const source of sources) {
    if (source.canHandle(input)) return source;
  }
  throw new Error('No task source can handle this input');
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-intake.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/belayer/intake.ts test/belayer-intake.test.ts
git commit -m "feat(belayer): add TextSource adapter and task source resolution"
```

---

### Task 4: Prompt templates

**Files:**
- Create: `server/belayer/prompts.ts`
- Test: `test/belayer-prompts.test.ts`

**Step 1: Write the failing test**

Create `test/belayer-prompts.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-prompts.test.js`
Expected: FAIL — module not found

**Step 3: Implement the prompts module**

Create `server/belayer/prompts.ts`:

```typescript
import type { TaskSpec, Verdict } from './types.js';

export function buildBrainstormPrompt(task: TaskSpec): string {
  let prompt = `You are a product engineer. Your goal is to brainstorm a design for the following task and produce a PRD (Product Requirements Document).

## Task

**Title:** ${task.title}

**Description:**
${task.description}
`;

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    prompt += `\n**Acceptance Criteria:**\n${task.acceptanceCriteria.map((c) => '- ' + c).join('\n')}\n`;
  }

  prompt += `
## Instructions

1. Analyze the task requirements
2. Brainstorm the design approach — consider trade-offs, alternatives, and edge cases
3. Produce a PRD with:
   - **Goal** (one sentence)
   - **Background** (context and motivation)
   - **Requirements** (numbered list of specific requirements)
   - **Acceptance Criteria** (testable criteria for each requirement)
   - **Technical Approach** (high-level architecture decisions)
   - **Non-Goals** (what this does NOT include)

Output the PRD as a markdown document.`;

  return prompt;
}

export function buildPlanPrompt(task: TaskSpec, prdContent: string): string {
  return `You are a senior engineer creating an implementation plan. You have a PRD to implement.

## Task

**Title:** ${task.title}

## PRD

${prdContent}

## Instructions

Create a detailed implementation plan with bite-sized tasks. For each task:
1. List exact files to create or modify
2. Describe the changes in detail
3. Include test requirements
4. Keep each task small enough to complete in one commit

Use the \`/harness:plan\` format: numbered tasks with file paths, step-by-step instructions, and commit messages.

Output the plan as a markdown document.`;
}

export function buildExecutionPrompt(task: TaskSpec, planContent: string, previousVerdicts?: Verdict[]): string {
  let prompt = `You are implementing a feature according to a plan. Follow the plan exactly, task by task. Use TDD where applicable. Commit after each task.

## Task

**Title:** ${task.title}

## Plan

${planContent}
`;

  if (previousVerdicts && previousVerdicts.length > 0) {
    prompt += `\n## PREVIOUS REVIEW FEEDBACK\n\nThe following review(s) found issues that must be fixed:\n\n`;
    for (const verdict of previousVerdicts) {
      prompt += `### Review: ${verdict.goalName}\n`;
      prompt += `**Result:** ${verdict.pass ? 'PASS' : 'FAIL'}\n`;
      prompt += `**Summary:** ${verdict.summary}\n`;
      for (const cr of verdict.criteriaResults) {
        if (!cr.met) {
          prompt += `- **FAILED:** ${cr.criterion}${cr.reason ? ' — ' + cr.reason : ''}\n`;
        }
      }
      if (verdict.suggestions && verdict.suggestions.length > 0) {
        prompt += `**Suggestions:** ${verdict.suggestions.join('; ')}\n`;
      }
      prompt += '\n';
    }
    prompt += `Fix ALL failed criteria before marking the work as complete.\n`;
  }

  prompt += `\n## Completion

When all tasks are done:
1. Run all tests and ensure they pass
2. Create a file \`.belayer/COMPLETE\` containing "done"
`;

  return prompt;
}

export function buildReviewPrompt(task: TaskSpec, worktreePath: string): string {
  let prompt = `You are an independent code reviewer. Review the implementation in this worktree against the task requirements.

## Task

**Title:** ${task.title}
**Description:** ${task.description}
`;

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    prompt += `\n**Acceptance Criteria:**\n${task.acceptanceCriteria.map((c) => '- ' + c).join('\n')}\n`;
  }

  prompt += `
## Instructions

1. Read the code changes (check git diff against the base branch)
2. Run the tests
3. Evaluate each acceptance criterion
4. Write a structured verdict

## Output

Write the verdict to \`.belayer/verdict.json\` with this exact shape:

\`\`\`json
{
  "goalName": "${task.title}",
  "pass": true or false,
  "criteriaResults": [
    { "criterion": "description", "met": true or false, "reason": "explanation" }
  ],
  "summary": "overall assessment",
  "suggestions": ["optional improvement suggestions"],
  "timestamp": "ISO 8601 timestamp"
}
\`\`\`

Be thorough but fair. Only fail criteria that are clearly not met.`;

  return prompt;
}

export function buildStuckPrompt(task: TaskSpec, verdicts: Verdict[], attempts: number): string {
  let prompt = `## STUCK REPORT

The pipeline for "${task.title}" is stuck after ${attempts} failed attempt(s).

## Verdict History

`;

  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]!;
    prompt += `### Attempt ${i + 1}: ${v.pass ? 'PASS' : 'FAIL'}\n`;
    prompt += `${v.summary}\n`;
    for (const cr of v.criteriaResults) {
      prompt += `- ${cr.met ? '✓' : '✗'} ${cr.criterion}${cr.reason ? ': ' + cr.reason : ''}\n`;
    }
    prompt += '\n';
  }

  prompt += `## Action Required

A human must review and decide:
1. **Fix and resume** — address the issues manually, then resume the pipeline
2. **Skip review** — force the pipeline to proceed to PR creation
3. **Abort** — cancel this pipeline
`;

  return prompt;
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-prompts.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/belayer/prompts.ts test/belayer-prompts.test.ts
git commit -m "feat(belayer): add prompt templates for brainstorm, plan, execute, review, stuck"
```

---

### Task 5: Executor (headless PTY spawning)

**Files:**
- Create: `server/belayer/executor.ts`
- Test: `test/belayer-executor.test.ts`

This module orchestrates the full pipeline lifecycle — spawning headless Claude sessions for brainstorm, plan, execute, and review phases.

**Step 1: Write the test for executor helpers**

Create `test/belayer-executor.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-executor.test.js`
Expected: FAIL — module not found

**Step 3: Implement the executor module**

Create `server/belayer/executor.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import * as sessions from '../sessions.js';
import type { Pipeline, Verdict } from './types.js';
import { transitionPipeline, updatePipeline, getPipeline } from './pipeline.js';
import { buildBrainstormPrompt, buildPlanPrompt, buildExecutionPrompt, buildReviewPrompt, buildStuckPrompt } from './prompts.js';

export function buildClaudeArgs(model: string): string[] {
  return ['-p', '--dangerously-skip-permissions', '--model', model];
}

export function parseVerdictFile(content: string): Verdict | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      typeof parsed.goalName !== 'string' ||
      typeof parsed.pass !== 'boolean' ||
      !Array.isArray(parsed.criteriaResults) ||
      typeof parsed.summary !== 'string'
    ) {
      return null;
    }
    return parsed as unknown as Verdict;
  } catch {
    return null;
  }
}

type PipelineEventCallback = (pipelineId: string, event: string, data?: Record<string, unknown>) => void;

let eventCallback: PipelineEventCallback | null = null;

export function onPipelineEvent(cb: PipelineEventCallback): void {
  eventCallback = cb;
}

function emitEvent(pipelineId: string, event: string, data?: Record<string, unknown>): void {
  if (eventCallback) eventCallback(pipelineId, event, data);
}

export async function startPipeline(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  // Move from intake to brainstorming
  transitionPipeline(pipelineId, 'brainstorming');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'brainstorming' });

  const prompt = buildBrainstormPrompt(pipeline.task);
  await runAgentPhase(pipelineId, prompt, pipeline.config.models.brainstorm, pipeline.config.targetRepo, (output) => {
    // Store brainstorm output as PRD
    updatePipeline(pipelineId, { prdContent: output });
    transitionPipeline(pipelineId, 'prd_review');
    emitEvent(pipelineId, 'pipeline-state-changed', { state: 'prd_review' });
  });
}

export async function approvePrd(pipelineId: string, editedContent?: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);
  if (pipeline.state !== 'prd_review') throw new Error('Pipeline not in prd_review state');

  if (editedContent) {
    updatePipeline(pipelineId, { prdContent: editedContent });
  }

  transitionPipeline(pipelineId, 'planning');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'planning' });

  const updatedPipeline = getPipeline(pipelineId)!;
  const prompt = buildPlanPrompt(updatedPipeline.task, updatedPipeline.prdContent || '');
  await runAgentPhase(pipelineId, prompt, updatedPipeline.config.models.brainstorm, updatedPipeline.config.targetRepo, (output) => {
    updatePipeline(pipelineId, { planContent: output });
    transitionPipeline(pipelineId, 'plan_review');
    emitEvent(pipelineId, 'pipeline-state-changed', { state: 'plan_review' });
  });
}

export async function approvePlan(pipelineId: string, editedContent?: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);
  if (pipeline.state !== 'plan_review') throw new Error('Pipeline not in plan_review state');

  if (editedContent) {
    updatePipeline(pipelineId, { planContent: editedContent });
  }

  await startExecution(pipelineId);
}

export async function startExecution(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  transitionPipeline(pipelineId, 'executing');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'executing' });

  const failedVerdicts = pipeline.verdicts.filter((v) => !v.pass);
  const prompt = buildExecutionPrompt(pipeline.task, pipeline.planContent || '', failedVerdicts.length > 0 ? failedVerdicts : undefined);

  // TODO: Create git worktree for execution if not already created
  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;

  await runAgentPhase(pipelineId, prompt, pipeline.config.models.execute, cwd, () => {
    startReview(pipelineId);
  });
}

export async function startReview(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  transitionPipeline(pipelineId, 'reviewing');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'reviewing' });

  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;
  const prompt = buildReviewPrompt(pipeline.task, cwd);

  await runAgentPhase(pipelineId, prompt, pipeline.config.models.review, cwd, () => {
    // Try to read verdict file
    const verdictPath = path.join(cwd, '.belayer', 'verdict.json');
    let verdict: Verdict | null = null;
    try {
      const content = fs.readFileSync(verdictPath, 'utf8');
      verdict = parseVerdictFile(content);
    } catch {
      // No verdict file
    }

    if (verdict) {
      const updatedPipeline = getPipeline(pipelineId)!;
      const verdicts = [...updatedPipeline.verdicts, verdict];
      updatePipeline(pipelineId, { verdicts });
      emitEvent(pipelineId, 'pipeline-verdict', { verdict });

      if (verdict.pass) {
        transitionPipeline(pipelineId, 'pr_created');
        emitEvent(pipelineId, 'pipeline-state-changed', { state: 'pr_created' });
        // TODO: create PR
      } else if (updatedPipeline.attempts >= updatedPipeline.maxAttempts) {
        const stuckReport = buildStuckPrompt(updatedPipeline.task, verdicts, updatedPipeline.attempts);
        updatePipeline(pipelineId, { stuckReport });
        transitionPipeline(pipelineId, 'stuck');
        emitEvent(pipelineId, 'pipeline-state-changed', { state: 'stuck' });
      } else {
        transitionPipeline(pipelineId, 'retry');
        emitEvent(pipelineId, 'pipeline-state-changed', { state: 'retry' });
        // Re-execute with feedback
        startExecution(pipelineId);
      }
    } else {
      // No verdict — treat as failure
      transitionPipeline(pipelineId, 'failed');
      updatePipeline(pipelineId, { error: 'Review did not produce a verdict.json file' });
      emitEvent(pipelineId, 'pipeline-state-changed', { state: 'failed' });
    }
  });
}

export async function resumeFromStuck(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);
  if (pipeline.state !== 'stuck') throw new Error('Pipeline not in stuck state');

  transitionPipeline(pipelineId, 'executing');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'executing' });
  await startExecution(pipelineId);
}

export function abortPipeline(pipelineId: string): void {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  // Kill active session if any
  if (pipeline.activeSessionId) {
    try {
      sessions.kill(pipeline.activeSessionId);
    } catch {
      // Session may already be gone
    }
    updatePipeline(pipelineId, { activeSessionId: undefined });
  }

  transitionPipeline(pipelineId, 'failed');
  updatePipeline(pipelineId, { error: 'Aborted by user' });
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'failed' });
}

async function runAgentPhase(
  pipelineId: string,
  prompt: string,
  model: string,
  cwd: string,
  onComplete: (output: string) => void,
): Promise<void> {
  const args = buildClaudeArgs(model);
  let output = '';

  const session = sessions.create({
    type: 'repo',
    repoPath: cwd,
    cwd,
    command: 'claude',
    args,
    displayName: `belayer-${pipelineId.slice(0, 8)}`,
  });

  updatePipeline(pipelineId, { activeSessionId: session.id });

  // Write prompt to the PTY's stdin
  sessions.write(session.id, prompt + '\n');

  // Monitor for completion via PTY exit
  const ptySession = sessions.get(session.id);
  if (ptySession) {
    // Collect output
    const dataDisposable = ptySession.pty.onData((data) => {
      output += data;
      emitEvent(pipelineId, 'pipeline-output', { chunk: data });
    });

    ptySession.pty.onExit(() => {
      dataDisposable.dispose();
      updatePipeline(pipelineId, { activeSessionId: undefined });
      onComplete(output);
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-executor.test.js`
Expected: All tests PASS (tests cover only the pure helper functions, not PTY-dependent code)

**Step 5: Commit**

```bash
git add server/belayer/executor.ts test/belayer-executor.test.ts
git commit -m "feat(belayer): add executor with pipeline lifecycle orchestration"
```

---

### Task 6: Reviewer (independent PTY + verdict parsing)

The reviewer logic is already integrated into `executor.ts` (the `startReview` function). This task adds the `pr-lifecycle.ts` module.

**Files:**
- Create: `server/belayer/pr-lifecycle.ts`
- Test: `test/belayer-pr-lifecycle.test.ts`

**Step 1: Write the test**

Create `test/belayer-pr-lifecycle.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrTitle, buildPrBody } from '../server/belayer/pr-lifecycle.js';
import type { TaskSpec, Pipeline } from '../server/belayer/types.js';
import { DEFAULT_PIPELINE_CONFIG } from '../server/belayer/types.js';

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
```

**Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-pr-lifecycle.test.js`
Expected: FAIL — module not found

**Step 3: Implement the pr-lifecycle module**

Create `server/belayer/pr-lifecycle.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TaskSpec, Pipeline } from './types.js';
import { updatePipeline, transitionPipeline, getPipeline } from './pipeline.js';

const execFileAsync = promisify(execFile);

export function buildPrTitle(task: TaskSpec): string {
  return `feat: ${task.title}`;
}

export function buildPrBody(task: TaskSpec, prdContent: string, attempts: number): string {
  return `## ${task.title}

${task.description}

**Automated by Belayer** — completed in ${attempts} attempt${attempts !== 1 ? 's' : ''}.

<details>
<summary>PRD</summary>

${prdContent}

</details>
`;
}

export async function createPullRequest(pipelineId: string): Promise<{ prNumber: number; prUrl: string }> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;
  const title = buildPrTitle(pipeline.task);
  const body = buildPrBody(pipeline.task, pipeline.prdContent || '', pipeline.attempts);

  // Push branch
  if (pipeline.config.autoPush && pipeline.branchName) {
    await execFileAsync('git', ['push', '-u', 'origin', pipeline.branchName], { cwd });
  }

  // Create PR via gh CLI
  const { stdout } = await execFileAsync('gh', [
    'pr', 'create',
    '--title', title,
    '--body', body,
    '--base', pipeline.config.baseBranch,
    '--json', 'number,url',
  ], { cwd });

  const result = JSON.parse(stdout) as { number: number; url: string };
  updatePipeline(pipelineId, {
    prNumber: result.number,
    prUrl: result.url,
  });

  return result;
}

export async function checkCiStatus(pipelineId: string): Promise<'pending' | 'success' | 'failure'> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline || !pipeline.prNumber) throw new Error('Pipeline has no PR');

  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;

  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'checks', String(pipeline.prNumber),
      '--json', 'state',
    ], { cwd });

    const checks = JSON.parse(stdout) as Array<{ state: string }>;
    if (checks.length === 0) return 'success'; // No CI configured
    if (checks.every((c) => c.state === 'SUCCESS' || c.state === 'SKIPPED')) return 'success';
    if (checks.some((c) => c.state === 'FAILURE' || c.state === 'ERROR')) return 'failure';
    return 'pending';
  } catch {
    return 'pending';
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/belayer-pr-lifecycle.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/belayer/pr-lifecycle.ts test/belayer-pr-lifecycle.test.ts
git commit -m "feat(belayer): add PR lifecycle module with gh CLI integration"
```

---

### Task 7: PR lifecycle (wiring into executor)

This task is handled by integrating `createPullRequest` from `pr-lifecycle.ts` into the executor flow. No new files needed — the wiring happens when the REST API routes call executor functions. Covered implicitly by Task 8.

---

### Task 8: REST API routes

**Files:**
- Modify: `server/index.ts` (add pipeline routes)

**Step 1: Add pipeline route imports and REST endpoints**

Add to `server/index.ts` after existing imports:

```typescript
import { createPipeline, getPipeline, listPipelines, deletePipeline, loadAllPipelines } from './belayer/pipeline.js';
import { resolveTaskSource } from './belayer/intake.js';
import { startPipeline, approvePrd, approvePlan, resumeFromStuck, abortPipeline, onPipelineEvent } from './belayer/executor.js';
import { DEFAULT_PIPELINE_CONFIG } from './belayer/types.js';
```

Add these routes after the existing `POST /update` route, before `server.listen`:

```typescript
  // Load persisted pipelines on startup
  loadAllPipelines();

  // Wire pipeline events to WebSocket broadcast
  onPipelineEvent((pipelineId, event, data) => {
    broadcastEvent(event, { id: pipelineId, ...data });
  });

  // GET /pipelines — list all pipelines
  app.get('/pipelines', requireAuth, (_req, res) => {
    res.json(listPipelines());
  });

  // GET /pipelines/:id — get pipeline detail
  app.get('/pipelines/:id', requireAuth, (req, res) => {
    const pipeline = getPipeline(req.params['id'] as string);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }
    res.json(pipeline);
  });

  // POST /pipelines — create pipeline from task input
  app.post('/pipelines', requireAuth, async (req, res) => {
    const { input, targetRepo, baseBranch } = req.body as {
      input?: string;
      targetRepo?: string;
      baseBranch?: string;
    };
    if (!input) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    if (!targetRepo) {
      res.status(400).json({ error: 'targetRepo is required' });
      return;
    }

    try {
      const source = resolveTaskSource(input);
      const task = await source.fetch(input);
      const pipelineConfig = {
        ...DEFAULT_PIPELINE_CONFIG,
        targetRepo,
        baseBranch: baseBranch || 'main',
      };
      const pipeline = createPipeline(task, pipelineConfig);

      // Start the pipeline asynchronously
      startPipeline(pipeline.id).catch((err) => {
        console.error('Pipeline start failed:', err);
      });

      res.status(201).json(pipeline);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create pipeline';
      res.status(400).json({ error: message });
    }
  });

  // POST /pipelines/:id/approve-prd
  app.post('/pipelines/:id/approve-prd', requireAuth, async (req, res) => {
    const { content } = req.body as { content?: string };
    try {
      await approvePrd(req.params['id'] as string, content);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve PRD';
      res.status(400).json({ error: message });
    }
  });

  // POST /pipelines/:id/approve-plan
  app.post('/pipelines/:id/approve-plan', requireAuth, async (req, res) => {
    const { content } = req.body as { content?: string };
    try {
      await approvePlan(req.params['id'] as string, content);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve plan';
      res.status(400).json({ error: message });
    }
  });

  // POST /pipelines/:id/resume — resume from stuck/failed
  app.post('/pipelines/:id/resume', requireAuth, async (req, res) => {
    try {
      await resumeFromStuck(req.params['id'] as string);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume pipeline';
      res.status(400).json({ error: message });
    }
  });

  // POST /pipelines/:id/abort — cancel pipeline
  app.post('/pipelines/:id/abort', requireAuth, (req, res) => {
    try {
      abortPipeline(req.params['id'] as string);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to abort pipeline';
      res.status(400).json({ error: message });
    }
  });

  // DELETE /pipelines/:id — delete pipeline
  app.delete('/pipelines/:id', requireAuth, (req, res) => {
    try {
      deletePipeline(req.params['id'] as string);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete pipeline';
      res.status(400).json({ error: message });
    }
  });
```

**Step 2: Verify build compiles**

Run: `npm run build:server`
Expected: TypeScript compilation succeeds with no errors

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(belayer): add REST API routes for pipeline CRUD and lifecycle"
```

---

### Task 9: WebSocket pipeline events

The WebSocket integration is already handled by `onPipelineEvent` + `broadcastEvent` wiring in Task 8. The existing `/ws/events` channel broadcasts all pipeline events. No new WebSocket channel needed.

**Step 1: Verify event types are broadcast**

The following events are emitted by executor.ts and broadcast via broadcastEvent:
- `pipeline-state-changed` — `{ id, state }`
- `pipeline-output` — `{ id, chunk }`
- `pipeline-verdict` — `{ id, verdict }`

No additional backend work needed. Commit is included in Task 8.

---

### Task 10: Frontend types + API client

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

**Step 1: Add frontend pipeline types**

Add to the end of `frontend/src/lib/types.ts`:

```typescript
export type PipelineState =
  | 'intake'
  | 'brainstorming'
  | 'prd_review'
  | 'planning'
  | 'plan_review'
  | 'executing'
  | 'reviewing'
  | 'retry'
  | 'stuck'
  | 'pr_created'
  | 'ci_monitoring'
  | 'ready_for_review'
  | 'done'
  | 'failed';

export interface TaskSpec {
  source: 'jira' | 'linear' | 'github' | 'text';
  externalId?: string | undefined;
  externalUrl?: string | undefined;
  title: string;
  description: string;
  acceptanceCriteria?: string[] | undefined;
  labels?: string[] | undefined;
  priority?: 'low' | 'medium' | 'high' | 'critical' | undefined;
}

export interface Verdict {
  goalName: string;
  pass: boolean;
  criteriaResults: Array<{
    criterion: string;
    met: boolean;
    reason?: string | undefined;
  }>;
  summary: string;
  suggestions?: string[] | undefined;
  timestamp: string;
}

export interface PipelineSummary {
  id: string;
  state: PipelineState;
  task: TaskSpec;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  prUrl?: string | undefined;
  error?: string | undefined;
}

export interface PipelineDetail extends PipelineSummary {
  prdContent?: string | undefined;
  planContent?: string | undefined;
  verdicts: Verdict[];
  stuckReport?: string | undefined;
  branchName?: string | undefined;
  prNumber?: number | undefined;
}
```

**Step 2: Add API client functions**

Add to the end of `frontend/src/lib/api.ts`:

```typescript
import type { PipelineSummary, PipelineDetail } from './types.js';

export async function fetchPipelines(): Promise<PipelineSummary[]> {
  return json<PipelineSummary[]>(await fetch('/pipelines'));
}

export async function fetchPipeline(id: string): Promise<PipelineDetail> {
  return json<PipelineDetail>(await fetch('/pipelines/' + id));
}

export async function createPipeline(body: {
  input: string;
  targetRepo: string;
  baseBranch?: string | undefined;
}): Promise<PipelineSummary> {
  const res = await fetch('/pipelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json<PipelineSummary>(res);
}

export async function approvePrd(id: string, content?: string): Promise<void> {
  await fetch('/pipelines/' + id + '/approve-prd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function approvePlan(id: string, content?: string): Promise<void> {
  await fetch('/pipelines/' + id + '/approve-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function resumePipeline(id: string): Promise<void> {
  await fetch('/pipelines/' + id + '/resume', { method: 'POST' });
}

export async function abortPipeline(id: string): Promise<void> {
  await fetch('/pipelines/' + id + '/abort', { method: 'POST' });
}

export async function deletePipeline(id: string): Promise<void> {
  await fetch('/pipelines/' + id, { method: 'DELETE' });
}
```

**Step 3: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat(belayer): add frontend types and API client for pipelines"
```

---

### Task 11: Frontend pipeline state module

**Files:**
- Create: `frontend/src/lib/state/pipelines.svelte.ts`

**Step 1: Create the state module**

Following the existing pattern from `sessions.svelte.ts`:

Create `frontend/src/lib/state/pipelines.svelte.ts`:

```typescript
import type { PipelineSummary, PipelineDetail, PipelineState } from '../types.js';
import * as api from '../api.js';

let pipelines = $state<PipelineSummary[]>([]);
let activePipelineId = $state<string | null>(null);
let activePipelineDetail = $state<PipelineDetail | null>(null);

export function getPipelineState() {
  return {
    get pipelines() { return pipelines; },
    get activePipelineId() { return activePipelineId; },
    set activePipelineId(id: string | null) { activePipelineId = id; },
    get activePipelineDetail() { return activePipelineDetail; },
  };
}

export async function refreshPipelines(): Promise<void> {
  try {
    pipelines = await api.fetchPipelines();
  } catch { /* silent */ }
}

export async function refreshActivePipeline(): Promise<void> {
  if (!activePipelineId) {
    activePipelineDetail = null;
    return;
  }
  try {
    activePipelineDetail = await api.fetchPipeline(activePipelineId);
  } catch {
    activePipelineDetail = null;
  }
}

export function handlePipelineEvent(event: { type: string; id?: string; state?: PipelineState }): void {
  if (event.type === 'pipeline-state-changed') {
    refreshPipelines();
    if (event.id === activePipelineId) {
      refreshActivePipeline();
    }
  } else if (event.type === 'pipeline-verdict') {
    if (event.id === activePipelineId) {
      refreshActivePipeline();
    }
  }
}

export function getPipelineStateLabel(pipelineState: PipelineState): string {
  const labels: Record<PipelineState, string> = {
    intake: 'Starting',
    brainstorming: 'Brainstorming',
    prd_review: 'PRD Review',
    planning: 'Planning',
    plan_review: 'Plan Review',
    executing: 'Executing',
    reviewing: 'Reviewing',
    retry: 'Retrying',
    stuck: 'Stuck',
    pr_created: 'PR Created',
    ci_monitoring: 'CI Running',
    ready_for_review: 'Ready for Review',
    done: 'Done',
    failed: 'Failed',
  };
  return labels[pipelineState] || pipelineState;
}

export function getPipelineStatusColor(pipelineState: PipelineState): string {
  if (pipelineState === 'done') return 'var(--green)';
  if (pipelineState === 'failed') return 'var(--red, #e74c3c)';
  if (pipelineState === 'stuck') return 'var(--amber, #f39c12)';
  if (pipelineState === 'prd_review' || pipelineState === 'plan_review' || pipelineState === 'ready_for_review') return 'var(--amber, #f39c12)';
  return 'var(--blue, #3498db)';
}
```

**Step 2: Run type check**

Run: `npm run check:svelte`
Expected: No type errors

**Step 3: Commit**

```bash
git add frontend/src/lib/state/pipelines.svelte.ts
git commit -m "feat(belayer): add frontend pipeline state module"
```

---

### Task 12: Pipeline sidebar tab + PipelineList component

**Files:**
- Modify: `frontend/src/lib/state/ui.svelte.ts` (add `'pipelines'` to `TabId`)
- Create: `frontend/src/components/PipelineList.svelte`
- Modify: `frontend/src/components/SessionList.svelte` (add fourth tab)

**Step 1: Add 'pipelines' to TabId union**

In `frontend/src/lib/state/ui.svelte.ts`, change:

```typescript
export type TabId = 'repos' | 'worktrees' | 'prs';
```

to:

```typescript
export type TabId = 'repos' | 'worktrees' | 'prs' | 'pipelines';
```

**Step 2: Create PipelineList.svelte**

Create `frontend/src/components/PipelineList.svelte`:

```svelte
<script lang="ts">
  import { getPipelineState, getPipelineStateLabel, getPipelineStatusColor } from '../lib/state/pipelines.svelte.js';
  import type { PipelineSummary } from '../lib/types.js';

  let {
    onSelectPipeline,
  }: {
    onSelectPipeline: (id: string) => void;
  } = $props();

  const pipelineState = getPipelineState();

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }
</script>

{#if pipelineState.pipelines.length === 0}
  <div class="empty-state">
    <p>No pipelines yet</p>
  </div>
{:else}
  {#each pipelineState.pipelines as pipeline (pipeline.id)}
    <button class="pipeline-item" class:active={pipelineState.activePipelineId === pipeline.id} onclick={() => onSelectPipeline(pipeline.id)}>
      <div class="row-1">
        <span class="status-dot" style:background={getPipelineStatusColor(pipeline.state)}></span>
        <span class="title">{pipeline.task.title}</span>
      </div>
      <div class="row-2">
        <span class="state-label">{getPipelineStateLabel(pipeline.state)}</span>
        {#if pipeline.attempts > 0}
          <span class="attempts">Attempt {pipeline.attempts}/{pipeline.maxAttempts}</span>
        {/if}
      </div>
      <div class="row-3">
        <span class="time">{relativeTime(pipeline.updatedAt)}</span>
      </div>
    </button>
  {/each}
{/if}

<style>
  .empty-state {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .pipeline-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    color: var(--text);
    font-size: 0.85rem;
  }

  .pipeline-item:hover {
    background: var(--surface-hover, rgba(255, 255, 255, 0.05));
  }

  .pipeline-item.active {
    background: var(--surface-active, rgba(255, 255, 255, 0.1));
  }

  .row-1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .row-2 {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 16px;
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .state-label {
    font-weight: 500;
  }

  .attempts {
    opacity: 0.7;
  }

  .row-3 {
    padding-left: 16px;
    color: var(--text-muted);
    font-size: 0.75rem;
    opacity: 0.7;
  }
</style>
```

**Step 3: Add the fourth tab to SessionList.svelte**

In `SessionList.svelte`, add the "Pipelines" tab to the tab bar. The exact edit depends on the current SessionList template — add a fourth tab button with `onclick={() => { ui.activeTab = 'pipelines'; }}` and render `<PipelineList>` when `ui.activeTab === 'pipelines'`.

Import at the top:

```typescript
import PipelineList from './PipelineList.svelte';
```

Add the tab button alongside existing tabs and conditionally render:

```svelte
{:else if ui.activeTab === 'pipelines'}
  <PipelineList onSelectPipeline={...} />
```

**Step 4: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 5: Commit**

```bash
git add frontend/src/lib/state/ui.svelte.ts frontend/src/components/PipelineList.svelte frontend/src/components/SessionList.svelte
git commit -m "feat(belayer): add Pipelines sidebar tab with PipelineList component"
```

---

### Task 13: IntakeDialog component

**Files:**
- Create: `frontend/src/components/dialogs/IntakeDialog.svelte`
- Modify: `frontend/src/App.svelte` (add dialog ref + handler)

**Step 1: Create the dialog component**

Create `frontend/src/components/dialogs/IntakeDialog.svelte`:

```svelte
<script lang="ts">
  import { getSessionState } from '../../lib/state/sessions.svelte.js';
  import * as api from '../../lib/api.js';
  import { refreshPipelines } from '../../lib/state/pipelines.svelte.js';
  import type { RepoInfo } from '../../lib/types.js';

  let {
    onPipelineCreated,
  }: {
    onPipelineCreated: (id: string) => void;
  } = $props();

  const sessionState = getSessionState();

  let dialogEl = $state<HTMLDialogElement | undefined>();
  let input = $state('');
  let selectedRepo = $state('');
  let baseBranch = $state('main');
  let creating = $state(false);
  let errorMsg = $state('');

  export function open(repo?: RepoInfo) {
    input = '';
    errorMsg = '';
    creating = false;
    if (repo) {
      selectedRepo = repo.path;
    } else if (sessionState.repos.length > 0) {
      selectedRepo = sessionState.repos[0]!.path;
    }
    dialogEl?.showModal();
  }

  async function handleSubmit() {
    if (!input.trim() || !selectedRepo) return;
    creating = true;
    errorMsg = '';
    try {
      const pipeline = await api.createPipeline({
        input: input.trim(),
        targetRepo: selectedRepo,
        baseBranch,
      });
      await refreshPipelines();
      dialogEl?.close();
      onPipelineCreated(pipeline.id);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Failed to create pipeline';
    } finally {
      creating = false;
    }
  }
</script>

<dialog bind:this={dialogEl}>
  <div class="dialog-content">
    <h3>New Pipeline</h3>

    <label>
      Task description
      <textarea bind:value={input} rows="5" placeholder="Describe the task, or paste a Jira/GitHub URL (v2)..."></textarea>
    </label>

    <label>
      Target repo
      <select bind:value={selectedRepo}>
        {#each sessionState.repos as repo (repo.path)}
          <option value={repo.path}>{repo.name}</option>
        {/each}
      </select>
    </label>

    <label>
      Base branch
      <input type="text" bind:value={baseBranch} placeholder="main" />
    </label>

    {#if errorMsg}
      <p class="error">{errorMsg}</p>
    {/if}

    <div class="actions">
      <button class="cancel-btn" onclick={() => dialogEl?.close()}>Cancel</button>
      <button class="create-btn" onclick={handleSubmit} disabled={creating || !input.trim() || !selectedRepo}>
        {creating ? 'Creating...' : 'Start Pipeline'}
      </button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0;
    max-width: 480px;
    width: 90vw;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
  }

  .dialog-content {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  textarea, input, select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.9rem;
    font-family: inherit;
    resize: vertical;
  }

  .error {
    color: var(--red, #e74c3c);
    font-size: 0.85rem;
    margin: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .cancel-btn, .create-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .cancel-btn {
    background: none;
    color: var(--text);
  }

  .create-btn {
    background: var(--accent, #3498db);
    color: white;
    border-color: transparent;
  }

  .create-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

**Step 2: Wire into App.svelte**

Add the `IntakeDialog` import and ref to `App.svelte`, wire it to a handler that the Pipelines tab can trigger.

**Step 3: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 4: Commit**

```bash
git add frontend/src/components/dialogs/IntakeDialog.svelte frontend/src/App.svelte
git commit -m "feat(belayer): add IntakeDialog for creating new pipelines"
```

---

### Task 14: PipelineView + state visualization

**Files:**
- Create: `frontend/src/components/PipelineView.svelte`
- Modify: `frontend/src/App.svelte` (render PipelineView in main content area when pipeline active)

**Step 1: Create PipelineView component**

Create `frontend/src/components/PipelineView.svelte`:

```svelte
<script lang="ts">
  import { getPipelineState, getPipelineStateLabel, getPipelineStatusColor, refreshActivePipeline } from '../lib/state/pipelines.svelte.js';
  import type { PipelineState } from '../lib/types.js';
  import { onMount } from 'svelte';

  const pipelineState = getPipelineState();

  const STATE_ORDER: PipelineState[] = [
    'intake', 'brainstorming', 'prd_review', 'planning', 'plan_review',
    'executing', 'reviewing', 'pr_created', 'ci_monitoring', 'ready_for_review', 'done',
  ];

  let stateIndex = $derived(
    pipelineState.activePipelineDetail
      ? STATE_ORDER.indexOf(pipelineState.activePipelineDetail.state)
      : -1,
  );

  onMount(() => {
    refreshActivePipeline();
  });

  function getStepClass(idx: number, currentState: PipelineState): string {
    const currentIdx = STATE_ORDER.indexOf(currentState);
    if (currentState === 'failed' || currentState === 'stuck') {
      if (idx <= currentIdx || currentIdx === -1) return 'step-error';
      return 'step-pending';
    }
    if (idx < currentIdx) return 'step-done';
    if (idx === currentIdx) return 'step-active';
    return 'step-pending';
  }
</script>

{#if pipelineState.activePipelineDetail}
  {@const detail = pipelineState.activePipelineDetail}
  <div class="pipeline-view">
    <div class="header">
      <h2>{detail.task.title}</h2>
      <span class="state-badge" style:background={getPipelineStatusColor(detail.state)}>
        {getPipelineStateLabel(detail.state)}
      </span>
      {#if detail.attempts > 0}
        <span class="attempts">Attempt {detail.attempts}/{detail.maxAttempts}</span>
      {/if}
    </div>

    <div class="progress-bar">
      {#each STATE_ORDER as step, i (step)}
        <div class="step {getStepClass(i, detail.state)}" title={getPipelineStateLabel(step)}>
          <div class="step-dot"></div>
          {#if i < STATE_ORDER.length - 1}
            <div class="step-line"></div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="sections">
      {#if detail.prdContent}
        <details class="artifact">
          <summary>PRD</summary>
          <pre class="artifact-content">{detail.prdContent}</pre>
        </details>
      {/if}

      {#if detail.planContent}
        <details class="artifact">
          <summary>Plan</summary>
          <pre class="artifact-content">{detail.planContent}</pre>
        </details>
      {/if}

      {#if detail.verdicts.length > 0}
        <details class="artifact" open>
          <summary>Verdicts ({detail.verdicts.length})</summary>
          {#each detail.verdicts as verdict, i (i)}
            <div class="verdict" class:pass={verdict.pass} class:fail={!verdict.pass}>
              <div class="verdict-header">
                Attempt {i + 1}: {verdict.pass ? 'PASS' : 'FAIL'}
              </div>
              <p>{verdict.summary}</p>
              {#each verdict.criteriaResults as cr (cr.criterion)}
                <div class="criterion" class:met={cr.met}>
                  <span>{cr.met ? '✓' : '✗'}</span>
                  <span>{cr.criterion}</span>
                  {#if cr.reason}
                    <span class="reason">{cr.reason}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </details>
      {/if}

      {#if detail.error}
        <div class="error-block">
          <strong>Error:</strong> {detail.error}
        </div>
      {/if}

      {#if detail.stuckReport}
        <details class="artifact" open>
          <summary>Stuck Report</summary>
          <pre class="artifact-content">{detail.stuckReport}</pre>
        </details>
      {/if}

      {#if detail.prUrl}
        <div class="pr-link">
          <a href={detail.prUrl} target="_blank" rel="noopener">View PR #{detail.prNumber}</a>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div class="no-pipeline">
    <p>Select a pipeline from the sidebar</p>
  </div>
{/if}

<style>
  .pipeline-view {
    padding: 24px;
    overflow-y: auto;
    height: 100%;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .header h2 {
    margin: 0;
    font-size: 1.2rem;
    flex: 1;
  }

  .state-badge {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
  }

  .attempts {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .progress-bar {
    display: flex;
    align-items: center;
    margin-bottom: 24px;
    overflow-x: auto;
  }

  .step {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .step-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
  }

  .step-line {
    width: 20px;
    height: 2px;
    background: var(--border);
  }

  .step-done .step-dot { background: var(--green, #2ecc71); }
  .step-done .step-line { background: var(--green, #2ecc71); }
  .step-active .step-dot { background: var(--blue, #3498db); box-shadow: 0 0 6px var(--blue, #3498db); }
  .step-error .step-dot { background: var(--red, #e74c3c); }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .artifact {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .artifact summary {
    padding: 10px 14px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
    background: var(--surface);
  }

  .artifact-content {
    padding: 14px;
    margin: 0;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
  }

  .verdict {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .verdict.pass { border-left: 3px solid var(--green, #2ecc71); }
  .verdict.fail { border-left: 3px solid var(--red, #e74c3c); }

  .verdict-header {
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 6px;
  }

  .verdict p {
    margin: 0 0 8px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .criterion {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    padding: 2px 0;
  }

  .criterion.met { color: var(--green, #2ecc71); }
  .criterion:not(.met) { color: var(--red, #e74c3c); }

  .reason {
    color: var(--text-muted);
    font-style: italic;
  }

  .error-block {
    padding: 12px 14px;
    background: rgba(231, 76, 60, 0.1);
    border: 1px solid var(--red, #e74c3c);
    border-radius: 8px;
    font-size: 0.85rem;
    color: var(--red, #e74c3c);
  }

  .pr-link {
    padding: 12px;
  }

  .pr-link a {
    color: var(--accent, #3498db);
    text-decoration: none;
    font-weight: 500;
  }

  .no-pipeline {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }
</style>
```

**Step 2: Add PipelineView to App.svelte**

In `App.svelte`, conditionally render `PipelineView` alongside the terminal area when a pipeline is active and the pipelines tab is selected. The pipeline view replaces the terminal area content.

**Step 3: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 4: Commit**

```bash
git add frontend/src/components/PipelineView.svelte frontend/src/App.svelte
git commit -m "feat(belayer): add PipelineView with state visualization and artifact display"
```

---

### Task 15: PRDReview + PlanReview components

**Files:**
- Create: `frontend/src/components/PRDReview.svelte`
- Create: `frontend/src/components/PlanReview.svelte`

These are embedded in `PipelineView` when the pipeline is in `prd_review` or `plan_review` state. They show the rendered markdown content with approve/edit/reject actions.

**Step 1: Create PRDReview.svelte**

Create `frontend/src/components/PRDReview.svelte`:

```svelte
<script lang="ts">
  import * as api from '../lib/api.js';
  import { refreshPipelines, refreshActivePipeline } from '../lib/state/pipelines.svelte.js';

  let {
    pipelineId,
    content,
  }: {
    pipelineId: string;
    content: string;
  } = $props();

  let editing = $state(false);
  let editedContent = $state('');
  let submitting = $state(false);

  function startEdit() {
    editedContent = content;
    editing = true;
  }

  async function approve() {
    submitting = true;
    try {
      await api.approvePrd(pipelineId, editing ? editedContent : undefined);
      await refreshPipelines();
      await refreshActivePipeline();
    } finally {
      submitting = false;
    }
  }
</script>

<div class="review-panel">
  <div class="review-header">
    <h3>PRD Review</h3>
    <span class="hint">Review the PRD, then approve or edit before planning begins.</span>
  </div>

  {#if editing}
    <textarea class="edit-area" bind:value={editedContent} rows="20"></textarea>
  {:else}
    <pre class="content">{content}</pre>
  {/if}

  <div class="actions">
    {#if !editing}
      <button class="edit-btn" onclick={startEdit}>Edit</button>
    {/if}
    <button class="approve-btn" onclick={approve} disabled={submitting}>
      {submitting ? 'Approving...' : 'Approve & Plan'}
    </button>
  </div>
</div>

<style>
  .review-panel {
    border: 2px solid var(--amber, #f39c12);
    border-radius: 8px;
    padding: 16px;
  }

  .review-header {
    margin-bottom: 12px;
  }

  .review-header h3 {
    margin: 0 0 4px;
    font-size: 1rem;
  }

  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .content {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    max-height: 500px;
    overflow-y: auto;
    margin: 0 0 12px;
  }

  .edit-area {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    font-family: monospace;
    font-size: 0.85rem;
    resize: vertical;
    margin-bottom: 12px;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .edit-btn, .approve-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .edit-btn {
    background: none;
    color: var(--text);
  }

  .approve-btn {
    background: var(--green, #2ecc71);
    color: white;
    border-color: transparent;
  }

  .approve-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

**Step 2: Create PlanReview.svelte**

Create `frontend/src/components/PlanReview.svelte` — nearly identical structure, calling `api.approvePlan` instead. Label reads "Approve & Execute".

```svelte
<script lang="ts">
  import * as api from '../lib/api.js';
  import { refreshPipelines, refreshActivePipeline } from '../lib/state/pipelines.svelte.js';

  let {
    pipelineId,
    content,
  }: {
    pipelineId: string;
    content: string;
  } = $props();

  let editing = $state(false);
  let editedContent = $state('');
  let submitting = $state(false);

  function startEdit() {
    editedContent = content;
    editing = true;
  }

  async function approve() {
    submitting = true;
    try {
      await api.approvePlan(pipelineId, editing ? editedContent : undefined);
      await refreshPipelines();
      await refreshActivePipeline();
    } finally {
      submitting = false;
    }
  }
</script>

<div class="review-panel">
  <div class="review-header">
    <h3>Plan Review</h3>
    <span class="hint">Review the plan, then approve to begin autonomous execution.</span>
  </div>

  {#if editing}
    <textarea class="edit-area" bind:value={editedContent} rows="20"></textarea>
  {:else}
    <pre class="content">{content}</pre>
  {/if}

  <div class="actions">
    {#if !editing}
      <button class="edit-btn" onclick={startEdit}>Edit</button>
    {/if}
    <button class="approve-btn" onclick={approve} disabled={submitting}>
      {submitting ? 'Approving...' : 'Approve & Execute'}
    </button>
  </div>
</div>

<style>
  .review-panel {
    border: 2px solid var(--amber, #f39c12);
    border-radius: 8px;
    padding: 16px;
  }

  .review-header {
    margin-bottom: 12px;
  }

  .review-header h3 {
    margin: 0 0 4px;
    font-size: 1rem;
  }

  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .content {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    max-height: 500px;
    overflow-y: auto;
    margin: 0 0 12px;
  }

  .edit-area {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    font-family: monospace;
    font-size: 0.85rem;
    resize: vertical;
    margin-bottom: 12px;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .edit-btn, .approve-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .edit-btn {
    background: none;
    color: var(--text);
  }

  .approve-btn {
    background: var(--green, #2ecc71);
    color: white;
    border-color: transparent;
  }

  .approve-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

**Step 3: Integrate into PipelineView**

In `PipelineView.svelte`, import and render `PRDReview` when `detail.state === 'prd_review'` and `PlanReview` when `detail.state === 'plan_review'`:

```svelte
{#if detail.state === 'prd_review' && detail.prdContent}
  <PRDReview pipelineId={detail.id} content={detail.prdContent} />
{:else if detail.state === 'plan_review' && detail.planContent}
  <PlanReview pipelineId={detail.id} content={detail.planContent} />
{/if}
```

**Step 4: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 5: Commit**

```bash
git add frontend/src/components/PRDReview.svelte frontend/src/components/PlanReview.svelte frontend/src/components/PipelineView.svelte
git commit -m "feat(belayer): add PRDReview and PlanReview components with approve/edit actions"
```

---

### Task 16: ExecutionMonitor + VerdictView + StuckReport components

These are rendered within `PipelineView` based on pipeline state.

**Files:**
- Create: `frontend/src/components/ExecutionMonitor.svelte`
- Create: `frontend/src/components/VerdictView.svelte`
- Create: `frontend/src/components/StuckReport.svelte`
- Modify: `frontend/src/components/PipelineView.svelte` (integrate components)

**Step 1: Create ExecutionMonitor.svelte**

A read-only terminal-like display that shows agent output streamed via WebSocket.

Create `frontend/src/components/ExecutionMonitor.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let {
    pipelineId,
  }: {
    pipelineId: string;
  } = $props();

  let outputEl = $state<HTMLPreElement | undefined>();
  let lines = $state<string[]>([]);

  // Listen for pipeline-output events from the event WebSocket
  // This is handled by the parent connecting via the event socket;
  // for now, output is accumulated from the pipeline detail refresh.
  // Future: subscribe to real-time WebSocket stream.

  export function appendOutput(chunk: string) {
    lines = [...lines, chunk];
    // Auto-scroll to bottom
    if (outputEl) {
      requestAnimationFrame(() => {
        if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
      });
    }
  }
</script>

<div class="monitor">
  <div class="monitor-header">
    <span class="indicator"></span>
    Live Output
  </div>
  <pre class="output" bind:this={outputEl}>{lines.join('')}</pre>
</div>

<style>
  .monitor {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .monitor-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--surface);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green, #2ecc71);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .output {
    background: var(--bg);
    color: var(--text);
    padding: 14px;
    margin: 0;
    font-size: 0.75rem;
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
  }
</style>
```

**Step 2: Create StuckReport.svelte**

Create `frontend/src/components/StuckReport.svelte`:

```svelte
<script lang="ts">
  import * as api from '../lib/api.js';
  import { refreshPipelines, refreshActivePipeline } from '../lib/state/pipelines.svelte.js';

  let {
    pipelineId,
    report,
  }: {
    pipelineId: string;
    report: string;
  } = $props();

  let submitting = $state(false);

  async function handleResume() {
    submitting = true;
    try {
      await api.resumePipeline(pipelineId);
      await refreshPipelines();
      await refreshActivePipeline();
    } finally {
      submitting = false;
    }
  }

  async function handleAbort() {
    submitting = true;
    try {
      await api.abortPipeline(pipelineId);
      await refreshPipelines();
      await refreshActivePipeline();
    } finally {
      submitting = false;
    }
  }
</script>

<div class="stuck-panel">
  <div class="stuck-header">
    <h3>Pipeline Stuck</h3>
    <span class="hint">Max retries exhausted. Review the report and choose an action.</span>
  </div>

  <pre class="report">{report}</pre>

  <div class="actions">
    <button class="abort-btn" onclick={handleAbort} disabled={submitting}>Abort</button>
    <button class="resume-btn" onclick={handleResume} disabled={submitting}>
      {submitting ? 'Resuming...' : 'Resume Execution'}
    </button>
  </div>
</div>

<style>
  .stuck-panel {
    border: 2px solid var(--red, #e74c3c);
    border-radius: 8px;
    padding: 16px;
  }

  .stuck-header {
    margin-bottom: 12px;
  }

  .stuck-header h3 {
    margin: 0 0 4px;
    font-size: 1rem;
    color: var(--red, #e74c3c);
  }

  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .report {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    max-height: 400px;
    overflow-y: auto;
    margin: 0 0 12px;
    padding: 12px;
    background: var(--bg);
    border-radius: 6px;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .abort-btn, .resume-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .abort-btn {
    background: none;
    color: var(--red, #e74c3c);
    border-color: var(--red, #e74c3c);
  }

  .resume-btn {
    background: var(--accent, #3498db);
    color: white;
    border-color: transparent;
  }

  .abort-btn:disabled, .resume-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

**Step 3: Integrate into PipelineView**

Add imports and conditional rendering in `PipelineView.svelte`:

```svelte
import ExecutionMonitor from './ExecutionMonitor.svelte';
import StuckReport from './StuckReport.svelte';

<!-- In the sections area: -->
{#if detail.state === 'executing' || detail.state === 'reviewing'}
  <ExecutionMonitor pipelineId={detail.id} />
{/if}

{#if detail.state === 'stuck' && detail.stuckReport}
  <StuckReport pipelineId={detail.id} report={detail.stuckReport} />
{/if}
```

**Step 4: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 5: Commit**

```bash
git add frontend/src/components/ExecutionMonitor.svelte frontend/src/components/StuckReport.svelte frontend/src/components/PipelineView.svelte
git commit -m "feat(belayer): add ExecutionMonitor and StuckReport components"
```

---

### Task 17: Integration wiring + build verification

**Files:**
- Modify: `frontend/src/App.svelte` (final wiring — event socket handlers, tab switching, pipeline view rendering)
- Modify: `frontend/src/lib/ws.ts` (handle pipeline event types in callback)

**Step 1: Wire pipeline events into App.svelte event socket handler**

In `App.svelte`, update the `connectEventSocket` callback to handle pipeline events:

```typescript
import { handlePipelineEvent, refreshPipelines } from './lib/state/pipelines.svelte.js';

// In the existing connectEventSocket callback:
connectEventSocket((msg) => {
  if (msg.type === 'worktrees-changed') {
    refreshAll();
  } else if (msg.type === 'session-idle-changed' && msg.sessionId) {
    setAttention(msg.sessionId, msg.idle ?? false);
  } else if (msg.type.startsWith('pipeline-')) {
    handlePipelineEvent(msg as any);
  }
});
```

**Step 2: Add pipeline refresh on auth**

In the `$effect` that refreshes on auth, also refresh pipelines:

```typescript
$effect(() => {
  if (auth.authenticated) {
    refreshAll();
    refreshPipelines();
  }
});
```

**Step 3: Conditionally render PipelineView or Terminal based on active tab**

When `ui.activeTab === 'pipelines'` and a pipeline is selected, show `PipelineView` instead of the terminal:

```svelte
{#if ui.activeTab === 'pipelines' && pipelineState.activePipelineId}
  <PipelineView />
{:else}
  <Terminal ... />
{/if}
```

**Step 4: Full build**

Run: `npm run build`
Expected: Both server and frontend compile without errors

**Step 5: Run all tests**

Run: `npm test`
Expected: All existing tests + new belayer tests pass

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(belayer): complete integration wiring and build verification"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
