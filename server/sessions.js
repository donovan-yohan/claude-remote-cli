'use strict';

const pty = require('node-pty');
const crypto = require('crypto');

// In-memory registry: id -> {id, root, repoName, repoPath, worktreeName, displayName, pty, createdAt}
const sessions = new Map();

function create({ repoName, repoPath, root, worktreeName, displayName, command, args = [], cols = 80, rows = 24 }) {
  const id = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();

  // Strip CLAUDECODE env var to allow spawning claude inside a claude-managed server
  const env = Object.assign({}, process.env);
  delete env.CLAUDECODE;

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: repoPath,
    env,
  });

  // Scrollback buffer: stores all PTY output so we can replay on WebSocket (re)connect
  const scrollback = [];
  let scrollbackBytes = 0;
  const MAX_SCROLLBACK = 256 * 1024; // 256KB max

  const session = {
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
      scrollbackBytes -= scrollback.shift().length;
    }
  });

  ptyProcess.onExit(() => {
    sessions.delete(id);
  });

  return { id, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, displayName: session.displayName, pid: ptyProcess.pid, createdAt };
}

function get(id) {
  return sessions.get(id);
}

function list() {
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

function updateDisplayName(id, displayName) {
  const session = sessions.get(id);
  if (!session) throw new Error('Session not found: ' + id);
  session.displayName = displayName;
  return { id, displayName };
}

function kill(id) {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.kill('SIGTERM');
  sessions.delete(id);
}

function resize(id, cols, rows) {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.resize(cols, rows);
}

module.exports = { create, get, list, kill, resize, updateDisplayName };
