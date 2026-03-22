import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { createIntegrationJiraRouter } from '../server/integration-jira.js';
import type { JiraIssue, JiraIssuesResponse, JiraStatus } from '../server/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusesResponse {
  statuses: JiraStatus[];
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FAKE_BASE_URL = 'https://fake-jira.atlassian.net';
const FAKE_TOKEN = 'test-api-token';
const FAKE_EMAIL = 'test@example.com';

// ─── Globals ──────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

/**
 * The real Node.js fetch, saved before any test replaces globalThis.fetch.
 * All HTTP calls from the test itself to the local Express server must use this.
 */
let realFetch: typeof globalThis.fetch;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Jira REST API issue shape for use in mock responses.
 */
function makeJiraApiIssue(overrides: {
  key?: string;
  summary?: string;
  status?: string;
  priority?: string | null;
  storyPoints?: number | null;
  sprint?: string | null;
  assignee?: string | null;
  updated?: string;
}): object {
  const {
    key = 'TEST-1',
    summary = 'Test issue',
    status = 'In Progress',
    priority = 'Medium',
    storyPoints = null,
    sprint = null,
    assignee = 'Jane Doe',
    updated = '2026-03-21T00:00:00.000+0000',
  } = overrides;

  return {
    key,
    self: `${FAKE_BASE_URL}/rest/api/3/issue/${key}`,
    fields: {
      summary,
      status: { name: status },
      priority: priority !== null ? { name: priority } : null,
      customfield_10016: storyPoints,
      customfield_10020: sprint !== null ? [{ name: sprint }] : null,
      assignee: assignee !== null ? { displayName: assignee } : null,
      updated,
    },
  };
}

/**
 * Builds a real Response with a given status and JSON body.
 */
function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

/**
 * Starts a fresh Express server with a new Jira router instance (and therefore
 * a fresh in-memory cache). Call this AFTER setting globalThis.fetch so the
 * router uses the mock when handling requests.
 */
function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/integration-jira', createIntegrationJiraRouter({ configPath: '' }));
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

// ─── Env var helpers ──────────────────────────────────────────────────────────

function setEnvVars(): void {
  process.env.JIRA_API_TOKEN = FAKE_TOKEN;
  process.env.JIRA_EMAIL = FAKE_EMAIL;
  process.env.JIRA_BASE_URL = FAKE_BASE_URL;
}

function clearEnvVars(): void {
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_BASE_URL;
}

// ─── Suite setup / teardown ───────────────────────────────────────────────────

before(() => {
  realFetch = globalThis.fetch;
  clearEnvVars();
});

