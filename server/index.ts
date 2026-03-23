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

import { loadConfig, saveConfig, DEFAULTS, readMeta, writeMeta, deleteMeta, ensureMetaDir, resolveSessionSettings } from './config.js';
import * as auth from './auth.js';
import * as sessions from './sessions.js';
import { AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS, serializeAll, restoreFromDisk, activeTmuxSessionNames, populateMetaCache } from './sessions.js';
import { setupWebSocket } from './ws.js';
import { WorktreeWatcher, BranchWatcher, RefWatcher, WORKTREE_DIRS, isValidWorktreePath, parseWorktreeListPorcelain, parseAllWorktrees } from './watcher.js';
import { isInstalled as serviceIsInstalled } from './service.js';
import { extensionForMime, setClipboardImage } from './clipboard.js';
import { listBranches, isBranchStale } from './git.js';
import * as push from './push.js';
import { initAnalytics, closeAnalytics, createAnalyticsRouter } from './analytics.js';
import { createWorkspaceRouter } from './workspaces.js';
import { createOrgDashboardRouter } from './org-dashboard.js';
import { createIntegrationGitHubRouter } from './integration-github.js';
import { createBranchLinkerRouter, invalidateBranchLinkerCache } from './branch-linker.js';
import { createHooksRouter } from './hooks.js';
import { createTicketTransitionsRouter } from './ticket-transitions.js';
import { createIntegrationJiraRouter } from './integration-jira.js';
import { startPolling, stopPolling } from './review-poller.js';
import { createGitHubAppRouter } from './github-app.js';
import { createWebhookRouter } from './webhooks.js';
import { fetchPrsGraphQL } from './github-graphql.js';
import type { AgentType, AutomationSettings, Config } from './types.js';
import { MOUNTAIN_NAMES } from './types.js';
import { semverLessThan } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

// When run via CLI bin, config lives in ~/.config/claude-remote-cli/
// When run directly (development), fall back to local config.json
const CONFIG_PATH = process.env.CLAUDE_REMOTE_CONFIG || path.join(__dirname, '..', '..', 'config.json');

const VERSION_CACHE_TTL = 5 * 60 * 1000;
let versionCache: { latest: string; fetchedAt: number } | null = null;

