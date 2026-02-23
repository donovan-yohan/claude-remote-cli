import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const WORKTREE_DIRS = ['.worktrees', '.claude/worktrees'];

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
