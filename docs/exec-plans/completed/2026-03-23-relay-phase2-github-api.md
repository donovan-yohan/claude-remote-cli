# Relay Phase 2: GitHub App + GraphQL API + Webhooks

> **Status**: Active | **Created**: 2026-03-23 | **Last Updated**: 2026-03-23
> **Design Doc**: `docs/design-docs/2026-03-23-relay-phase2-github-api-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-23 | Design | GitHub App OAuth for auth instead of reusing `gh` CLI tokens | Clean separation, enables webhook secret management, solves identity resolution |
| 2026-03-23 | Design | smee.io for webhook delivery to localhost | Standard pattern for dev tools, avoids public URL requirement, npm package available as library |
| 2026-03-23 | Design | GraphQL replaces `gh api search/issues` | Returns isDraft, reviewDecision, CI status, review requests — solving L-007/L-008/L-009 |
| 2026-03-23 | Design | Polling fallback when smee-client disconnects | Reliability for spotty connections, 30s GraphQL polling |
| 2026-03-23 | Plan | 7 tasks, sequential with some parallel potential | Types → GraphQL → OAuth → Webhooks → Server wiring → Frontend API → Frontend UI |

## Progress

- [x] Task 1: Type extensions + GraphQL client _(completed 2026-03-23)_
- [x] Task 2: GitHub App OAuth flow _(completed 2026-03-23)_
- [x] Task 3: Webhook handler _(completed 2026-03-23)_
- [x] Task 4: Org dashboard GraphQL upgrade _(completed 2026-03-23)_
- [x] Task 5: Server integration wiring + smee polling fallback _(completed 2026-03-23)_
- [x] Task 6: Frontend events, API, and settings _(completed 2026-03-23)_
- [x] Task 7: Frontend dashboard + sidebar enrichment _(completed 2026-03-23)_
- [x] Task 8: Priority sort + pr-status tests _(completed 2026-03-23)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Type extensions + GraphQL client

**Files:**
- Modify: `server/types.ts` — add `ciStatus` to PullRequest, add GitHub config to Config
- Modify: `frontend/src/lib/types.ts` — mirror PullRequest changes
- Create: `server/github-graphql.ts` — GraphQL query construction, response mapping
- Create: `test/github-graphql.test.ts` — unit tests for query and mapping

**Context:** The current `PullRequest` type is missing `ciStatus` fields. The `Config` type needs GitHub App settings (accessToken, username, webhookSecret, smeeUrl). The GraphQL module is a pure function layer: build query string, call `fetch`, map response to `PullRequest[]`. No Express dependency — just async functions that take a token and return data.

- [ ] **Step 1: Add CI status and GitHub config types to server/types.ts**

Add `ciStatus` to `PullRequest` and make `isDraft` required:
```typescript
// Change isDraft to required:
isDraft: boolean;
// After mergeable field:
ciStatus: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | null;
```

Add GitHub config to `Config`:
```typescript
// In Config interface, after integrations:
github?: {
  accessToken?: string;
  username?: string;
  webhookSecret?: string;
  smeeUrl?: string;
} | undefined;
```

- [ ] **Step 2: Mirror ciStatus in frontend types**

In `frontend/src/lib/types.ts`, change `isDraft` to required and add `ciStatus`:
```typescript
isDraft: boolean;
ciStatus: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | null;
```

Note: All existing callsites that construct `PullRequest` without `isDraft` will need `isDraft: false` added. The `ciStatus` field should default to `null` where unknown.

- [ ] **Step 3: Write failing tests for GraphQL query builder**

Create `test/github-graphql.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrSearchQuery, mapGraphQLResponse } from '../server/github-graphql.js';

test('buildPrSearchQuery returns valid GraphQL query string', () => {
  const query = buildPrSearchQuery();
  assert.ok(query.includes('search('));
  assert.ok(query.includes('isDraft'));
  assert.ok(query.includes('reviewDecision'));
  assert.ok(query.includes('statusCheckRollup'));
  assert.ok(query.includes('reviewRequests'));
});
```

Run: `npm run build:server && node --test dist/test/github-graphql.test.js`
Expected: FAIL — module not found

- [ ] **Step 4: Implement GraphQL query builder**

Create `server/github-graphql.ts`:
```typescript
import type { PullRequest } from './types.js';

const PR_SEARCH_QUERY = `query($query: String!) {
  viewer { login }
  search(query: $query, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number
        title
        state
        isDraft
        url
        updatedAt
        createdAt
        author { login }
        headRefName
        baseRefName
        repository { nameWithOwner }
        reviewDecision
        reviewRequests(first: 10) {
          nodes { requestedReviewer { ... on User { login } } }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
        mergeable
        additions
        deletions
      }
    }
  }
}`;

