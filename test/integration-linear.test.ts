import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';

import { createIntegrationLinearRouter } from '../server/integration-linear.js';
import type { LinearIssuesResponse } from '../server/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatesResponse {
  states: Array<{ id: string; name: string }>;
  error?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

// Saved before any mock replaces globalThis.fetch so test HTTP calls
// to the local Express server always reach it even when fetch is mocked.
let httpFetch: typeof globalThis.fetch;
let originalApiKey: string | undefined;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a single Linear issue node as returned by the GraphQL API. */
function makeIssueNode(overrides: Partial<{
  id: string;
  identifier: string;
  title: string;
  url: string;
  stateName: string;
  priority: number;
  priorityLabel: string;
  cycle: string | null;
  estimate: number | null;
  assigneeName: string | null;
  updatedAt: string;
  teamId: string;
}> = {}): object {
  return {
    id: overrides.id ?? 'issue-1',
    identifier: overrides.identifier ?? 'ENG-1',
    title: overrides.title ?? 'Test Issue',
    url: overrides.url ?? 'https://linear.app/team/issue/ENG-1',
    state: overrides.stateName != null ? { name: overrides.stateName } : { name: 'In Progress' },
    priority: overrides.priority ?? 2,
    priorityLabel: overrides.priorityLabel ?? 'Medium',
    cycle: (overrides.cycle !== undefined)
      ? (overrides.cycle !== null ? { name: overrides.cycle } : null)
      : null,
    estimate: overrides.estimate ?? null,
    assignee: overrides.assigneeName != null ? { name: overrides.assigneeName } : null,
    updatedAt: overrides.updatedAt ?? '2026-03-21T00:00:00Z',
    team: overrides.teamId != null ? { id: overrides.teamId } : { id: 'team-abc' },
  };
}

/** Builds a GraphQL issues response envelope. */
function makeIssuesGqlResponse(nodes: object[]): object {
  return {
    data: {
      viewer: {
        assignedIssues: {
          nodes,
        },
      },
    },
  };
}

/** Builds a GraphQL workflow states response envelope. */
function makeStatesGqlResponse(nodes: Array<{ id: string; name: string }>): object {
  return {
    data: {
      workflowStates: {
        nodes,
      },
    },
  };
}

/**
 * Returns a function suitable for replacing globalThis.fetch.
 * The returned mock always resolves with a minimal Response-shaped object.
 */
function makeMockFetch(
  gqlBody: object,
  opts: { status?: number; ok?: boolean } = {},
): typeof globalThis.fetch {
  const status = opts.status ?? 200;
  const ok = opts.ok !== undefined ? opts.ok : (status >= 200 && status < 300);
  return (async () => ({
    ok,
    status,
    json: async () => gqlBody,
  })) as unknown as typeof globalThis.fetch;
}

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    // configPath is unused by the Linear router at runtime; pass a dummy.
    app.use('/integration-linear', createIntegrationLinearRouter({ configPath: '/dev/null' }));
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

// Each test gets a fresh server instance so the module-level issuesCache starts
// at null. This is the only reliable way to clear cache state without exposing
// internals, since issuesCache lives in the router closure.
beforeEach(async () => {
  await startServer();
  // Capture real fetch AFTER server starts (so baseUrl is set) but BEFORE any
  // test mock replaces it. Used for all test-to-server HTTP calls.
  httpFetch = globalThis.fetch;
  originalApiKey = process.env['LINEAR_API_KEY'];
});

afterEach(async () => {
  await stopServer();
  globalThis.fetch = httpFetch;
  if (originalApiKey === undefined) {
    delete process.env['LINEAR_API_KEY'];
  } else {
    process.env['LINEAR_API_KEY'] = originalApiKey;
  }
});

// ─── GET /configured ─────────────────────────────────────────────────────────

