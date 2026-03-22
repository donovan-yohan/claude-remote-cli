import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { BranchWatcher } from '../server/watcher.js';

function makeTempGitRepo(): string {
  // Resolve symlinks (macOS /var → /private/var) so paths match git output
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'branch-watcher-test-')));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('BranchWatcher', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    cleanups.length = 0;
  });

  it('detects branch change via HEAD file write', async () => {
    const repoDir = makeTempGitRepo();
    const parentDir = path.dirname(repoDir);
    cleanups.push(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const events: Array<{ cwdPath: string; newBranch: string }> = [];
    const watcher = new BranchWatcher((cwdPath, newBranch) => {
      events.push({ cwdPath, newBranch });
    });
    cleanups.push(() => watcher.close());

    watcher.rebuild([parentDir]);

    // Let fs.watch initialize
    await new Promise(resolve => setTimeout(resolve, 200));

    // Create the branch first, then simulate checkout by writing HEAD directly
    // (more deterministic than git checkout which uses lock+rename)
    execFileSync('git', ['branch', 'feature-test'], { cwd: repoDir });
    const headPath = path.join(repoDir, '.git', 'HEAD');
    fs.writeFileSync(headPath, 'ref: refs/heads/feature-test\n');

    // Wait for debounce (300ms) + processing
    await new Promise(resolve => setTimeout(resolve, 800));

    assert.ok(events.length > 0, 'Expected at least one branch change event');
    const lastEvent = events[events.length - 1]!;
    assert.equal(lastEvent.cwdPath, repoDir);
    assert.equal(lastEvent.newBranch, 'feature-test');
  });

  it('does not fire callback if branch did not change', async () => {
    const repoDir = makeTempGitRepo();
    const parentDir = path.dirname(repoDir);
    cleanups.push(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const events: Array<{ cwdPath: string; newBranch: string }> = [];
    const watcher = new BranchWatcher((cwdPath, newBranch) => {
      events.push({ cwdPath, newBranch });
    });
    cleanups.push(() => watcher.close());

    watcher.rebuild([parentDir]);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Touch the HEAD file without changing the branch content
    const headPath = path.join(repoDir, '.git', 'HEAD');
    const content = fs.readFileSync(headPath, 'utf-8');
    fs.writeFileSync(headPath, content);

    await new Promise(resolve => setTimeout(resolve, 800));

    assert.equal(events.length, 0, 'Should not fire callback when branch is unchanged');
  });

  it('closes cleanly', () => {
    const watcher = new BranchWatcher(() => {});
    watcher.close();
    // No error means success
  });
});
