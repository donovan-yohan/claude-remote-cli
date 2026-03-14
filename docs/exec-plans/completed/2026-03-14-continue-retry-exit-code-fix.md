# Continue Retry Exit Code Fix

> **Status**: Completed | **Created**: 2026-03-14 | **Completed**: 2026-03-14
> **Bug Analysis**: `docs/bug-analyses/2026-03-14-continue-retry-tmux-exit-code-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-14 | Design | Remove `exitCode !== 0` from retry condition | Tmux masks inner exit codes to 0; 3-second timing window is sufficient heuristic |

## Progress

- [x] Task 1: Add failing test for exit-code-0 retry
- [x] Task 2: Fix retry condition and verify

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

**Goal:** Fix `--continue` retry so it fires regardless of exit code, preventing session death when tmux (or claude CLI) exits with code 0.

**Architecture:** Single-line condition change in `sessions.ts:186` plus a new test case that verifies retry fires when process exits with code 0 (simulating tmux behavior).

**Tech Stack:** TypeScript, node:test, node-pty

---

### Task 1: Add failing test for exit-code-0 retry

**Files:**
- Modify: `test/sessions.test.ts:441-477` (add new test alongside existing retry tests)

- [ ] **Step 1: Write the failing test**

Add a new test after the existing "session survives after continue-arg retry" test (line 477). This test uses `/bin/sh -c 'exit 0'` to simulate a process that exits with code 0 within the 3-second window — matching tmux behavior.

```typescript
it('retries when continue-arg process exits quickly with code 0 (tmux behavior)', (_, done) => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/sh',
    args: ['-c', 'exit 0', ...sessions.AGENT_CONTINUE_ARGS.claude],
  });
  createdIds.push(result.id);

  const session = sessions.get(result.id);
  assert.ok(session);

  session.onPtyReplacedCallbacks.push((newPty) => {
    assert.ok(newPty, 'should receive new PTY even with exit code 0');
    assert.strictEqual(session.pty, newPty, 'session.pty should be updated');
    const stillExists = sessions.get(result.id);
    assert.ok(stillExists, 'session should still exist after retry');
    done();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A 5 'retries when continue-arg process exits quickly with code 0'`

Expected: FAIL — the test times out because `onPtyReplacedCallbacks` is never called (the retry condition `exitCode !== 0` prevents retry when exit code is 0).

### Task 2: Fix retry condition and verify

**Files:**
- Modify: `server/sessions.ts:186` (remove `exitCode !== 0` from condition)

- [ ] **Step 1: Apply the fix**

Change line 186 in `server/sessions.ts`:

```typescript
// Before:
if (canRetry && (Date.now() - spawnTime) < 3000 && exitCode !== 0) {

// After:
if (canRetry && (Date.now() - spawnTime) < 3000) {
```

- [ ] **Step 2: Run all tests to verify**

Run: `npm test`

Expected: ALL tests pass, including the new exit-code-0 test and the two existing retry tests.

- [ ] **Step 3: Commit**

```bash
git add server/sessions.ts test/sessions.test.ts
git commit -m "fix: --continue retry fires regardless of exit code

Tmux masks inner process exit codes to 0, so the retry condition
exitCode !== 0 never triggers. Remove the exit code check — the
3-second timing window is sufficient to detect start failures."
```

---

## Outcomes & Retrospective

**What worked:**
- Bug analysis correctly identified tmux exit code masking as the root cause
- TDD flow: failing test confirmed the issue before the fix was applied
- Single-line fix with high confidence due to precise diagnosis
- Review caught a significant documentation gap (missing comment explaining the intentional behavior)

**What didn't:**
- Nothing — this was a clean, focused fix

**Learnings to codify:**
- Tmux client always exits with code 0 regardless of inner command exit code — documented in DESIGN.md and inline comment
- When wrapping processes (tmux, screen, etc.), timing-based heuristics are more reliable than exit code checks