export function buildPrSearchQuery(): string {
  return PR_SEARCH_QUERY;
}
```

Run: `npm run build:server && node --test dist/test/github-graphql.test.js`
Expected: PASS

- [ ] **Step 5: Write failing tests for response mapper**

Add to `test/github-graphql.test.ts`:
```typescript
test('mapGraphQLResponse maps nodes to PullRequest[]', () => {
  const response = {
    data: {
      viewer: { login: 'testuser' },
      search: {
        nodes: [{
          number: 42,
          title: 'Test PR',
          state: 'OPEN',
          isDraft: false,
          url: 'https://github.com/owner/repo/pull/42',
          updatedAt: '2026-03-23T00:00:00Z',
          createdAt: '2026-03-22T00:00:00Z',
          author: { login: 'testuser' },
          headRefName: 'feature-branch',
          baseRefName: 'main',
          repository: { nameWithOwner: 'owner/repo' },
          reviewDecision: 'APPROVED',
          reviewRequests: { nodes: [] },
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
          mergeable: 'MERGEABLE',
          additions: 10,
          deletions: 5,
        }],
      },
    },
  };

  const repoMap = new Map([['owner/repo', '/workspace/repo']]);
  const result = mapGraphQLResponse(response, repoMap);

  assert.equal(result.prs.length, 1);
  assert.equal(result.prs[0].number, 42);
  assert.equal(result.prs[0].reviewDecision, 'APPROVED');
  assert.equal(result.prs[0].ciStatus, 'SUCCESS');
  assert.equal(result.prs[0].isDraft, false);
  assert.equal(result.prs[0].role, 'author');
  assert.equal(result.prs[0].repoName, 'repo');
  assert.equal(result.prs[0].repoPath, '/workspace/repo');
  assert.equal(result.username, 'testuser');
});

test('mapGraphQLResponse assigns reviewer role correctly', () => {
  const response = {
    data: {
      viewer: { login: 'testuser' },
      search: {
        nodes: [{
          number: 99,
          title: 'Someone else PR',
          state: 'OPEN',
          isDraft: false,
          url: 'https://github.com/owner/repo/pull/99',
          updatedAt: '2026-03-23T00:00:00Z',
          createdAt: '2026-03-22T00:00:00Z',
          author: { login: 'otheruser' },
          headRefName: 'other-branch',
          baseRefName: 'main',
          repository: { nameWithOwner: 'owner/repo' },
          reviewDecision: null,
          reviewRequests: { nodes: [{ requestedReviewer: { login: 'testuser' } }] },
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
          mergeable: 'UNKNOWN',
          additions: 0,
          deletions: 0,
        }],
      },
    },
  };

  const repoMap = new Map([['owner/repo', '/workspace/repo']]);
  const result = mapGraphQLResponse(response, repoMap);

  assert.equal(result.prs[0].role, 'reviewer');
  assert.equal(result.prs[0].ciStatus, null);
});

test('mapGraphQLResponse filters out repos not in workspace map', () => {
  const response = {
    data: {
      viewer: { login: 'testuser' },
      search: {
        nodes: [{
          number: 1,
          title: 'Unknown repo PR',
          state: 'OPEN',
          isDraft: false,
          url: 'https://github.com/unknown/repo/pull/1',
          updatedAt: '2026-03-23T00:00:00Z',
          createdAt: '2026-03-22T00:00:00Z',
          author: { login: 'testuser' },
          headRefName: 'branch',
          baseRefName: 'main',
          repository: { nameWithOwner: 'unknown/repo' },
          reviewDecision: null,
          reviewRequests: { nodes: [] },
          commits: { nodes: [] },
          mergeable: 'UNKNOWN',
          additions: 0,
          deletions: 0,
        }],
      },
    },
  };

  const repoMap = new Map<string, string>();
  const result = mapGraphQLResponse(response, repoMap);
  assert.equal(result.prs.length, 0);
});
```

Run: `npm run build:server && node --test dist/test/github-graphql.test.js`
Expected: FAIL — mapGraphQLResponse not found

- [ ] **Step 6: Implement response mapper**

Add to `server/github-graphql.ts`:
```typescript
import path from 'node:path';

interface GraphQLPrNode {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  updatedAt: string;
  createdAt: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  repository: { nameWithOwner: string };
  reviewDecision: string | null;
  reviewRequests: { nodes: Array<{ requestedReviewer: { login: string } | null }> };
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
  mergeable: string;
  additions: number;
  deletions: number;
}

interface GraphQLResponse {
  data: {
    viewer: { login: string };
    search: { nodes: GraphQLPrNode[] };
  };
}

interface MapResult {
  prs: PullRequest[];
  username: string;
}

export function mapGraphQLResponse(
  response: GraphQLResponse,
  repoMap: Map<string, string>,
): MapResult {
  const username = response.data.viewer.login;
  const nodes = response.data.search.nodes;
  const prs: PullRequest[] = [];

  for (const node of nodes) {
    const ownerRepo = node.repository.nameWithOwner.toLowerCase();
    const wsPath = repoMap.get(ownerRepo);
    if (!wsPath) continue;

    const isAuthor = node.author.login === username;
    const isReviewer = !isAuthor && node.reviewRequests.nodes.some(
      (r) => r.requestedReviewer?.login === username
    );
    if (!isAuthor && !isReviewer) continue;

    const rollup = node.commits.nodes[0]?.commit?.statusCheckRollup;
    const ciStatus = rollup?.state as PullRequest['ciStatus'] ?? null;

    prs.push({
      number: node.number,
      title: node.title,
      url: node.url,
      headRefName: node.headRefName,
      baseRefName: node.baseRefName,
      state: node.state as PullRequest['state'],
      author: node.author.login,
      role: isAuthor ? 'author' : 'reviewer',
      updatedAt: node.updatedAt,
      additions: node.additions,
      deletions: node.deletions,
      reviewDecision: node.reviewDecision,
      mergeable: node.mergeable,
      isDraft: node.isDraft,
      ciStatus,
      repoName: path.basename(wsPath),
      repoPath: wsPath,
    });
  }

  return { prs, username };
}
```

Run: `npm run build:server && node --test dist/test/github-graphql.test.js`
Expected: PASS

- [ ] **Step 7: Write failing test for fetchPrsGraphQL**

Add to `test/github-graphql.test.ts`:
```typescript
import { fetchPrsGraphQL } from '../server/github-graphql.js';

