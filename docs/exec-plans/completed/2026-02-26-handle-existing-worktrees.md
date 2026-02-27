# Handle Existing Worktrees Implementation Plan

> **Status**: Completed | **Created**: 2026-02-26 | **Completed**: 2026-02-26
> **Design Doc**: `docs/design-docs/2026-02-26-handle-existing-worktrees-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-26 | Design | Auto-redirect to existing worktree on branch conflict | Users expect seamless UX, not raw git errors |
| 2026-02-26 | Design | Main worktree → repo session, other worktree → worktree session | Auto-detect session type based on worktree location |
| 2026-02-26 | Design | Git-based delete validation (replace path-pattern check) | Allow managing worktrees at arbitrary paths |
| 2026-02-26 | Design | Full management of arbitrary-path worktrees | Users want view + open + delete regardless of path |
| 2026-02-26 | Plan | Auto-switch sidebar tab when redirect changes session type | User expects to see the created session regardless of tab |
| 2026-02-26 | Retrospective | Plan completed — 5/5 tasks, 0 surprises, 0 drift | Clean execution, all tests pass |

## Progress

- [x] Task 1: Add `parseAllWorktrees` helper to `server/watcher.ts` _(completed 2026-02-26)_
- [x] Task 2: Add branch conflict detection to `POST /sessions` _(completed 2026-02-26)_
- [x] Task 3: Replace `isValidWorktreePath` with git-based validation in `DELETE /worktrees` _(completed 2026-02-26)_
- [x] Task 4: Frontend tab auto-switch on redirect to repo session _(completed 2026-02-26)_
- [x] Task 5: Build and verify all tests pass _(completed 2026-02-26)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Add `parseAllWorktrees` helper to `server/watcher.ts`

**Files:**
- Modify: `server/watcher.ts:14-41`
- Test: `test/worktrees.test.ts`

**Step 1: Write the failing tests**

In `test/worktrees.test.ts`, add a new `describe` block after the existing `parseWorktreeListPorcelain` tests (after line 171). Import `parseAllWorktrees` alongside existing imports.

Update the import at line 3:

```typescript
import { WORKTREE_DIRS, isValidWorktreePath, parseWorktreeListPorcelain, parseAllWorktrees } from '../server/watcher.js';
```

Add tests:

```typescript
describe('parseAllWorktrees', () => {
  const repoPath = '/Users/me/code/my-repo';

  it('should include the main worktree with isMain=true', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
    ].join('\n');

    const result = parseAllWorktrees(stdout, repoPath);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.path, repoPath);
    assert.equal(result[0]!.branch, 'main');
    assert.equal(result[0]!.isMain, true);
  });

  it('should mark non-main worktrees with isMain=false', () => {
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

    const result = parseAllWorktrees(stdout, repoPath);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.isMain, true);
    assert.equal(result[1]!.isMain, false);
    assert.equal(result[1]!.path, '/Users/me/code/my-repo/.worktrees/feat-branch');
    assert.equal(result[1]!.branch, 'feat/branch');
  });

  it('should still skip bare entries', () => {
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

    const result = parseAllWorktrees(stdout, repoPath);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.isMain, true);
  });

  it('should include detached HEAD entries with empty branch', () => {
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

    const result = parseAllWorktrees(stdout, repoPath);
    assert.equal(result.length, 2);
    assert.equal(result[1]!.branch, '');
  });

  it('should handle empty output', () => {
    const result = parseAllWorktrees('', repoPath);
    assert.equal(result.length, 0);
  });

  it('should find worktree by branch name', () => {
    const stdout = [
      `worktree ${repoPath}`,
      'HEAD abc123',
      'branch refs/heads/dy/feat/worktree-isolation',
      '',
      'worktree /Users/me/code/my-repo/.worktrees/feat-a',
      'HEAD def456',
      'branch refs/heads/feat/a',
      '',
    ].join('\n');

    const result = parseAllWorktrees(stdout, repoPath);
    const match = result.find(wt => wt.branch === 'dy/feat/worktree-isolation');
    assert.ok(match);
    assert.equal(match!.path, repoPath);
    assert.equal(match!.isMain, true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/test/worktrees.test.js`
Expected: FAIL — `parseAllWorktrees` is not exported

**Step 3: Write the implementation**

In `server/watcher.ts`, add a new interface and function after `ParsedWorktree` (after line 17):

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/test/worktrees.test.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/watcher.ts test/worktrees.test.ts
git commit -m "feat: add parseAllWorktrees helper that includes main worktree"
```

---

### Task 2: Add branch conflict detection to `POST /sessions`

**Files:**
- Modify: `server/index.ts:591-679` (POST /sessions handler)

**Step 1: Add the import**

At the top of `server/index.ts`, update the import from `./watcher.js` to include `parseAllWorktrees`:

```typescript
import { WorktreeWatcher, WORKTREE_DIRS, isValidWorktreePath, parseWorktreeListPorcelain, parseAllWorktrees } from './watcher.js';
```

**Step 2: Add branch-conflict detection in the creation flow**

In `POST /sessions`, after `branchExists` is determined (after line 661), add conflict detection before the `git worktree add` calls. Replace the block from line 663 to line 669:

```typescript
        if (branchName && branchExists) {
          // Check if branch is already checked out in an existing worktree
          const { stdout: wtListOut } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
          const allWorktrees = parseAllWorktrees(wtListOut, repoPath);
          const existingWt = allWorktrees.find(wt => wt.branch === branchName);

          if (existingWt) {
            // Branch already checked out — redirect to the existing worktree
            if (existingWt.isMain) {
              // Main worktree → create a repo session
              const existingRepoSession = sessions.findRepoSession(repoPath);
              if (existingRepoSession) {
                res.status(409).json({ error: 'A session already exists for this repo', sessionId: existingRepoSession.id });
                return;
              }

              const repoSession = sessions.create({
                type: 'repo',
                repoName: name,
                repoPath,
                cwd: repoPath,
                root,
                displayName: name,
                command: config.claudeCommand,
                args: baseArgs,
              });

              res.status(201).json(repoSession);
              return;
            } else {
              // Another worktree → create a worktree session with --continue
              cwd = existingWt.path;
              sessionRepoPath = existingWt.path;
              worktreeName = existingWt.path.split('/').pop() || '';
              args = ['--continue', ...baseArgs];

              const displayNameVal = branchName || worktreeName;

              const session = sessions.create({
                type: 'worktree',
                repoName: name,
                repoPath: sessionRepoPath,
                cwd,
                root,
                worktreeName,
                branchName: branchName || worktreeName,
                displayName: displayNameVal,
                command: config.claudeCommand,
                args,
                configPath: CONFIG_PATH,
              });

              writeMeta(CONFIG_PATH, {
                worktreePath: sessionRepoPath,
                displayName: displayNameVal,
                lastActivity: new Date().toISOString(),
                branchName: branchName || worktreeName,
              });

              res.status(201).json(session);
              return;
            }
          }

          await execFileAsync('git', ['worktree', 'add', targetDir, resolvedBranch], { cwd: repoPath });
        } else if (branchName) {
```

**Step 3: Run tests to verify nothing is broken**

Run: `npm run build && node --test dist/test/worktrees.test.js`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: auto-redirect to existing worktree on branch conflict"
```

---

### Task 3: Replace `isValidWorktreePath` with git-based validation in `DELETE /worktrees`

**Files:**
- Modify: `server/index.ts:527-589` (DELETE /worktrees handler)

**Step 1: Replace the path validation**

In `DELETE /worktrees`, replace the `isValidWorktreePath` check (lines 535-538) with a git-based validation:

Replace:
```typescript
    if (!isValidWorktreePath(worktreePath)) {
      res.status(400).json({ error: 'Path is not inside a worktree directory' });
      return;
    }
```

With:
```typescript
    // Validate the path is a real git worktree (not the main worktree)
    try {
      const { stdout: wtListOut } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
      const allWorktrees = parseAllWorktrees(wtListOut, repoPath);
      const isKnownWorktree = allWorktrees.some(wt => wt.path === path.resolve(worktreePath) && !wt.isMain);
      if (!isKnownWorktree) {
        res.status(400).json({ error: 'Path is not a recognized git worktree' });
        return;
      }
    } catch {
      // If git worktree list fails, fall back to the directory-name check
      if (!isValidWorktreePath(worktreePath)) {
        res.status(400).json({ error: 'Path is not inside a worktree directory' });
        return;
      }
    }
```

Note: The handler also needs to become `async` if it isn't already. Check the existing signature — it already is `async` (line 528).

**Step 2: Run tests to verify nothing is broken**

Run: `npm run build && node --test dist/test/worktrees.test.js`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: git-based worktree validation for delete (supports arbitrary paths)"
```

---

### Task 4: Frontend tab auto-switch on redirect to repo session

**Files:**
- Modify: `frontend/src/components/dialogs/NewSessionDialog.svelte:151-196`

When the user is on the "worktrees" tab and creates a session, but the backend returns a repo-type session (because the branch was already checked out in the main worktree), the frontend should switch to the "repos" tab so the new session is visible.

**Step 1: Update handleSubmit to check session type and switch tab**

In `NewSessionDialog.svelte`, the `handleSubmit()` function at line 180-184 currently does:

```typescript
      dialogEl.close();
      await refreshAll();
      if (session?.id) {
        onSessionCreated?.(session.id);
      }
```

Replace with:

```typescript
      dialogEl.close();
      await refreshAll();
      if (session?.id) {
        // If backend redirected a worktree request to a repo session,
        // switch to the repos tab so the user can see it
        if (activeTab === 'worktrees' && session.type === 'repo') {
          ui.activeTab = 'repos';
        }
        onSessionCreated?.(session.id);
      }
```

This requires importing `ui` — check if it's already imported. Look at the script block imports.

**Step 2: Verify the import**

Check that `NewSessionDialog.svelte` already imports `ui` from the state module. If not, add:

```typescript
import { getUi } from '../lib/state/ui.svelte.js';
const ui = getUi();
```

**Step 3: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/dialogs/NewSessionDialog.svelte
git commit -m "feat: auto-switch to repos tab when worktree redirects to repo session"
```

---

### Task 5: Build and verify all tests pass

**Files:**
- None (verification only)

**Step 1: Full build**

Run: `npm run build`
Expected: No errors

**Step 2: Full test suite**

Run: `npm test`
Expected: ALL PASS (svelte-check + tsc + node --test)

**Step 3: Verify no regressions**

Check that the existing `isValidWorktreePath` tests still pass (they test internal function behavior, not the endpoint, so they remain valid).

**Step 4: Final commit if needed**

If any build/lint fixes were needed:
```bash
git add -A
git commit -m "fix: address build issues from worktree handling changes"
```

---

## Outcomes & Retrospective

**What worked:**
- Clean execution — 0 surprises, 0 drift across all 5 tasks
- Parallel dispatch of independent tasks (Task 1 + Task 4) saved time
- Sequential dispatch of Tasks 2 and 3 (both editing server/index.ts) avoided merge conflicts

**What didn't:**
- Nothing notable — straightforward implementation

**Learnings to codify:**
- `parseAllWorktrees` as a reusable helper pattern: include main worktree with `isMain` flag rather than duplicating parsing logic
- Git-based validation (`git worktree list`) is more robust than path-pattern checks for worktree operations
