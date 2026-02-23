import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('DELETE /worktrees validation', () => {
  it('should reject paths not inside .worktrees/', () => {
    const worktreePath = '/some/random/path';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, false);
  });

  it('should accept paths inside .worktrees/', () => {
    const worktreePath = '/Users/me/code/repo/.worktrees/my-worktree';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, true);
  });

  it('should not match partial .worktrees paths', () => {
    const worktreePath = '/Users/me/.worktrees-fake/foo';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, false);
  });

  it('should reject old .claude/worktrees/ paths', () => {
    const worktreePath = '/Users/me/code/repo/.claude/worktrees/my-worktree';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, false);
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
