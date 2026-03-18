import type { SessionSummary, WorktreeInfo, GitStatus, Workspace } from '../types.js';
import { fireNotification, shouldFireNotification } from '../notifications.js';
import * as api from '../api.js';

const NOTIFICATIONS_STORAGE_KEY = 'claude-remote-notifications';
const ACTIVE_SESSION_KEY = 'claude-remote-active-session';

function loadActiveSessionId(): string | null {
  try { return localStorage.getItem(ACTIVE_SESSION_KEY); }
  catch { return null; }
}

function saveActiveSessionId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_SESSION_KEY);
    else localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } catch { /* localStorage unavailable */ }
}

let sessions = $state<SessionSummary[]>([]);
let worktrees = $state<WorktreeInfo[]>([]);
let workspaces = $state<Workspace[]>([]);
let activeSessionId = $state<string | null>(loadActiveSessionId());
let attentionSessions = $state<Record<string, boolean>>({});
let dismissedSessions = $state<Record<string, number>>({});
let loadingItems = $state<Record<string, boolean>>({});
let notificationSessions = $state<Record<string, boolean>>({});

// Load notification preferences from localStorage
try {
  const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
  if (stored) notificationSessions = JSON.parse(stored);
} catch { /* localStorage unavailable */ }

function saveNotificationPrefs(): void {
  try {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notificationSessions));
  } catch { /* localStorage unavailable */ }
}

export function getSessionState() {
  return {
    get sessions() { return sessions; },
    get worktrees() { return worktrees; },
    get workspaces() { return workspaces; },
    get activeSessionId() { return activeSessionId; },
    set activeSessionId(id: string | null) {
      activeSessionId = id;
      saveActiveSessionId(id);
    },
    get attentionSessions() { return attentionSessions; },
    get loadingItems() { return loadingItems; },
    get notificationSessions() { return notificationSessions; },
  };
}

export async function refreshAll(): Promise<void> {
  try {
    const [s, w, ws] = await Promise.all([
      api.fetchSessions(),
      api.fetchWorktrees(),
      api.fetchWorkspaces(),
    ]);
    sessions = s;
    worktrees = w;
    workspaces = ws;

    // Validate restored activeSessionId — clear if the session no longer exists
    const activeIds = new Set(sessions.map(sess => sess.id));
    if (activeSessionId !== null && !activeIds.has(activeSessionId)) {
      activeSessionId = null;
      saveActiveSessionId(null);
    }

    // Prune stale attention flags, dismissed cooldowns, and notification prefs
    let notifPruned = false;
    for (const id of Object.keys(attentionSessions)) {
      if (!activeIds.has(id)) delete attentionSessions[id];
    }
    for (const id of Object.keys(dismissedSessions)) {
      if (!activeIds.has(id)) delete dismissedSessions[id];
    }
    for (const id of Object.keys(notificationSessions)) {
      if (!activeIds.has(id)) {
        delete notificationSessions[id];
        notifPruned = true;
      }
    }
    if (notifPruned) saveNotificationPrefs();
  } catch { /* silent */ }
}

export function getSessionsForWorkspace(workspacePath: string): SessionSummary[] {
  return sessions.filter(s => s.repoPath === workspacePath);
}

const ATTENTION_COOLDOWN_MS = 30_000;

export function setAttention(sessionId: string, idle: boolean): void {
  // Update the idle flag on the session object so getSessionStatus() reflects
  // the real-time state without waiting for a full refreshAll() round-trip.
  const session = sessions.find(s => s.id === sessionId);
  if (session) session.idle = idle;

  if (idle && sessionId !== activeSessionId && session?.type !== 'terminal') {
    const dismissedAt = dismissedSessions[sessionId];
    if (dismissedAt && Date.now() - dismissedAt < ATTENTION_COOLDOWN_MS) {
      // Within cooldown window — don't re-trigger attention
      return;
    }
    delete dismissedSessions[sessionId];
    attentionSessions[sessionId] = true;

    // Fire browser notification if enabled and tab not focused
    if (session && notificationSessions[sessionId] && shouldFireNotification()) {
      fireNotification(session);
    }
  } else {
    delete attentionSessions[sessionId];
  }
}

export function clearAttention(sessionId: string): void {
  delete attentionSessions[sessionId];
  dismissedSessions[sessionId] = Date.now();
}

export function setNotificationEnabled(sessionId: string, enabled: boolean): void {
  notificationSessions[sessionId] = enabled;
  saveNotificationPrefs();
}

export function initSessionNotification(sessionId: string, defaultEnabled: boolean): void {
  if (!(sessionId in notificationSessions)) {
    notificationSessions[sessionId] = defaultEnabled;
    saveNotificationPrefs();
  }
}

export function getNotificationSessionIds(): string[] {
  return Object.entries(notificationSessions)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);
}

export function setGitStatus(key: string, status: GitStatus): void {
  // Per-session polling handles git statuses; this is kept for compatibility
  void key; void status;
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
