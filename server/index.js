'use strict';

const http = require('http');
const path = require('path');
const readline = require('readline');

const express = require('express');
const cookieParser = require('cookie-parser');

const { loadConfig, saveConfig, DEFAULTS } = require('./config');
const auth = require('./auth');
const sessions = require('./sessions');
const { setupWebSocket } = require('./ws');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function parseTTL(ttl) {
  if (typeof ttl !== 'string') return 24 * 60 * 60 * 1000;
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default:  return 24 * 60 * 60 * 1000;
  }
}

function promptPin(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  let config;
  try {
    config = loadConfig(CONFIG_PATH);
  } catch (_) {
    config = { ...DEFAULTS };
    saveConfig(CONFIG_PATH, config);
  }

  if (!config.pinHash) {
    const pin = await promptPin('Set up a PIN for claude-remote-cli:');
    config.pinHash = await auth.hashPin(pin);
    saveConfig(CONFIG_PATH, config);
    console.log('PIN set successfully.');
  }

  const authenticatedTokens = new Set();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  function requireAuth(req, res, next) {
    const token = req.cookies && req.cookies.token;
    if (!token || !authenticatedTokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // POST /auth
  app.post('/auth', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (auth.isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }

    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'PIN required' });
    }

    const valid = await auth.verifyPin(pin, config.pinHash);
    if (!valid) {
      auth.recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    auth.clearRateLimit(ip);
    const token = auth.generateCookieToken();
    authenticatedTokens.add(token);

    const ttlMs = parseTTL(config.cookieTTL);
    setTimeout(() => authenticatedTokens.delete(token), ttlMs);

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: ttlMs,
    });

    return res.json({ ok: true });
  });

  // GET /sessions
  app.get('/sessions', requireAuth, (req, res) => {
    res.json(sessions.list());
  });

  // GET /repos — scan root dirs for repos
  app.get('/repos', requireAuth, (req, res) => {
    const fs = require('fs');
    const roots = config.rootDirs || [];
    const repos = [];
    for (const rootDir of roots) {
      try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const fullPath = path.join(rootDir, entry.name);
          const hasGit = fs.existsSync(path.join(fullPath, '.git'));
          if (hasGit) {
            repos.push({ name: entry.name, path: fullPath, root: rootDir });
          }
        }
      } catch (_) {
        // skip unreadable dirs
      }
    }
    // Also include legacy manually-added repos
    if (config.repos) {
      for (const repo of config.repos) {
        if (!repos.some((r) => r.path === repo.path)) {
          repos.push(repo);
        }
      }
    }
    res.json(repos);
  });

  // GET /worktrees?repo=<path> — list worktrees; omit repo to scan all repos in all rootDirs
  app.get('/worktrees', requireAuth, (req, res) => {
    const fs = require('fs');
    const repoParam = req.query.repo;
    const roots = config.rootDirs || [];
    const worktrees = [];

    // Build list of repos to scan
    const reposToScan = [];
    if (repoParam) {
      // Single repo mode (used by new session dialog)
      const root = roots.find(function (r) { return repoParam.startsWith(r); }) || '';
      reposToScan.push({ path: repoParam, name: repoParam.split('/').filter(Boolean).pop(), root });
    } else {
      // Scan all repos in all roots
      for (const rootDir of roots) {
        try {
          const entries = fs.readdirSync(rootDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const fullPath = path.join(rootDir, entry.name);
            if (fs.existsSync(path.join(fullPath, '.git'))) {
              reposToScan.push({ path: fullPath, name: entry.name, root: rootDir });
            }
          }
        } catch (_) {
          // skip unreadable dirs
        }
      }
    }

    for (const repo of reposToScan) {
      const worktreeDir = path.join(repo.path, '.claude', 'worktrees');
      try {
        const entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          worktrees.push({
            name: entry.name,
            path: path.join(worktreeDir, entry.name),
            repoName: repo.name,
            repoPath: repo.path,
            root: repo.root,
          });
        }
      } catch (_) {
        // no worktrees dir — that's fine
      }
    }

    res.json(worktrees);
  });

  // GET /roots — list root directories
  app.get('/roots', requireAuth, (req, res) => {
    res.json(config.rootDirs || []);
  });

  // POST /roots — add a root directory
  app.post('/roots', requireAuth, (req, res) => {
    const { path: rootPath } = req.body;
    if (!rootPath) {
      return res.status(400).json({ error: 'path is required' });
    }
    if (!config.rootDirs) config.rootDirs = [];
    if (config.rootDirs.includes(rootPath)) {
      return res.status(409).json({ error: 'Root already exists' });
    }
    config.rootDirs.push(rootPath);
    saveConfig(CONFIG_PATH, config);
    res.status(201).json(config.rootDirs);
  });

  // DELETE /roots — remove a root directory
  app.delete('/roots', requireAuth, (req, res) => {
    const { path: rootPath } = req.body;
    if (!rootPath || !config.rootDirs) {
      return res.status(400).json({ error: 'path is required' });
    }
    config.rootDirs = config.rootDirs.filter((r) => r !== rootPath);
    saveConfig(CONFIG_PATH, config);
    res.json(config.rootDirs);
  });

  // POST /sessions
  app.post('/sessions', requireAuth, (req, res) => {
    const { repoPath, repoName, worktreePath, claudeArgs } = req.body;
    if (!repoPath) {
      return res.status(400).json({ error: 'repoPath is required' });
    }

    const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
    const baseArgs = claudeArgs || config.claudeArgs || [];

    // Compute root by matching repoPath against configured rootDirs
    const roots = config.rootDirs || [];
    const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

    let args, cwd, worktreeName;

    if (worktreePath) {
      // Resume existing worktree — run claude inside the worktree directory
      args = [...baseArgs];
      cwd = worktreePath;
      worktreeName = worktreePath.split('/').pop();
    } else {
      // New worktree
      worktreeName = 'mobile-' + name + '-' + Date.now().toString(36);
      args = ['--worktree', worktreeName, ...baseArgs];
      cwd = repoPath;
    }

    const session = sessions.create({
      repoName: name,
      repoPath: cwd,
      root,
      worktreeName,
      displayName: worktreeName,
      command: config.claudeCommand,
      args,
    });
    return res.status(201).json(session);
  });

  // DELETE /sessions/:id
  app.delete('/sessions/:id', requireAuth, (req, res) => {
    try {
      sessions.kill(req.params.id);
      res.json({ ok: true });
    } catch (_) {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // PATCH /sessions/:id — update displayName and send /rename through PTY
  app.patch('/sessions/:id', requireAuth, (req, res) => {
    const { displayName } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });
    try {
      const updated = sessions.updateDisplayName(req.params.id, displayName);
      const session = sessions.get(req.params.id);
      if (session && session.pty) {
        session.pty.write('/rename "' + displayName.replace(/"/g, '\\"') + '"\r');
      }
      res.json(updated);
    } catch (_) {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  const server = http.createServer(app);
  setupWebSocket(server, authenticatedTokens);

  server.listen(config.port, config.host, () => {
    console.log(`claude-remote-cli listening on ${config.host}:${config.port}`);
  });
}

main().catch(console.error);
