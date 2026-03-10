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

export async function fetchBranches(repoPath: string, options: { refresh?: boolean } = {}): Promise<string[]> {
  const params = new URLSearchParams({ repo: repoPath });
  if (options.refresh) params.set('refresh', '1');
  return json<string[]>(await fetch('/branches?' + params.toString()));
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
  yolo?: boolean | undefined;
  agent?: string | undefined;
  useTmux?: boolean | undefined;
}): Promise<SessionSummary> {
  const res = await fetch('/sessions', {
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

export async function createRepoSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  continue?: boolean | undefined;
  claudeArgs?: string[] | undefined;
  yolo?: boolean | undefined;
  agent?: string | undefined;
  useTmux?: boolean | undefined;
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

export async function createTerminalSession(): Promise<SessionSummary> {
  const res = await fetch('/sessions/terminal', { method: 'POST' });
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

export async function fetchDefaultAgent(): Promise<string> {
  const data = await json<{ defaultAgent: string }>(await fetch('/config/defaultAgent'));
  return data.defaultAgent;
}

export async function setDefaultAgent(agent: string): Promise<void> {
  const res = await fetch('/config/defaultAgent', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultAgent: agent }),
  });
  if (!res.ok) throw new Error('Failed to update default agent');
}

async function fetchConfigBool(key: string): Promise<boolean> {
  const data = await json<Record<string, boolean>>(await fetch(`/config/${key}`));
  return data[key]!;
}

async function setConfigBool(key: string, value: boolean): Promise<void> {
  const res = await fetch(`/config/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || `Failed to update ${key}`);
  }
}

export const fetchDefaultContinue = () => fetchConfigBool('defaultContinue');
export const setDefaultContinue = (v: boolean) => setConfigBool('defaultContinue', v);
export const fetchDefaultYolo = () => fetchConfigBool('defaultYolo');
export const setDefaultYolo = (v: boolean) => setConfigBool('defaultYolo', v);
export const fetchLaunchInTmux = () => fetchConfigBool('launchInTmux');
export const setLaunchInTmux = (v: boolean) => setConfigBool('launchInTmux', v);
