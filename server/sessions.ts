import pty from 'node-pty';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { AgentType, Session, SessionType } from './types.js';
import { readMeta, writeMeta } from './config.js';

type SessionSummary = Omit<Session, 'pty' | 'scrollback' | 'onPtyReplacedCallbacks'>;

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

type CreateParams = {
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
    ],
  };
}

// In-memory registry: id -> Session
const sessions = new Map<string, Session>();

const IDLE_TIMEOUT_MS = 5000;
let terminalCounter = 0;
type IdleChangeCallback = (sessionId: string, idle: boolean) => void;
let idleChangeCallback: IdleChangeCallback | null = null;

function onIdleChange(cb: IdleChangeCallback): void {
  idleChangeCallback = cb;
}

function create({ type, agent = 'claude', repoName, repoPath, cwd, root, worktreeName, branchName, displayName, command, args = [], cols = 80, rows = 24, configPath, useTmux: paramUseTmux }: CreateParams): CreateResult {
  const id = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();
  const resolvedCommand = command || AGENT_COMMANDS[agent];

  // Strip CLAUDECODE env var to allow spawning claude inside a claude-managed server
  const env = Object.assign({}, process.env) as Record<string, string>;
  delete env.CLAUDECODE;

  const useTmux = !command && !!paramUseTmux;
  let spawnCommand = resolvedCommand;
  let spawnArgs = args;
  const tmuxSessionName = useTmux ? generateTmuxSessionName(displayName || repoName || 'session', id) : '';

  if (useTmux) {
    const tmux = resolveTmuxSpawn(resolvedCommand, args, tmuxSessionName);
    spawnCommand = tmux.command;
    spawnArgs = tmux.args;
  }

  const ptyProcess = pty.spawn(spawnCommand, spawnArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || repoPath,
    env,
  });

  // Scrollback buffer: stores all PTY output so we can replay on WebSocket (re)connect
  const scrollback: string[] = [];
  let scrollbackBytes = 0;
  const MAX_SCROLLBACK = 256 * 1024; // 256KB max

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
    useTmux,
    tmuxSessionName,
    onPtyReplacedCallbacks: [],
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
      if (idleChangeCallback) idleChangeCallback(session.id, false);
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!session.idle) {
        session.idle = true;
        if (idleChangeCallback) idleChangeCallback(session.id, true);
      }
    }, IDLE_TIMEOUT_MS);
  }

  const continueArgs = AGENT_CONTINUE_ARGS[agent];

  function attachHandlers(proc: pty.IPty, canRetry: boolean): void {
    const spawnTime = Date.now();

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

    proc.onExit(({ exitCode }) => {
      // If continue args failed quickly, retry without them
      if (canRetry && (Date.now() - spawnTime) < 3000 && exitCode !== 0) {
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
          retryPty = pty.spawn(retryCommand, retrySpawnArgs, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: cwd || repoPath,
            env,
          });
        } catch {
          // Retry spawn failed — fall through to normal exit cleanup
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

  return { id, type: session.type, agent: session.agent, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, branchName: session.branchName, displayName: session.displayName, pid: ptyProcess.pid, createdAt, lastActivity: createdAt, idle: false, useTmux, tmuxSessionName };
}

function get(id: string): Session | undefined {
  return sessions.get(id);
}

function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, type, agent, root, repoName, repoPath, worktreeName, branchName, displayName, createdAt, lastActivity, idle, useTmux, tmuxSessionName }) => ({
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
      useTmux,
      tmuxSessionName,
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
  session.pty.kill('SIGTERM');
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

export { create, get, list, kill, killAllTmuxSessions, resize, updateDisplayName, write, onIdleChange, findRepoSession, nextTerminalName, AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS, resolveTmuxSpawn, generateTmuxSessionName };