after(async () => {
  globalThis.fetch = realFetch;
  clearEnvVars();
  await stopServer();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test('GET /configured returns true when all env vars are set', async () => {
  setEnvVars();
  globalThis.fetch = realFetch;
  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/configured`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { configured: boolean };
  assert.equal(body.configured, true);
});

test('GET /configured returns false when any env var is missing', async () => {
  clearEnvVars();
  // Set only two of the three required vars; JIRA_BASE_URL intentionally omitted
  process.env.JIRA_API_TOKEN = FAKE_TOKEN;
  process.env.JIRA_EMAIL = FAKE_EMAIL;
  globalThis.fetch = realFetch;
  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/configured`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { configured: boolean };
  assert.equal(body.configured, false);

  clearEnvVars();
});

test('GET /issues returns mapped JiraIssue[] from mocked Jira search response', async () => {
  setEnvVars();

  const mockSearchPayload = {
    issues: [
      makeJiraApiIssue({
        key: 'PROJ-42',
        summary: 'Fix the login bug',
        status: 'In Progress',
        priority: 'High',
        storyPoints: 3,
        sprint: 'Sprint 5',
        assignee: 'Alice',
        updated: '2026-03-21T12:00:00.000+0000',
      }),
      makeJiraApiIssue({
        key: 'PROJ-10',
        summary: 'Update docs',
        status: 'To Do',
        priority: null,
        storyPoints: null,
        sprint: null,
        assignee: null,
        updated: '2026-03-20T08:00:00.000+0000',
      }),
    ],
  };

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/api/3/search')) {
      return makeJsonResponse(mockSearchPayload);
    }
    return makeJsonResponse({ error: 'unexpected url' }, 500);
  };

  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/issues`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as JiraIssuesResponse;

  assert.equal(data.error, undefined, `Unexpected error: ${data.error}`);
  assert.equal(data.issues.length, 2);

  const issue42 = data.issues.find((i: JiraIssue) => i.key === 'PROJ-42');
  assert.ok(issue42, 'Should contain PROJ-42');
  assert.equal(issue42.title, 'Fix the login bug');
  assert.equal(issue42.status, 'In Progress');
  assert.equal(issue42.priority, 'High');
  assert.equal(issue42.storyPoints, 3);
  assert.equal(issue42.sprint, 'Sprint 5');
  assert.equal(issue42.assignee, 'Alice');
  assert.equal(issue42.url, `${FAKE_BASE_URL}/browse/PROJ-42`);
  assert.equal(issue42.projectKey, 'PROJ');

  const issue10 = data.issues.find((i: JiraIssue) => i.key === 'PROJ-10');
  assert.ok(issue10, 'Should contain PROJ-10');
  assert.equal(issue10.priority, null);
  assert.equal(issue10.storyPoints, null);
  assert.equal(issue10.sprint, null);
  assert.equal(issue10.assignee, null);

  // Verify sorted descending by updatedAt — PROJ-42 (newer) should come first
  assert.equal(data.issues[0]?.key, 'PROJ-42');
  assert.equal(data.issues[1]?.key, 'PROJ-10');
});

test('GET /issues caches results within TTL — fetch called only once for two requests', async () => {
  setEnvVars();

  let fetchCallCount = 0;
  const mockPayload = {
    issues: [makeJiraApiIssue({ key: 'CACHE-1', summary: 'Cached issue' })],
  };

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/api/3/search')) {
      fetchCallCount++;
      return makeJsonResponse(mockPayload);
    }
    return makeJsonResponse({}, 500);
  };

  await stopServer();
  await startServer();

  // First request — populates cache
  const firstRes = await realFetch(`${baseUrl}/integration-jira/issues`);
  const first = (await firstRes.json()) as JiraIssuesResponse;
  assert.equal(first.error, undefined, `Unexpected error: ${first.error}`);
  assert.equal(first.issues.length, 1);
  assert.equal(fetchCallCount, 1, 'fetch should be called once on first request');

  // Second request — should be served from cache, no additional fetch
  const secondRes = await realFetch(`${baseUrl}/integration-jira/issues`);
  const second = (await secondRes.json()) as JiraIssuesResponse;
  assert.equal(second.error, undefined, `Unexpected error: ${second.error}`);
  assert.equal(second.issues.length, 1);
  assert.equal(fetchCallCount, 1, 'fetch should not be called again within TTL (cache hit)');
});

test('GET /issues returns jira_not_configured when env vars missing', async () => {
  clearEnvVars();

  // fetch should never be called — use a mock that throws to verify early return
  globalThis.fetch = async (): Promise<Response> => {
    throw new Error('fetch should not be called when not configured');
  };

  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/issues`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as JiraIssuesResponse;

  assert.equal(data.error, 'jira_not_configured');
  assert.equal(data.issues.length, 0);
});

test('GET /statuses?projectKey=TEST returns deduplicated statuses from Jira project API', async () => {
  setEnvVars();

  // Jira returns one entry per issue type; statuses may overlap across types
  const mockProjectStatuses = [
    {
      statuses: [
        { id: '1', name: 'To Do' },
        { id: '2', name: 'In Progress' },
      ],
    },
    {
      statuses: [
        { id: '2', name: 'In Progress' }, // duplicate — should be filtered
        { id: '3', name: 'Done' },
      ],
    },
  ];

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/api/3/project/TEST/statuses')) {
      return makeJsonResponse(mockProjectStatuses);
    }
    return makeJsonResponse({}, 500);
  };

  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/statuses?projectKey=TEST`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as StatusesResponse;

  assert.equal(data.error, undefined, `Unexpected error: ${data.error}`);
  assert.equal(data.statuses.length, 3, 'Should deduplicate statuses by id');

  const ids = data.statuses.map((s: JiraStatus) => s.id);
  assert.deepEqual(ids, ['1', '2', '3']);

  const names = data.statuses.map((s: JiraStatus) => s.name);
  assert.deepEqual(names, ['To Do', 'In Progress', 'Done']);
});

test('GET /issues returns jira_auth_failed on 401 from Jira API', async () => {
  setEnvVars();

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/api/3/search')) {
      return makeJsonResponse({ message: 'Unauthorized' }, 401);
    }
    return makeJsonResponse({}, 500);
  };

  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/issues`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as JiraIssuesResponse;

  assert.equal(data.error, 'jira_auth_failed');
  assert.equal(data.issues.length, 0);
});

test('GET /statuses returns jira_auth_failed on 401 from Jira project API', async () => {
  setEnvVars();

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/api/3/project')) {
      return makeJsonResponse({ message: 'Unauthorized' }, 401);
    }
    return makeJsonResponse({}, 500);
  };

  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/statuses?projectKey=TEST`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as StatusesResponse;

  assert.equal(data.error, 'jira_auth_failed');
  assert.equal(data.statuses.length, 0);
});

test('GET /statuses returns 400 when projectKey query param is missing', async () => {
  setEnvVars();
  globalThis.fetch = realFetch;
  await stopServer();
  await startServer();

  const res = await realFetch(`${baseUrl}/integration-jira/statuses`);
  assert.equal(res.status, 400);
  const data = (await res.json()) as StatusesResponse;

  assert.equal(data.error, 'missing_project_key');
});