test('GET /configured — returns { configured: true } when LINEAR_API_KEY is set', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';

  const res = await httpFetch(`${baseUrl}/integration-linear/configured`);
  assert.equal(res.ok, true);
  const body = await res.json() as { configured: boolean };
  assert.deepEqual(body, { configured: true });
});

test('GET /configured — returns { configured: false } when LINEAR_API_KEY is not set', async () => {
  delete process.env['LINEAR_API_KEY'];

  const res = await httpFetch(`${baseUrl}/integration-linear/configured`);
  assert.equal(res.ok, true);
  const body = await res.json() as { configured: boolean };
  assert.deepEqual(body, { configured: false });
});

// ─── GET /issues ──────────────────────────────────────────────────────────────

test('GET /issues — returns linear_not_configured error when API key is missing', async () => {
  delete process.env['LINEAR_API_KEY'];

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, 'linear_not_configured');
  assert.deepEqual(body.issues, []);
});

test('GET /issues — returns mapped LinearIssue[] from mocked GraphQL response', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';

  const nodes = [
    makeIssueNode({
      id: 'issue-abc',
      identifier: 'ENG-42',
      title: 'Build something',
      url: 'https://linear.app/team/issue/ENG-42',
      stateName: 'In Progress',
      priority: 1,
      priorityLabel: 'Urgent',
      cycle: 'Sprint 5',
      estimate: 3,
      assigneeName: 'Alice',
      updatedAt: '2026-03-21T12:00:00Z',
      teamId: 'team-xyz',
    }),
  ];
  globalThis.fetch = makeMockFetch(makeIssuesGqlResponse(nodes));

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, undefined, `Unexpected error: ${body.error}`);
  assert.equal(body.issues.length, 1);

  const issue = body.issues[0]!;
  assert.equal(issue.id, 'issue-abc');
  assert.equal(issue.identifier, 'ENG-42');
  assert.equal(issue.title, 'Build something');
  assert.equal(issue.url, 'https://linear.app/team/issue/ENG-42');
  assert.equal(issue.state, 'In Progress');
  assert.equal(issue.priority, 1);
  assert.equal(issue.priorityLabel, 'Urgent');
  assert.equal(issue.cycle, 'Sprint 5');
  assert.equal(issue.estimate, 3);
  assert.equal(issue.assignee, 'Alice');
  assert.equal(issue.updatedAt, '2026-03-21T12:00:00Z');
  assert.equal(issue.teamId, 'team-xyz');
});

test('GET /issues — caches results within TTL (fetch called only once for two requests)', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';

  let fetchCallCount = 0;
  const nodes = [makeIssueNode({ id: 'cached-issue', identifier: 'ENG-99' })];
  const mockBody = makeIssuesGqlResponse(nodes);

  globalThis.fetch = (async () => {
    fetchCallCount++;
    return { ok: true, status: 200, json: async () => mockBody };
  }) as unknown as typeof globalThis.fetch;

  // First request — populates cache
  const first = await httpFetch(`${baseUrl}/integration-linear/issues`);
  const firstBody = await first.json() as LinearIssuesResponse;
  assert.equal(firstBody.error, undefined, `Unexpected error on first request: ${firstBody.error}`);
  assert.equal(firstBody.issues.length, 1);
  assert.equal(fetchCallCount, 1, 'fetch should be called once on the first request');

  // Second request — should be served from cache, no additional fetch calls
  const second = await httpFetch(`${baseUrl}/integration-linear/issues`);
  const secondBody = await second.json() as LinearIssuesResponse;
  assert.equal(secondBody.error, undefined, `Unexpected error on second request: ${secondBody.error}`);
  assert.equal(secondBody.issues.length, 1);
  assert.equal(fetchCallCount, 1, 'fetch should not be called again within TTL (cache hit)');
});

// ─── GET /states ──────────────────────────────────────────────────────────────

