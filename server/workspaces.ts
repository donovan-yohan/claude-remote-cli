import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Router } from 'express';
import type { Request, Response } from 'express';

import { loadConfig, saveConfig } from './config.js';
import { listBranches } from './git.js';
// These will be added by the git.ts enhancement task:
// import { getActivityFeed, getCiStatus, getPrForBranch, switchBranch } from './git.js';
import type { Config, PullRequest, PullRequestsResponse, Workspace, WorkspaceSettings } from './types.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Deps type
// ---------------------------------------------------------------------------

export interface WorkspaceDeps {
  configPath: string;
  /** Injected so tests can override execFile calls */
  execAsync?: typeof execFileAsync;
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Resolves and validates a raw workspace path string.
 * Throws with a human-readable message if the path is invalid.
 */
export async function validateWorkspacePath(rawPath: string): Promise<string> {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  const resolved = path.resolve(rawPath);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }

  return resolved;
}

/**
 * Detects whether a directory is the root of a git repository and, if so,
 * what the default branch name is.
 */
export async function detectGitRepo(
  dirPath: string,
  execAsync: typeof execFileAsync = execFileAsync,
): Promise<{ isGitRepo: boolean; defaultBranch: string | null }> {
  try {
    await execAsync('git', ['rev-parse', '--git-dir'], { cwd: dirPath });
  } catch {
    return { isGitRepo: false, defaultBranch: null };
  }

  // Attempt to determine the default branch from remote HEAD
  let defaultBranch: string | null = null;
  try {
    const { stdout } = await execAsync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd: dirPath },
    );
    const trimmed = stdout.trim();
    // "origin/main" → "main"
    defaultBranch = trimmed.replace(/^origin\//, '') || null;
  } catch {
    // Fall back to checking local HEAD
    try {
      const { stdout } = await execAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dirPath });
      defaultBranch = stdout.trim() || null;
    } catch {
      // Cannot determine default branch
    }
  }

  return { isGitRepo: true, defaultBranch };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns an Express Router that handles all /workspaces routes.
 *
 * Caller is responsible for mounting and applying auth middleware:
 *   app.use('/workspaces', requireAuth, createWorkspaceRouter({ configPath }));
 */
