import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WORKTREE_DIRS, isValidWorktreePath, parseWorktreeListPorcelain } from '../server/watcher.js';

describe('worktree directories constant', () => {
  it('should include both .worktrees and .claude/worktrees', () => {
    assert.deepEqual(WORKTREE_DIRS, ['.worktrees', '.claude/worktrees']);
  });
});

describe('isValidWorktreePath', () => {
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

describe('parseWorktreeListPorcelain', () => {
  const repoPath = '/Users/me/code/my-repo';

  it('should parse a single worktree entry', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/code/my-repo/.worktrees/feat-branch',
      'HEAD def456',
      'branch refs/heads/feat/branch',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.path, '/Users/me/code/my-repo/.worktrees/feat-branch');
    assert.equal(result[0]!.branch, 'feat/branch');
  });

  it('should parse multiple worktree entries', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/code/my-repo/.worktrees/feat-a',
      'HEAD def456',
      'branch refs/heads/feat/a',
      '',
      'worktree /Users/me/other-path/extend-cli',
      'HEAD 789abc',
      'branch refs/heads/dy/feat/worktree-isolation',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.path, '/Users/me/code/my-repo/.worktrees/feat-a');
    assert.equal(result[0]!.branch, 'feat/a');
    assert.equal(result[1]!.path, '/Users/me/other-path/extend-cli');
    assert.equal(result[1]!.branch, 'dy/feat/worktree-isolation');
  });

  it('should skip the main worktree (repo root)', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 0);
  });

  it('should skip bare entries', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /some/bare/repo',
      'HEAD def456',
      'bare',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 0);
  });

  it('should skip detached HEAD worktrees (no branch line)', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/code/my-repo/.worktrees/detached',
      'HEAD def456',
      'detached',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 0);
  });

  it('should handle empty output', () => {
    const result = parseWorktreeListPorcelain('', repoPath);
    assert.equal(result.length, 0);
  });

  it('should discover worktrees at arbitrary paths outside .worktrees/', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /completely/different/path/project-checkout',
      'HEAD def456',
      'branch refs/heads/feature/my-feature',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.path, '/completely/different/path/project-checkout');
    assert.equal(result[0]!.branch, 'feature/my-feature');
  });

  it('should handle deeply nested branch names', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/code/my-repo/.worktrees/dy-feat-deep-nesting',
      'HEAD def456',
      'branch refs/heads/dy/feat/deep/nesting/here',
      '',
    ].join('\n');

    const result = parseWorktreeListPorcelain(stdout, repoPath);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.branch, 'dy/feat/deep/nesting/here');
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
