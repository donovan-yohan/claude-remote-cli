import pty from 'node-pty';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentType, Session, SessionStatus, SessionType } from './types.js';
import { readMeta, writeMeta } from './config.js';

const execFileAsync = promisify(execFile);

type SessionSummary = Omit<Session, 'pty' | 'scrollback' | 'onPtyReplacedCallbacks' | 'restored'>;

const AGENT_COMMANDS: Record<AgentType, string> = {
  claude: 'claude',
  codex: 'codex',
};

const AGENT_CONTINUE_ARGS: Record<AgentType, string[]> = {
  claude: ['--continue'],
  codex: ['resume', '--last'],
};

const AGENT_YOLO_ARGS: Record<AgentType, string[]> = {
  claude: ['--dangerously-skip-permissions'],
  codex: ['--full-auto'],
};

interface SerializedSession {
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
  sessions: SerializedSession[];
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

function generateTmuxSessionName(displayName: string, id: string): string {
  const sanitized = displayName.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30);
  return `crc-${sanitized}-${id.slice(0, 8)}`;
}

function resolveTmuxSpawn(
  command: string,
  args: string[],
  tmuxSessionName: string,
): { command: string; args: string[] } {
  return {
    command: 'tmux',
    args: [
      '-u', 'new-session', '-s', tmuxSessionName, '--', command, ...args,
      // ';' tokens are tmux command separators — parsed at the top level before
      // dispatching to new-session, not passed as argv to `command`.
      ';', 'set', 'set-clipboard', 'on',
      ';', 'set', 'allow-passthrough', 'on',
      ';', 'set', 'mode-keys', 'vi',
    ],
  };
}

// In-memory registry: id -> Session
const sessions = new Map<string, Session>();

const IDLE_TIMEOUT_MS = 5000;
let terminalCounter = 0;
type IdleChangeCallback = (sessionId: string, idle: boolean) => void;
const idleChangeCallbacks: IdleChangeCallback[] = [];

function onIdleChange(cb: IdleChangeCallback): void {
  idleChangeCallbacks.push(cb);
}

