import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function isValidWorktreePath(worktreePath: string): boolean {
  const sep = '/';
  return worktreePath.includes(sep + '.worktrees' + sep)
    || worktreePath.includes(sep + '.claude/worktrees' + sep);
}

describe('worktree directories constant', () => {
  it('should include both .worktrees and .claude/worktrees', async () => {
    const { WORKTREE_DIRS } = await import('../server/watcher.js');
    assert.deepEqual(WORKTREE_DIRS, ['.worktrees', '.claude/worktrees']);
  });
});

describe('worktree scanning paths', () => {
  it('should check both .worktrees and .claude/worktrees directories', async () => {
    const { WORKTREE_DIRS } = await import('../server/watcher.js');
    const repoPath = '/Users/me/code/repo';
    const scannedPaths = WORKTREE_DIRS.map(d => repoPath + '/' + d);
    assert.ok(scannedPaths.includes(repoPath + '/.worktrees'));
    assert.ok(scannedPaths.includes(repoPath + '/.claude/worktrees'));
  });
});

describe('DELETE /worktrees validation', () => {
  it('should reject paths not inside any worktree directory', () => {
    assert.equal(isValidWorktreePath('/some/random/path'), false);
  });

  it('should accept paths inside .worktrees/', () => {
    assert.equal(isValidWorktreePath('/Users/me/code/repo/.worktrees/my-worktree'), true);
  });

  it('should accept paths inside .claude/worktrees/', () => {
    assert.equal(isValidWorktreePath('/Users/me/code/repo/.claude/worktrees/my-worktree'), true);
  });

  it('should not match partial .worktrees paths', () => {
    assert.equal(isValidWorktreePath('/Users/me/.worktrees-fake/foo'), false);
  });
});

describe('branch name to directory name', () => {
  it('should replace slashes with dashes', () => {
    const branchName = 'dy/feat/my-feature';
    const dirName = branchName.replace(/\//g, '-');
    assert.equal(dirName, 'dy-feat-my-feature');
  });

  it('should leave flat branch names unchanged', () => {
    const branchName = 'my-feature';
    const dirName = branchName.replace(/\//g, '-');
    assert.equal(dirName, 'my-feature');
  });
});

describe('CLI worktree arg parsing', () => {
  it('should extract --yolo and leave other args intact', () => {
    const args = ['add', './.worktrees/my-feature', '-b', 'my-feature', '--yolo'];
    const hasYolo = args.includes('--yolo');
    const gitArgs = args.filter(a => a !== '--yolo');
    assert.equal(hasYolo, true);
    assert.deepEqual(gitArgs, ['add', './.worktrees/my-feature', '-b', 'my-feature']);
  });

  it('should detect missing path for add and use default', () => {
    // args: ['add', '-b', 'my-feature'] — no positional path (first arg after 'add' starts with '-')
    const args = ['add', '-b', 'my-feature'];
    const subArgs = args.slice(1); // after 'add'
    const hasPositionalPath = subArgs.length > 0 && !subArgs[0]!.startsWith('-');
    assert.equal(hasPositionalPath, false);
  });

  it('should detect path when provided for add', () => {
    const args = ['add', './my-path', '-b', 'my-feature'];
    const subArgs = args.slice(1);
    const hasPositionalPath = subArgs.length > 0 && !subArgs[0]!.startsWith('-');
    assert.equal(hasPositionalPath, true);
    assert.equal(subArgs[0], './my-path');
  });
});
