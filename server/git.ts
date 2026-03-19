import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ExecFileAsyncResult = {
  stdout: string;
  stderr: string;
};

type ExecFileAsyncLike = (
  file: string,
  args: string[],
  options: { cwd: string; timeout?: number },
) => Promise<ExecFileAsyncResult>;

export interface ActivityEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timeAgo: string;
  branches: string[];
}

export interface CiStatus {
  total: number;
  passing: number;
  failing: number;
  pending: number;
}

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  unresolvedCommentCount: number;
}

function normalizeBranchNames(stdout: string): string[] {
  const branches = stdout
    .split('\n')
    .map((branch) => branch.trim())
    .filter((branch) => branch && !branch.includes('HEAD'))
    .map((branch) => branch.replace(/^origin\//, ''));

  return [...new Set(branches)].sort();
}

async function listBranches(
  repoPath: string,
  options: {
    refresh?: boolean;
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<string[]> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  if (options.refresh) {
    try {
      await run('git', ['fetch', '--all', '--prune'], { cwd: repoPath });
    } catch {
      // Best effort — still return the locally-known refs below.
    }
  }

  try {
    const { stdout } = await run('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: repoPath });
    return normalizeBranchNames(stdout);
  } catch {
    return [];
  }
}

async function getCurrentBranch(
  repoPath: string,
  options: { exec?: ExecFileAsyncLike } = {},
): Promise<string | null> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;
  try {
    const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getActivityFeed(
  repoPath: string,
  options: {
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<ActivityEntry[]> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  try {
    const { stdout } = await run(
      'git',
      [
        'log',
        '--all',
        '--since=24 hours ago',
        '--oneline',
        '--max-count=50',
        '--format=%H|%h|%s|%an|%ar|%D',
      ],
      { cwd: repoPath, timeout: 5000 },
    );

    const lines = stdout.split('\n').filter((line) => line.trim());
    const entries: ActivityEntry[] = [];

    for (const line of lines) {
      try {
        // Split into exactly 6 parts by the first 5 pipe characters
        const parts: string[] = [];
        let remaining = line;
        for (let i = 0; i < 5; i++) {
          const idx = remaining.indexOf('|');
          if (idx === -1) break;
          parts.push(remaining.slice(0, idx));
          remaining = remaining.slice(idx + 1);
        }
        parts.push(remaining);

        if (parts.length < 5) continue;

        const hash = parts[0] ?? '';
        const shortHash = parts[1] ?? '';
        const message = parts[2] ?? '';
        const author = parts[3] ?? '';
        const timeAgo = parts[4] ?? '';
        const decorations = parts[5] ?? '';

        if (!hash || !shortHash) continue;

        const branches: string[] = decorations
          .split(',')
          .map((d) => d.trim())
          .filter((d) => d && !d.startsWith('tag:') && d !== 'HEAD')
          .map((d) => d.replace(/^HEAD -> /, '').replace(/^origin\//, ''));

        entries.push({
          hash: hash.trim(),
          shortHash: shortHash.trim(),
          message: message.trim(),
          author: author.trim(),
          timeAgo: timeAgo.trim(),
          branches: [...new Set(branches)],
        });
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return entries;
  } catch {
    return [];
  }
}

async function getCiStatus(
  repoPath: string,
  branch: string,
  options: {
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<(CiStatus & { authError?: boolean }) | null> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  let stdout: string;
  let stderr: string;

  try {
    ({ stdout, stderr } = await run(
      'gh',
      ['pr', 'checks', branch, '--json', 'name,state,conclusion'],
      { cwd: repoPath, timeout: 5000 },
    ));
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const errObj = err as { code?: string; message?: string; stderr?: string };
      const errorText = errObj.stderr ?? errObj.message ?? '';

      // gh not installed
      if (errObj.code === 'ENOENT') return null;

      // Not authenticated
      if (
        typeof errorText === 'string' &&
        (errorText.includes('not logged into') || errorText.includes('authentication'))
      ) {
        return { total: 0, passing: 0, failing: 0, pending: 0, authError: true };
      }

      // No PR for branch
      if (
        typeof errorText === 'string' &&
        (errorText.includes('no pull requests found') || errorText.includes('Could not find'))
      ) {
        return null;
      }
    }

    return null;
  }

  // gh may exit 0 but write errors or auth prompts to stderr
  if (stderr && (stderr.includes('not logged into') || stderr.includes('authentication'))) {
    return { total: 0, passing: 0, failing: 0, pending: 0, authError: true };
  }

  if (!stdout.trim()) return null;

  try {
    const checks: Array<{ name: string; state: string; conclusion: string }> = JSON.parse(stdout);

    let passing = 0;
    let failing = 0;
    let pending = 0;

    for (const check of checks) {
      const conclusion = (check.conclusion ?? '').toUpperCase();
      const state = (check.state ?? '').toUpperCase();

      if (conclusion === 'SUCCESS' || conclusion === 'SKIPPED' || conclusion === 'NEUTRAL') {
        passing++;
      } else if (conclusion === 'FAILURE' || conclusion === 'CANCELLED' || conclusion === 'TIMED_OUT') {
        failing++;
      } else if (state === 'IN_PROGRESS' || state === 'QUEUED' || state === 'PENDING' || conclusion === '') {
        pending++;
      } else {
        // Unknown conclusion — treat as pending rather than silently ignoring
        pending++;
      }
    }

    return { total: checks.length, passing, failing, pending };
  } catch {
    return null;
  }
}

async function getPrForBranch(
  repoPath: string,
  branch: string,
  options: {
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<PrInfo | null> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  let stdout: string;

  try {
    ({ stdout } = await run(
      'gh',
      [
        'pr',
        'view',
        branch,
        '--json',
        'number,title,url,state,headRefName,baseRefName,reviewDecision,isDraft,additions,deletions,mergeable',
      ],
      { cwd: repoPath, timeout: 5000 },
    ));
  } catch {
    return null;
  }

  if (!stdout.trim()) return null;

  try {
    const data = JSON.parse(stdout) as {
      number: number;
      title: string;
      url: string;
      state: string;
      headRefName: string;
      baseRefName: string;
      isDraft: boolean;
      reviewDecision: string | null;
      additions: number;
      deletions: number;
      mergeable: string;
    };

    return {
      number: data.number,
      title: data.title,
      url: data.url,
      state: data.state as PrInfo['state'],
      headRefName: data.headRefName,
      baseRefName: data.baseRefName,
      isDraft: data.isDraft,
      reviewDecision: data.reviewDecision ?? null,
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      mergeable: (data.mergeable as PrInfo['mergeable']) ?? 'UNKNOWN',
      unresolvedCommentCount: 0,
    };
  } catch {
    return null;
  }
}

async function switchBranch(
  repoPath: string,
  branch: string,
  options: {
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<{ success: true } | { success: false; error: string }> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  try {
    await run('git', ['checkout', branch], { cwd: repoPath, timeout: 5000 });
    return { success: true };
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const errObj = err as { stderr?: string; message?: string };
      const errorText = errObj.stderr ?? errObj.message ?? 'Unknown error';
      return { success: false, error: errorText.trim() };
    }
    return { success: false, error: 'Unknown error' };
  }
}

async function getCommitsAhead(
  repoPath: string,
  branch: string,
  baseBranch: string,
  options: {
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<number> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  try {
    const { stdout } = await run(
      'git',
      ['rev-list', '--count', `${baseBranch}..${branch}`],
      { cwd: repoPath, timeout: 5000 },
    );
    const count = parseInt(stdout.trim(), 10);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

async function getUnresolvedCommentCount(
  repoPath: string,
  prNumber: number,
  options: {
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<number> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  try {
    const { stdout: repoStdout } = await run(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      { cwd: repoPath, timeout: 5000 },
    );
    const nameWithOwner = repoStdout.trim();
    if (!nameWithOwner) return 0;

    const [owner, repo] = nameWithOwner.split('/');
    if (!owner || !repo) return 0;

    const query = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}`;

    const { stdout } = await run(
      'gh',
      [
        'api', 'graphql',
        '-f', `query=${query}`,
        '-f', `owner=${owner}`,
        '-f', `repo=${repo}`,
        '-F', `number=${prNumber}`,
      ],
      { cwd: repoPath, timeout: 10000 },
    );

    const result = JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: Array<{ isResolved: boolean }>;
            };
          };
        };
      };
    };

    const nodes = result?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    return nodes.filter((n) => !n.isResolved).length;
  } catch {
    return 0;
  }
}

async function getWorkingTreeDiff(
  repoPath: string,
  exec: ExecFileAsyncLike = execFileAsync,
): Promise<{ additions: number; deletions: number }> {
  try {
    const { stdout } = await exec('git', ['diff', '--shortstat'], { cwd: repoPath, timeout: 5000 });
    // Output like: " 3 files changed, 55 insertions(+), 12 deletions(-)"
    const insertions = stdout.match(/(\d+) insertion/);
    const deletions = stdout.match(/(\d+) deletion/);
    return {
      additions: insertions?.[1] ? parseInt(insertions[1], 10) : 0,
      deletions: deletions?.[1] ? parseInt(deletions[1], 10) : 0,
    };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

/**
 * Convert a git branch name to a human-readable display name.
 * "fix-mobile-scroll-bug" → "Fix mobile scroll bug"
 * "feature/add-auth"      → "Add auth"
 */
function branchToDisplayName(branch: string): string {
  const stripped = branch.replace(/^(feature|fix|chore|refactor|docs|test|ci|build)\//i, '');
  const words = stripped.replace(/[-_]/g, ' ').trim();
  if (!words) return branch;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function isBranchStale(
  repoPath: string,
  branch: string,
  options: { exec?: ExecFileAsyncLike } = {},
): Promise<boolean> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;
  try {
    for (const base of ['main', 'master']) {
      try {
        const { stdout } = await run(
          'git', ['rev-list', '--count', `${base}..${branch}`],
          { cwd: repoPath, timeout: 5000 },
        );
        const count = parseInt(stdout.trim(), 10);
        if (count === 0) return true;
        return false;
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export {
  listBranches,
  normalizeBranchNames,
  getActivityFeed,
  getCiStatus,
  getPrForBranch,
  getUnresolvedCommentCount,
  switchBranch,
  getCommitsAhead,
  getCurrentBranch,
  getWorkingTreeDiff,
  branchToDisplayName,
  isBranchStale,
};
