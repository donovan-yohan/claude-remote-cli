import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { startPolling, stopPolling, isPolling, type ReviewPollerDeps } from '../server/review-poller.js';
import { saveConfig, DEFAULTS } from '../server/config.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

let tmpDir: string;
let configPath: string;

const WORKSPACE_PATH = '/fake/workspace/my-repo';

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-poller-test-'));
  configPath = path.join(tmpDir, 'config.json');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  // Guarantee no timer leaks between tests
  stopPolling();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal GhNotification JSON string suitable for mock exec stdout. */
function makeNotificationLine(overrides: {
  id?: string;
  reason?: string;
  prNumber?: number;
  ownerRepo?: string;
  updatedAt?: string;
  title?: string;
}): string {
  const {
    id = 'notif-1',
    reason = 'review_requested',
    prNumber = 42,
    ownerRepo = 'owner/my-repo',
    updatedAt = new Date().toISOString(),
    title = 'Test PR',
  } = overrides;

  return JSON.stringify({
    id,
    reason,
    subject: {
      title,
      url: `https://api.github.com/repos/${ownerRepo}/pulls/${prNumber}`,
      type: 'PullRequest',
    },
    repository: { full_name: ownerRepo },
    updated_at: updatedAt,
  });
}

type MockExec = (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>;
type ExecAsync = ReviewPollerDeps['execAsync'];

/**
 * Creates a mock execAsync. Routes by command:
 * - `gh api /notifications` → returns notification lines joined by newline
 * - `git remote get-url origin` → returns the configured remote URL
 * - `git fetch ...` → resolves with empty output
 * - `git worktree add ...` → resolves with empty output (unless worktreeError is set)
 */
function makeMockExec(opts: {
  notificationLines?: string[];
  ghError?: Error;
  remoteUrl?: string;
  gitRemoteError?: Error;
  worktreeError?: Error;
  onExec?: (cmd: string, args: string[]) => void;
}): MockExec {
  return async (cmd: unknown, args: unknown): Promise<{ stdout: string; stderr: string }> => {
    const command = cmd as string;
    const argv = args as string[];

    opts.onExec?.(command, argv);

    if (command === 'gh' && argv[0] === 'api') {
      if (opts.ghError) throw opts.ghError;
      const lines = opts.notificationLines ?? [];
      return { stdout: lines.join('\n'), stderr: '' };
    }

    if (command === 'git' && argv[0] === 'remote') {
      if (opts.gitRemoteError) throw opts.gitRemoteError;
      const url = opts.remoteUrl ?? 'https://github.com/owner/my-repo.git';
      return { stdout: url + '\n', stderr: '' };
    }

    if (command === 'git' && argv[0] === 'fetch') {
      return { stdout: '', stderr: '' };
    }

    if (command === 'git' && argv[0] === 'worktree') {
      if (opts.worktreeError) throw opts.worktreeError;
      return { stdout: '', stderr: '' };
    }

    throw new Error(`Unexpected exec call: ${command} ${argv.join(' ')}`);
  };
}

/** Returns a deps object with sensible defaults. Override individual fields as needed. */
function makeDeps(overrides: Record<string, unknown> = {}): ReviewPollerDeps {
  return {
    configPath,
    getWorkspacePaths: () => [WORKSPACE_PATH],
    getWorkspaceSettings: () => undefined,
    createSession: async () => {},
    broadcastEvent: () => {},
    execAsync: makeMockExec({}) as unknown as ExecAsync,
    ...overrides,
  } as ReviewPollerDeps;
}

/** Waits for at least one poll cycle to complete given the interval. */
function waitForCycles(intervalMs: number, cycles = 1): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, intervalMs * cycles + 20));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('isPolling() returns false initially', () => {
  assert.equal(isPolling(), false);
});

test('startPolling() sets isPolling() to true', () => {
  saveConfig(configPath, {
    ...DEFAULTS,
    automations: { pollIntervalMs: 60_000 },
  });

  startPolling(makeDeps());

  assert.equal(isPolling(), true);
});

test('stopPolling() sets isPolling() to false', () => {
  saveConfig(configPath, {
    ...DEFAULTS,
    automations: { pollIntervalMs: 60_000 },
  });

  startPolling(makeDeps());
  assert.equal(isPolling(), true);

  stopPolling();
  assert.equal(isPolling(), false);
});

