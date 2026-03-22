import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadConfig, saveConfig } from './config.js';
import type { Config, WorkspaceSettings } from './types.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 minutes

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewPollerDeps {
  configPath: string;
  getWorkspacePaths: () => string[];
  getWorkspaceSettings: (workspacePath: string) => WorkspaceSettings | undefined;
  createSession: (opts: {
    repoPath: string;
    worktreePath: string;
    branchName: string;
    initialPrompt?: string;
  }) => Promise<void>;
  broadcastEvent: (event: string, data?: Record<string, unknown>) => void;
  execAsync?: typeof execFileAsync;
}

interface GhNotification {
  id: string;
  reason: string;
  subject: {
    title: string;
    url: string; // e.g. "https://api.github.com/repos/owner/repo/pulls/123"
    type: string;
  };
  repository: {
    full_name: string; // e.g. "owner/repo"
  };
  updated_at: string;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let ghMissingWarned = false;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startPolling(deps: ReviewPollerDeps): void {
  if (timer !== null) return;

  const config = loadConfig(deps.configPath);
  const intervalMs = config.automations?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  timer = setInterval(() => {
    void pollOnce(deps);
  }, intervalMs);
}

export function stopPolling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function isPolling(): boolean {
  return timer !== null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts "owner/repo" from a git remote URL.
 * Handles SSH (git@github.com:owner/repo.git) and HTTPS forms.
 */
function extractOwnerRepo(remoteUrl: string): string | null {
  const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1] ?? null;
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1] ?? null;
  return null;
}

/** Extracts the PR number from a GitHub API URL like .../pulls/123 */
function extractPrNumber(subjectUrl: string): number | null {
  const match = subjectUrl.match(/\/pulls\/(\d+)$/);
  if (!match) return null;
  const num = parseInt(match[1] ?? '', 10);
  return isNaN(num) ? null : num;
}

/** Returns the workspace path whose git remote matches the given owner/repo, or null. */
async function findWorkspaceForRepo(
  ownerRepo: string,
  workspacePaths: string[],
  exec: typeof execFileAsync,
): Promise<string | null> {
  for (const workspacePath of workspacePaths) {
    try {
      const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], {
        cwd: workspacePath,
        timeout: GH_TIMEOUT_MS,
      });
      const remoteOwnerRepo = extractOwnerRepo(stdout.trim());
      if (remoteOwnerRepo && remoteOwnerRepo.toLowerCase() === ownerRepo.toLowerCase()) {
        return workspacePath;
      }
    } catch {
      // Not a git repo or no remote — skip
    }
  }
  return null;
}

// ─── Core poll logic ──────────────────────────────────────────────────────────

async function pollOnce(deps: ReviewPollerDeps): Promise<void> {
  const exec = deps.execAsync ?? execFileAsync;

  let config: Config;
  try {
    config = loadConfig(deps.configPath);
  } catch (err) {
    console.warn('[review-poller] Failed to load config:', err);
    return;
  }

  if (!config.automations?.autoCheckoutReviewRequests) return;

  // Default to "now" on first run to avoid processing all historical notifications
  const lastPollTimestamp = config.automations?.lastPollTimestamp ?? new Date().toISOString();

  // Fetch review_requested notifications from GitHub
  let notifications: GhNotification[];
  try {
    const { stdout } = await exec(
      'gh',
      [
        'api',
        '/notifications',
        '--jq',
        '.[] | select(.reason == "review_requested") | {id, reason, subject, repository, updated_at}',
      ],
      { timeout: GH_TIMEOUT_MS },
    );

    // gh --jq with select returns newline-delimited JSON objects
    const lines = stdout.trim().split('\n').filter(Boolean);
    notifications = [];
    for (const line of lines) {
      try {
        notifications.push(JSON.parse(line) as GhNotification);
      } catch {
        // gh may output non-JSON warnings mixed with results — skip
      }
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { killed?: boolean };
    if (error.code === 'ENOENT') {
      if (!ghMissingWarned) {
        console.warn('[review-poller] gh CLI not found — stopping poller');
        ghMissingWarned = true;
      }
      stopPolling();
      return;
    }
    if (error.killed) {
      console.warn('[review-poller] gh notifications timed out, skipping cycle');
      return;
    }
    // Auth failures and other gh errors come through stderr in the error message
    console.warn('[review-poller] gh notifications failed, skipping cycle:', error.message);
    return;
  }

  // Filter to notifications newer than the last poll
  const newNotifications = notifications.filter(
    (n) => new Date(n.updated_at) > new Date(lastPollTimestamp),
  );

  const workspacePaths = deps.getWorkspacePaths();

  for (const notification of newNotifications) {
    if (notification.subject.type !== 'PullRequest') continue;

    const prNumber = extractPrNumber(notification.subject.url);
    if (prNumber === null) {
      console.warn('[review-poller] Could not extract PR number from:', notification.subject.url);
      continue;
    }

    const ownerRepo = notification.repository.full_name;

    let workspacePath: string | null;
    try {
      workspacePath = await findWorkspaceForRepo(ownerRepo, workspacePaths, exec);
    } catch (err) {
      console.warn('[review-poller] Error finding workspace for', ownerRepo, ':', err);
      continue;
    }

    if (workspacePath === null) {
      // No local workspace for this repo — skip silently
      continue;
    }

    const localBranch = `review-pr-${prNumber}`;
    const worktreePath = path.join(workspacePath, '.worktrees', localBranch);

    // Skip if worktree already exists (e.g., from a previous poll)
    if (fs.existsSync(worktreePath)) {
      continue;
    }

    // Fetch the PR's head ref into a local branch, then create worktree from it
    try {
      await exec(
        'git',
        ['fetch', 'origin', `pull/${prNumber}/head:${localBranch}`],
        { cwd: workspacePath, timeout: GH_TIMEOUT_MS },
      );
    } catch (err) {
      // Branch may already exist from a prior fetch — continue to worktree add
      const errMsg = (err as Error).message ?? '';
      if (!errMsg.includes('already exists')) {
        console.warn(`[review-poller] Failed to fetch PR #${prNumber}:`, err);
        continue;
      }
    }

    try {
      await exec(
        'git',
        ['worktree', 'add', worktreePath, localBranch],
        { cwd: workspacePath, timeout: GH_TIMEOUT_MS },
      );
    } catch (err) {
      console.warn(`[review-poller] Failed to create worktree for PR #${prNumber}:`, err);
      continue;
    }

    // Optionally start a review session
    const settings = deps.getWorkspaceSettings(workspacePath);
    if (config.automations?.autoReviewOnCheckout && settings?.promptCodeReview) {
      try {
        await deps.createSession({
          repoPath: workspacePath,
          worktreePath,
          branchName: localBranch,
          initialPrompt: settings.promptCodeReview,
        });
      } catch (err) {
        console.warn(`[review-poller] Failed to create review session for PR #${prNumber}:`, err);
      }
    }

    deps.broadcastEvent('review-checkout', {
      prNumber,
      ownerRepo,
      worktreePath,
      branchName: localBranch,
      title: notification.subject.title,
    });
  }

  // Update lastPollTimestamp
  config.automations = {
    ...config.automations,
    lastPollTimestamp: new Date().toISOString(),
  };
  try {
    saveConfig(deps.configPath, config);
  } catch (err) {
    console.warn('[review-poller] Failed to save config after poll:', err);
  }
}