export function createWorkspaceRouter(deps: WorkspaceDeps): Router {
  const { configPath } = deps;
  const exec = deps.execAsync ?? execFileAsync;

  const router = Router();

  // Helper: reload config on every request so concurrent changes are reflected
  function getConfig(): Config {
    return loadConfig(configPath);
  }

  // -------------------------------------------------------------------------
  // GET /workspaces — list all workspaces with git info
  // -------------------------------------------------------------------------
  router.get('/', async (_req: Request, res: Response) => {
    const config = getConfig();
    const workspacePaths = config.workspaces ?? [];

    const results: Workspace[] = await Promise.all(
      workspacePaths.map(async (p) => {
        const name = path.basename(p);
        const { isGitRepo, defaultBranch } = await detectGitRepo(p, exec);
        return { path: p, name, isGitRepo, defaultBranch };
      }),
    );

    res.json({ workspaces: results });
  });

  // -------------------------------------------------------------------------
  // POST /workspaces — add a workspace
  // -------------------------------------------------------------------------
  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const rawPath = body.path;

    if (typeof rawPath !== 'string' || !rawPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    let resolved: string;
    try {
      resolved = await validateWorkspacePath(rawPath);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const config = getConfig();
    const workspaces = config.workspaces ?? [];

    if (workspaces.includes(resolved)) {
      res.status(409).json({ error: 'Workspace already exists' });
      return;
    }

    const { isGitRepo, defaultBranch } = await detectGitRepo(resolved, exec);

    config.workspaces = [...workspaces, resolved];
    saveConfig(configPath, config);

    const workspace: Workspace = {
      path: resolved,
      name: path.basename(resolved),
      isGitRepo,
      defaultBranch,
    };

    res.status(201).json(workspace);
  });

  // -------------------------------------------------------------------------
  // DELETE /workspaces — remove a workspace
  // -------------------------------------------------------------------------
  router.delete('/', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const rawPath = body.path;

    if (typeof rawPath !== 'string' || !rawPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    const resolved = path.resolve(rawPath);
    const config = getConfig();
    const workspaces = config.workspaces ?? [];
    const idx = workspaces.indexOf(resolved);

    if (idx === -1) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    config.workspaces = workspaces.filter((p) => p !== resolved);
    saveConfig(configPath, config);

    res.json({ removed: resolved });
  });

  // -------------------------------------------------------------------------
  // GET /workspaces/dashboard — aggregated PR + activity data for a workspace
  // -------------------------------------------------------------------------
  router.get('/dashboard', async (req: Request, res: Response) => {
    const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;

    if (!workspacePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const fields = 'number,title,url,headRefName,state,author,updatedAt,additions,deletions,reviewDecision';

    // Get current GitHub user
    let currentUser = '';
    try {
      const { stdout: whoami } = await exec('gh', ['api', 'user', '--jq', '.login'], { cwd: workspacePath });
      currentUser = whoami.trim();
    } catch {
      const response: PullRequestsResponse = { prs: [], error: 'gh_not_authenticated' };
      res.json({ pullRequests: response, branches: [] });
      return;
    }

    // Fetch authored PRs
    const authored: PullRequest[] = [];
    try {
      const { stdout } = await exec(
        'gh',
        ['pr', 'list', '--author', currentUser, '--state', 'open', '--limit', '30', '--json', fields],
        { cwd: workspacePath },
      );
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
      const { stdout } = await exec(
        'gh',
        ['pr', 'list', '--search', `review-requested:${currentUser}`, '--state', 'open', '--limit', '30', '--json', fields],
        { cwd: workspacePath },
      );
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

    // Deduplicate: if a PR appears in both, keep as 'author'
    const seen = new Set(authored.map((pr) => pr.number));
    const combined = [...authored, ...reviewing.filter((pr) => !seen.has(pr.number))];

    // Sort by updatedAt descending
    combined.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const pullRequests: PullRequestsResponse = { prs: combined };

    // Fetch branches for the workspace
    let branches: string[] = [];
    try {
      branches = await listBranches(workspacePath);
    } catch { /* not a git repo or git unavailable */ }

    res.json({
      pullRequests,
      branches,
      // activity and ciStatus will be populated once git.ts enhancements land:
      // activity: await getActivityFeed(workspacePath),
      // ciStatus: await getCiStatus(workspacePath),
    });
  });

  // -------------------------------------------------------------------------
  // GET /workspaces/settings — per-workspace settings
  // -------------------------------------------------------------------------
  router.get('/settings', async (req: Request, res: Response) => {
    const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;

    if (!workspacePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const config = getConfig();
    const resolved = path.resolve(workspacePath);
    const settings: WorkspaceSettings = config.workspaceSettings?.[resolved] ?? {};

    res.json(settings);
  });

  // -------------------------------------------------------------------------
  // PATCH /workspaces/settings — update per-workspace settings
  // -------------------------------------------------------------------------
  router.patch('/settings', async (req: Request, res: Response) => {
    const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;

    if (!workspacePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const resolved = path.resolve(workspacePath);
    const updates = req.body as Partial<WorkspaceSettings>;

    const config = getConfig();
    const current: WorkspaceSettings = config.workspaceSettings?.[resolved] ?? {};
    const merged: WorkspaceSettings = { ...current, ...updates };

    config.workspaceSettings = { ...config.workspaceSettings, [resolved]: merged };
    saveConfig(configPath, config);

    res.json(merged);
  });

  // -------------------------------------------------------------------------
  // GET /workspaces/ci-status — CI check results for a workspace + branch
  // -------------------------------------------------------------------------
  router.get('/ci-status', async (req: Request, res: Response) => {
    const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;
    const branch = typeof req.query.branch === 'string' ? req.query.branch : undefined;

    if (!workspacePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    // Stub: returns empty until getCiStatus is added to git.ts
    // When git.ts is enhanced:
    //   const status = await getCiStatus(workspacePath, branch);
    //   res.json(status);

    res.json({
      workspacePath,
      branch: branch ?? null,
      checks: [],
      // Will be populated once git.ts enhancement task lands
    });
  });

  // -------------------------------------------------------------------------
  // POST /workspaces/branch — switch branch for a workspace
  // -------------------------------------------------------------------------
  router.post('/branch', async (req: Request, res: Response) => {
    const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;

    if (!workspacePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const branch = body.branch;

    if (typeof branch !== 'string' || !branch) {
      res.status(400).json({ error: 'branch is required in request body' });
      return;
    }

    // Performs checkout until switchBranch is added to git.ts
    // When git.ts is enhanced:
    //   await switchBranch(workspacePath, branch);
    //   res.json({ path: workspacePath, branch });

    try {
      await exec('git', ['checkout', branch], { cwd: workspacePath });
      res.json({ path: workspacePath, branch });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : `Failed to switch to branch: ${branch}`,
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /workspaces/autocomplete — path prefix autocomplete
  // -------------------------------------------------------------------------
  router.get('/autocomplete', async (req: Request, res: Response) => {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';

    if (!prefix) {
      res.json({ suggestions: [] });
      return;
    }

    const expanded = prefix.startsWith('~')
      ? path.join(process.env.HOME ?? '~', prefix.slice(1))
      : prefix;

    let dirToRead: string;
    let partialName: string;

    if (expanded.endsWith('/') || expanded.endsWith(path.sep)) {
      // User typed a trailing slash — list immediate children of that dir
      dirToRead = expanded;
      partialName = '';
    } else {
      dirToRead = path.dirname(expanded);
      partialName = path.basename(expanded).toLowerCase();
    }

    let suggestions: string[] = [];
    try {
      const entries = await fs.promises.readdir(dirToRead, { withFileTypes: true });
      suggestions = entries
        .filter((e) => {
          if (!e.isDirectory()) return false;
          if (e.name.startsWith('.')) return false;
          if (!partialName) return true;
          return e.name.toLowerCase().startsWith(partialName);
        })
        .map((e) => path.join(dirToRead, e.name))
        .slice(0, 20); // cap results
    } catch {
      // Directory doesn't exist or permission denied — return empty
    }

    res.json({ suggestions });
  });

  return router;
}
