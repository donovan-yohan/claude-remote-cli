import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentType, PtySession, SdkSession, Session, SessionSummary, SessionType } from './types.js';
import { AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS } from './types.js';
import { createPtySession, generateTmuxSessionName, resolveTmuxSpawn } from './pty-handler.js';
import type { CreatePtyParams } from './pty-handler.js';
import { createSdkSession, killSdkSession, sendMessage as sdkSendMessage, handlePermission as sdkHandlePermission, interruptSession as sdkInterruptSession, serializeSdkSession, restoreSdkSession } from './sdk-handler.js';
import type { SerializedSdkSession } from './sdk-handler.js';

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
  sdkSessions?: SerializedSdkSession[] | undefined;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const SDK_IDLE_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds
const SDK_MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const SDK_MAX_IDLE_SESSIONS = 5;

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

let terminalCounter = 0;
type IdleChangeCallback = (sessionId: string, idle: boolean) => void;
const idleChangeCallbacks: IdleChangeCallback[] = [];

function onIdleChange(cb: IdleChangeCallback): void {
  idleChangeCallbacks.push(cb);
}

function offIdleChange(cb: IdleChangeCallback): void {
  const idx = idleChangeCallbacks.indexOf(cb);
  if (idx !== -1) idleChangeCallbacks.splice(idx, 1);
}

function create({ id: providedId, type, agent = 'claude', repoName, repoPath, cwd, root, worktreeName, branchName, displayName, command, args = [], cols = 80, rows = 24, configPath, useTmux: paramUseTmux, tmuxSessionName: paramTmuxSessionName, initialScrollback, restored: paramRestored, needsBranchRename: paramNeedsBranchRename, branchRenamePrompt: paramBranchRenamePrompt }: CreateParams): CreateResult {
  const id = providedId || crypto.randomBytes(8).toString('hex');

  // Dispatch: if agent is claude, no custom command, try SDK first
  if (agent === 'claude' && !command) {
    const sdkResult = createSdkSession(
      {
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
      },
      sessions,
      idleChangeCallbacks,
    );

    if (!('fallback' in sdkResult)) {
      if (paramNeedsBranchRename) {
        // createSdkSession initializes needsBranchRename to false; set it now
        sessions.get(id)!.needsBranchRename = true;
      }
      return { ...sdkResult.result, pid: undefined, needsBranchRename: !!paramNeedsBranchRename };
    }
    // SDK init failed — fall through to PTY
  }

  // PTY path: codex, terminal, custom command, or SDK fallback
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

  const { result, session: ptySession } = createPtySession(ptyParams, sessions, idleChangeCallbacks);
  if (paramNeedsBranchRename) {
    ptySession.needsBranchRename = true;
  }
  return { ...result, needsBranchRename: ptySession.needsBranchRename };
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
      useTmux: s.mode === 'pty' ? s.useTmux : false,
      tmuxSessionName: s.mode === 'pty' ? s.tmuxSessionName : '',
      status: s.status,
      needsBranchRename: s.needsBranchRename,
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
  if (session.mode === 'pty') {
    try {
      session.pty.kill('SIGTERM');
    } catch {
      // PTY may already be dead (e.g. disconnected sessions) — still delete from registry
    }
    if (session.tmuxSessionName) {
      execFile('tmux', ['kill-session', '-t', session.tmuxSessionName], () => {});
    }
  } else if (session.mode === 'sdk') {
    killSdkSession(id);
  }
  sessions.delete(id);
}

function killAllTmuxSessions(): void {
  for (const session of sessions.values()) {
    if (session.mode === 'pty' && session.tmuxSessionName) {
      execFile('tmux', ['kill-session', '-t', session.tmuxSessionName], () => {});
    }
  }
}

function resize(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  if (session.mode === 'pty') {
    session.pty.resize(cols, rows);
  }
  // SDK sessions don't support resize (no PTY)
}

function write(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  if (session.mode === 'pty') {
    session.pty.write(data);
  } else if (session.mode === 'sdk') {
    sdkSendMessage(id, data);
  }
}

function handlePermission(id: string, requestId: string, approved: boolean): void {
  sdkHandlePermission(id, requestId, approved);
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
  const serializedSdk: SerializedSdkSession[] = [];

  for (const session of sessions.values()) {
    if (session.mode === 'pty') {
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
    } else if (session.mode === 'sdk') {
      serializedSdk.push(serializeSdkSession(session));
    }
  }

  const pending: PendingSessionsFile = {
    version: 1,
    timestamp: new Date().toISOString(),
    sessions: serializedPty,
    sdkSessions: serializedSdk.length > 0 ? serializedSdk : undefined,
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
        args = ['attach-session', '-t', s.tmuxSessionName];
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

  // Restore SDK sessions (as disconnected — they can't resume a live process)
  if (pending.sdkSessions) {
    for (const sdkData of pending.sdkSessions) {
      try {
        restoreSdkSession(sdkData, sessions);
        restored++;
      } catch {
        console.error(`Failed to restore SDK session ${sdkData.id} (${sdkData.displayName})`);
      }
    }
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
    if (session.mode === 'pty' && session.tmuxSessionName) names.add(session.tmuxSessionName);
  }
  return names;
}

// SDK idle sweep: check every 60s, terminate SDK sessions idle > 30min, max 5 idle
let sdkIdleSweepTimer: ReturnType<typeof setInterval> | null = null;

function startSdkIdleSweep(): void {
  if (sdkIdleSweepTimer) return;
  sdkIdleSweepTimer = setInterval(() => {
    const now = Date.now();
    const sdkSessions: SdkSession[] = [];

    for (const session of sessions.values()) {
      if (session.mode === 'sdk') {
        sdkSessions.push(session);
      }
    }

    // Terminate sessions idle > 30 minutes
    for (const session of sdkSessions) {
      const lastActivity = new Date(session.lastActivity).getTime();
      if (session.idle && (now - lastActivity) > SDK_MAX_IDLE_MS) {
        console.log(`SDK idle sweep: terminating session ${session.id} (${session.displayName}) — idle for ${Math.round((now - lastActivity) / 60000)}min`);
        try { kill(session.id); } catch { /* already dead */ }
      }
    }

    // LRU eviction: if more than 5 idle SDK sessions remain, evict oldest
    const idleSdkSessions = Array.from(sessions.values())
      .filter((s): s is SdkSession => s.mode === 'sdk' && s.idle)
      .sort((a, b) => a.lastActivity.localeCompare(b.lastActivity));

    while (idleSdkSessions.length > SDK_MAX_IDLE_SESSIONS) {
      const oldest = idleSdkSessions.shift()!;
      console.log(`SDK idle sweep: evicting session ${oldest.id} (${oldest.displayName}) — LRU`);
      try { kill(oldest.id); } catch { /* already dead */ }
    }
  }, SDK_IDLE_CHECK_INTERVAL_MS);
}

function stopSdkIdleSweep(): void {
  if (sdkIdleSweepTimer) {
    clearInterval(sdkIdleSweepTimer);
    sdkIdleSweepTimer = null;
  }
}

// Re-export pty-handler utilities for backward compatibility
export { generateTmuxSessionName, resolveTmuxSpawn } from './pty-handler.js';

export { create, get, list, kill, killAllTmuxSessions, resize, updateDisplayName, write, handlePermission, onIdleChange, offIdleChange, findRepoSession, nextTerminalName, serializeAll, restoreFromDisk, activeTmuxSessionNames, startSdkIdleSweep, stopSdkIdleSweep, AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS };
