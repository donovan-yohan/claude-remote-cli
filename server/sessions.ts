import pty from 'node-pty';
import crypto from 'node:crypto';
import type { Session } from './types.js';

type SessionSummary = Omit<Session, 'pty' | 'scrollback'>;

type CreateParams = {
  repoName?: string;
  repoPath: string;
  root?: string;
  worktreeName?: string;
  displayName?: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
};

type CreateResult = SessionSummary & { pid: number | undefined };

// In-memory registry: id -> Session
const sessions = new Map<string, Session>();

function create({ repoName, repoPath, root, worktreeName, displayName, command, args = [], cols = 80, rows = 24 }: CreateParams): CreateResult {
  const id = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();

  // Strip CLAUDECODE env var to allow spawning claude inside a claude-managed server
  const env = Object.assign({}, process.env) as Record<string, string>;
  delete env.CLAUDECODE;

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: repoPath,
    env,
  });

  // Scrollback buffer: stores all PTY output so we can replay on WebSocket (re)connect
  const scrollback: string[] = [];
  let scrollbackBytes = 0;
  const MAX_SCROLLBACK = 256 * 1024; // 256KB max

  const session: Session = {
    id,
    root: root || '',
    repoName: repoName || '',
    repoPath,
    worktreeName: worktreeName || '',
    displayName: displayName || worktreeName || repoName || '',
    pty: ptyProcess,
    createdAt,
    lastActivity: createdAt,
    scrollback,
  };
  sessions.set(id, session);

  ptyProcess.onData((data) => {
    session.lastActivity = new Date().toISOString();
    scrollback.push(data);
    scrollbackBytes += data.length;
    // Trim oldest entries if over limit
    while (scrollbackBytes > MAX_SCROLLBACK && scrollback.length > 1) {
      scrollbackBytes -= (scrollback.shift() as string).length;
    }
  });

  ptyProcess.onExit(() => {
    sessions.delete(id);
  });

  return { id, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, displayName: session.displayName, pid: ptyProcess.pid, createdAt, lastActivity: createdAt };
}

function get(id: string): Session | undefined {
  return sessions.get(id);
}

function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity }) => ({
      id,
      root,
      repoName,
      repoPath,
      worktreeName,
      displayName,
      createdAt,
      lastActivity,
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

export { create, get, list, kill, resize, updateDisplayName };