test('fetchPrsGraphQL calls GitHub GraphQL API with token', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody = '';

  const mockFetch = async (url: string, opts: { headers: Record<string, string>; method: string; body: string }) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = opts.body;
    return {
      ok: true,
      json: async () => ({
        data: {
          viewer: { login: 'testuser' },
          search: { nodes: [] },
        },
      }),
    };
  };

  const repoMap = new Map<string, string>();
  const result = await fetchPrsGraphQL('test-token', repoMap, mockFetch as any);

  assert.equal(capturedUrl, 'https://api.github.com/graphql');
  assert.equal(capturedHeaders['Authorization'], 'Bearer test-token');
  assert.equal(result.prs.length, 0);
  assert.equal(result.username, 'testuser');
});

test('fetchPrsGraphQL throws on 401', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Bad credentials' }),
  });

  const repoMap = new Map<string, string>();
  await assert.rejects(
    () => fetchPrsGraphQL('bad-token', repoMap, mockFetch as any),
    (err: Error) => {
      assert.ok(err.message.includes('401'));
      return true;
    },
  );
});
```

Run: `npm run build:server && node --test dist/test/github-graphql.test.js`
Expected: FAIL — fetchPrsGraphQL not found

- [ ] **Step 8: Implement fetchPrsGraphQL**

Add to `server/github-graphql.ts`:
```typescript
type FetchFn = typeof globalThis.fetch;

export async function fetchPrsGraphQL(
  token: string,
  repoMap: Map<string, string>,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<MapResult> {
  const res = await fetchFn('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: PR_SEARCH_QUERY,
      variables: { query: 'is:pr is:open involves:@me' },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`GitHub GraphQL ${res.status}: ${body.message ?? 'unknown error'}`);
  }

  const json = await res.json() as GraphQLResponse;
  return mapGraphQLResponse(json, repoMap);
}
```

Run: `npm run build:server && node --test dist/test/github-graphql.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/types.ts server/github-graphql.ts frontend/src/lib/types.ts test/github-graphql.test.ts
git commit -m "feat: add GraphQL client for GitHub PR data with type extensions"
```

---

### Task 2: GitHub App OAuth flow

**Files:**
- Create: `server/github-app.ts` — OAuth routes, token management
- Create: `test/github-app.test.ts` — OAuth endpoint tests
- Modify: `package.json` — add `smee-client` dependency

**Context:** The OAuth flow has 3 endpoints: GET `/auth/github` (redirect to GitHub), GET `/auth/github/callback` (exchange code for token), GET `/auth/github/status` (check connection state). Token is stored in config.json under `github.accessToken`. The smee-client lifecycle is managed here too but the actual smee setup happens in Task 5.

- [ ] **Step 1: Install smee-client**

Run: `npm install smee-client`

- [ ] **Step 2: Write failing tests for OAuth endpoints**

Create `test/github-app.test.ts`:
```typescript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { createGitHubAppRouter, type GitHubAppDeps } from '../server/github-app.js';
import { saveConfig, DEFAULTS } from '../server/config.js';

let tmpDir: string;
let configPath: string;
let server: Server;
let baseUrl: string;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-app-test-'));
  configPath = path.join(tmpDir, 'config.json');
  saveConfig(configPath, { ...DEFAULTS, repos: [] });

  const app = express();
  app.use(express.json());

  const deps: GitHubAppDeps = {
    configPath,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };
  const router = createGitHubAppRouter(deps);
  app.use('/auth/github', router);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /auth/github returns redirect URL', async () => {
  const res = await fetch(`${baseUrl}/auth/github`);
  assert.equal(res.status, 200);
  const data = await res.json() as { url: string };
  assert.ok(data.url.includes('github.com/login/oauth/authorize'));
  assert.ok(data.url.includes('client_id=test-client-id'));
});

test('GET /auth/github/status returns disconnected when no token', async () => {
  const res = await fetch(`${baseUrl}/auth/github/status`);
  assert.equal(res.status, 200);
  const data = await res.json() as { connected: boolean };
  assert.equal(data.connected, false);
});
```

Run: `npm run build:server && node --test dist/test/github-app.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OAuth router**