function create({ id: providedId, type, agent = 'claude', repoName, repoPath, cwd, root, worktreeName, branchName, displayName, command, args = [], cols = 80, rows = 24, configPath, useTmux: paramUseTmux, tmuxSessionName: paramTmuxSessionName, initialScrollback, restored: paramRestored, needsBranchRename: paramNeedsBranchRename, branchRenamePrompt: paramBranchRenamePrompt }: CreateParams): CreateResult {
  const id = providedId || crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();
  const resolvedCommand = command || AGENT_COMMANDS[agent];

  // Strip CLAUDECODE env var to allow spawning claude inside a claude-managed server
  const env = Object.assign({}, process.env) as Record<string, string>;
  delete env.CLAUDECODE;

  const useTmux = !command && !!paramUseTmux;
  let spawnCommand = resolvedCommand;
  let spawnArgs = args;
  const tmuxSessionName = paramTmuxSessionName || (useTmux ? generateTmuxSessionName(displayName || repoName || 'session', id) : '');

  if (useTmux) {
    const tmux = resolveTmuxSpawn(resolvedCommand, args, tmuxSessionName);
    spawnCommand = tmux.command;
    spawnArgs = tmux.args;
  }

  // Wrap the spawn command to trap SIGPIPE in the child shell.
  // Without this, piped bash commands (e.g. `cmd | grep | tail`) run by
  // Claude Code inside the PTY can generate SIGPIPE when the reading end
  // of the pipe closes, which propagates up and kills the PTY session.
  // Wrapping with `trap '' PIPE; exec ...` makes the shell ignore SIGPIPE
  // before exec'ing the agent, so the agent inherits SIG_IGN for PIPE.
  const wrappedCommand = '/bin/bash';
  const wrappedArgs = ['-c', `trap '' PIPE; exec ${spawnCommand} ${spawnArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`];

  const ptyProcess = pty.spawn(wrappedCommand, wrappedArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || repoPath,
    env,
  });

  // Scrollback buffer: stores all PTY output so we can replay on WebSocket (re)connect
  const scrollback: string[] = initialScrollback ? [...initialScrollback] : [];
  let scrollbackBytes = initialScrollback ? initialScrollback.reduce((sum, s) => sum + s.length, 0) : 0;
  const MAX_SCROLLBACK = 256 * 1024; // 256KB max

  const resolvedCwd = cwd || repoPath;
  const session: Session = {
    id,
    type: type || 'worktree',
    agent,
    root: root || '',
    repoName: repoName || '',
    repoPath,
    worktreeName: worktreeName || '',
    branchName: branchName || worktreeName || '',
    displayName: displayName || worktreeName || repoName || '',
    pty: ptyProcess,
    createdAt,
    lastActivity: createdAt,
    scrollback,
    idle: false,
    cwd: resolvedCwd,
    customCommand: command || null,
    useTmux,
    tmuxSessionName,
    onPtyReplacedCallbacks: [],
    status: 'active' as SessionStatus,
    restored: paramRestored || false,
    needsBranchRename: paramNeedsBranchRename || false,
    branchRenamePrompt: paramBranchRenamePrompt || '',
  };
  sessions.set(id, session);

  // Load existing metadata to preserve a previously-set displayName
  if (configPath && worktreeName) {
    const existing = readMeta(configPath, repoPath);
    if (existing && existing.displayName) {
      session.displayName = existing.displayName;
    }
    writeMeta(configPath, { worktreePath: repoPath, displayName: session.displayName, lastActivity: createdAt });
  }

  let metaFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function resetIdleTimer(): void {
    if (session.idle) {
      session.idle = false;
      for (const cb of idleChangeCallbacks) cb(session.id, false);
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!session.idle) {
        session.idle = true;
        for (const cb of idleChangeCallbacks) cb(session.id, true);
      }
    }, IDLE_TIMEOUT_MS);
  }

  const continueArgs = AGENT_CONTINUE_ARGS[agent];

  function attachHandlers(proc: pty.IPty, canRetry: boolean): void {
    const spawnTime = Date.now();
    // Clear restored flag after 3s of running — means the PTY is healthy
    const restoredClearTimer = session.restored ? setTimeout(() => { session.restored = false; }, 3000) : null;

    proc.onData((data) => {
      session.lastActivity = new Date().toISOString();
      resetIdleTimer();
      scrollback.push(data);
      scrollbackBytes += data.length;
      // Trim oldest entries if over limit
      while (scrollbackBytes > MAX_SCROLLBACK && scrollback.length > 1) {
        scrollbackBytes -= (scrollback.shift() as string).length;
      }
      if (configPath && worktreeName && !metaFlushTimer) {
        metaFlushTimer = setTimeout(() => {
          metaFlushTimer = null;
          writeMeta(configPath, { worktreePath: repoPath, displayName: session.displayName, lastActivity: session.lastActivity });
        }, 5000);
      }
    });

    proc.onExit(() => {
      // If continue args failed quickly, retry without them.
      // Exit code is intentionally not checked: tmux wrapping exits 0 even
      // when the inner command (e.g. claude --continue) fails, because the
      // tmux client doesn't propagate inner exit codes. The 3-second window
      // is the primary heuristic — no user quits a session that fast.
      if (canRetry && (Date.now() - spawnTime) < 3000) {
        const retryArgs = args.filter(a => !continueArgs.includes(a));
        const retryNotice = '\r\n[claude-remote-cli] --continue not available; starting new session...\r\n';
        scrollback.length = 0;
        scrollbackBytes = 0;
        scrollback.push(retryNotice);
        scrollbackBytes = retryNotice.length;
        let retryCommand = resolvedCommand;
        let retrySpawnArgs = retryArgs;
        if (useTmux && tmuxSessionName) {
          const retryTmuxName = tmuxSessionName + '-retry';
          session.tmuxSessionName = retryTmuxName;
          const tmux = resolveTmuxSpawn(resolvedCommand, retryArgs, retryTmuxName);
          retryCommand = tmux.command;
          retrySpawnArgs = tmux.args;
        }
        let retryPty: pty.IPty;
        try {
          // Wrap retry spawn with SIGPIPE trap (same as initial spawn)
          const retryWrapped = ['-c', `trap '' PIPE; exec ${retryCommand} ${retrySpawnArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`];
          retryPty = pty.spawn('/bin/bash', retryWrapped, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: cwd || repoPath,
            env,
          });
        } catch {
          // Retry spawn failed — fall through to normal exit cleanup
          if (restoredClearTimer) clearTimeout(restoredClearTimer);
          if (idleTimer) clearTimeout(idleTimer);
          if (metaFlushTimer) clearTimeout(metaFlushTimer);
          sessions.delete(id);
          return;
        }
        session.pty = retryPty;
        for (const cb of session.onPtyReplacedCallbacks) cb(retryPty);
        attachHandlers(retryPty, false);
        return;
      }

      if (restoredClearTimer) clearTimeout(restoredClearTimer);

      // If PTY exited and this is a restored session, mark disconnected rather than delete
      if (session.restored) {
        session.status = 'disconnected';
        session.restored = false; // clear so user-initiated kills can delete normally
        if (idleTimer) clearTimeout(idleTimer);
        if (metaFlushTimer) clearTimeout(metaFlushTimer);
        return;
      }

      if (idleTimer) clearTimeout(idleTimer);
      if (metaFlushTimer) clearTimeout(metaFlushTimer);
      if (configPath && worktreeName) {
        writeMeta(configPath, { worktreePath: repoPath, displayName: session.displayName, lastActivity: session.lastActivity });
      }
      sessions.delete(id);
      const tmpDir = path.join(os.tmpdir(), 'claude-remote-cli', id);
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    });
  }

  attachHandlers(ptyProcess, continueArgs.some(a => args.includes(a)));

  return { id, type: session.type, agent: session.agent, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, branchName: session.branchName, displayName: session.displayName, pid: ptyProcess.pid, createdAt, lastActivity: createdAt, idle: false, cwd: resolvedCwd, customCommand: command || null, useTmux, tmuxSessionName, status: 'active' as SessionStatus };
}

function get(id: string): Session | undefined {
  return sessions.get(id);
}

function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, type, agent, root, repoName, repoPath, worktreeName, branchName, displayName, createdAt, lastActivity, idle, cwd, customCommand, useTmux, tmuxSessionName, status }) => ({
      id,
      type,
      agent,
      root,
      repoName,
      repoPath,
      worktreeName,
      branchName,
      displayName,
      createdAt,
      lastActivity,
      idle,
      cwd,
      customCommand,
      useTmux,
      tmuxSessionName,
      status,
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

  const serialized: SerializedSession[] = [];
  for (const session of sessions.values()) {
    // Write scrollback to disk
    const scrollbackPath = path.join(scrollbackDirPath, session.id + '.buf');
    fs.writeFileSync(scrollbackPath, session.scrollback.join(''), 'utf-8');

    serialized.push({
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
    sessions: serialized,
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

export { create, get, list, kill, killAllTmuxSessions, resize, updateDisplayName, write, onIdleChange, findRepoSession, nextTerminalName, serializeAll, restoreFromDisk, activeTmuxSessionNames, AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS, resolveTmuxSpawn, generateTmuxSessionName };
