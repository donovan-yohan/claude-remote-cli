import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import express from 'express';
import cookieParser from 'cookie-parser';

import { loadConfig, saveConfig, DEFAULTS, readMeta, writeMeta, deleteMeta, ensureMetaDir } from './config.js';
import * as auth from './auth.js';
import * as sessions from './sessions.js';
import { setupWebSocket } from './ws.js';
import { WorktreeWatcher, WORKTREE_DIRS, isValidWorktreePath, parseWorktreeListPorcelain, parseAllWorktrees } from './watcher.js';
import { isInstalled as serviceIsInstalled } from './service.js';
import { extensionForMime, setClipboardImage } from './clipboard.js';
import type { Config, PullRequest, PullRequestsResponse } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

// When run via CLI bin, config lives in ~/.config/claude-remote-cli/
// When run directly (development), fall back to local config.json
const CONFIG_PATH = process.env.CLAUDE_REMOTE_CONFIG || path.join(__dirname, '..', '..', 'config.json');

// Ensure worktree metadata directory exists alongside config
ensureMetaDir(CONFIG_PATH);

const VERSION_CACHE_TTL = 5 * 60 * 1000;
let versionCache: { latest: string; fetchedAt: number } | null = null;

function getCurrentVersion(): string {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

function semverLessThan(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPat < bPat;
}

async function getLatestVersion(): Promise<string | null> {
  const now = Date.now();
  if (versionCache && now - versionCache.fetchedAt < VERSION_CACHE_TTL) {
    return versionCache.latest;
  }
  try {
    const res = await fetch('https://registry.npmjs.org/claude-remote-cli/latest');
    if (!res.ok) return null;
    const data = await res.json() as { version?: string };
    if (!data.version) return null;
    versionCache = { latest: data.version, fetchedAt: now };
    return data.version;
  } catch (_) {
    return null;
  }
}

function execErrorMessage(err: unknown, fallback: string): string {
  const e = err as { stderr?: string; message?: string };
  return (e.stderr || e.message || fallback).trim();
}

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
    const dotGit = path.join(fullPath, '.git');
    try {
      // Only count directories with a .git *directory* as repos.
      // Worktrees and submodules have a .git *file* and should be skipped.
      if (fs.statSync(dotGit).isDirectory()) {
        repos.push({ name: entry.name, path: fullPath, root: rootDir });
      }
    } catch (_) {
      // .git doesn't exist — not a repo
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

function ensureGitignore(repoPath: string, entry: string): void {
  const gitignorePath = path.join(repoPath, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (content.split('\n').some((line) => line.trim() === entry)) return;
      const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(gitignorePath, prefix + entry + '\n');
    } else {
      fs.writeFileSync(gitignorePath, entry + '\n');
    }
  } catch (_) {
    // Non-fatal: gitignore update failure shouldn't block session creation
  }
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

  // Build frontend if missing (e.g. fresh clone in development)
  const frontendDir = path.join(__dirname, '..', 'frontend');
  if (!fs.existsSync(path.join(frontendDir, 'index.html'))) {
    const packageRoot = path.join(__dirname, '..', '..');
    const viteConfig = path.join(packageRoot, 'frontend', 'vite.config.ts');
    if (fs.existsSync(viteConfig)) {
      console.log('Frontend not built — building now...');
      try {
        await execFileAsync('npx', ['vite', 'build', '--config', 'frontend/vite.config.ts'], { cwd: packageRoot });
        console.log('Frontend build complete.');
      } catch (err) {
        console.error('Frontend build failed:', err instanceof Error ? err.message : err);
      }
    } else {
      console.warn('Frontend assets missing and source not available — UI will not be served.');
    }
  }

  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());
  app.use(express.static(frontendDir));

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

  // GET /branches?repo=<path> — list local and remote branches for a repo
  app.get('/branches', requireAuth, async (req, res) => {
    const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    if (!repoPath) {
      res.status(400).json({ error: 'repo query parameter is required' });
      return;
    }

    try {
      const { stdout } = await execFileAsync('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: repoPath });
      const branches = stdout
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b && !b.includes('HEAD'))
        .map((b) => b.replace(/^origin\//, ''));

      const unique = [...new Set(branches)];
      res.json(unique.sort());
    } catch (_) {
      res.json([]);
    }
  });

  // GET /git-status?repo=<path>&branch=<name>
  app.get('/git-status', requireAuth, async (req, res) => {
    const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const branch = typeof req.query.branch === 'string' ? req.query.branch : undefined;
    if (!repoPath || !branch) {
      res.status(400).json({ error: 'repo and branch query parameters are required' });
      return;
    }

    let prState: 'open' | 'merged' | 'closed' | null = null;
    let additions = 0;
    let deletions = 0;

    // Try gh CLI for PR status
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'view', branch,
        '--json', 'state,additions,deletions',
      ], { cwd: repoPath });
      const data = JSON.parse(stdout) as { state?: string; additions?: number; deletions?: number };
      if (data.state) prState = data.state.toLowerCase() as 'open' | 'merged' | 'closed';
      if (typeof data.additions === 'number') additions = data.additions;
      if (typeof data.deletions === 'number') deletions = data.deletions;
    } catch {
      // No PR or gh not available — fall back to git diff against default branch
      try {
        // Detect default branch (main, master, etc.)
        let baseBranch = 'main';
        try {
          const { stdout: headRef } = await execFileAsync('git', [
            'symbolic-ref', 'refs/remotes/origin/HEAD', '--short',
          ], { cwd: repoPath });
          baseBranch = headRef.trim().replace(/^origin\//, '');
        } catch { /* use main as fallback */ }
        const { stdout } = await execFileAsync('git', [
          'diff', '--shortstat', baseBranch + '...' + branch,
        ], { cwd: repoPath });
        const addMatch = stdout.match(/(\d+) insertion/);
        const delMatch = stdout.match(/(\d+) deletion/);
        if (addMatch) additions = parseInt(addMatch[1]!, 10);
        if (delMatch) deletions = parseInt(delMatch[1]!, 10);
      } catch { /* no diff data */ }
    }

    res.json({ prState, additions, deletions });
  });

  // GET /pull-requests?repo=<path>
  app.get('/pull-requests', requireAuth, async (req, res) => {
    const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    if (!repoPath) {
      res.status(400).json({ prs: [], error: 'repo query parameter is required' } satisfies PullRequestsResponse);
      return;
    }

    const fields = 'number,title,url,headRefName,state,author,updatedAt,additions,deletions,reviewDecision';

    // Get current GitHub user
    let currentUser = '';
    try {
      const { stdout: whoami } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], { cwd: repoPath });
      currentUser = whoami.trim();
    } catch {
      const response: PullRequestsResponse = { prs: [], error: 'gh_not_authenticated' };
      res.json(response);
      return;
    }

    // Fetch authored PRs
    const authored: PullRequest[] = [];
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list', '--author', currentUser, '--state', 'open', '--limit', '30',
        '--json', fields,
      ], { cwd: repoPath });
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      for (const pr of raw) {
        authored.push({
          number: pr.number as number,
          title: pr.title as string,
          url: pr.url as string,
          headRefName: pr.headRefName as string,
          state: pr.state as 'OPEN' | 'CLOSED' | 'MERGED',
          author: (pr.author as { login?: string })?.login ?? currentUser,
          role: 'author',
          updatedAt: pr.updatedAt as string,
          additions: (pr.additions as number) ?? 0,
          deletions: (pr.deletions as number) ?? 0,
          reviewDecision: (pr.reviewDecision as string) ?? null,
        });
      }
    } catch { /* no authored PRs or gh error */ }

    // Fetch review-requested PRs
    const reviewing: PullRequest[] = [];
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list', '--search', `review-requested:${currentUser}`, '--state', 'open', '--limit', '30',
        '--json', fields,
      ], { cwd: repoPath });
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      for (const pr of raw) {
        reviewing.push({
          number: pr.number as number,
          title: pr.title as string,
          url: pr.url as string,
          headRefName: pr.headRefName as string,
          state: pr.state as 'OPEN' | 'CLOSED' | 'MERGED',
          author: (pr.author as { login?: string })?.login ?? '',
          role: 'reviewer',
          updatedAt: pr.updatedAt as string,
          additions: (pr.additions as number) ?? 0,
          deletions: (pr.deletions as number) ?? 0,
          reviewDecision: (pr.reviewDecision as string) ?? null,
        });
      }
    } catch { /* no review-requested PRs or gh error */ }

    // Deduplicate: if a PR appears in both (user is author AND reviewer), keep as 'author'
    const seen = new Set(authored.map(pr => pr.number));
    const combined = [...authored, ...reviewing.filter(pr => !seen.has(pr.number))];

    // Sort by updatedAt descending
    combined.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const response: PullRequestsResponse = { prs: combined };
    res.json(response);
  });

  // GET /worktrees?repo=<path> — list worktrees; omit repo to scan all repos in all rootDirs
  app.get('/worktrees', requireAuth, async (req, res) => {
    const repoParam = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const roots = config.rootDirs || [];
    const worktrees: Array<{ name: string; path: string; repoName: string; repoPath: string; root: string; displayName: string; lastActivity: string; branchName: string }> = [];

    let reposToScan: RepoEntry[];
    if (repoParam) {
      const root = roots.find(function (r) { return repoParam.startsWith(r); }) || '';
      reposToScan = [{ path: repoParam, name: repoParam.split('/').filter(Boolean).pop() || '', root }];
    } else {
      reposToScan = scanAllRepos(roots);
    }

    for (const repo of reposToScan) {
      // Use git worktree list to discover all worktrees (including those at arbitrary paths)
      try {
        const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repo.path });
        const parsed = parseWorktreeListPorcelain(stdout, repo.path);
        for (const wt of parsed) {
          const dirName = wt.path.split('/').pop() || '';
          const meta = readMeta(CONFIG_PATH, wt.path);
          worktrees.push({
            name: dirName,
            path: wt.path,
            repoName: repo.name,
            repoPath: repo.path,
            root: repo.root,
            displayName: meta?.displayName || wt.branch || dirName,
            lastActivity: meta?.lastActivity || '',
            branchName: wt.branch || meta?.branchName || dirName,
          });
        }
      } catch {
        // git worktree list failed — fall back to directory scanning
        for (const dir of WORKTREE_DIRS) {
          const worktreeDir = path.join(repo.path, dir);
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
          } catch (_) {
            continue;
          }
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const wtPath = path.join(worktreeDir, entry.name);
            const meta = readMeta(CONFIG_PATH, wtPath);
            worktrees.push({
              name: entry.name,
              path: wtPath,
              repoName: repo.name,
              repoPath: repo.path,
              root: repo.root,
              displayName: meta?.displayName || '',
              lastActivity: meta?.lastActivity || '',
              branchName: meta?.branchName || entry.name,
            });
          }
        }
      }
    }

    // Deduplicate by path (a worktree can appear via multiple repo scans)
    const seen = new Set<string>();
    const unique = worktrees.filter(wt => {
      if (seen.has(wt.path)) return false;
      seen.add(wt.path);
      return true;
    });

    res.json(unique);
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

  // DELETE /worktrees — remove a worktree, prune, and delete its branch
  app.delete('/worktrees', requireAuth, async (req, res) => {
    const { worktreePath, repoPath } = req.body as { worktreePath?: string; repoPath?: string };
    if (!worktreePath || !repoPath) {
      res.status(400).json({ error: 'worktreePath and repoPath are required' });
      return;
    }

    if (!isValidWorktreePath(worktreePath)) {
      res.status(400).json({ error: 'Path is not inside a worktree directory' });
      return;
    }

    // Check no active session is using this worktree
    const activeSessions = sessions.list();
    const conflict = activeSessions.find(function (s) { return s.repoPath === worktreePath; });
    if (conflict) {
      res.status(409).json({ error: 'Close the active session first' });
      return;
    }

    // Derive branch name from metadata or worktree directory name
    const meta = readMeta(CONFIG_PATH, worktreePath);
    const branchName = (meta && meta.branchName) || worktreePath.split('/').pop() || '';

    try {
      // Will fail if uncommitted changes -- no --force
      await execFileAsync('git', ['worktree', 'remove', worktreePath], { cwd: repoPath });
    } catch (err: unknown) {
      // If git worktree remove fails, the directory may be an orphaned worktree
      // that git no longer tracks. Try to remove the directory directly.
      if (fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true });
        } catch (rmErr: unknown) {
          res.status(500).json({ error: execErrorMessage(rmErr, 'Failed to remove worktree directory') });
          return;
        }
      }
      // If directory doesn't exist, the worktree is already gone — continue to cleanup
    }

    try {
      // Prune stale worktree refs
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath });
    } catch (_) {
      // Non-fatal: prune failure doesn't block success
    }

    if (branchName) {
      try {
        // Delete the branch
        await execFileAsync('git', ['branch', '-D', branchName], { cwd: repoPath });
      } catch (_) {
        // Non-fatal: branch may not exist or may be checked out elsewhere
      }
    }

    // Clean up metadata file
    deleteMeta(CONFIG_PATH, worktreePath);

    res.json({ ok: true });
  });

  // POST /sessions
  app.post('/sessions', requireAuth, async (req, res) => {
    const { repoPath, repoName, worktreePath, branchName, claudeArgs } = req.body as {
      repoPath?: string;
      repoName?: string;
      worktreePath?: string;
      branchName?: string;
      claudeArgs?: string[];
    };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
    const baseArgs = [...(config.claudeArgs || []), ...(claudeArgs || [])];

    // Compute root by matching repoPath against configured rootDirs
    const roots = config.rootDirs || [];
    const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

    let args: string[];
    let cwd: string;
    let worktreeName: string;
    let sessionRepoPath: string;
    let resolvedBranch = '';

    if (worktreePath) {
      // Resume existing worktree
      args = ['--continue', ...baseArgs];
      cwd = worktreePath;
      sessionRepoPath = worktreePath;
      worktreeName = worktreePath.split('/').pop() || '';
    } else {
      // Create new worktree via git
      let dirName: string;
      if (branchName) {
        dirName = branchName.replace(/\//g, '-');
        resolvedBranch = branchName;
      } else {
        dirName = 'mobile-' + name + '-' + Date.now().toString(36);
        resolvedBranch = dirName;
      }

      const worktreeDir = path.join(repoPath, WORKTREE_DIRS[0]!);
      let targetDir = path.join(worktreeDir, dirName);

      if (fs.existsSync(targetDir)) {
        targetDir = targetDir + '-' + Date.now().toString(36);
        dirName = path.basename(targetDir);
      }

      for (const dir of WORKTREE_DIRS) {
        ensureGitignore(repoPath, dir + '/');
      }

      try {
        // Check if branch exists locally or on a remote
        let branchExists = false;
        if (branchName) {
          const localCheck = await execFileAsync('git', ['rev-parse', '--verify', branchName], { cwd: repoPath }).then(() => true, () => false);
          if (localCheck) {
            branchExists = true;
          } else {
            const remoteCheck = await execFileAsync('git', ['rev-parse', '--verify', 'origin/' + branchName], { cwd: repoPath }).then(() => true, () => false);
            if (remoteCheck) {
              branchExists = true;
              resolvedBranch = 'origin/' + branchName;
            }
          }
        }

        if (branchName && branchExists) {
          // Check if branch is already checked out in an existing worktree
          const { stdout: wtListOut } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
          const allWorktrees = parseAllWorktrees(wtListOut, repoPath);
          const existingWt = allWorktrees.find(wt => wt.branch === branchName);

          if (existingWt) {
            // Branch already checked out — redirect to the existing worktree
            if (existingWt.isMain) {
              // Main worktree → create a repo session
              const existingRepoSession = sessions.findRepoSession(repoPath);
              if (existingRepoSession) {
                res.status(409).json({ error: 'A session already exists for this repo', sessionId: existingRepoSession.id });
                return;
              }

              const repoSession = sessions.create({
                type: 'repo',
                repoName: name,
                repoPath,
                cwd: repoPath,
                root,
                displayName: name,
                command: config.claudeCommand,
                args: baseArgs,
              });

              res.status(201).json(repoSession);
              return;
            } else {
              // Another worktree → create a worktree session with --continue
              cwd = existingWt.path;
              sessionRepoPath = existingWt.path;
              worktreeName = existingWt.path.split('/').pop() || '';
              args = ['--continue', ...baseArgs];

              const displayNameVal = branchName || worktreeName;

              const session = sessions.create({
                type: 'worktree',
                repoName: name,
                repoPath: sessionRepoPath,
                cwd,
                root,
                worktreeName,
                branchName: branchName || worktreeName,
                displayName: displayNameVal,
                command: config.claudeCommand,
                args,
                configPath: CONFIG_PATH,
              });

              writeMeta(CONFIG_PATH, {
                worktreePath: sessionRepoPath,
                displayName: displayNameVal,
                lastActivity: new Date().toISOString(),
                branchName: branchName || worktreeName,
              });

              res.status(201).json(session);
              return;
            }
          }

          await execFileAsync('git', ['worktree', 'add', targetDir, resolvedBranch], { cwd: repoPath });
        } else if (branchName) {
          await execFileAsync('git', ['worktree', 'add', '-b', branchName, targetDir, 'HEAD'], { cwd: repoPath });
        } else {
          await execFileAsync('git', ['worktree', 'add', '-b', dirName, targetDir, 'HEAD'], { cwd: repoPath });
        }
      } catch (err: unknown) {
        res.status(500).json({ error: execErrorMessage(err, 'Failed to create worktree') });
        return;
      }

      worktreeName = dirName;
      sessionRepoPath = targetDir;
      cwd = targetDir;
      args = [...baseArgs];
    }

    const displayName = branchName || worktreeName;

    const session = sessions.create({
      type: 'worktree',
      repoName: name,
      repoPath: sessionRepoPath,
      cwd,
      root,
      worktreeName,
      branchName: branchName || worktreeName,
      displayName,
      command: config.claudeCommand,
      args,
      configPath: CONFIG_PATH,
    });

    if (!worktreePath) {
      writeMeta(CONFIG_PATH, {
        worktreePath: sessionRepoPath,
        displayName,
        lastActivity: new Date().toISOString(),
        branchName: branchName || worktreeName,
      });
    }

    res.status(201).json(session);
  });

  // POST /sessions/repo — start a session in the repo root (no worktree)
  app.post('/sessions/repo', requireAuth, (req, res) => {
    const { repoPath, repoName, continue: continueSession, claudeArgs } = req.body as {
      repoPath?: string;
      repoName?: string;
      continue?: boolean;
      claudeArgs?: string[];
    };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    // One repo session at a time
    const existing = sessions.findRepoSession(repoPath);
    if (existing) {
      res.status(409).json({ error: 'A session already exists for this repo', sessionId: existing.id });
      return;
    }

    const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
    const baseArgs = [...(config.claudeArgs || []), ...(claudeArgs || [])];
    const args = continueSession ? ['--continue', ...baseArgs] : [...baseArgs];

    const roots = config.rootDirs || [];
    const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

    const session = sessions.create({
      type: 'repo',
      repoName: name,
      repoPath,
      cwd: repoPath,
      root,
      displayName: name,
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

  // PATCH /sessions/:id — update displayName and persist to metadata
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
      if (session) {
        writeMeta(CONFIG_PATH, { worktreePath: session.repoPath, displayName, lastActivity: session.lastActivity });
      }
      res.json(updated);
    } catch (_) {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // POST /sessions/:id/image — upload clipboard image, proxy to system clipboard
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  app.post('/sessions/:id/image', requireAuth, async (req, res) => {
    const { data, mimeType } = req.body as { data?: string; mimeType?: string };
    if (!data || !mimeType) {
      res.status(400).json({ error: 'data and mimeType are required' });
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      res.status(400).json({ error: 'Unsupported image type: ' + mimeType });
      return;
    }
    // base64 is ~33% larger than binary; 10MB binary ≈ 13.3MB base64
    if (data.length > 14 * 1024 * 1024) {
      res.status(413).json({ error: 'Image too large (max 10MB)' });
      return;
    }
    const sessionId = req.params['id'] as string;
    if (!sessions.get(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      const ext = extensionForMime(mimeType);
      const dir = path.join(os.tmpdir(), 'claude-remote-cli', sessionId);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'paste-' + Date.now() + ext);
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

      let clipboardSet = false;
      try {
        clipboardSet = await setClipboardImage(filePath, mimeType);
      } catch {
        // Clipboard tools failed — fall back to path
      }

      if (clipboardSet) {
        sessions.write(sessionId, '\x16');
      }

      res.json({ path: filePath, clipboardSet });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed';
      res.status(500).json({ error: message });
    }
  });

  // GET /version — check current vs latest
  app.get('/version', requireAuth, async (_req, res) => {
    const current = getCurrentVersion();
    const latest = await getLatestVersion();
    const updateAvailable = latest !== null && semverLessThan(current, latest);
    res.json({ current, latest, updateAvailable });
  });

  // POST /update — install latest version from npm
  app.post('/update', requireAuth, async (_req, res) => {
    try {
      await execFileAsync('npm', ['install', '-g', 'claude-remote-cli@latest']);
      const restarting = serviceIsInstalled();
      res.json({ ok: true, restarting });
      if (restarting) {
        setTimeout(() => process.exit(0), 1000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      res.status(500).json({ ok: false, error: message });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`claude-remote-cli listening on ${config.host}:${config.port}`);
  });
}

main().catch(console.error);
