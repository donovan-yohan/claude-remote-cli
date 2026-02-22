import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

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
    const worktreeDir = path.join(repoPath, '.claude', 'worktrees');
    if (fs.existsSync(worktreeDir)) {
      this._addWatch(worktreeDir);
    } else {
      const claudeDir = path.join(repoPath, '.claude');
      if (fs.existsSync(claudeDir)) {
        this._addWatch(claudeDir);
      }
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