Create `server/github-app.ts`:
```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadConfig, saveConfig } from './config.js';
import type { Config } from './types.js';

export interface GitHubAppDeps {
  configPath: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof globalThis.fetch;
}

export function createGitHubAppRouter(deps: GitHubAppDeps): Router {
  const { configPath, clientId, clientSecret } = deps;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const router = Router();

  function getConfig(): Config {
    return loadConfig(configPath);
  }

  // GET / — return OAuth authorization URL
  router.get('/', (_req: Request, res: Response) => {
    const redirectUri = `${_req.protocol}://${_req.get('host')}/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
    res.json({ url });
  });

  // GET /callback — exchange code for token
  router.get('/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).json({ error: 'missing_code' });
      return;
    }

    try {
      const tokenRes = await fetchFn('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        res.status(400).json({ error: tokenData.error ?? 'token_exchange_failed' });
        return;
      }

      // Fetch username
      const userRes = await fetchFn('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '{ viewer { login } }' }),
      });
      const userData = await userRes.json() as { data?: { viewer?: { login: string } } };
      const username = userData.data?.viewer?.login ?? '';

      // Save to config
      const config = getConfig();
      config.github = {
        ...config.github,
        accessToken: tokenData.access_token,
        username,
      };
      saveConfig(configPath, config);

      // Redirect back to app with success message
      res.send('<html><body><script>window.close();</script><p>GitHub connected! You can close this tab.</p></body></html>');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'oauth_failed', message: msg });
    }
  });

  // GET /status — check connection state
  router.get('/status', (_req: Request, res: Response) => {
    const config = getConfig();
    const token = config.github?.accessToken;
    res.json({
      connected: !!token,
      username: config.github?.username ?? null,
    });
  });

  // POST /disconnect — remove token
  router.post('/disconnect', (_req: Request, res: Response) => {
    const config = getConfig();
    delete config.github;
    saveConfig(configPath, config);
    res.json({ ok: true });
  });

  return router;
}
```

Run: `npm run build:server && node --test dist/test/github-app.test.js`
Expected: PASS

- [ ] **Step 4: Write callback test with mock fetch**

Add to `test/github-app.test.ts`:
```typescript
test('GET /auth/github/callback exchanges code for token', async () => {
  // Set up a new server with mock fetch
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-app-cb-'));
  const configPath2 = path.join(tmpDir2, 'config.json');
  saveConfig(configPath2, { ...DEFAULTS, repos: [] });

  const mockFetch = async (url: string, opts: any) => {
    if (url.includes('access_token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'ghp_test123' }),
      };
    }
    if (url.includes('graphql')) {
      return {
        ok: true,
        json: async () => ({ data: { viewer: { login: 'octocat' } } }),
      };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  const app2 = express();
  app2.use(express.json());
  const router2 = createGitHubAppRouter({
    configPath: configPath2,
    clientId: 'cid',
    clientSecret: 'csec',
    fetchFn: mockFetch as any,
  });
  app2.use('/auth/github', router2);

  const server2 = await new Promise<Server>((resolve) => {
    const s = app2.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port2 = (server2.address() as { port: number }).port;

  const res = await fetch(`http://127.0.0.1:${port2}/auth/github/callback?code=test-code`, { redirect: 'manual' });
  assert.equal(res.status, 200);

  // Verify token was saved
  const config = JSON.parse(fs.readFileSync(configPath2, 'utf-8'));
  assert.equal(config.github.accessToken, 'ghp_test123');
  assert.equal(config.github.username, 'octocat');

  await new Promise<void>((resolve) => server2.close(() => resolve()));
  fs.rmSync(tmpDir2, { recursive: true, force: true });
});
```

Run: `npm run build:server && node --test dist/test/github-app.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/github-app.ts test/github-app.test.ts package.json package-lock.json
git commit -m "feat: add GitHub App OAuth flow with token management"
```

---

### Task 3: Webhook handler

**Files:**
- Create: `server/webhooks.ts` — webhook endpoint, HMAC verification, event routing
- Create: `test/webhooks.test.ts` — signature verification and event routing tests

**Context:** The webhook handler receives POST requests from smee.io → GitHub. It verifies the `X-Hub-Signature-256` HMAC-SHA256 header, then routes events to `broadcastEvent` which pushes them to the frontend via WebSocket. The endpoint is mounted at `/webhooks` without auth middleware (GitHub sends the requests, not the user).

- [ ] **Step 1: Write failing tests for signature verification**

Create `test/webhooks.test.ts`:
```typescript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { createWebhookRouter, type WebhookDeps } from '../server/webhooks.js';

function signPayload(secret: string, payload: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return 'sha256=' + hmac.digest('hex');
}

let server: Server;
let baseUrl: string;
let broadcastedEvents: Array<{ type: string; data?: Record<string, unknown> }>;

before(async () => {
  broadcastedEvents = [];
  const app = express();
  app.use(express.json());

  const deps: WebhookDeps = {
    secret: 'test-webhook-secret',
    broadcastEvent: (type, data) => { broadcastedEvents.push({ type, data }); },
    getWorkspacePaths: () => ['/workspace/repo'],
  };
  const router = createWebhookRouter(deps);
  app.use('/webhooks', router);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('rejects request with missing signature', async () => {
  const res = await fetch(`${baseUrl}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'opened' }),
  });
  assert.equal(res.status, 401);
});

test('rejects request with invalid signature', async () => {
  const body = JSON.stringify({ action: 'opened' });
  const res = await fetch(`${baseUrl}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=invalid',
    },
    body,
  });
  assert.equal(res.status, 401);
});

test('accepts request with valid signature and routes pull_request event', async () => {
  broadcastedEvents = [];
  const payload = JSON.stringify({ action: 'opened' });
  const signature = signPayload('test-webhook-secret', payload);

  const res = await fetch(`${baseUrl}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-GitHub-Event': 'pull_request',
    },
    body: payload,
  });
  assert.equal(res.status, 200);
  assert.equal(broadcastedEvents.length, 1);
  assert.equal(broadcastedEvents[0].type, 'pr-updated');
});

test('routes check_suite event to ci-updated', async () => {
  broadcastedEvents = [];
  const payload = JSON.stringify({ action: 'completed' });
  const signature = signPayload('test-webhook-secret', payload);

  const res = await fetch(`${baseUrl}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-GitHub-Event': 'check_suite',
    },
    body: payload,
  });
  assert.equal(res.status, 200);
  assert.equal(broadcastedEvents.length, 1);
  assert.equal(broadcastedEvents[0].type, 'ci-updated');
});

test('ignores unknown events', async () => {
  broadcastedEvents = [];
  const payload = JSON.stringify({ action: 'created' });
  const signature = signPayload('test-webhook-secret', payload);

  const res = await fetch(`${baseUrl}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-GitHub-Event': 'star',
    },
    body: payload,
  });
  assert.equal(res.status, 200);
  assert.equal(broadcastedEvents.length, 0);
});
```

Run: `npm run build:server && node --test dist/test/webhooks.test.js`
Expected: FAIL — module not found

- [ ] **Step 2: Implement webhook router**

Create `server/webhooks.ts`:
```typescript
import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';

export interface WebhookDeps {
  secret: string;
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void;
  getWorkspacePaths: () => string[];
}

const ROUTABLE_EVENTS: Record<string, string> = {
  'pull_request': 'pr-updated',
  'pull_request_review': 'pr-updated',
  'check_suite': 'ci-updated',
};

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: 'missing_signature' });
      return;
    }

    const payload = JSON.stringify(req.body);
    if (!verifySignature(deps.secret, payload, signature)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    const event = req.headers['x-github-event'] as string | undefined;
    const broadcastType = event ? ROUTABLE_EVENTS[event] : undefined;

    if (broadcastType) {
      deps.broadcastEvent(broadcastType);
    }

    res.json({ ok: true });
  });

  return router;
}
```

Run: `npm run build:server && node --test dist/test/webhooks.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/webhooks.ts test/webhooks.test.ts
git commit -m "feat: add webhook handler with HMAC signature verification"
```

---

### Task 4: Org dashboard GraphQL upgrade

**Files:**
- Modify: `server/org-dashboard.ts` — add GraphQL path when token available, keep gh CLI fallback
- Modify: `test/org-dashboard.test.ts` — add tests for GraphQL path

**Context:** The org-dashboard currently uses `gh api search/issues`. When a GitHub token is in config, it should use `fetchPrsGraphQL` instead. When no token is present, fall back to the existing `gh` CLI path. The `buildRepoMap` helper is reused. The response type is the same `PullRequestsResponse`.

- [ ] **Step 1: Add GraphQL dep to OrgDashboardDeps and implement dual-path**

Modify `server/org-dashboard.ts`:
- Add to `OrgDashboardDeps`:
  ```typescript
  fetchGraphQL?: (token: string, repoMap: Map<string, string>) => Promise<{ prs: PullRequest[]; username: string }>;
  ```
- In the `GET /prs` handler, before the `gh api` call, check if `config.github?.accessToken` exists. If so, use the GraphQL path:
  ```typescript
  const githubToken = config.github?.accessToken;
  if (githubToken && deps.fetchGraphQL) {
    try {
      const result = await deps.fetchGraphQL(githubToken, repoMap);
      cachedUser = result.username;
      cache = { prs: result.prs, fetchedAt: now };
      // Fire ticket transitions (same as before)
      const response: PullRequestsResponse = { prs: result.prs };
      res.json(response);
      return;
    } catch {
      // Fall through to gh CLI path
    }
  }
  ```

- [ ] **Step 2: Write test for GraphQL path**

Add to `test/org-dashboard.test.ts`:
```typescript
test('uses GraphQL when GitHub token is configured', async () => {
  saveConfig(configPath, {
    ...DEFAULTS,
    repos: [],
    workspaces: [WORKSPACE_PATH_A],
    github: { accessToken: 'ghp_test123', username: 'testuser' },
  });

  // Tear down and rebuild server with GraphQL mock
  await new Promise<void>((resolve) => server.close(() => resolve()));

  let graphqlCalled = false;
  const mockGraphQL = async (_token: string, _repoMap: Map<string, string>) => {
    graphqlCalled = true;
    return {
      prs: [{
        number: 42,
        title: 'GraphQL PR',
        url: 'https://github.com/owner/repo-a/pull/42',
        headRefName: 'feat',
        baseRefName: 'main',
        state: 'OPEN' as const,
        author: 'testuser',
        role: 'author' as const,
        updatedAt: '2026-03-23T00:00:00Z',
        additions: 5,
        deletions: 2,
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        isDraft: false,
        ciStatus: 'SUCCESS' as const,
        repoName: 'repo-a',
        repoPath: WORKSPACE_PATH_A,
      }],
      username: 'testuser',
    };
  };

  const mockExec = makeMockExec({
    remotes: { [WORKSPACE_PATH_A]: 'https://github.com/owner/repo-a.git' },
    userLogin: 'testuser',
    searchItems: [],
  });

  const app2 = express();
  app2.use(express.json());
  const router2 = createOrgDashboardRouter({
    configPath,
    execAsync: mockExec as OrgDashboardDeps['execAsync'],
    fetchGraphQL: mockGraphQL,
  });
  app2.use('/org-dashboard', router2);

  const server2 = await new Promise<Server>((resolve) => {
    const s = app2.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port2 = (server2.address() as { port: number }).port;

  const res = await fetch(`http://127.0.0.1:${port2}/org-dashboard/prs`);
  const data = await res.json() as PullRequestsResponse;

  assert.ok(graphqlCalled);
  assert.equal(data.prs.length, 1);
  assert.equal(data.prs[0].title, 'GraphQL PR');
  assert.equal(data.prs[0].ciStatus, 'SUCCESS');

  await new Promise<void>((resolve) => server2.close(() => resolve()));

  // Restore original server for remaining tests
  const app = express();
  app.use(express.json());
  const router = createOrgDashboardRouter({
    configPath,
    execAsync: makeMockExec({ remotes: {}, searchItems: [] }) as OrgDashboardDeps['execAsync'],
  });
  app.use('/org-dashboard', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
```

Run: `npm run build:server && node --test dist/test/org-dashboard.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/org-dashboard.ts test/org-dashboard.test.ts
git commit -m "feat: org dashboard uses GraphQL when GitHub token available, falls back to gh CLI"
```

---

### Task 5: Server integration wiring + smee polling fallback

**Files:**
- Modify: `server/index.ts` — mount OAuth, webhook routes; wire GraphQL to org-dashboard; start smee-client with polling fallback
- Modify: `server/ws.ts` — no changes needed (broadcastEvent already exists)

**Context:** This task wires everything together. Mount `/auth/github` routes (no auth middleware — the OAuth callback needs to be accessible). Mount `/webhooks` route (no auth — GitHub sends these). Pass `fetchPrsGraphQL` to org-dashboard deps. Start smee-client when config has `smeeUrl`, with fallback to 30s GraphQL polling when smee disconnects (3 consecutive errors).

- [ ] **Step 1: Add imports to server/index.ts**

Add imports at top of file:
```typescript
import { createGitHubAppRouter } from './github-app.js';
import { createWebhookRouter } from './webhooks.js';
import { fetchPrsGraphQL } from './github-graphql.js';
```

- [ ] **Step 2: Mount GitHub OAuth routes**

After hooks router mount (line ~318), add:
```typescript
// GitHub App OAuth (no auth — callback comes from GitHub redirect)
const githubAppRouter = createGitHubAppRouter({
  configPath: CONFIG_PATH,
  clientId: process.env.GITHUB_CLIENT_ID ?? '',
  clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
});
app.use('/auth/github', githubAppRouter);
```

- [ ] **Step 3: Mount webhook route and wire GraphQL to org-dashboard**

After org-dashboard mount (~line 361), add webhook router:
```typescript
// Webhooks (no auth — GitHub sends these with HMAC signature)
const config = loadConfig(CONFIG_PATH);
const webhookSecret = config.github?.webhookSecret ?? '';
if (webhookSecret) {
  const webhookRouter = createWebhookRouter({
    secret: webhookSecret,
    broadcastEvent,
    getWorkspacePaths: () => loadConfig(CONFIG_PATH).workspaces ?? [],
  });
  app.use('/webhooks', webhookRouter);
}
```

Update org-dashboard creation to pass GraphQL fetcher:
```typescript
const orgDashboardRouter = createOrgDashboardRouter({
  configPath: CONFIG_PATH,
  checkPrTransitions,
  getBranchLinks: () => branchLinkerRouter.fetchLinks(),
  fetchGraphQL: fetchPrsGraphQL,
});
```

- [ ] **Step 4: Add smee-client lifecycle with polling fallback**

Add to server startup section (after all routes are mounted). When smee-client encounters 3 consecutive connection errors, fall back to 30s GraphQL polling. When smee reconnects, stop polling and resume webhook delivery:

```typescript
// Start smee-client if configured, with polling fallback
const startCfg = loadConfig(CONFIG_PATH);
const smeeUrl = startCfg.github?.smeeUrl;
const githubToken = startCfg.github?.accessToken;
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let smeeErrorCount = 0;

function startPollingFallback() {
  if (pollingInterval) return;
  pollingInterval = setInterval(() => {
    broadcastEvent('pr-updated');
    broadcastEvent('ci-updated');
  }, 30_000);
}

function stopPollingFallback() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

if (smeeUrl) {
  import('smee-client').then(({ default: SmeeClient }) => {
    const smee = new SmeeClient({
      source: smeeUrl,
      target: `http://127.0.0.1:${port}/webhooks`,
      logger: {
        info: () => {},
        error: () => {
          smeeErrorCount++;
          if (smeeErrorCount >= 3) startPollingFallback();
        },
      },
    });
    const events = smee.start();
    events.addEventListener('open', () => {
      smeeErrorCount = 0;
      stopPollingFallback();
    });
  }).catch(() => {
    // smee-client not available — start polling immediately
    if (githubToken) startPollingFallback();
  });
} else if (githubToken) {
  // No smee URL configured — use polling
  startPollingFallback();
}
```

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All existing tests pass (no regressions)

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat: wire GitHub OAuth, webhooks, and GraphQL into server"
```

---

### Task 6: Frontend events, API, and settings

**Files:**
- Modify: `frontend/src/lib/api.ts` — add GitHub auth API functions
- Modify: `frontend/src/App.svelte` — handle pr-updated/ci-updated WebSocket events
- Modify: `frontend/src/components/dialogs/SettingsDialog.svelte` — add Connect GitHub section

**Context:** The frontend needs API functions to check GitHub connection status, initiate OAuth, and disconnect. The App.svelte event socket handler needs to invalidate queries on webhook-originated events. The SettingsDialog gets a "Connect GitHub" button.

- [ ] **Step 1: Add GitHub auth API functions**

Add to `frontend/src/lib/api.ts`:
```typescript
export async function fetchGitHubStatus(): Promise<{ connected: boolean; username: string | null }> {
  return json<{ connected: boolean; username: string | null }>(await fetch('/auth/github/status'));
}

export async function fetchGitHubAuthUrl(): Promise<string> {
  const data = await json<{ url: string }>(await fetch('/auth/github'));
  return data.url;
}

export async function disconnectGitHub(): Promise<void> {
  await fetch('/auth/github/disconnect', { method: 'POST' });
}
```

- [ ] **Step 2: Handle pr-updated and ci-updated in App.svelte**

In the `connectEventSocket` callback in App.svelte, add handlers for the new event types. After the existing `ref-changed` handler:
```typescript
} else if (msg.type === 'pr-updated' || msg.type === 'ci-updated') {
  queryClient.invalidateQueries({ queryKey: ['org-prs'] });
  queryClient.invalidateQueries({ queryKey: ['pr'] });
  queryClient.invalidateQueries({ queryKey: ['ci-status'] });
}
```

- [ ] **Step 3: Add Connect GitHub section to SettingsDialog**

In `frontend/src/components/dialogs/SettingsDialog.svelte`, add a "GitHub Connection" section. Import the new API functions. Add state for connection status:

```svelte
<script>
  import { fetchGitHubStatus, fetchGitHubAuthUrl, disconnectGitHub } from '../../lib/api.js';

  let githubStatus = $state<{ connected: boolean; username: string | null }>({ connected: false, username: null });

  $effect(() => {
    fetchGitHubStatus().then(s => { githubStatus = s; }).catch(() => {});
  });

  async function connectGitHub() {
    const url = await fetchGitHubAuthUrl();
    window.open(url, '_blank', 'width=600,height=700');
    // Poll for connection status after opening
    const interval = setInterval(async () => {
      const status = await fetchGitHubStatus();
      if (status.connected) {
        githubStatus = status;
        clearInterval(interval);
      }
    }, 2000);
    // Stop polling after 2 minutes
    setTimeout(() => clearInterval(interval), 120_000);
  }

  async function handleDisconnect() {
    await disconnectGitHub();
    githubStatus = { connected: false, username: null };
  }
</script>

<!-- Add before Developer Tools section -->
<div class="settings-section">
  <h3>GitHub Connection</h3>
  {#if githubStatus.connected}
    <div class="setting-row">
      <span>Connected as <strong>{githubStatus.username}</strong></span>
      <button class="btn btn--danger" onclick={handleDisconnect}>Disconnect</button>
    </div>
  {:else}
    <div class="setting-row">
      <span>Connect GitHub for rich PR data, CI status, and real-time webhooks.</span>
      <button class="btn btn--primary" onclick={connectGitHub}>Connect GitHub</button>
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Build frontend to verify no type errors**

Run: `npm run build:frontend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/App.svelte frontend/src/components/dialogs/SettingsDialog.svelte
git commit -m "feat: frontend GitHub auth API, webhook event handling, settings Connect GitHub"
```

---

### Task 7: Frontend dashboard CI column + sidebar enrichment

**Files:**
- Modify: `frontend/src/components/OrgDashboard.svelte` — add CI status icon column, priority sort upgrade
- Modify: `frontend/src/lib/pr-status.ts` — add `review-requested` state using role data
- Modify: `frontend/src/components/WorkspaceItem.svelte` — show PR status + CI icon inline

**Context:** The OrgDashboard needs a CI status column showing checkmark/X/spinner based on `ciStatus`. The priority sort from the design doc should be implemented (changes-requested → review-requested → waiting → approved+CI → other). The sidebar WorkspaceItem shows PR review status + CI status when a worktree has a matching open PR.

- [ ] **Step 1: Update derivePrDotStatus to handle review-requested**

Modify `frontend/src/lib/pr-status.ts`:
```typescript
export function derivePrDotStatus(pr: PullRequest): PrDotStatus {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.role === 'reviewer') return 'review-requested';
  return 'open';
}
```

- [ ] **Step 2: Add CI status column to OrgDashboard**

In `OrgDashboard.svelte`, add a CI column to `prColumns`:
```typescript
const prColumns: Column[] = [
  { key: 'status', label: 'St', sortable: false, width: '36px' },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'repo', label: 'Repo', sortable: true, width: '100px' },
  { key: 'role', label: 'Role', sortable: true, width: '60px' },
  { key: 'ci', label: 'CI', sortable: false, width: '32px' },
  { key: 'age', label: 'Age', sortable: true, width: '50px' },
  { key: 'action', label: '', sortable: false, width: '80px' },
];
```

Add CI icon helper:
```typescript
function ciIcon(pr: PullRequest): { icon: string; cls: string } | null {
  if (!pr.ciStatus) return null;
  if (pr.ciStatus === 'SUCCESS') return { icon: '✓', cls: 'ci-pass' };
  if (pr.ciStatus === 'FAILURE' || pr.ciStatus === 'ERROR') return { icon: '✗', cls: 'ci-fail' };
  if (pr.ciStatus === 'PENDING') return { icon: '●', cls: 'ci-pending' };
  return null;
}
```

Add CI cell to the DataTable row snippet (between role and age cells):
```svelte
<td class="ci-cell">
  {#if ciIcon(row) !== null}
    {@const ci = ciIcon(row)!}
    <span class="ci-icon {ci.cls}">{ci.icon}</span>
  {/if}
</td>
```

Add CSS:
```css
.ci-icon { font-size: 12px; }
.ci-pass { color: var(--status-success); }
.ci-fail { color: var(--status-error); }
.ci-pending { color: var(--status-warning); animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
```

- [ ] **Step 3: Implement priority sort**

Replace the default sort logic in `processedPrs` with the design doc's priority algorithm:
```typescript
// Priority sort when sortBy === 'role'
if (sortBy === 'role') {
  const priorityTier = (pr: PullRequest): number => {
    if (pr.reviewDecision === 'CHANGES_REQUESTED' && pr.role === 'author') return 0;
    if (pr.role === 'reviewer') return 1;
    if (pr.role === 'author' && !pr.reviewDecision) return 2;
    if (pr.reviewDecision === 'APPROVED' && pr.ciStatus === 'SUCCESS') return 3;
    return 4;
  };
  prs = [...prs].sort((a, b) => {
    const tierDiff = priorityTier(a) - priorityTier(b);
    if (tierDiff !== 0) return sortDir === 'asc' ? tierDiff : -tierDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
```

- [ ] **Step 4: Add PR/CI status to sidebar WorkspaceItem**

In `WorkspaceItem.svelte`, accept org PR data as a prop:
```typescript
// Add to props:
orgPrs?: PullRequest[];
```

Add a helper to find a matching PR for a branch:
```typescript
function findPrForBranch(branchName: string): PullRequest | undefined {
  return orgPrs?.find(pr => pr.headRefName === branchName && pr.state === 'OPEN');
}
```

In the session group row template, after the group name, show PR status:
```svelte
{#if findPrForBranch(sessions[0]?.branchName ?? '') as matchedPr}
  <span class="sidebar-pr-badge">
    <StatusDot status={derivePrDotStatus(matchedPr)} size={5} />
    {#if matchedPr.ciStatus === 'SUCCESS'}<span class="sidebar-ci ci-pass">✓</span>
    {:else if matchedPr.ciStatus === 'FAILURE'}<span class="sidebar-ci ci-fail">✗</span>
    {:else if matchedPr.ciStatus === 'PENDING'}<span class="sidebar-ci ci-pending">●</span>
    {/if}
  </span>
{/if}
```

- [ ] **Step 5: Thread orgPrs data from Sidebar.svelte to WorkspaceItem**

`Sidebar.svelte` renders `WorkspaceItem`. Add an org-prs query in `Sidebar.svelte`:
```typescript
import { createQuery } from '@tanstack/svelte-query';
import { fetchOrgPrs } from '../lib/api.js';
import type { OrgPrsResponse, PullRequest } from '../lib/types.js';

const orgQuery = createQuery<OrgPrsResponse>(() => ({
  queryKey: ['org-prs'],
  queryFn: fetchOrgPrs,
  staleTime: 60_000,
}));

let orgPrs = $derived(orgQuery.data?.prs ?? []);
```

Then pass `orgPrs={orgPrs}` to each `<WorkspaceItem>` instance in Sidebar.svelte (two render sites: grouped workspaces and ungrouped workspaces).

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: PASS — no type errors, all compiles

- [ ] **Step 7: Run test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/OrgDashboard.svelte frontend/src/lib/pr-status.ts frontend/src/components/WorkspaceItem.svelte frontend/src/components/StatusDot.svelte
git commit -m "feat: CI status column, priority sort, sidebar PR enrichment"
```

---

### Task 8: Priority sort + pr-status tests

**Files:**
- Create: `test/pr-status.test.ts` — tests for derivePrDotStatus and priority sort
- Modify: `frontend/src/lib/pr-status.ts` — already updated in Task 7, just needs tests

**Context:** The design doc requires "Priority sort: all 5 tiers with mock PR data." This task adds dedicated tests for the priority algorithm and the updated `derivePrDotStatus` function that now handles `review-requested`.

- [ ] **Step 1: Write tests for derivePrDotStatus**

Create or update `test/pr-status.test.ts` (check if it already exists and extend it):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePrDotStatus } from '../frontend/src/lib/pr-status.js';
import type { PullRequest } from '../frontend/src/lib/types.js';

function makePr(overrides: Partial<PullRequest>): PullRequest {
  return {
    number: 1, title: 'Test', url: '', headRefName: '', baseRefName: '',
    state: 'OPEN', author: 'user', role: 'author', updatedAt: '',
    additions: 0, deletions: 0, reviewDecision: null, mergeable: null,
    isDraft: false, ciStatus: null,
    ...overrides,
  };
}

test('derivePrDotStatus returns draft for isDraft PRs', () => {
  assert.equal(derivePrDotStatus(makePr({ isDraft: true })), 'draft');
});

test('derivePrDotStatus returns merged for MERGED state', () => {
  assert.equal(derivePrDotStatus(makePr({ state: 'MERGED' })), 'merged');
});

test('derivePrDotStatus returns closed for CLOSED state', () => {
  assert.equal(derivePrDotStatus(makePr({ state: 'CLOSED' })), 'closed');
});

test('derivePrDotStatus returns changes-requested', () => {
  assert.equal(derivePrDotStatus(makePr({ reviewDecision: 'CHANGES_REQUESTED' })), 'changes-requested');
});

test('derivePrDotStatus returns approved', () => {
  assert.equal(derivePrDotStatus(makePr({ reviewDecision: 'APPROVED' })), 'approved');
});

test('derivePrDotStatus returns review-requested for reviewers', () => {
  assert.equal(derivePrDotStatus(makePr({ role: 'reviewer' })), 'review-requested');
});

test('derivePrDotStatus returns open for plain open PRs', () => {
  assert.equal(derivePrDotStatus(makePr({})), 'open');
});
```

Note: This file imports from frontend source. The test tsconfig must include frontend paths. If it doesn't compile, create a simpler version that copies the function inline.

Run: `npm run build:server && node --test dist/test/pr-status.test.js`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/pr-status.test.ts
git commit -m "test: add priority sort and pr-status derivation tests"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Parallel subagent dispatch for independent tasks (2+3, 6+7) saved significant time
- TDD approach with injectable deps (fetchFn, execAsync) made testing clean
- Plan review caught 9 issues before implementation started

**What didn't:**
- Plan didn't specify OAuth redirect_uri correctly (used smeeUrl)
- Plan didn't address auth middleware for /auth/github/* routes
- smee-client API assumption wrong (start() returns Promise, not EventSource)

**Learnings to codify:**
- GitHub GraphQL returns HTTP 200 even with errors — always check `data.errors`
- Webhook handlers should broadcast signals, not full payloads
- OAuth callback routes need auth exemption but status/disconnect need protection
