import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTicketTransitionsRouter, type TicketTransitionsDeps } from '../server/ticket-transitions.js';
import type { TicketContext, BranchLink } from '../server/types.js';

// Loose mock type — cast to TicketTransitionsDeps['execAsync'] at call sites
type MockExec = (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>;

interface ExecCall {
  cmd: string;
  args: string[];
  cwd: string | undefined;
}

// Shared temp config for all tests (checkPrTransitions calls loadConfig)
let sharedTmpDir: string;
let sharedConfigPath: string;

before(() => {
  sharedTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
  sharedConfigPath = path.join(sharedTmpDir, 'config.json');
  const minimalConfig = {
    host: '0.0.0.0', port: 3456, cookieTTL: '24h', repos: [],
    claudeCommand: 'claude', claudeArgs: [], defaultAgent: 'claude',
    defaultContinue: true, defaultYolo: false, launchInTmux: false,
    defaultNotifications: true,
  };
  fs.writeFileSync(sharedConfigPath, JSON.stringify(minimalConfig, null, 2));
});

after(() => {
  fs.rmSync(sharedTmpDir, { recursive: true, force: true });
});

function makeExecMock(opts: { shouldThrow?: boolean } = {}): {
  exec: MockExec;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec: MockExec = async (cmd: unknown, args: unknown, options: unknown) => {
    const command = cmd as string;
    const argv = args as string[];
    const cwd = (options as { cwd?: string } | undefined)?.cwd;
    calls.push({ cmd: command, args: argv, cwd });
    if (opts.shouldThrow) {
      throw new Error('gh CLI error');
    }
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

function makeApp(execMock: MockExec) {
  const deps = { configPath: sharedConfigPath, execAsync: execMock } as unknown as TicketTransitionsDeps;
  return createTicketTransitionsRouter(deps);
}

const REPO_PATH = '/fake/workspace/repo-a';

function makeTicketContext(overrides: Partial<TicketContext> = {}): TicketContext {
  return {
    ticketId: 'GH-1',
    title: 'Test Issue',
    url: 'https://github.com/fake/repo/issues/1',
    source: 'github',
    repoPath: REPO_PATH,
    repoName: 'repo-a',
    ...overrides,
  };
}

function makeBranchLinks(ticketId: string, branchName: string): Record<string, BranchLink[]> {
  return {
    [ticketId]: [
      {
        repoPath: REPO_PATH,
        repoName: 'repo-a',
        branchName,
        hasActiveSession: true,
      },
    ],
  };
}

describe('ticket-transitions', () => {
  describe('transitionOnSessionCreate', () => {
    test('adds in-progress label to GitHub issue', async () => {
      const { exec, calls } = makeExecMock();
      const { transitionOnSessionCreate } = makeApp(exec);

      const ctx = makeTicketContext({ ticketId: 'GH-100' });
      await transitionOnSessionCreate(ctx);

      const addLabelCall = calls.find(
        (c) => c.cmd === 'gh' && c.args.includes('--add-label') && c.args.includes('in-progress'),
      );
      assert.ok(addLabelCall, 'Should have called gh issue edit --add-label in-progress');
      assert.equal(addLabelCall.cwd, REPO_PATH);
      assert.ok(addLabelCall.args.includes('100'), 'Should pass issue number 100');
    });

    test('is idempotent — does not re-fire same transition', async () => {
      const { exec, calls } = makeExecMock();
      const { transitionOnSessionCreate } = makeApp(exec);

      const ctx = makeTicketContext({ ticketId: 'GH-101' });

      // First call — should fire
      await transitionOnSessionCreate(ctx);
      const firstCallCount = calls.length;
      assert.ok(firstCallCount > 0, 'First call should trigger gh');

      // Second call — should be a no-op (idempotent)
      await transitionOnSessionCreate(ctx);
      assert.equal(calls.length, firstCallCount, 'Second call should not trigger additional gh calls');
    });
  });

  describe('checkPrTransitions', () => {
    test('adds code-review label when PR is OPEN for a linked ticket', async () => {
      const { exec, calls } = makeExecMock();
      const { checkPrTransitions } = makeApp(exec);

      const ticketId = 'GH-200';
      const branchName = 'feat/my-feature';
      const prs = [{ number: 1, headRefName: branchName, state: 'OPEN' as const }];
      const branchLinks = makeBranchLinks(ticketId, branchName);

      await checkPrTransitions(prs, branchLinks);

      const addCodeReview = calls.find(
        (c) => c.cmd === 'gh' && c.args.includes('--add-label') && c.args.includes('code-review'),
      );
      assert.ok(addCodeReview, 'Should have called gh issue edit --add-label code-review');
      assert.equal(addCodeReview.cwd, REPO_PATH);
      assert.ok(addCodeReview.args.includes('200'), 'Should pass issue number 200');

      const removeInProgress = calls.find(
        (c) => c.cmd === 'gh' && c.args.includes('--remove-label') && c.args.includes('in-progress'),
      );
      assert.ok(removeInProgress, 'Should have removed in-progress label');
    });

    test('adds ready-for-qa label when PR is MERGED for a linked ticket', async () => {
      const { exec, calls } = makeExecMock();
      const { checkPrTransitions } = makeApp(exec);

      const ticketId = 'GH-300';
      const branchName = 'feat/merged-feature';
      const prs = [{ number: 2, headRefName: branchName, state: 'MERGED' as const }];
      const branchLinks = makeBranchLinks(ticketId, branchName);

      await checkPrTransitions(prs, branchLinks);

      const addReadyForQa = calls.find(
        (c) => c.cmd === 'gh' && c.args.includes('--add-label') && c.args.includes('ready-for-qa'),
      );
      assert.ok(addReadyForQa, 'Should have called gh issue edit --add-label ready-for-qa');
      assert.equal(addReadyForQa.cwd, REPO_PATH);
      assert.ok(addReadyForQa.args.includes('300'), 'Should pass issue number 300');

      const removeCodeReview = calls.find(
        (c) => c.cmd === 'gh' && c.args.includes('--remove-label') && c.args.includes('code-review'),
      );
      assert.ok(removeCodeReview, 'Should have removed code-review label');
    });

    test('is idempotent for PR transitions', async () => {
      const { exec, calls } = makeExecMock();
      const { checkPrTransitions } = makeApp(exec);

      const ticketId = 'GH-400';
      const branchName = 'feat/idempotent-pr';
      const prs = [{ number: 3, headRefName: branchName, state: 'OPEN' as const }];
      const branchLinks = makeBranchLinks(ticketId, branchName);

      // First call — should fire
      await checkPrTransitions(prs, branchLinks);
      const firstCallCount = calls.length;
      assert.ok(firstCallCount > 0, 'First call should trigger gh');

      // Second call with same PR state — should be a no-op (idempotent)
      await checkPrTransitions(prs, branchLinks);
      assert.equal(calls.length, firstCallCount, 'Second call with same state should not trigger additional gh calls');
    });

    test('handles gh CLI errors gracefully', async () => {
      const { exec } = makeExecMock({ shouldThrow: true });
      const { checkPrTransitions } = makeApp(exec);

      const ticketId = 'GH-500';
      const branchName = 'feat/error-branch';
      const prs = [{ number: 4, headRefName: branchName, state: 'OPEN' as const }];
      const branchLinks = makeBranchLinks(ticketId, branchName);

      // Should not throw even when gh CLI fails
      await assert.doesNotReject(
        () => checkPrTransitions(prs, branchLinks),
        'checkPrTransitions should not throw when gh CLI errors',
      );
    });
  });
});

// ─── Jira / Linear transition tests ─────────────────────────────────────────

describe('ticket-transitions (Jira/Linear)', () => {
  let tmpDir: string;
  let configPath: string;
  const origFetch = globalThis.fetch;
  const origEnv: Record<string, string | undefined> = {};

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-jira-linear-'));
    configPath = path.join(tmpDir, 'config.json');

    // Save env vars
    for (const key of ['JIRA_API_TOKEN', 'JIRA_EMAIL', 'JIRA_BASE_URL', 'LINEAR_API_KEY']) {
      origEnv[key] = process.env[key];
    }
  });

  after(() => {
    globalThis.fetch = origFetch;
    // Restore env vars
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(mappings: { jira?: Record<string, string>; linear?: Record<string, string> }) {
    const config = {
      host: '0.0.0.0',
      port: 3456,
      cookieTTL: '24h',
      repos: [],
      claudeCommand: 'claude',
      claudeArgs: [],
      defaultAgent: 'claude',
      defaultContinue: true,
      defaultYolo: false,
      launchInTmux: false,
      defaultNotifications: true,
      integrations: {
        ...(mappings.jira ? { jira: { projectKey: 'PROJ', statusMappings: mappings.jira } } : {}),
        ...(mappings.linear ? { linear: { teamId: 'TEAM', statusMappings: mappings.linear } } : {}),
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  function makeJiraLinearApp() {
    const { exec } = makeExecMock();
    const deps = { configPath, execAsync: exec } as unknown as TicketTransitionsDeps;
    return createTicketTransitionsRouter(deps);
  }

  test('detectTicketSource returns jira for PROJ-123 when JIRA_API_TOKEN is set', async () => {
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    process.env.JIRA_BASE_URL = 'https://test.atlassian.net';
    delete process.env.LINEAR_API_KEY;

    writeConfig({ jira: { 'in-progress': '21' } });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'PROJ-123',
      title: 'Test',
      url: 'https://jira.example.com/browse/PROJ-123',
      source: 'jira',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };
    await transitionOnSessionCreate(ctx);

    assert.ok(
      fetchCalls.some((u) => u.includes('/rest/api/3/issue/PROJ-123/transitions')),
      `Expected Jira transition call, got: ${fetchCalls.join(', ')}`,
    );
  });

  test('detectTicketSource returns linear for TEAM-42 when LINEAR_API_KEY is set', async () => {
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_BASE_URL;
    process.env.LINEAR_API_KEY = 'fake-linear-key';

    writeConfig({ linear: { 'in-progress': 'state-in-progress-id' } });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { issues: { nodes: [{ id: 'issue-uuid' }] } } }),
      };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'TEAM-42',
      title: 'Test',
      url: 'https://linear.app/team/issue/TEAM-42',
      source: 'linear',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };
    await transitionOnSessionCreate(ctx);

    assert.ok(
      fetchCalls.some((u) => u.includes('linear.app/graphql')),
      `Expected Linear GraphQL call, got: ${fetchCalls.join(', ')}`,
    );
  });

  test('skips transition when no status mapping configured', async () => {
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    process.env.JIRA_BASE_URL = 'https://test.atlassian.net';

    // Config with empty mappings — no 'in-progress' mapping
    writeConfig({ jira: {} });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'PROJ-456',
      title: 'Test',
      url: 'https://jira.example.com/browse/PROJ-456',
      source: 'jira',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };
    await transitionOnSessionCreate(ctx);

    assert.equal(fetchCalls.length, 0, 'Should not call fetch when no status mapping exists');
  });

  test('checkPrTransitions calls Jira transition for OPEN PR with mapped ticket', async () => {
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    process.env.JIRA_BASE_URL = 'https://test.atlassian.net';
    delete process.env.LINEAR_API_KEY;

    writeConfig({ jira: { 'code-review': '31', 'ready-for-qa': '41' } });
    const { checkPrTransitions } = makeJiraLinearApp();

    const fetchCalls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: unknown, init: unknown) => {
      const reqInit = init as { body?: string } | undefined;
      fetchCalls.push({ url: String(input), body: reqInit?.body ?? '' });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const prs = [{ number: 10, headRefName: 'feat/jira-pr', state: 'OPEN' as const }];
    const branchLinks: Record<string, BranchLink[]> = {
      'PROJ-789': [{ repoPath: '/fake/repo', repoName: 'repo', branchName: 'feat/jira-pr', hasActiveSession: true }],
    };

    await checkPrTransitions(prs, branchLinks);

    const transitionCall = fetchCalls.find((c) => c.url.includes('/transitions'));
    assert.ok(transitionCall, `Expected Jira transition call, got: ${fetchCalls.map((c) => c.url).join(', ')}`);
    assert.ok(transitionCall.body.includes('"31"'), 'Should use code-review transition ID 31');
  });

  // ── New tests ────────────────────────────────────────────────────────────

  test('Jira transitionOnSessionCreate — correct URL and transitionId, transitionMap updated only on success', async () => {
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    process.env.JIRA_BASE_URL = 'https://my-org.atlassian.net';
    delete process.env.LINEAR_API_KEY;

    writeConfig({ jira: { 'in-progress': '21', 'code-review': '31' } });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    const fetchCalls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: unknown, init: unknown) => {
      const reqInit = init as { body?: string } | undefined;
      fetchCalls.push({ url: String(input), body: reqInit?.body ?? '' });
      return { ok: true, status: 204, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'MYPROJ-55',
      title: 'Jira test issue',
      url: 'https://my-org.atlassian.net/browse/MYPROJ-55',
      source: 'jira',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };

    await transitionOnSessionCreate(ctx);

    assert.equal(fetchCalls.length, 1, 'Should make exactly one fetch call');
    assert.ok(
      fetchCalls[0]!.url.includes('/rest/api/3/issue/MYPROJ-55/transitions'),
      `Expected Jira transition URL, got: ${fetchCalls[0]!.url}`,
    );
    assert.ok(fetchCalls[0]!.body.includes('"21"'), 'Should pass in-progress transition ID 21');

    // Verify idempotency — second call should be blocked because transitionMap was updated
    fetchCalls.length = 0;
    await transitionOnSessionCreate(ctx);
    assert.equal(fetchCalls.length, 0, 'Second call should be blocked by idempotency guard after success');
  });

  test('Linear transitionOnSessionCreate — calls issue lookup then state update mutation', async () => {
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_BASE_URL;
    process.env.LINEAR_API_KEY = 'lin_api_fake';

    writeConfig({ linear: { 'in-progress': 'state-id-1', 'code-review': 'state-id-2' } });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    let callCount = 0;
    const fetchCalls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: unknown, init: unknown) => {
      const reqInit = init as { body?: string } | undefined;
      fetchCalls.push({ url: String(input), body: reqInit?.body ?? '' });
      callCount++;
      // First call: issue lookup — return issue UUID
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { issues: { nodes: [{ id: 'issue-uuid-abc' }] } } }),
        };
      }
      // Second call: state update mutation
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { issueUpdate: { success: true } } }),
      };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'ENG-77',
      title: 'Linear test issue',
      url: 'https://linear.app/eng/issue/ENG-77',
      source: 'linear',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };

    await transitionOnSessionCreate(ctx);

    assert.equal(fetchCalls.length, 2, 'Should make two fetch calls — one lookup, one update');
    assert.ok(
      fetchCalls.every((c) => c.url.includes('linear.app/graphql')),
      'Both calls should target the Linear GraphQL endpoint',
    );
    // First call: issue lookup query
    assert.ok(fetchCalls[0]!.body.includes('ENG-77'), 'Lookup should reference the ticket identifier');
    // Second call: mutation with resolved issue UUID and target state ID
    assert.ok(fetchCalls[1]!.body.includes('issue-uuid-abc'), 'Update mutation should use resolved issue UUID');
    assert.ok(fetchCalls[1]!.body.includes('state-id-1'), 'Update mutation should pass in-progress state ID');

    // Verify idempotency after success
    fetchCalls.length = 0;
    callCount = 0;
    await transitionOnSessionCreate(ctx);
    assert.equal(fetchCalls.length, 0, 'Second call should be blocked by idempotency guard after success');
  });

  test('F5 premature idempotency — failed fetch does not update transitionMap, second call retries', async () => {
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    process.env.JIRA_BASE_URL = 'https://my-org.atlassian.net';
    delete process.env.LINEAR_API_KEY;

    writeConfig({ jira: { 'in-progress': '21', 'code-review': '31' } });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    const fetchCalls: string[] = [];

    // First attempt: server returns 500
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'FAIL-99',
      title: 'Failing ticket',
      url: 'https://my-org.atlassian.net/browse/FAIL-99',
      source: 'jira',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };

    await transitionOnSessionCreate(ctx);
    assert.equal(fetchCalls.length, 1, 'First call should attempt fetch');

    // Second attempt after failure: transitionMap should NOT have been updated,
    // so the guard should not block this retry
    const fetchCallsBeforeRetry = fetchCalls.length;
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: true, status: 204, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    await transitionOnSessionCreate(ctx);
    assert.ok(
      fetchCalls.length > fetchCallsBeforeRetry,
      'Second call should NOT be blocked — failed remote call must not update transitionMap',
    );
  });

  test('Source detection via BranchLink source field — jira source overrides env-var heuristic', async () => {
    // Set up env so that env-var heuristic would pick linear (if source field were ignored)
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_BASE_URL;
    process.env.LINEAR_API_KEY = 'lin_api_fake';

    // But also set Jira env so jiraTransition can actually run
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    process.env.JIRA_BASE_URL = 'https://my-org.atlassian.net';

    writeConfig({ jira: { 'code-review': '31' }, linear: { 'code-review': 'state-id-2' } });
    const { checkPrTransitions } = makeJiraLinearApp();

    const fetchCalls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: unknown, init: unknown) => {
      const reqInit = init as { body?: string } | undefined;
      fetchCalls.push({ url: String(input), body: reqInit?.body ?? '' });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const prs = [{ number: 20, headRefName: 'feat/via-branch-link', state: 'OPEN' as const }];
    // BranchLink explicitly declares source: 'jira'
    const branchLinks: Record<string, BranchLink[]> = {
      'XPROJ-10': [
        {
          repoPath: '/fake/repo',
          repoName: 'repo',
          branchName: 'feat/via-branch-link',
          hasActiveSession: true,
          source: 'jira',
        },
      ],
    };

    await checkPrTransitions(prs, branchLinks);

    const jiraCall = fetchCalls.find((c) => c.url.includes('/rest/api/3/issue/XPROJ-10/transitions'));
    assert.ok(
      jiraCall,
      `Expected Jira transition call (source from BranchLink), got: ${fetchCalls.map((c) => c.url).join(', ')}`,
    );
    assert.ok(jiraCall.body.includes('"31"'), 'Should use code-review Jira transition ID');

    const linearCall = fetchCalls.find((c) => c.url.includes('linear.app/graphql'));
    assert.equal(linearCall, undefined, 'Should NOT call Linear when BranchLink.source is jira');
  });

  test('Jira URL validation — http non-localhost URL is rejected without making a fetch', async () => {
    process.env.JIRA_API_TOKEN = 'fake-token';
    process.env.JIRA_EMAIL = 'test@test.com';
    // Insecure non-localhost URL — should be rejected
    process.env.JIRA_BASE_URL = 'http://evil.com';
    delete process.env.LINEAR_API_KEY;

    writeConfig({ jira: { 'in-progress': '21' } });
    const { transitionOnSessionCreate } = makeJiraLinearApp();

    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof globalThis.fetch;

    const ctx: TicketContext = {
      ticketId: 'EVIL-1',
      title: 'Evil ticket',
      url: 'http://evil.com/browse/EVIL-1',
      source: 'jira',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };

    await transitionOnSessionCreate(ctx);

    assert.equal(fetchCalls.length, 0, 'Should not make any fetch call when JIRA_BASE_URL is http non-localhost');
  });
});