function getCurrentVersion(): string {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
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
  // Ignore SIGPIPE: node-pty can propagate pipe breaks causing unexpected session exits
  process.on('SIGPIPE', () => {});
  // Ignore SIGHUP: keep server alive if controlling terminal disconnects
  process.on('SIGHUP', () => {});

  ensureMetaDir(CONFIG_PATH);

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

  push.ensureVapidKeys(config, CONFIG_PATH, saveConfig);

  const configDir = path.dirname(CONFIG_PATH);
  try {
    initAnalytics(configDir);
  } catch (err) {
    console.warn('Analytics disabled: failed to initialize:', err instanceof Error ? err.message : err);
  }

  if (config.pinHash && auth.isLegacyHash(config.pinHash)) {
    console.log('Migrating legacy PIN hash to scrypt. You will need to set a new PIN.');
    delete config.pinHash;
    saveConfig(CONFIG_PATH, config);
  }

  if (!config.pinHash) {
    if (!process.stdin.isTTY) {
      console.error('No PIN configured. Run claude-remote-cli interactively first to set a PIN.');
      process.exit(1);
    }
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

  function boolConfigEndpoints(name: string, defaultValue: boolean, onEnable?: () => Promise<void>) {
    app.get(`/config/${name}`, requireAuth, (_req: express.Request, res: express.Response) => {
      res.json({ [name]: (config as unknown as Record<string, unknown>)[name] ?? defaultValue });
    });
    app.patch(`/config/${name}`, requireAuth, async (req: express.Request, res: express.Response) => {
      const value = (req.body as Record<string, unknown>)[name];
      if (typeof value !== 'boolean') {
        res.status(400).json({ error: `${name} must be a boolean` });
        return;
      }
      if (value && onEnable) {
        try { await onEnable(); } catch {
          res.status(400).json({ error: `Validation failed for ${name}` });
          return;
        }
      }
      (config as unknown as Record<string, unknown>)[name] = value;
      saveConfig(CONFIG_PATH, config);
      res.json({ [name]: value });
    });
  }

  const watcher = new WorktreeWatcher();
  watcher.rebuild(config.workspaces || []);

  const server = http.createServer(app);
  const { broadcastEvent } = setupWebSocket(server, authenticatedTokens, watcher, CONFIG_PATH);

  // Watch .git/HEAD files for branch changes and update active sessions
  const branchWatcher = new BranchWatcher((cwdPath, newBranch) => {
    for (const session of sessions.list()) {
      if (session.repoPath === cwdPath || session.cwd === cwdPath) {
        const raw = sessions.get(session.id);
        if (raw) {
          raw.branchName = newBranch;
          broadcastEvent('session-renamed', {
            sessionId: session.id,
            branchName: newBranch,
            displayName: raw.displayName,
          });
        }
      }
    }
    // Rebuild ref watchers when branches change (new upstream to watch)
    rebuildRefWatcher();
  });
  branchWatcher.rebuild(config.workspaces || []);
  watcher.on('worktrees-changed', () => {
    branchWatcher.rebuild(config.workspaces || []);
  });

  // Watch upstream tracking refs for push/fetch and broadcast ref-changed events
  const refWatcher = new RefWatcher((cwdPath, branch) => {
    broadcastEvent('ref-changed', { cwdPath, branch });
  });

  let refWatcherRebuildPending = false;
  let refWatcherNeedsRebuild = false;
  function rebuildRefWatcher(): void {
    if (refWatcherRebuildPending) {
      refWatcherNeedsRebuild = true;
      return;
    }
    refWatcherRebuildPending = true;
    refWatcherNeedsRebuild = false;
    const entries = sessions.list()
      .filter(s => s.branchName)
      .map(s => ({ cwdPath: s.cwd, branch: s.branchName }));
    refWatcher.rebuild(entries).finally(() => {
      refWatcherRebuildPending = false;
      if (refWatcherNeedsRebuild) rebuildRefWatcher();
    });
  }

  rebuildRefWatcher();
  sessions.onSessionCreate(() => rebuildRefWatcher());
  sessions.onSessionEnd(() => rebuildRefWatcher());

  // Configure session defaults for hooks injection
  sessions.configure({ port: config.port, forceOutputParser: config.forceOutputParser ?? false });

  // Mount hooks router BEFORE auth middleware — hook callbacks come from localhost Claude Code
  const hooksRouter = createHooksRouter({
    getSession: sessions.get,
    broadcastEvent,
    fireStateChange: sessions.fireStateChange,
    notifySessionAttention: push.notifySessionAttention,
    configPath: CONFIG_PATH,
  });
  app.use('/hooks', hooksRouter);

  // Mount workspace router
  const workspaceRouter = createWorkspaceRouter({ configPath: CONFIG_PATH });
  app.use('/workspaces', requireAuth, workspaceRouter);

  // Mount GitHub integration router
  const integrationGitHubRouter = createIntegrationGitHubRouter({ configPath: CONFIG_PATH });
  app.use('/integration-github', requireAuth, integrationGitHubRouter);

  // Mount Jira integration router
  const integrationJiraRouter = createIntegrationJiraRouter({ configPath: CONFIG_PATH });
  app.use('/integration-jira', requireAuth, integrationJiraRouter);

  // Mount branch linker router
  const branchLinkerRouter = createBranchLinkerRouter({
    configPath: CONFIG_PATH,
    getActiveBranchNames: () => {
      const workspaces = config.workspaces ?? [];
      const map = new Map<string, Set<string>>();
      for (const s of sessions.list()) {
        if (!s.branchName) continue;
        // Normalize: match session repoPath to workspace root
        // (worktree sessions store the worktree path, not workspace root)
        const wsRoot = workspaces.find((ws) => s.repoPath.startsWith(ws)) ?? s.repoPath;
        const existing = map.get(wsRoot);
        if (existing) {
          existing.add(s.branchName);
        } else {
          map.set(wsRoot, new Set([s.branchName]));
        }
      }
      return map;
    },
  });
  app.use('/branch-linker', requireAuth, branchLinkerRouter);

  // Mount ticket transitions router
  const { router: ticketTransitionsRouter, transitionOnSessionCreate, checkPrTransitions } = createTicketTransitionsRouter({ configPath: CONFIG_PATH });
  app.use('/ticket-transitions', requireAuth, ticketTransitionsRouter);

  // Mount GitHub App OAuth (no auth — callback comes from GitHub redirect)
  const githubAppRouter = createGitHubAppRouter({
    configPath: CONFIG_PATH,
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
  });
  app.use('/auth/github', githubAppRouter);

  // Mount webhooks (no auth — GitHub sends these with HMAC signature)
  const webhookSecret = config.github?.webhookSecret;
  if (webhookSecret) {
    const webhookRouter = createWebhookRouter({
      secret: webhookSecret,
      broadcastEvent,
      getWorkspacePaths: () => loadConfig(CONFIG_PATH).workspaces ?? [],
    });
    app.use('/webhooks', webhookRouter);
  }

  // Mount org dashboard router — use GraphQL when token available, fall back to gh CLI
  const orgDashboardRouter = createOrgDashboardRouter({
    configPath: CONFIG_PATH,
    checkPrTransitions,
    getBranchLinks: () => branchLinkerRouter.fetchLinks(),
    fetchGraphQL: fetchPrsGraphQL,
  });
  app.use('/org-dashboard', requireAuth, orgDashboardRouter);

  // Mount analytics router
  app.use('/analytics', requireAuth, createAnalyticsRouter(configDir));

  // Restore sessions from a previous update restart
  const restoredCount = await restoreFromDisk(configDir);
  if (restoredCount > 0) {
    console.log(`Restored ${restoredCount} session(s) from previous update.`);
  }

  // Populate session metadata cache in background (non-blocking)
  populateMetaCache().catch(() => {});

  // Build shared deps for review poller
  function buildPollerDeps() {
    return {
      configPath: CONFIG_PATH,
      getWorkspacePaths: () => config.workspaces ?? [],
      getWorkspaceSettings: (wsPath: string) => config.workspaceSettings?.[wsPath],
      createSession: async (opts: { repoPath: string; worktreePath: string; branchName: string; initialPrompt?: string }) => {
        const resolved = resolveSessionSettings(config, opts.repoPath, {});
        const roots = config.rootDirs || [];
        const root = roots.find((r) => opts.repoPath.startsWith(r)) || '';
        const repoName = opts.repoPath.split('/').filter(Boolean).pop() || 'session';
        const worktreeName = opts.worktreePath.split('/').pop() || '';
        const displayName = sessions.nextAgentName();
        sessions.create({
          type: 'worktree',
          agent: resolved.agent,
          repoName,
          repoPath: opts.worktreePath,
          cwd: opts.worktreePath,
          root,
          worktreeName,
          branchName: opts.branchName,
          displayName,
          args: [...resolved.claudeArgs, ...(resolved.yolo ? AGENT_YOLO_ARGS[resolved.agent] : [])],
          configPath: CONFIG_PATH,
          useTmux: resolved.useTmux,
          yolo: resolved.yolo,
          claudeArgs: resolved.claudeArgs,
          ...(opts.initialPrompt != null && { initialPrompt: opts.initialPrompt }),
        });
      },
      broadcastEvent,
    };
  }

  // Start review request poller if enabled
  if (config.automations?.autoCheckoutReviewRequests) {
    startPolling(buildPollerDeps());
  }

  // Start smee-client for webhook delivery (with polling fallback)
  const smeeUrl = config.github?.smeeUrl;
  const githubToken = config.github?.accessToken;
  let webhookPollingInterval: ReturnType<typeof setInterval> | null = null;
  let smeeErrorCount = 0;

  function startWebhookPolling(): void {
    if (webhookPollingInterval) return;
    webhookPollingInterval = setInterval(() => {
      broadcastEvent('pr-updated');
      broadcastEvent('ci-updated');
    }, 30_000);
  }

  function stopWebhookPolling(): void {
    if (webhookPollingInterval) {
      clearInterval(webhookPollingInterval);
      webhookPollingInterval = null;
    }
  }

  if (smeeUrl) {
    import('smee-client').then(({ default: SmeeClient }) => {
      const smee = new SmeeClient({
        source: smeeUrl,
        target: `http://127.0.0.1:${config.port}/webhooks`,
        logger: {
          info: () => {},
          error: () => {
            smeeErrorCount++;
            if (smeeErrorCount >= 3) startWebhookPolling();
          },
        },
      });
      smee.start().then((events) => {
        events.addEventListener('open', () => {
          smeeErrorCount = 0;
          stopWebhookPolling();
        });
      }).catch(() => {});
    }).catch(() => {
      // smee-client not available — use polling
      if (githubToken) startWebhookPolling();
    });
  } else if (githubToken) {
    // No smee URL configured — use polling
    startWebhookPolling();
  }

  // Invalidate branch linker cache on session lifecycle changes
  sessions.onSessionCreate(() => { invalidateBranchLinkerCache(); });
  sessions.onSessionEnd(() => { invalidateBranchLinkerCache(); });

  // Push notifications on session idle (skip when hooks already sent attention notification)
  sessions.onIdleChange((sessionId, idle) => {
    if (idle) {
      const session = sessions.get(sessionId);
      if (session && session.type !== 'terminal') {
        // Dedup: if hooks fired an attention notification within last 10s, skip
        if (session.hooksActive && session.lastAttentionNotifiedAt && Date.now() - session.lastAttentionNotifiedAt < 10000) {
          return;
        }
        push.notifySessionAttention(sessionId, session);
      }
    }
  });

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

  // GET /sessions — enrich with live branch from git (rate-limited to avoid spawning git on every poll)
  const branchRefreshCache = new Map<string, number>(); // sessionId -> last refresh timestamp
  const BRANCH_REFRESH_INTERVAL_MS = 10_000;
  app.get('/sessions', requireAuth, async (_req, res) => {
    const allSessions = sessions.list();
    const now = Date.now();

    // Prune cache entries for sessions that no longer exist
    const activeIds = new Set(allSessions.map((s) => s.id));
    for (const sessionId of branchRefreshCache.keys()) {
      if (!activeIds.has(sessionId)) branchRefreshCache.delete(sessionId);
    }

    await Promise.all(allSessions.map(async (s) => {
      if (s.type !== 'repo' && s.type !== 'worktree') return;
      if (!s.repoPath) return;
      const lastRefresh = branchRefreshCache.get(s.id) ?? 0;
      if (now - lastRefresh < BRANCH_REFRESH_INTERVAL_MS) return;
      const cwd = s.type === 'repo' ? s.repoPath : s.cwd;
      if (!cwd) return;
      branchRefreshCache.set(s.id, now);
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
        const liveBranch = stdout.trim();
        if (liveBranch && liveBranch !== s.branchName) {
          s.branchName = liveBranch;
          const raw = sessions.get(s.id);
          if (raw) raw.branchName = liveBranch;
        }
      } catch { /* non-fatal */ }
    }));
    res.json(allSessions);
  });

  // GET /repos — scan root dirs for repos
  app.get('/repos', requireAuth, async (_req, res) => {
    const repos = scanAllRepos(config.rootDirs || []);
    // Also include legacy manually-added repos
    if (config.repos) {
      for (const repo of config.repos as unknown as RepoEntry[]) {
        if (!repos.some((r) => r.path === repo.path)) {
          repos.push(repo);
        }
      }
    }
    // Enrich with current branch (best-effort, parallel)
    const enriched = await Promise.all(repos.map(async (repo) => {
      try {
        const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: repo.path });
        return { ...repo, defaultBranch: stdout.trim() };
      } catch {
        return { ...repo, defaultBranch: null };
      }
    }));
    res.json(enriched);
  });

  // GET /branches?repo=<path> — list local and remote branches for a repo
  app.get('/branches', requireAuth, async (req, res) => {
    const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const refresh = req.query.refresh === '1';
    if (!repoPath) {
      res.status(400).json({ error: 'repo query parameter is required' });
      return;
    }

    res.json(await listBranches(repoPath, { refresh }));
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
      reposToScan = [];
      for (const rootDir of roots) {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(rootDir, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const fullPath = path.join(rootDir, entry.name);
          const dotGit = path.join(fullPath, '.git');
          try {
            if (fs.statSync(dotGit).isDirectory()) {
              reposToScan.push({ name: entry.name, path: fullPath, root: rootDir });
            }
          } catch (_) {
            // .git doesn't exist — not a repo
          }
        }
      }
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

  // GET /config/defaultAgent — get default coding agent
  app.get('/config/defaultAgent', requireAuth, (_req, res) => {
    res.json({ defaultAgent: config.defaultAgent || 'claude' });
  });

  // PATCH /config/defaultAgent — set default coding agent
  app.patch('/config/defaultAgent', requireAuth, (req, res) => {
    const { defaultAgent } = req.body as { defaultAgent?: string };
    if (!defaultAgent || (defaultAgent !== 'claude' && defaultAgent !== 'codex')) {
      res.status(400).json({ error: 'defaultAgent must be "claude" or "codex"' });
      return;
    }
    config.defaultAgent = defaultAgent;
    saveConfig(CONFIG_PATH, config);
    res.json({ defaultAgent: config.defaultAgent });
  });

  boolConfigEndpoints('defaultContinue', true);
  boolConfigEndpoints('defaultYolo', false);
  boolConfigEndpoints('launchInTmux', false, async () => {
    await execFileAsync('tmux', ['-V']);
  });
  boolConfigEndpoints('defaultNotifications', true);

  // GET /config/automations — get automation settings
  app.get('/config/automations', requireAuth, (_req: express.Request, res: express.Response) => {
    res.json(config.automations ?? {});
  });

  // PATCH /config/automations — update automation settings and start/stop poller
  app.patch('/config/automations', requireAuth, (req: express.Request, res: express.Response) => {
    const body = req.body as Partial<AutomationSettings>;
    const prev = config.automations ?? {};
    const next: AutomationSettings = { ...prev };

    if (typeof body.autoCheckoutReviewRequests === 'boolean') {
      next.autoCheckoutReviewRequests = body.autoCheckoutReviewRequests;
    }
    if (typeof body.autoReviewOnCheckout === 'boolean') {
      next.autoReviewOnCheckout = body.autoReviewOnCheckout;
    }
    if (typeof body.pollIntervalMs === 'number' && body.pollIntervalMs >= 60000) {
      next.pollIntervalMs = body.pollIntervalMs;
    }

    // Enforce: auto-review requires auto-checkout
    if (!next.autoCheckoutReviewRequests) {
      next.autoReviewOnCheckout = false;
    }

    config.automations = next;
    try {
      saveConfig(CONFIG_PATH, config);
    } catch (err) {
      config.automations = prev;
      console.error('[config] Failed to save automation settings:', err);
      res.status(500).json({ error: 'Failed to save settings' });
      return;
    }

    // Start or stop poller based on new setting
    void stopPolling().then(() => {
      if (next.autoCheckoutReviewRequests) {
        startPolling(buildPollerDeps());
      }
    });

    res.json(next);
  });

  // GET /config/workspace-groups — return workspace group configuration
  app.get('/config/workspace-groups', requireAuth, (_req, res) => {
    res.json({ groups: config.workspaceGroups ?? {} });
  });

  // GET /presets — return all filter presets (built-in merged with user presets)
  app.get('/presets', requireAuth, (_req: express.Request, res: express.Response) => {
    res.json(config.filterPresets ?? []);
  });

  // POST /presets — add a new user filter preset
  app.post('/presets', requireAuth, (req: express.Request, res: express.Response) => {
    const { name, filters, sort } = req.body as { name?: string; filters?: unknown; sort?: unknown };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (sort && typeof sort === 'object') {
      const dir = (sort as any).direction;
      if (dir !== 'asc' && dir !== 'desc') {
        res.status(400).json({ error: 'sort.direction must be "asc" or "desc"' });
        return;
      }
    }
    const preset = { name: name.trim(), filters: (filters as { status?: string[]; repo?: string[]; role?: string[] }) ?? {}, sort: (sort as { column: string; direction: 'asc' | 'desc' }) ?? { column: 'role', direction: 'asc' as const } };
    if (!config.filterPresets) config.filterPresets = [];
    config.filterPresets.push(preset);
    saveConfig(CONFIG_PATH, config);
    res.json(preset);
  });

  // DELETE /presets/:name — remove a user preset (built-in presets cannot be deleted)
  app.delete('/presets/:name', requireAuth, (req: express.Request, res: express.Response) => {
    const name = decodeURIComponent(req.params['name'] ?? '');
    const presets = config.filterPresets ?? [];
    const target = presets.find((p) => p.name === name);
    if (!target) {
      res.status(404).json({ error: 'Preset not found' });
      return;
    }
    if (target.builtIn) {
      res.status(400).json({ error: 'Cannot delete a built-in preset' });
      return;
    }
    config.filterPresets = presets.filter((p) => p.name !== name);
    saveConfig(CONFIG_PATH, config);
    res.json({ ok: true });
  });

  // GET /push/vapid-key
  app.get('/push/vapid-key', requireAuth, (_req, res) => {
    const key = push.getVapidPublicKey();
    if (!key) {
      res.status(501).json({ error: 'Push not available' });
      return;
    }
    res.json({ vapidPublicKey: key });
  });

  // POST /push/subscribe
  app.post('/push/subscribe', requireAuth, (req, res) => {
    const { subscription, sessionIds } = req.body as { subscription?: { endpoint: string; keys: { p256dh: string; auth: string } }; sessionIds?: string[] };
    if (!subscription?.endpoint) {
      res.status(400).json({ error: 'subscription required' });
      return;
    }
    push.subscribe(subscription, sessionIds || []);
    res.json({ ok: true });
  });

  // POST /push/unsubscribe
  app.post('/push/unsubscribe', requireAuth, (req, res) => {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }
    push.unsubscribe(endpoint);
    res.json({ ok: true });
  });

  // DELETE /worktrees — remove a worktree, prune, and delete its branch
  app.delete('/worktrees', requireAuth, async (req, res) => {
    const { worktreePath, repoPath } = req.body as { worktreePath?: string; repoPath?: string };
    if (!worktreePath || !repoPath) {
      res.status(400).json({ error: 'worktreePath and repoPath are required' });
      return;
    }

    // Validate the path is a real git worktree (not the main worktree)
    try {
      const { stdout: wtListOut } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
      const allWorktrees = parseAllWorktrees(wtListOut, repoPath);
      const isKnownWorktree = allWorktrees.some(wt => wt.path === path.resolve(worktreePath) && !wt.isMain);
      if (!isKnownWorktree) {
        res.status(400).json({ error: 'Path is not a recognized git worktree' });
        return;
      }
    } catch {
      // If git worktree list fails, fall back to the directory-name check
      if (!isValidWorktreePath(worktreePath)) {
        res.status(400).json({ error: 'Path is not inside a worktree directory' });
        return;
      }
    }

    // Multiple sessions per worktree allowed (multi-tab support)

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
    const { repoPath, repoName, worktreePath, branchName, claudeArgs, yolo, agent, useTmux, cols, rows, needsBranchRename, branchRenamePrompt, ticketContext } = req.body as {
      repoPath?: string;
      repoName?: string;
      worktreePath?: string;
      branchName?: string;
      claudeArgs?: string[];
      yolo?: boolean;
      agent?: AgentType;
      useTmux?: boolean;
      cols?: number;
      rows?: number;
      needsBranchRename?: boolean;
      branchRenamePrompt?: string;
      ticketContext?: { ticketId: string; title: string; description?: string; url: string; source: 'github' | 'jira'; repoPath: string; repoName: string };
    };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    // Sanitize optional terminal dimensions
    const safeCols = typeof cols === 'number' && Number.isFinite(cols) && cols >= 1 && cols <= 500 ? Math.round(cols) : undefined;
    const safeRows = typeof rows === 'number' && Number.isFinite(rows) && rows >= 1 && rows <= 200 ? Math.round(rows) : undefined;

    const resolved = resolveSessionSettings(config, repoPath, { agent, yolo, useTmux, claudeArgs });
    const resolvedAgent = resolved.agent;
    const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';

    let initialPrompt: string | undefined;
    if (ticketContext && (typeof ticketContext.ticketId !== 'string' || typeof ticketContext.title !== 'string' || typeof ticketContext.url !== 'string')) {
      res.status(400).json({ error: 'ticketContext requires string ticketId, title, and url' });
      return;
    }
    if (ticketContext) {
      // Validate source is a known integration
      if (ticketContext.source !== 'github' && ticketContext.source !== 'jira') {
        res.status(400).json({ error: "ticketContext.source must be 'github' or 'jira'" });
        return;
      }
      // Validate repoPath is a configured workspace
      const configuredWorkspaces = config.workspaces || [];
      if (!configuredWorkspaces.includes(ticketContext.repoPath)) {
        res.status(400).json({ error: 'ticketContext.repoPath is not a configured workspace' });
        return;
      }
      // Jira integration is configured via acli CLI — no env var check needed.
      // Auth validation happens when acli commands are actually called.
      // Validate ticket ID format per source
      if (ticketContext.source === 'github' && !/^GH-\d+$/.test(ticketContext.ticketId)) {
        res.status(400).json({ error: 'ticketContext.ticketId for github must match GH-<number>' });
        return;
      }
      if (ticketContext.source === 'jira' && !/^[A-Z][A-Z0-9]*-\d+$/.test(ticketContext.ticketId)) {
        res.status(400).json({ error: 'ticketContext.ticketId must match <PROJECT>-<number>' });
        return;
      }
    }
    if (ticketContext) {
      // Use ticketContext.repoPath (workspace root) for settings lookup
      const settings = config.workspaceSettings?.[ticketContext.repoPath];
      const template = settings?.promptStartWork ??
        'You are working on ticket {ticketId}: {title}\n\nTicket URL: {ticketUrl}\n\nPlease start by understanding the issue and proposing an approach.';
      initialPrompt = template
        .replace(/\{ticketId\}/g, ticketContext.ticketId)
        .replace(/\{title\}/g, ticketContext.title)
        .replace(/\{ticketUrl\}/g, ticketContext.url)
        .replace(/\{description\}/g, ticketContext.description ?? '');
    }
    const baseArgs = [
      ...(resolved.claudeArgs),
      ...(resolved.yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
    ];

    // Compute root by matching repoPath against configured rootDirs
    const roots = config.rootDirs || [];
    const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

    let args: string[];
    let cwd: string;
    let worktreeName: string;
    let sessionRepoPath: string;
    let resolvedBranch = '';
    let isMountainName = false;

    if (worktreePath) {
      // Check if the worktree's branch is stale (merged/at base) and needs a fresh name
      const currentBranchResult = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath }).catch(() => null);
      const currentBranch = currentBranchResult?.stdout.trim();

      if (currentBranch && !needsBranchRename) {
        const stale = await isBranchStale(worktreePath, currentBranch);
        if (stale) {
          // Generate unique temp branch: <mountain>-<short-timestamp>
          const mountainName = worktreePath.split('/').pop() || 'branch';
          const suffix = Date.now().toString(36).slice(-4);
          const tempBranch = `${mountainName}-${suffix}`;
          try {
            await execFileAsync('git', ['checkout', '-b', tempBranch], { cwd: worktreePath });
          } catch {
            await execFileAsync('git', ['branch', '-m', tempBranch], { cwd: worktreePath }).catch(() => {});
          }
          isMountainName = true;
        }
      }

      // Only use --continue if:
      // 1. Not a brand-new worktree (needsBranchRename flag)
      // 2. A prior Claude session exists in this directory (.claude/ dir present)
      // 3. Branch is not stale (isMountainName means we just created a fresh branch)
      const hasPriorSession = !needsBranchRename && !isMountainName && fs.existsSync(path.join(worktreePath, '.claude'));
      args = hasPriorSession ? [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs] : [...baseArgs];
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
        // Pick the next mountain name from the cycling list
        const idx = config.nextMountainIndex || 0;
        const picked = MOUNTAIN_NAMES[idx % MOUNTAIN_NAMES.length]!;
        dirName = picked;
        resolvedBranch = picked;
        isMountainName = true;
        config.nextMountainIndex = (idx + 1) % MOUNTAIN_NAMES.length;
        saveConfig(CONFIG_PATH, config);
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
                agent: resolvedAgent,
                repoName: name,
                repoPath,
                cwd: repoPath,
                root,
                displayName: sessions.nextAgentName(),
                args: baseArgs,
                useTmux: resolved.useTmux,
                yolo: resolved.yolo,
                claudeArgs: resolved.claudeArgs,
                ...(safeCols != null && { cols: safeCols }),
                ...(safeRows != null && { rows: safeRows }),
                ...(initialPrompt != null && { initialPrompt }),
              });

              if (ticketContext) {
                transitionOnSessionCreate(ticketContext).catch((err: unknown) => {
                  console.error('[index] transition on session create failed:', err);
                });
              }
              res.status(201).json(repoSession);
              return;
            } else {
              // Another worktree → create a worktree session with --continue
              cwd = existingWt.path;
              sessionRepoPath = existingWt.path;
              worktreeName = existingWt.path.split('/').pop() || '';
              args = [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs];

              const displayNameVal = sessions.nextAgentName();

              const session = sessions.create({
                type: 'worktree',
                agent: resolvedAgent,
                repoName: name,
                repoPath: sessionRepoPath,
                cwd,
                root,
                worktreeName,
                branchName: branchName || worktreeName,
                displayName: displayNameVal,
                args,
                configPath: CONFIG_PATH,
                useTmux: resolved.useTmux,
                yolo: resolved.yolo,
                claudeArgs: resolved.claudeArgs,
                ...(safeCols != null && { cols: safeCols }),
                ...(safeRows != null && { rows: safeRows }),
                ...(initialPrompt != null && { initialPrompt }),
              });

              writeMeta(CONFIG_PATH, {
                worktreePath: sessionRepoPath,
                displayName: displayNameVal,
                lastActivity: new Date().toISOString(),
                branchName: branchName || worktreeName,
              });

              if (ticketContext) {
                transitionOnSessionCreate(ticketContext).catch((err: unknown) => {
                  console.error('[index] transition on session create failed:', err);
                });
              }
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

    const displayName = sessions.nextAgentName();

    const session = sessions.create({
      type: 'worktree',
      agent: resolvedAgent,
      repoName: name,
      repoPath: sessionRepoPath,
      cwd,
      root,
      worktreeName,
      branchName: branchName || worktreeName,
      displayName,
      args,
      configPath: CONFIG_PATH,
      useTmux: resolved.useTmux,
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
      ...(safeCols != null && { cols: safeCols }),
      ...(safeRows != null && { rows: safeRows }),
      needsBranchRename: isMountainName || (needsBranchRename ?? false),
      branchRenamePrompt: branchRenamePrompt ?? '',
      ...(initialPrompt != null && { initialPrompt }),
    });

    if (!worktreePath) {
      writeMeta(CONFIG_PATH, {
        worktreePath: sessionRepoPath,
        displayName,
        lastActivity: new Date().toISOString(),
        branchName: branchName || worktreeName,
      });
    }

    if (ticketContext) {
      transitionOnSessionCreate(ticketContext).catch((err: unknown) => {
        console.error('[index] transition on session create failed:', err);
      });
    }
    res.status(201).json(session);
  });

  // POST /sessions/repo — start a session in the repo root (no worktree)
  app.post('/sessions/repo', requireAuth, async (req, res) => {
    const { repoPath, repoName, continue: continueSession, claudeArgs, yolo, agent, useTmux, cols, rows } = req.body as {
      repoPath?: string;
      repoName?: string;
      continue?: boolean;
      claudeArgs?: string[];
      yolo?: boolean;
      agent?: AgentType;
      useTmux?: boolean;
      cols?: number;
      rows?: number;
    };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    const resolved = resolveSessionSettings(config, repoPath, {
      agent, yolo, continue: continueSession, useTmux, claudeArgs,
    });
    const resolvedAgent = resolved.agent;

    // Sanitize optional terminal dimensions
    const safeCols = typeof cols === 'number' && Number.isFinite(cols) && cols >= 1 && cols <= 500 ? Math.round(cols) : undefined;
    const safeRows = typeof rows === 'number' && Number.isFinite(rows) && rows >= 1 && rows <= 200 ? Math.round(rows) : undefined;

    // Multiple sessions per repo allowed (multi-tab support)

    const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
    const baseArgs = [
      ...(resolved.claudeArgs),
      ...(resolved.yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
    ];
    const args = resolved.continue ? [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs] : [...baseArgs];

    const roots = config.rootDirs || [];
    const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

    let branchName = '';
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
      branchName = stdout.trim();
    } catch { /* non-fatal */ }

    const session = sessions.create({
      type: 'repo',
      agent: resolvedAgent,
      repoName: name,
      repoPath,
      cwd: repoPath,
      root,
      displayName: sessions.nextAgentName(),
      args,
      branchName,
      useTmux: resolved.useTmux,
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
      ...(safeCols != null && { cols: safeCols }),
      ...(safeRows != null && { rows: safeRows }),
    });

    res.status(201).json(session);
  });

  // POST /sessions/terminal — start a bare shell session (no agent), optional cwd in body
  app.post('/sessions/terminal', requireAuth, (req, res) => {
    const shell = process.env.SHELL || '/bin/sh';
    const displayName = sessions.nextTerminalName();
    const rawCwd = (req.body as Record<string, unknown>)?.cwd;
    const startDir = typeof rawCwd === 'string' && rawCwd.trim()
      ? rawCwd.trim()
      : os.homedir();

    if (!fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory()) {
      res.status(400).json({ error: `Directory does not exist: ${startDir}` });
      return;
    }

    const session = sessions.create({
      type: 'terminal',
      agent: 'claude', // required by CreateParams but unused for terminal sessions
      repoPath: startDir,
      cwd: startDir,
      displayName,
      command: shell,
      args: [],
    });

    res.status(201).json(session);
  });

  // DELETE /sessions/:id
  app.delete('/sessions/:id', requireAuth, (req, res) => {
    const id = req.params['id'] as string;
    try {
      sessions.kill(id);
      push.removeSession(id);
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
      if (restarting) {
        // Persist sessions so they can be restored after restart
        const configDir = path.dirname(CONFIG_PATH);
        serializeAll(configDir);
      }
      res.json({ ok: true, restarting });
      if (restarting) {
        setTimeout(() => process.exit(0), 1000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      res.status(500).json({ ok: false, error: message });
    }
  });

  // Clean up orphaned tmux sessions from previous runs (skip any adopted by restore)
  try {
    const adoptedNames = activeTmuxSessionNames();
    const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
    const orphanedSessions = stdout.trim().split('\n').filter(name => name.startsWith('crc-') && !adoptedNames.has(name));
    for (const name of orphanedSessions) {
      execFileAsync('tmux', ['kill-session', '-t', name]).catch(() => {});
    }
    if (orphanedSessions.length > 0) {
      console.log(`Cleaned up ${orphanedSessions.length} orphaned tmux session(s).`);
    }
  } catch {
    // tmux not installed or no sessions — ignore
  }

  async function gracefulShutdown() {
    await stopPolling();
    closeAnalytics();
    branchWatcher.close();
    refWatcher.close();
    server.close();
    // Serialize sessions to disk BEFORE killing them
    const configDir = path.dirname(CONFIG_PATH);
    serializeAll(configDir);
    // Kill all active sessions (PTY + tmux)
    for (const s of sessions.list()) {
      try { sessions.kill(s.id); } catch { /* already exiting */ }
    }
    // Brief delay to let async tmux kill-session calls fire
    setTimeout(() => process.exit(0), 200);
  }
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  server.listen(config.port, config.host, () => {
    console.log(`claude-remote-cli listening on ${config.host}:${config.port}`);
  });
}

main().catch(console.error);
