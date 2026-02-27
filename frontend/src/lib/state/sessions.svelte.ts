import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus } from '../types.js';
import * as api from '../api.js';

let sessions = $state<SessionSummary[]>([]);
let worktrees = $state<WorktreeInfo[]>([]);
let repos = $state<RepoInfo[]>([]);
let activeSessionId = $state<string | null>(null);
let attentionSessions = $state<Record<string, boolean>>({});
let gitStatuses = $state<Record<string, GitStatus>>({});
let loadingItems = $state<Record<string, boolean>>({});

export function getSessionState() {
  return {
    get sessions() { return sessions; },
    get worktrees() { return worktrees; },
    get repos() { return repos; },
    get activeSessionId() { return activeSessionId; },
    set activeSessionId(id: string | null) { activeSessionId = id; },
    get attentionSessions() { return attentionSessions; },
    get gitStatuses() { return gitStatuses; },
    get loadingItems() { return loadingItems; },
  };
}

export async function refreshAll(): Promise<void> {
  try {
    const [s, w, r] = await Promise.all([
      api.fetchSessions(),
      api.fetchWorktrees(),
      api.fetchRepos(),
    ]);
    sessions = s;
    worktrees = w;
    repos = r;

    // Prune stale attention flags
    const activeIds = new Set(sessions.map(sess => sess.id));
    for (const id of Object.keys(attentionSessions)) {
      if (!activeIds.has(id)) delete attentionSessions[id];
    }

    refreshGitStatuses();
  } catch { /* silent */ }
}

let gitStatusTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshGitStatuses(): Promise<void> {
  if (gitStatusTimer) clearTimeout(gitStatusTimer);
  gitStatusTimer = setTimeout(async () => {
    for (const wt of worktrees) {
      const branch = wt.name; // worktree dir name is typically the branch
      const key = wt.repoPath + ':' + branch;
      if (gitStatuses[key]) continue; // already cached
      try {
        const status = await api.fetchGitStatus(wt.repoPath, branch);
        gitStatuses[key] = status;
      } catch { /* silent */ }
    }
  }, 500);
}

export function setAttention(sessionId: string, idle: boolean): void {
  // Update the idle flag on the session object so getSessionStatus() reflects
  // the real-time state without waiting for a full refreshAll() round-trip.
  const session = sessions.find(s => s.id === sessionId);
  if (session) session.idle = idle;

  if (idle && sessionId !== activeSessionId) {
    attentionSessions[sessionId] = true;
  } else {
    delete attentionSessions[sessionId];
  }
}

export function clearAttention(sessionId: string): void {
  delete attentionSessions[sessionId];
}

export function setGitStatus(key: string, status: GitStatus): void {
  gitStatuses[key] = status;
}

export function getSessionStatus(session: SessionSummary): 'attention' | 'idle' | 'running' {
  if (attentionSessions[session.id]) return 'attention';
  if (session.idle) return 'idle';
  return 'running';
}

export function setLoading(key: string): void {
  loadingItems[key] = true;
}

export function clearLoading(key: string): void {
  delete loadingItems[key];
}

export function isItemLoading(key: string): boolean {
  return !!loadingItems[key];
}
