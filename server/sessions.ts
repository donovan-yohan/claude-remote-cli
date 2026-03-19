import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentType, AgentState, Session, SessionSummary, SessionMeta, SessionType } from './types.js';
import { AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS } from './types.js';
import { createPtySession } from './pty-handler.js';
import type { CreatePtyParams } from './pty-handler.js';
import { getPrForBranch, getWorkingTreeDiff } from './git.js';

const execFileAsync = promisify(execFile);

interface SerializedPtySession {
  id: string;
  type: SessionType;
  agent: AgentType;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  useTmux: boolean;
  tmuxSessionName: string;
  customCommand: string | null;
  cwd: string;
}

interface PendingSessionsFile {
  version: number;
  timestamp: string;
  sessions: SerializedPtySession[];
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

type CreateParams = {
  id?: string;
  type?: SessionType;
  agent?: AgentType;
  repoName?: string;
  repoPath: string;
  cwd?: string;
  root?: string;
  worktreeName?: string;
  branchName?: string;
  displayName?: string;
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  configPath?: string;
  useTmux?: boolean;
  /** Override for the tmux session name (used when restoring serialized sessions) */
  tmuxSessionName?: string;
  /** Pre-loaded scrollback for restored sessions */
  initialScrollback?: string[];
  /** Mark this session as a restored session (PTY exit won't delete it) */
  restored?: boolean;
  /** Flag to trigger branch rename on first message (worktree auto-naming) */
  needsBranchRename?: boolean;
  /** Custom prompt for branch rename (from workspace settings) */
  branchRenamePrompt?: string;
};

type CreateResult = SessionSummary & { pid: number | undefined };

// In-memory registry: id -> Session
const sessions = new Map<string, Session>();

// Session metadata cache: session ID or worktree path -> SessionMeta
const metaCache = new Map<string, SessionMeta>();

let terminalCounter = 0;
type IdleChangeCallback = (sessionId: string, idle: boolean) => void;
const idleChangeCallbacks: IdleChangeCallback[] = [];

function onIdleChange(cb: IdleChangeCallback): void {
  idleChangeCallbacks.push(cb);
}

type StateChangeCallback = (sessionId: string, state: AgentState) => void;
const stateChangeCallbacks: StateChangeCallback[] = [];

function onStateChange(cb: StateChangeCallback): void {
  stateChangeCallbacks.push(cb);
}

type SessionEndCallback = (sessionId: string, repoPath: string, branchName: string) => void;
const sessionEndCallbacks: SessionEndCallback[] = [];

function onSessionEnd(cb: SessionEndCallback): void {
  sessionEndCallbacks.push(cb);
}

function fireSessionEnd(sessionId: string, repoPath: string, branchName: string): void {
  for (const cb of sessionEndCallbacks) cb(sessionId, repoPath, branchName);
}

function create({ id: providedId, type, agent = 'claude', repoName, repoPath, cwd, root, worktreeName, branchName, displayName, command, args = [], cols = 80, rows = 24, configPath, useTmux: paramUseTmux, tmuxSessionName: paramTmuxSessionName, initialScrollback, restored: paramRestored, needsBranchRename: paramNeedsBranchRename, branchRenamePrompt: paramBranchRenamePrompt }: CreateParams): CreateResult {
  const id = providedId || crypto.randomBytes(8).toString('hex');

  // PTY path
  const ptyParams: CreatePtyParams = {
    id,
    type,
    agent,
    repoName,
    repoPath,
    cwd,
    root,
    worktreeName,
    branchName,
    displayName,
    command,
    args,
    cols,
    rows,
    configPath,
    useTmux: paramUseTmux,
    tmuxSessionName: paramTmuxSessionName,
    initialScrollback,
    restored: paramRestored,
  };

  const { session: ptySession, result } = createPtySession(ptyParams, sessions, idleChangeCallbacks, stateChangeCallbacks);
  if (paramNeedsBranchRename) {
    ptySession.needsBranchRename = true;
  }
  if (paramBranchRenamePrompt) {
    ptySession.branchRenamePrompt = paramBranchRenamePrompt;
  }
  return { ...result, needsBranchRename: !!ptySession.needsBranchRename };
}

function get(id: string): Session | undefined {
  return sessions.get(id);
}

function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map((s): SessionSummary => ({
      id: s.id,
      type: s.type,
      agent: s.agent,
      mode: s.mode,
      root: s.root,
      repoName: s.repoName,
      repoPath: s.repoPath,
      worktreeName: s.worktreeName,
      branchName: s.branchName,
      displayName: s.displayName,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      idle: s.idle,
      cwd: s.cwd,
      customCommand: s.customCommand,
      useTmux: s.useTmux,
      tmuxSessionName: s.tmuxSessionName,
      status: s.status,
      needsBranchRename: !!s.needsBranchRename,
      agentState: s.agentState,
    }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

function updateDisplayName(id: string, displayName: string): { id: string; displayName: string } {
  const session = sessions.get(id);
  if (!session) throw new Error('Session not found: ' + id);
  session.displayName = displayName;
  return { id, displayName };
}

function kill(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  try {
    session.pty.kill('SIGTERM');
  } catch {
    // PTY may already be dead (e.g. disconnected sessions) — still delete from registry
  }
  if (session.tmuxSessionName) {
    execFile('tmux', ['kill-session', '-t', session.tmuxSessionName], () => {});
  }
  fireSessionEnd(id, session.repoPath, session.branchName);
  sessions.delete(id);
}

function killAllTmuxSessions(): void {
  for (const session of sessions.values()) {
    if (session.tmuxSessionName) {
      execFile('tmux', ['kill-session', '-t', session.tmuxSessionName], () => {});
    }
  }
}

function resize(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.resize(cols, rows);
}

function write(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.write(data);
}

function findRepoSession(repoPath: string): SessionSummary | undefined {
  return list().find((s) => s.type === 'repo' && s.repoPath === repoPath);
}

function nextTerminalName(): string {
  return `Terminal ${++terminalCounter}`;
}

function serializeAll(configDir: string): void {
  const scrollbackDirPath = path.join(configDir, 'scrollback');
  fs.mkdirSync(scrollbackDirPath, { recursive: true });

  const serializedPty: SerializedPtySession[] = [];

  for (const session of sessions.values()) {
    // Write scrollback to disk
    const scrollbackPath = path.join(scrollbackDirPath, session.id + '.buf');
    fs.writeFileSync(scrollbackPath, session.scrollback.join(''), 'utf-8');

    serializedPty.push({
      id: session.id,
      type: session.type,
      agent: session.agent,
      root: session.root,
      repoName: session.repoName,
      repoPath: session.repoPath,
      worktreeName: session.worktreeName,
      branchName: session.branchName,
      displayName: session.displayName,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      useTmux: session.useTmux,
      tmuxSessionName: session.tmuxSessionName,
      customCommand: session.customCommand,
      cwd: session.cwd,
    });
  }

  const pending: PendingSessionsFile = {
    version: 1,
    timestamp: new Date().toISOString(),
    sessions: serializedPty,
  };

  fs.writeFileSync(path.join(configDir, 'pending-sessions.json'), JSON.stringify(pending, null, 2), 'utf-8');
}

async function restoreFromDisk(configDir: string): Promise<number> {
  const pendingPath = path.join(configDir, 'pending-sessions.json');
  if (!fs.existsSync(pendingPath)) return 0;

  let pending: PendingSessionsFile;
  try {
    pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as PendingSessionsFile;
  } catch {
    fs.unlinkSync(pendingPath);
    return 0;
  }

  // Ignore stale files (>5 minutes old)
  if (Date.now() - new Date(pending.timestamp).getTime() > STALE_THRESHOLD_MS) {
    fs.unlinkSync(pendingPath);
    return 0;
  }

  const scrollbackDirPath = path.join(configDir, 'scrollback');
  let restored = 0;

  // Restore PTY sessions
  for (const s of pending.sessions) {
    // Load scrollback from disk
    let initialScrollback: string[] | undefined;
    const scrollbackPath = path.join(scrollbackDirPath, s.id + '.buf');
    try {
      const data = fs.readFileSync(scrollbackPath, 'utf-8');
      if (data.length > 0) initialScrollback = [data];
    } catch {
      // Missing scrollback is non-fatal
    }

    // Determine spawn command and args
    let command: string | undefined;
    let args: string[] = [];

    if (s.customCommand) {
      // Terminal session — respawn the shell
      command = s.customCommand;
    } else if (s.useTmux && s.tmuxSessionName) {
      // Tmux session — check if tmux session is still alive
      let tmuxAlive = false;
      try {
        await execFileAsync('tmux', ['has-session', '-t', s.tmuxSessionName]);
        tmuxAlive = true;
      } catch {
        // tmux session is gone
      }

      if (tmuxAlive) {
        // Attach to surviving tmux session
        command = 'tmux';
        args = ['-u', 'attach-session', '-t', s.tmuxSessionName];
      } else {
        // Tmux session died — fall back to agent with continue args
        args = [...AGENT_CONTINUE_ARGS[s.agent]];
      }
    } else {
      // Non-tmux agent session — respawn with continue args
      args = [...AGENT_CONTINUE_ARGS[s.agent]];
    }

    try {
      const createParams: CreateParams = {
        id: s.id,
        type: s.type,
        agent: s.agent,
        repoName: s.repoName,
        repoPath: s.repoPath,
        cwd: s.cwd,
        root: s.root,
        worktreeName: s.worktreeName,
        branchName: s.branchName,
        displayName: s.displayName,
        args,
        useTmux: false, // Don't re-wrap in tmux — either attaching to existing or using plain agent
        tmuxSessionName: s.tmuxSessionName,
        restored: true,
      };
      if (command) createParams.command = command;
      if (initialScrollback) createParams.initialScrollback = initialScrollback;
      create(createParams);
      restored++;
    } catch {
      console.error(`Failed to restore session ${s.id} (${s.displayName})`);
    }

    // Clean up scrollback file
    try { fs.unlinkSync(scrollbackPath); } catch { /* ignore */ }
  }

  // Clean up
  try { fs.unlinkSync(pendingPath); } catch { /* ignore */ }
  try { fs.rmdirSync(path.join(configDir, 'scrollback')); } catch { /* ignore — may not be empty */ }

  return restored;
}

/** Returns the set of tmux session names currently owned by restored sessions */
function activeTmuxSessionNames(): Set<string> {
  const names = new Set<string>();
  for (const session of sessions.values()) {
    if (session.tmuxSessionName) names.add(session.tmuxSessionName);
  }
  return names;
}

async function fetchMetaForSession(session: SessionSummary): Promise<SessionMeta> {
  const repoPath = session.repoPath;
  const branch = session.branchName;

  let prNumber: number | null = null;
  let additions = 0;
  let deletions = 0;

  if (branch) {
    try {
      const pr = await getPrForBranch(repoPath, branch);
      if (pr) {
        prNumber = pr.number;
        additions = pr.additions;
        deletions = pr.deletions;
      }
    } catch { /* gh CLI unavailable */ }
  }

  // Fallback to working tree diff if no PR data
  if (additions === 0 && deletions === 0) {
    const diff = await getWorkingTreeDiff(repoPath);
    additions = diff.additions;
    deletions = diff.deletions;
  }

  return { prNumber, additions, deletions, fetchedAt: new Date().toISOString() };
}

async function getSessionMeta(id: string, refresh = false): Promise<SessionMeta | null> {
  if (!refresh && metaCache.has(id)) return metaCache.get(id)!;

  const session = sessions.get(id);
  if (!session) return metaCache.get(id) ?? null;

  const summary = list().find(s => s.id === id);
  if (!summary) return null;

  const meta = await fetchMetaForSession(summary);
  metaCache.set(id, meta);
  return meta;
}

function getAllSessionMeta(): Record<string, SessionMeta> {
  const result: Record<string, SessionMeta> = {};
  for (const [key, meta] of metaCache) {
    result[key] = meta;
  }
  return result;
}

// Populate cache for all active sessions (called on startup or refresh)
async function populateMetaCache(): Promise<void> {
  const allSessions = list();
  await Promise.allSettled(
    allSessions.map(async (s) => {
      if (!metaCache.has(s.id)) {
        const meta = await fetchMetaForSession(s);
        metaCache.set(s.id, meta);
      }
    }),
  );
}

// Re-export pty-handler utilities for backward compatibility
export { generateTmuxSessionName, resolveTmuxSpawn } from './pty-handler.js';

export { create, get, list, kill, killAllTmuxSessions, resize, updateDisplayName, write, onIdleChange, onStateChange, onSessionEnd, fireSessionEnd, findRepoSession, nextTerminalName, serializeAll, restoreFromDisk, activeTmuxSessionNames, getSessionMeta, getAllSessionMeta, populateMetaCache, AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS };
