import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execFileAsync = promisify(execFile);

export const WORKTREE_DIRS = ['.worktrees', '.claude/worktrees'];

export function isValidWorktreePath(worktreePath: string): boolean {
  const resolved = path.resolve(worktreePath);
  return WORKTREE_DIRS.some(function (dir) {
    return resolved.includes(path.sep + dir + path.sep);
  });
}

export interface ParsedWorktree {
  path: string;
  branch: string;
}

export interface ParsedWorktreeEntry {
  path: string;
  branch: string;
  isMain: boolean;
}

/**
 * Parse `git worktree list --porcelain` output into ALL entries (including main worktree).
 * Skips bare entries. Detached HEAD entries get empty branch string.
 */
export function parseAllWorktrees(stdout: string, repoPath: string): ParsedWorktreeEntry[] {
  const results: ParsedWorktreeEntry[] = [];
  const blocks = stdout.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';
    let bare = false;
    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9);
      if (line.startsWith('branch refs/heads/')) branch = line.slice(18);
      if (line === 'bare') bare = true;
    }
    if (!wtPath || bare) continue;
    results.push({ path: wtPath, branch, isMain: wtPath === repoPath });
  }
  return results;
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Skips the main worktree (matching repoPath) and bare/detached entries.
 */
export function parseWorktreeListPorcelain(stdout: string, repoPath: string): ParsedWorktree[] {
  const results: ParsedWorktree[] = [];
  const blocks = stdout.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';
    let bare = false;
    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9);
      if (line.startsWith('branch refs/heads/')) branch = line.slice(18);
      if (line === 'bare') bare = true;
    }
    // Skip the main worktree (repo root), bare repos, and detached HEAD
    if (!wtPath || wtPath === repoPath || bare || !branch) continue;
    results.push({ path: wtPath, branch });
  }
  return results;
}

export class WorktreeWatcher extends EventEmitter {
  private _watchers: fs.FSWatcher[];
  private _debounceTimer: ReturnType<typeof setTimeout> | null;

  constructor() {
    super();
    this._watchers = [];
    this._debounceTimer = null;
  }

  rebuild(rootDirs: string[]): void {
    this._closeAll();

    for (const rootDir of rootDirs) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const repoPath = path.join(rootDir, entry.name);
        if (!fs.existsSync(path.join(repoPath, '.git'))) continue;
        this._watchRepo(repoPath);
      }
    }
  }

  private _watchRepo(repoPath: string): void {
    let anyWatched = false;
    for (const dir of WORKTREE_DIRS) {
      const worktreeDir = path.join(repoPath, dir);
      if (fs.existsSync(worktreeDir)) {
        this._addWatch(worktreeDir);
        anyWatched = true;
      }
    }
    if (!anyWatched) {
      // Watch repo root so we detect when either dir is first created
      this._addWatch(repoPath);
    }
  }

  private _addWatch(dirPath: string): void {
    try {
      const watcher = fs.watch(dirPath, { persistent: false }, () => {
        this._debouncedEmit();
      });
      watcher.on('error', () => {});
      this._watchers.push(watcher);
    } catch (_) {}
  }

  private _debouncedEmit(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.emit('worktrees-changed');
    }, 500);
  }

  private _closeAll(): void {
    for (const w of this._watchers) {
      try { w.close(); } catch (_) {}
    }
    this._watchers = [];
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  close(): void {
    this._closeAll();
  }
}

export type BranchChangeCallback = (cwdPath: string, newBranch: string) => void;

export class BranchWatcher {
  private _watchers: fs.FSWatcher[] = [];
  private _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _lastBranch = new Map<string, string>();
  private _callback: BranchChangeCallback;

  constructor(callback: BranchChangeCallback) {
    this._callback = callback;
  }

  rebuild(rootDirs: string[]): void {
    this._closeAll();

    for (const rootDir of rootDirs) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const repoPath = path.join(rootDir, entry.name);
        if (!fs.existsSync(path.join(repoPath, '.git'))) continue;
        this._watchRepoHeads(repoPath);
      }
    }
  }

  private _watchRepoHeads(repoPath: string): void {
    // Watch main repo HEAD
    const mainHead = path.join(repoPath, '.git', 'HEAD');
    this._watchHeadFile(mainHead, repoPath);

    // Watch worktree HEADs: <repoPath>/.git/worktrees/*/HEAD
    const worktreesGitDir = path.join(repoPath, '.git', 'worktrees');
    let wtEntries: fs.Dirent[];
    try {
      wtEntries = fs.readdirSync(worktreesGitDir, { withFileTypes: true });
    } catch (_) {
      return; // No worktrees
    }

    for (const entry of wtEntries) {
      if (!entry.isDirectory()) continue;
      const wtGitDir = path.join(worktreesGitDir, entry.name);
      const headFile = path.join(wtGitDir, 'HEAD');
      if (!fs.existsSync(headFile)) continue;

      // Map worktree git dir back to checkout path via gitdir file
      const gitdirFile = path.join(wtGitDir, 'gitdir');
      let checkoutPath: string;
      try {
        const gitdirContent = fs.readFileSync(gitdirFile, 'utf-8').trim();
        // gitdir contains <checkoutPath>/.git — strip the /.git suffix
        checkoutPath = gitdirContent.replace(/\/\.git\/?$/, '');
      } catch (_) {
        continue;
      }

      this._watchHeadFile(headFile, checkoutPath);
    }
  }

  private _watchHeadFile(headPath: string, cwdPath: string): void {
    // Seed initial branch to avoid false-positive on first change detection
    try {
      const content = fs.readFileSync(headPath, 'utf-8').trim();
      const match = content.match(/^ref: refs\/heads\/(.+)$/);
      if (match) this._lastBranch.set(cwdPath, match[1]!);
    } catch (_) {}

    try {
      const watcher = fs.watch(headPath, { persistent: false }, () => {
        this._debouncedCheck(cwdPath);
      });
      watcher.on('error', () => {});
      this._watchers.push(watcher);
    } catch (_) {}
  }

  private _debouncedCheck(cwdPath: string): void {
    const existing = this._debounceTimers.get(cwdPath);
    if (existing) clearTimeout(existing);

    this._debounceTimers.set(cwdPath, setTimeout(() => {
      this._debounceTimers.delete(cwdPath);
      this._readAndEmit(cwdPath);
    }, 300));
  }

  private async _readAndEmit(cwdPath: string): Promise<void> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cwdPath });
      const newBranch = stdout.trim();
      const lastBranch = this._lastBranch.get(cwdPath);
      if (newBranch && newBranch !== lastBranch) {
        this._lastBranch.set(cwdPath, newBranch);
        this._callback(cwdPath, newBranch);
      }
    } catch (_) {
      // Non-fatal — repo may be in detached HEAD or mid-rebase
    }
  }

  private _closeAll(): void {
    for (const w of this._watchers) {
      try { w.close(); } catch (_) {}
    }
    this._watchers = [];
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
    this._lastBranch.clear();
  }

  close(): void {
    this._closeAll();
  }
}
