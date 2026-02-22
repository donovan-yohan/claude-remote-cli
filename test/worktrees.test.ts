import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('DELETE /worktrees validation', () => {
  it('should reject paths not inside .claude/worktrees/', () => {
    // Validate the path check logic used by the endpoint
    const worktreePath = '/some/random/path';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.claude' + sep + 'worktrees' + sep);
    assert.equal(inside, false);
  });

  it('should accept paths inside .claude/worktrees/', () => {
    const worktreePath = '/Users/me/code/repo/.claude/worktrees/my-worktree';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.claude' + sep + 'worktrees' + sep);
    assert.equal(inside, true);
  });

  it('should not match partial .claude/worktrees paths', () => {
    const worktreePath = '/Users/me/.claude/worktrees-fake/foo';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.claude' + sep + 'worktrees' + sep);
    assert.equal(inside, false);
  });
});
