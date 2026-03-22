import type { SessionSummary, WorktreeInfo, Workspace, DashboardData, CiStatus, PrInfo, PullRequest, ActivityEntry, WorkspaceSettings, OrgPrsResponse, GitHubIssuesResponse, BranchLinksResponse, JiraIssuesResponse, LinearIssuesResponse, JiraStatus, LinearState } from './types.js';

export class ConflictError extends Error {
  sessionId: string;
  constructor(sessionId: string) {
    super('conflict');
    this.name = 'ConflictError';
    this.sessionId = sessionId;
  }
}

export interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasChildren: boolean;
}

export interface BrowseResponse {
  resolved: string;
  entries: BrowseEntry[];
  truncated: boolean;
  total: number;
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

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const data = await json<{ workspaces: Workspace[] }>(await fetch('/workspaces'));
  return data.workspaces;
}

export async function addWorkspace(path: string): Promise<void> {
  const res = await fetch('/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error || 'Failed to add workspace'); }
}

export async function removeWorkspace(path: string): Promise<void> {
  const res = await fetch('/workspaces', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  if (!res.ok) throw new Error('Failed to remove workspace');
}

export async function reorderWorkspaces(paths: string[]): Promise<Workspace[]> {
  const data = await json<{ workspaces: Workspace[] }>(
    await fetch('/workspaces/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }),
  );
  return data.workspaces;
}

export async function browseFsDirectory(
  dirPath?: string,
  options?: { prefix?: string; showHidden?: boolean },
): Promise<BrowseResponse> {
  const params = new URLSearchParams();
  if (dirPath) params.set('path', dirPath);
  if (options?.prefix) params.set('prefix', options.prefix);
  if (options?.showHidden) params.set('showHidden', 'true');
  return json<BrowseResponse>(await fetch('/workspaces/browse?' + params.toString()));
}

export interface BulkAddResult {
  added: Array<{ path: string; name: string; isGitRepo: boolean; defaultBranch: string | null }>;
  errors: Array<{ path: string; error: string }>;
}

export async function addWorkspacesBulk(paths: string[]): Promise<BulkAddResult> {
  return json<BulkAddResult>(
    await fetch('/workspaces/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }),
  );
}

export async function fetchDashboard(workspacePath: string): Promise<DashboardData> {
  interface RawDashboard {
    pullRequests: { prs: PullRequest[]; error?: string };
    branches: string[];
    activity: ActivityEntry[];
  }
  const raw = await json<RawDashboard>(await fetch('/workspaces/dashboard?path=' + encodeURIComponent(workspacePath)));
  return {
    prs: raw.pullRequests?.prs ?? [],
    activity: raw.activity ?? [],
    isGitRepo: true,
    defaultBranch: null,
    hasGhCli: !raw.pullRequests?.error,
  };
}

export async function fetchCiStatusOrNull(workspacePath: string, branch: string): Promise<CiStatus | null> {
  const res = await fetch('/workspaces/ci-status?path=' + encodeURIComponent(workspacePath) + '&branch=' + encodeURIComponent(branch));
  if (!res.ok) return null;
  return res.json() as Promise<CiStatus>;
}

export async function fetchPrForBranchOrNull(workspacePath: string, branch: string): Promise<PrInfo | null> {
  const res = await fetch('/workspaces/pr?path=' + encodeURIComponent(workspacePath) + '&branch=' + encodeURIComponent(branch));
  if (!res.ok) return null;
  return res.json() as Promise<PrInfo>;
}

export async function fetchCurrentBranch(workspacePath: string): Promise<string | null> {
  const data = await json<{ branch: string | null }>(await fetch('/workspaces/current-branch?path=' + encodeURIComponent(workspacePath)));
  return data.branch;
}

export async function autocompletePath(prefix: string): Promise<string[]> {
  const data = await json<{ suggestions: string[] }>(await fetch('/workspaces/autocomplete?prefix=' + encodeURIComponent(prefix)));
  return data.suggestions;
}

export async function createWorktree(workspacePath: string, branch?: string): Promise<{ branchName: string; mountainName: string; worktreePath: string }> {
  const res = await fetch('/workspaces/worktree?path=' + encodeURIComponent(workspacePath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Failed to create worktree');
  }
  return res.json() as Promise<{ branchName: string; mountainName: string; worktreePath: string }>;
}

export async function switchBranch(workspacePath: string, branch: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('/workspaces/branch?path=' + encodeURIComponent(workspacePath), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch })
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function fetchBranches(repoPath: string, options: { refresh?: boolean } = {}): Promise<string[]> {
  const params = new URLSearchParams({ repo: repoPath });
  if (options.refresh) params.set('refresh', '1');
  return json<string[]>(await fetch('/branches?' + params.toString()));
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
  cols?: number | undefined;
  rows?: number | undefined;
  needsBranchRename?: boolean | undefined;
  branchRenamePrompt?: string | undefined;
  ticketContext?: {
    ticketId: string;
    title: string;
    description?: string;
    url: string;
    source: 'github' | 'jira' | 'linear';
    repoPath: string;
    repoName: string;
  };
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
  cols?: number | undefined;
  rows?: number | undefined;
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

export async function createTerminalSession(cwd?: string): Promise<SessionSummary> {
  const res = await fetch('/sessions/terminal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  });
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
export const fetchDefaultNotifications = () => fetchConfigBool('defaultNotifications');
export const setDefaultNotifications = (v: boolean) => setConfigBool('defaultNotifications', v);

export async function fetchVapidKey(): Promise<string | null> {
  try {
    const data = await json<{ vapidPublicKey: string }>(await fetch('/push/vapid-key'));
    return data.vapidPublicKey;
  } catch { return null; }
}

export async function pushSubscribe(subscription: PushSubscriptionJSON, sessionIds: string[]): Promise<void> {
  const res = await fetch('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, sessionIds }),
  });
  if (!res.ok) throw new Error('Push subscribe failed');
}

export async function pushUnsubscribe(endpoint: string): Promise<void> {
  await fetch('/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

export async function fetchWorkspaceSettings(workspacePath: string): Promise<WorkspaceSettings> {
  return json<WorkspaceSettings>(await fetch('/workspaces/settings?path=' + encodeURIComponent(workspacePath)));
}

export interface MergedWorkspaceSettings {
  settings: WorkspaceSettings;
  overridden: string[];
}

export async function fetchMergedWorkspaceSettings(workspacePath: string): Promise<MergedWorkspaceSettings> {
  return json<MergedWorkspaceSettings>(
    await fetch('/workspaces/settings/merged?path=' + encodeURIComponent(workspacePath))
  );
}

export async function updateWorkspaceSettings(workspacePath: string, settings: WorkspaceSettings): Promise<void> {
  const res = await fetch('/workspaces/settings?path=' + encodeURIComponent(workspacePath), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Failed to update workspace settings');
  }
}

export async function fetchOrgPrs(): Promise<OrgPrsResponse> {
  const res = await fetch('/org-dashboard/prs');
  return json<OrgPrsResponse>(res);
}

export async function fetchGithubIssues(): Promise<GitHubIssuesResponse> {
  const res = await fetch('/integration-github/issues');
  return json<GitHubIssuesResponse>(res);
}

export async function fetchBranchLinks(): Promise<BranchLinksResponse> {
  const res = await fetch('/branch-linker/links');
  return json<BranchLinksResponse>(res);
}

export async function fetchJiraIssues(): Promise<JiraIssuesResponse> {
  const res = await fetch('/integration-jira/issues');
  return json<JiraIssuesResponse>(res);
}

export async function fetchJiraConfigured(): Promise<boolean> {
  const data = await json<{ configured: boolean }>(await fetch('/integration-jira/configured'));
  return data.configured;
}

export async function fetchJiraStatuses(projectKey: string): Promise<JiraStatus[]> {
  const data = await json<{ statuses: JiraStatus[] }>(await fetch('/integration-jira/statuses?projectKey=' + encodeURIComponent(projectKey)));
  return data.statuses;
}

export async function fetchLinearIssues(): Promise<LinearIssuesResponse> {
  const res = await fetch('/integration-linear/issues');
  return json<LinearIssuesResponse>(res);
}

export async function fetchLinearConfigured(): Promise<boolean> {
  const data = await json<{ configured: boolean }>(await fetch('/integration-linear/configured'));
  return data.configured;
}

export async function fetchLinearStates(teamId: string): Promise<LinearState[]> {
  const data = await json<{ states: LinearState[] }>(await fetch('/integration-linear/states?teamId=' + encodeURIComponent(teamId)));
  return data.states;
}

export async function fetchWorkspaceGroups(): Promise<Record<string, string[]>> {
  const data = await json<{ groups: Record<string, string[]> }>(await fetch('/config/workspace-groups'));
  return data.groups;
}

export async function fetchAnalyticsSize(): Promise<{ bytes: number }> {
  return json<{ bytes: number }>(await fetch('/analytics/size'));
}

export async function clearAnalytics(): Promise<void> {
  const res = await fetch('/analytics/events', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear analytics');
}
