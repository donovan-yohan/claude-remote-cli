'use strict';

const pty = require('node-pty');
const crypto = require('crypto');

// In-memory registry: id -> {id, repoName, repoPath, pty, createdAt}
const sessions = new Map();

function create({ repoName, repoPath, command, args = [], cols = 80, rows = 24 }) {
  const id = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: repoPath,
    env: process.env,
  });

  const session = { id, repoName, repoPath, pty: ptyProcess, createdAt };
  sessions.set(id, session);

  ptyProcess.onExit(() => {
    sessions.delete(id);
  });

  return { id, repoName, repoPath, pid: ptyProcess.pid, createdAt };
}

function get(id) {
  return sessions.get(id);
}

function list() {
  return Array.from(sessions.values()).map(({ id, repoName, repoPath, createdAt }) => ({
    id,
    repoName,
    repoPath,
    createdAt,
  }));
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

module.exports = { create, get, list, kill, resize };
