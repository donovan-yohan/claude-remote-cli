import pty from 'node-pty';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session, SessionType } from './types.js';
import { readMeta, writeMeta } from './config.js';

type SessionSummary = Omit<Session, 'pty' | 'scrollback'>;

type CreateParams = {
  type?: SessionType;
  repoName?: string;
  repoPath: string;
  cwd?: string;
  root?: string;
  worktreeName?: string;
  branchName?: string;
  displayName?: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  configPath?: string;
};

type CreateResult = SessionSummary & { pid: number | undefined };

// In-memory registry: id -> Session
const sessions = new Map<string, Session>();

const IDLE_TIMEOUT_MS = 5000;
type IdleChangeCallback = (sessionId: string, idle: boolean) => void;
let idleChangeCallback: IdleChangeCallback | null = null;

function onIdleChange(cb: IdleChangeCallback): void {
  idleChangeCallback = cb;
}

function create({ type, repoName, repoPath, cwd, root, worktreeName, branchName, displayName, command, args = [], cols = 80, rows = 24, configPath }: CreateParams): CreateResult {
  const id = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();

  // Strip CLAUDECODE env var to allow spawning claude inside a claude-managed server
  const env = Object.assign({}, process.env) as Record<string, string>;
  delete env.CLAUDECODE;

  const ptyProcess = pty.spawn(command, args, {
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
      // If --continue failed quickly, retry without it
      if (canRetry && (Date.now() - spawnTime) < 3000 && exitCode !== 0) {
        const retryArgs = args.filter(a => a !== '--continue');
        scrollback.length = 0;
        scrollbackBytes = 0;
        const retryPty = pty.spawn(command, retryArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: cwd || repoPath,
          env,
        });
        session.pty = retryPty;
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

  attachHandlers(ptyProcess, args.includes('--continue'));

  return { id, type: session.type, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, branchName: session.branchName, displayName: session.displayName, pid: ptyProcess.pid, createdAt, lastActivity: createdAt, idle: false };
}

function get(id: string): Session | undefined {
  return sessions.get(id);
}

function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, type, root, repoName, repoPath, worktreeName, branchName, displayName, createdAt, lastActivity, idle }) => ({
      id,
      type,
      root,
      repoName,
      repoPath,
      worktreeName,
      branchName,
      displayName,
      createdAt,
      lastActivity,
      idle,
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
  sessions.delete(id);
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

export { create, get, list, kill, resize, updateDisplayName, write, onIdleChange, findRepoSession };
