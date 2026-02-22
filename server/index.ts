import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

import express from 'express';
import cookieParser from 'cookie-parser';

import { loadConfig, saveConfig, DEFAULTS } from './config.js';
import * as auth from './auth.js';
import * as sessions from './sessions.js';
import { setupWebSocket } from './ws.js';
import { WorktreeWatcher } from './watcher.js';
import type { Config } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When run via CLI bin, config lives in ~/.config/claude-remote-cli/
// When run directly (development), fall back to local config.json
const CONFIG_PATH = process.env.CLAUDE_REMOTE_CONFIG || path.join(__dirname, '..', 'config.json');

type RepoEntry = { name: string; path: string; root: string };

function parseTTL(ttl: string): number {
  if (typeof ttl !== 'string') return 24 * 60 * 60 * 1000;
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1]!, 10);
  switch (match[2]!) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default:  return 24 * 60 * 60 * 1000;
  }
}

function promptPin(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function scanReposInRoot(rootDir: string): RepoEntry[] {
  const repos: RepoEntry[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (_) {
    return repos;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (fs.existsSync(path.join(fullPath, '.git'))) {
      repos.push({ name: entry.name, path: fullPath, root: rootDir });
    }
  }
  return repos;
}

function scanAllRepos(rootDirs: string[]): RepoEntry[] {
  const repos: RepoEntry[] = [];
  for (const rootDir of rootDirs) {
    repos.push(...scanReposInRoot(rootDir));
  }
  return repos;
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(CONFIG_PATH);
  } catch (_) {
    config = { ...DEFAULTS } as Config;
    saveConfig(CONFIG_PATH, config);
  }

  // CLI flag overrides
  if (process.env.CLAUDE_REMOTE_PORT) config.port = parseInt(process.env.CLAUDE_REMOTE_PORT, 10);
  if (process.env.CLAUDE_REMOTE_HOST) config.host = process.env.CLAUDE_REMOTE_HOST;

  if (!config.pinHash) {
    const pin = await promptPin('Set up a PIN for claude-remote-cli:');
    config.pinHash = await auth.hashPin(pin);
    saveConfig(CONFIG_PATH, config);
    console.log('PIN set successfully.');
  }

  const authenticatedTokens = new Set<string>();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const token = req.cookies && req.cookies.token;
    if (!token || !authenticatedTokens.has(token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  const watcher = new WorktreeWatcher();
  watcher.rebuild(config.rootDirs || []);

  const server = http.createServer(app);
  const { broadcastEvent } = setupWebSocket(server, authenticatedTokens, watcher);

  // POST /auth
  app.post('/auth', async (req, res) => {
    const ip = (req.ip || req.connection.remoteAddress) as string;
    if (auth.isRateLimited(ip)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    const { pin } = req.body as { pin?: string };
    if (!pin) {
      res.status(400).json({ error: 'PIN required' });
      return;
    }

    const valid = await auth.verifyPin(pin, config.pinHash as string);
    if (!valid) {
      auth.recordFailedAttempt(ip);
      res.status(401).json({ error: 'Invalid PIN' });
      return;
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

    res.json({ ok: true });
  });

  // GET /sessions
  app.get('/sessions', requireAuth, (_req, res) => {
    res.json(sessions.list());
  });

  // GET /repos — scan root dirs for repos
  app.get('/repos', requireAuth, (_req, res) => {
    const repos = scanAllRepos(config.rootDirs || []);
    // Also include legacy manually-added repos
    if (config.repos) {
      for (const repo of config.repos as unknown as RepoEntry[]) {
        if (!repos.some((r) => r.path === repo.path)) {
          repos.push(repo);
        }
      }
    }
    res.json(repos);
  });

  // GET /worktrees?repo=<path> — list worktrees; omit repo to scan all repos in all rootDirs
  app.get('/worktrees', requireAuth, (req, res) => {
    const repoParam = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const roots = config.rootDirs || [];
    const worktrees: Array<{ name: string; path: string; repoName: string; repoPath: string; root: string }> = [];

    let reposToScan: RepoEntry[];
    if (repoParam) {
      const root = roots.find(function (r) { return repoParam.startsWith(r); }) || '';
      reposToScan = [{ path: repoParam, name: repoParam.split('/').filter(Boolean).pop() || '', root }];
    } else {
      reposToScan = scanAllRepos(roots);
    }

    for (const repo of reposToScan) {
      const worktreeDir = path.join(repo.path, '.claude', 'worktrees');
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
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
    }

    res.json(worktrees);
  });

  // GET /roots — list root directories
  app.get('/roots', requireAuth, (_req, res) => {
    res.json(config.rootDirs || []);
  });

  // POST /roots — add a root directory
  app.post('/roots', requireAuth, (req, res) => {
    const { path: rootPath } = req.body as { path?: string };
    if (!rootPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    if (!config.rootDirs) config.rootDirs = [];
    if (config.rootDirs.includes(rootPath)) {
      res.status(409).json({ error: 'Root already exists' });
      return;
    }
    config.rootDirs.push(rootPath);
    saveConfig(CONFIG_PATH, config);
    watcher.rebuild(config.rootDirs);
    broadcastEvent('worktrees-changed');
    res.status(201).json(config.rootDirs);
  });

  // DELETE /roots — remove a root directory
  app.delete('/roots', requireAuth, (req, res) => {
    const { path: rootPath } = req.body as { path?: string };
    if (!rootPath || !config.rootDirs) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    config.rootDirs = config.rootDirs.filter((r) => r !== rootPath);
    saveConfig(CONFIG_PATH, config);
    watcher.rebuild(config.rootDirs);
    broadcastEvent('worktrees-changed');
    res.json(config.rootDirs);
  });

  // POST /sessions
  app.post('/sessions', requireAuth, (req, res) => {
    const { repoPath, repoName, worktreePath, claudeArgs } = req.body as {
      repoPath?: string;
      repoName?: string;
      worktreePath?: string;
      claudeArgs?: string[];
    };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
    const baseArgs = claudeArgs || config.claudeArgs || [];

    // Compute root by matching repoPath against configured rootDirs
    const roots = config.rootDirs || [];
    const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

    let args: string[];
    let cwd: string;
    let worktreeName: string;

    if (worktreePath) {
      // Resume existing worktree — run claude inside the worktree directory
      args = [...baseArgs];
      cwd = worktreePath;
      worktreeName = worktreePath.split('/').pop() || '';
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
    res.status(201).json(session);
  });

  // DELETE /sessions/:id
  app.delete('/sessions/:id', requireAuth, (req, res) => {
    try {
      sessions.kill(req.params['id'] as string);
      res.json({ ok: true });
    } catch (_) {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // PATCH /sessions/:id — update displayName and send /rename through PTY
  app.patch('/sessions/:id', requireAuth, (req, res) => {
    const { displayName } = req.body as { displayName?: string };
    if (!displayName) {
      res.status(400).json({ error: 'displayName is required' });
      return;
    }
    try {
      const id = req.params['id'] as string;
      const updated = sessions.updateDisplayName(id, displayName);
      const session = sessions.get(id);
      if (session && session.pty) {
        session.pty.write('/rename "' + displayName.replace(/"/g, '\\"') + '"\r');
      }
      res.json(updated);
    } catch (_) {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`claude-remote-cli listening on ${config.host}:${config.port}`);
  });
}

main().catch(console.error);
