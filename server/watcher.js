'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class WorktreeWatcher extends EventEmitter {
  constructor() {
    super();
    this._watchers = [];
    this._debounceTimer = null;
  }

  rebuild(rootDirs) {
    this._closeAll();

    for (const rootDir of rootDirs) {
      let entries;
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

  _watchRepo(repoPath) {
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

  _addWatch(dirPath) {
    try {
      const watcher = fs.watch(dirPath, { persistent: false }, () => {
        this._debouncedEmit();
      });
      watcher.on('error', () => {});
      this._watchers.push(watcher);
    } catch (_) {}
  }

  _debouncedEmit() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.emit('worktrees-changed');
    }, 500);
  }

  _closeAll() {
    for (const w of this._watchers) {
      try { w.close(); } catch (_) {}
    }
    this._watchers = [];
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  close() {
    this._closeAll();
  }
}

module.exports = { WorktreeWatcher };
