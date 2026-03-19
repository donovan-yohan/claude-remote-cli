import pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentType, PtySession, SessionStatus, SessionSummary, SessionType } from './types.js';
import { AGENT_COMMANDS, AGENT_CONTINUE_ARGS } from './types.js';
import { readMeta, writeMeta } from './config.js';

const IDLE_TIMEOUT_MS = 5000;
const MAX_SCROLLBACK = 256 * 1024; // 256KB max

export function generateTmuxSessionName(displayName: string, id: string): string {
  const sanitized = displayName.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30);
  return `crc-${sanitized}-${id.slice(0, 8)}`;
}

export function resolveTmuxSpawn(
  command: string,
  args: string[],
  tmuxSessionName: string,
): { command: string; args: string[] } {
  return {
    command: 'tmux',
    args: [
      '-u', 'new-session', '-s', tmuxSessionName, '--', command, ...args,
      ';', 'set', 'set-clipboard', 'on',
      ';', 'set', 'allow-passthrough', 'on',
      ';', 'set', 'mode-keys', 'vi',
    ],
  };
}

export type CreatePtyParams = {
  id: string;
  type?: SessionType | undefined;
  agent?: AgentType | undefined;
  repoName?: string | undefined;
  repoPath: string;
  cwd?: string | undefined;
  root?: string | undefined;
  worktreeName?: string | undefined;
  branchName?: string | undefined;
  displayName?: string | undefined;
  command?: string | undefined;
  args?: string[] | undefined;
  cols?: number | undefined;
  rows?: number | undefined;
  configPath?: string | undefined;
  useTmux?: boolean | undefined;
  tmuxSessionName?: string | undefined;
  initialScrollback?: string[] | undefined;
  restored?: boolean | undefined;
};

export type CreatePtyResult = SessionSummary & { pid: number | undefined };

export function createPtySession(
  params: CreatePtyParams,
  sessionsMap: Map<string, import('./types.js').Session>,
  idleChangeCallbacks: Array<(sessionId: string, idle: boolean) => void>,
): { session: PtySession; result: CreatePtyResult } {
  const {
    id,
    type,
    agent = 'claude',
    repoName,
    repoPath,
    cwd,
    root,
    worktreeName,
    branchName,
    displayName,
    command,
    args = [],
    cols = 80,
    rows = 24,
    configPath,
    useTmux: paramUseTmux,
    tmuxSessionName: paramTmuxSessionName,
    initialScrollback,
    restored: paramRestored,
  } = params;

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

  const ptyProcess = pty.spawn(spawnCommand, spawnArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || repoPath,
    env,
  });

  // Scrollback buffer: stores all PTY output so we can replay on WebSocket (re)connect
  const scrollback: string[] = initialScrollback ? [...initialScrollback] : [];
  let scrollbackBytes = initialScrollback ? initialScrollback.reduce((sum, s) => sum + s.length, 0) : 0;

  const resolvedCwd = cwd || repoPath;
  const session: PtySession = {
    id,
    type: type || 'worktree',
    agent,
    mode: 'pty' as const,
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
  };
  sessionsMap.set(id, session);

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
          retryPty = pty.spawn(retryCommand, retrySpawnArgs, {
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
          sessionsMap.delete(id);
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
      sessionsMap.delete(id);
      const tmpDir = path.join(os.tmpdir(), 'claude-remote-cli', id);
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    });
  }

  attachHandlers(ptyProcess, continueArgs.some(a => args.includes(a)));

  const result: CreatePtyResult = {
    id,
    type: session.type,
    agent: session.agent,
    mode: 'pty' as const,
    root: session.root,
    repoName: session.repoName,
    repoPath,
    worktreeName: session.worktreeName,
    branchName: session.branchName,
    displayName: session.displayName,
    pid: ptyProcess.pid,
    createdAt,
    lastActivity: createdAt,
    idle: false,
    cwd: resolvedCwd,
    customCommand: command || null,
    useTmux,
    tmuxSessionName,
    status: 'active' as SessionStatus,
    needsBranchRename: false,
  };

  return { session, result };
}