test('GET /states — returns workflow states from mocked GraphQL response', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';

  const stateNodes = [
    { id: 'state-1', name: 'Backlog' },
    { id: 'state-2', name: 'In Progress' },
    { id: 'state-3', name: 'Done' },
  ];
  globalThis.fetch = makeMockFetch(makeStatesGqlResponse(stateNodes));

  const res = await httpFetch(`${baseUrl}/integration-linear/states?teamId=team-abc`);
  assert.equal(res.ok, true);
  const body = await res.json() as StatesResponse;
  assert.equal(body.error, undefined, `Unexpected error: ${body.error}`);
  assert.equal(body.states.length, 3);
  assert.deepEqual(body.states, stateNodes);
});

test('GET /states — returns linear_not_configured error when API key is missing', async () => {
  delete process.env['LINEAR_API_KEY'];

  const res = await httpFetch(`${baseUrl}/integration-linear/states?teamId=team-abc`);
  assert.equal(res.ok, true);
  const body = await res.json() as StatesResponse;
  assert.equal(body.error, 'linear_not_configured');
  assert.deepEqual(body.states, []);
});

test('GET /states — returns 400 missing_team_id when teamId query param is absent', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';

  const res = await httpFetch(`${baseUrl}/integration-linear/states`);
  assert.equal(res.status, 400);
  const body = await res.json() as StatesResponse;
  assert.equal(body.error, 'missing_team_id');
});

// ─── Error handling ───────────────────────────────────────────────────────────

test('auth failure (HTTP 401) returns linear_auth_failed for /issues', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_bad_key';
  globalThis.fetch = makeMockFetch({}, { status: 401, ok: false });

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, 'linear_auth_failed');
  assert.deepEqual(body.issues, []);
});

test('auth failure (HTTP 403) returns linear_auth_failed for /issues', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_bad_key';
  globalThis.fetch = makeMockFetch({}, { status: 403, ok: false });

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, 'linear_auth_failed');
  assert.deepEqual(body.issues, []);
});

test('non-ok response (HTTP 500) returns linear_fetch_failed for /issues', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';
  globalThis.fetch = makeMockFetch({}, { status: 500, ok: false });

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, 'linear_fetch_failed');
  assert.deepEqual(body.issues, []);
});

test('GraphQL-level authentication error returns linear_auth_failed', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';

  const gqlAuthError = {
    errors: [{ extensions: { type: 'authentication' } }],
    data: null,
  };
  globalThis.fetch = makeMockFetch(gqlAuthError);

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, 'linear_auth_failed');
  assert.deepEqual(body.issues, []);
});

test('network error (fetch throws) returns linear_fetch_failed for /issues', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';
  globalThis.fetch = (async () => { throw new Error('Network failure'); }) as unknown as typeof globalThis.fetch;

  const res = await httpFetch(`${baseUrl}/integration-linear/issues`);
  assert.equal(res.ok, true);
  const body = await res.json() as LinearIssuesResponse;
  assert.equal(body.error, 'linear_fetch_failed');
  assert.deepEqual(body.issues, []);
});

test('auth failure (HTTP 401) returns linear_auth_failed for /states', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_bad_key';
  globalThis.fetch = makeMockFetch({}, { status: 401, ok: false });

  const res = await httpFetch(`${baseUrl}/integration-linear/states?teamId=team-abc`);
  assert.equal(res.ok, true);
  const body = await res.json() as StatesResponse;
  assert.equal(body.error, 'linear_auth_failed');
  assert.deepEqual(body.states, []);
});

test('non-ok response (HTTP 500) returns linear_fetch_failed for /states', async () => {
  process.env['LINEAR_API_KEY'] = 'lin_test_key';
  globalThis.fetch = makeMockFetch({}, { status: 500, ok: false });

  const res = await httpFetch(`${baseUrl}/integration-linear/states?teamId=team-abc`);
  assert.equal(res.ok, true);
  const body = await res.json() as StatesResponse;
  assert.equal(body.error, 'linear_fetch_failed');
  assert.deepEqual(body.states, []);
});
