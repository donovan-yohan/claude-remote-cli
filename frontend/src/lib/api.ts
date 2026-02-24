import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus, PullRequestsResponse } from './types.js';

export class ConflictError extends Error {
  sessionId: string;
  constructor(sessionId: string) {
    super('conflict');
    this.name = 'ConflictError';
    this.sessionId = sessionId;
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function authenticate(pin: string): Promise<void> {
  const res = await fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Authentication failed');
  }
}

export async function checkAuth(): Promise<boolean> {
  const res = await fetch('/sessions');
  return res.ok;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  return json<SessionSummary[]>(await fetch('/sessions'));
}

export async function fetchWorktrees(): Promise<WorktreeInfo[]> {
  return json<WorktreeInfo[]>(await fetch('/worktrees'));
}

export async function fetchRepos(): Promise<RepoInfo[]> {
  return json<RepoInfo[]>(await fetch('/repos'));
}

export async function fetchRoots(): Promise<string[]> {
  return json<string[]>(await fetch('/roots'));
}

export async function fetchBranches(repoPath: string): Promise<string[]> {
  return json<string[]>(await fetch('/branches?repo=' + encodeURIComponent(repoPath)));
}

export async function fetchGitStatus(repoPath: string, branch: string): Promise<GitStatus> {
  return json<GitStatus>(
    await fetch('/git-status?repo=' + encodeURIComponent(repoPath) + '&branch=' + encodeURIComponent(branch)),
  );
}

export async function fetchPullRequests(repoPath: string): Promise<PullRequestsResponse> {
  return json<PullRequestsResponse>(await fetch('/pull-requests?repo=' + encodeURIComponent(repoPath)));
}

export async function createSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  worktreePath?: string | undefined;
  branchName?: string | undefined;
  claudeArgs?: string[] | undefined;
}): Promise<SessionSummary> {
  return json<SessionSummary>(
    await fetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function createRepoSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  continue?: boolean | undefined;
  claudeArgs?: string[] | undefined;
}): Promise<SessionSummary> {
  const res = await fetch('/sessions/repo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const data = await res.json() as { sessionId?: string };
    throw new ConflictError(data.sessionId ?? '');
  }
  return json<SessionSummary>(res);
}

export async function killSession(id: string): Promise<void> {
  await fetch('/sessions/' + id, { method: 'DELETE' });
}

export async function renameSession(id: string, displayName: string): Promise<void> {
  await fetch('/sessions/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
}

export async function deleteWorktree(worktreePath: string, repoPath: string): Promise<void> {
  const res = await fetch('/worktrees', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreePath, repoPath }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Failed to delete worktree');
  }
}

export async function addRoot(path: string): Promise<string[]> {
  return json<string[]>(
    await fetch('/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  );
}

export async function removeRoot(path: string): Promise<string[]> {
  return json<string[]>(
    await fetch('/roots', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  );
}

export async function uploadImage(
  sessionId: string,
  data: string,
  mimeType: string,
): Promise<{ path: string; clipboardSet: boolean }> {
  return json<{ path: string; clipboardSet: boolean }>(
    await fetch('/sessions/' + sessionId + '/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, mimeType }),
    }),
  );
}

export async function checkVersion(): Promise<{ current: string; latest: string | null; updateAvailable: boolean }> {
  return json<{ current: string; latest: string | null; updateAvailable: boolean }>(await fetch('/version'));
}

export async function triggerUpdate(): Promise<{ ok: boolean; restarting?: boolean; error?: string }> {
  return json<{ ok: boolean; restarting?: boolean; error?: string }>(await fetch('/update', { method: 'POST' }));
}