test('startPolling() is idempotent — calling twice does not create two timers', async () => {
  const INTERVAL = 50;
  let callCount = 0;

  saveConfig(configPath, {
    ...DEFAULTS,
    automations: {
      autoCheckoutReviewRequests: true,
      pollIntervalMs: INTERVAL,
      lastPollTimestamp: new Date().toISOString(),
    },
  });

  const exec = makeMockExec({
    onExec: (cmd, argv) => {
      if (cmd === 'gh' && argv[0] === 'api') callCount++;
    },
  });

  const deps = makeDeps({ execAsync: exec as unknown as ExecAsync });

  startPolling(deps);
  startPolling(deps); // second call must be a no-op

  await waitForCycles(INTERVAL, 2);

  // Two timer cycles elapsed. If only one timer exists, gh was called ~2 times.
  // If startPolling were NOT idempotent (two timers), we would see ~4 calls.
  assert.ok(callCount <= 3, `Expected at most 3 gh calls (got ${callCount}) — suggests only one timer running`);
});

test('first-run guard — when lastPollTimestamp is absent, no notifications are processed', async () => {
  const INTERVAL = 50;

  // Config without lastPollTimestamp — first-run scenario
  saveConfig(configPath, {
    ...DEFAULTS,
    automations: {
      autoCheckoutReviewRequests: true,
      pollIntervalMs: INTERVAL,
      // No lastPollTimestamp — module will default to "now"
    },
  });

  const broadcastedEvents: unknown[] = [];
  let fetchCallCount = 0;

  const exec = makeMockExec({
    // Notification is old (well before "now"), so it should NOT be processed
    notificationLines: [
      makeNotificationLine({
        updatedAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
        ownerRepo: 'owner/my-repo',
      }),
    ],
    remoteUrl: 'https://github.com/owner/my-repo.git',
    onExec: (cmd, argv) => {
      if (cmd === 'git' && argv[0] === 'fetch') fetchCallCount++;
    },
  });

  const deps = makeDeps({
    execAsync: exec as unknown as ExecAsync,
    broadcastEvent: (event: string, data?: Record<string, unknown>) => broadcastedEvents.push({ event, data }),
  });

  startPolling(deps);
  await waitForCycles(INTERVAL);

  // The notification predates the first-run "now" baseline, so no checkout should occur
  assert.equal(fetchCallCount, 0, 'git fetch should not be called for historical notifications');
  assert.equal(broadcastedEvents.length, 0, 'No review-checkout events should be broadcast');
});

test('JSON parse safety — non-JSON lines in gh output do not crash', async () => {
  const INTERVAL = 50;

  saveConfig(configPath, {
    ...DEFAULTS,
    automations: {
      autoCheckoutReviewRequests: true,
      pollIntervalMs: INTERVAL,
      lastPollTimestamp: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
    },
  });

  // Mix valid JSON with non-JSON warning lines that gh sometimes emits
  const validNotification = makeNotificationLine({
    updatedAt: new Date().toISOString(),
    ownerRepo: 'owner/my-repo',
    prNumber: 7,
  });

  const exec = makeMockExec({
    notificationLines: [
      'Warning: some gh warning message',
      validNotification,
      'another non-JSON line',
    ],
    remoteUrl: 'https://github.com/owner/my-repo.git',
  });

  // Just verify it doesn't throw — if parsing crashes, startPolling's setInterval
  // would log an unhandled rejection. We capture broadcastEvent to confirm the
  // valid notification was still processed.
  const broadcastedEvents: unknown[] = [];

  const deps = makeDeps({
    execAsync: exec as unknown as ExecAsync,
    broadcastEvent: (event: string, data?: Record<string, unknown>) => broadcastedEvents.push({ event, data }),
  });

  // Should not throw
  startPolling(deps);
  await waitForCycles(INTERVAL);

  // The valid notification was newer than lastPollTimestamp — should be processed
  const checkoutEvents = (broadcastedEvents as Array<{ event: string }>).filter(
    (e) => e.event === 'review-checkout',
  );
  assert.equal(checkoutEvents.length, 1, 'Valid notification should still be processed despite surrounding non-JSON lines');
});

test('poll skips processing when autoCheckoutReviewRequests is disabled', async () => {
  const INTERVAL = 50;

  saveConfig(configPath, {
    ...DEFAULTS,
    automations: {
      autoCheckoutReviewRequests: false,
      pollIntervalMs: INTERVAL,
      lastPollTimestamp: new Date(Date.now() - 120_000).toISOString(),
    },
  });

  let ghCallCount = 0;

  const exec = makeMockExec({
    notificationLines: [makeNotificationLine({ updatedAt: new Date().toISOString() })],
    onExec: (cmd, argv) => {
      if (cmd === 'gh' && argv[0] === 'api') ghCallCount++;
    },
  });

  startPolling(makeDeps({ execAsync: exec as unknown as ExecAsync }));
  await waitForCycles(INTERVAL);

  // pollOnce returns early when the flag is off — gh should not even be called
  assert.equal(ghCallCount, 0, 'gh should not be called when autoCheckoutReviewRequests is false');
});
