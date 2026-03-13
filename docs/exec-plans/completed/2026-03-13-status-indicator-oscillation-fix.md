# Status Indicator Oscillation Fix

> **Status**: Complete | **Created**: 2026-03-13 | **Last Updated**: 2026-03-13
> **Bug Analysis**: `docs/bug-analyses/2026-03-13-status-indicator-oscillation-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-13 | Design | Cooldown-based attention suppression (30s) | Simplest fix that solves oscillation without backend changes. Standard notification pattern. |
| 2026-03-13 | Design | Frontend-only fix, no backend changes | Backend idle timer works correctly; the issue is re-triggering attention after dismissal |
| 2026-03-13 | Design | No content-based output filtering | Distinguishing PTY noise from meaningful output would require content parsing — out of scope for this bug fix |

## Progress

- [x] Task 1: Add cooldown-based attention suppression to sessions.svelte.ts
- [x] Task 2: Prune stale cooldowns in refreshAll
- [x] Task 3: Build and verify
- [ ] Task 4: Manual verification

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

## Chunk 1: Cooldown Implementation

### Task 1: Add cooldown-based attention suppression to sessions.svelte.ts

**Files:**
- Modify: `frontend/src/lib/state/sessions.svelte.ts`

**Approach:** Add a `dismissedSessions` record that maps `sessionId → dismissal timestamp`. When `clearAttention()` is called, record the current time. In `setAttention()`, skip setting attention if the session is within the cooldown window (30 seconds). This prevents the oscillation while still re-alerting after a reasonable delay.

- [ ] **Step 1: Add dismissedSessions state**

Add after the `attentionSessions` declaration (line 8):

```typescript
let dismissedSessions = $state<Record<string, number>>({});
```

- [ ] **Step 2: Update setAttention to check cooldown**

Replace the `setAttention` function (lines 63-74) with:

```typescript
const ATTENTION_COOLDOWN_MS = 30_000;

export function setAttention(sessionId: string, idle: boolean): void {
  // Update the idle flag on the session object so getSessionStatus() reflects
  // the real-time state without waiting for a full refreshAll() round-trip.
  const session = sessions.find(s => s.id === sessionId);
  if (session) session.idle = idle;

  if (idle && sessionId !== activeSessionId && session?.type !== 'terminal') {
    const dismissedAt = dismissedSessions[sessionId];
    if (dismissedAt && Date.now() - dismissedAt < ATTENTION_COOLDOWN_MS) {
      // Within cooldown window — don't re-trigger attention
      return;
    }
    delete dismissedSessions[sessionId];
    attentionSessions[sessionId] = true;
  } else {
    delete attentionSessions[sessionId];
  }
}
```

- [ ] **Step 3: Update clearAttention to record dismissal timestamp**

Replace the `clearAttention` function (lines 76-78) with:

```typescript
export function clearAttention(sessionId: string): void {
  delete attentionSessions[sessionId];
  dismissedSessions[sessionId] = Date.now();
}
```

### Task 2: Prune stale cooldowns in refreshAll

**Files:**
- Modify: `frontend/src/lib/state/sessions.svelte.ts`

- [ ] **Step 1: Add cleanup for dismissedSessions in refreshAll**

Add after the existing attention prune loop (after line 40, inside the `refreshAll` function):

```typescript
    // Prune stale dismissed cooldowns
    for (const id of Object.keys(dismissedSessions)) {
      if (!activeIds.has(id)) delete dismissedSessions[id];
    }
```

### Task 3: Build and verify

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (these are backend tests; no frontend test changes needed)

### Task 4: Manual verification

- [ ] **Step 1: Start the server and test the fix**

1. Start `claude-remote-cli`
2. Open a Claude session (worktree type)
3. Let it run and switch to a different session
4. Observe: first session shows flashing orange (attention) — correct
5. Click on it — attention clears — correct
6. Switch away again
7. Verify: session does NOT immediately flash orange again (cooldown active)
8. Wait 30+ seconds, then observe: session shows attention again if it went through an active→idle cycle — correct

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/state/sessions.svelte.ts
git commit -m "fix: prevent status indicator oscillation with attention cooldown

Add 30-second cooldown after user dismisses attention for a session.
Prevents PTY background noise from causing rapid attention re-triggering
that would produce spurious notifications."
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Cooldown-based suppression is a clean, minimal fix that doesn't require backend changes
- Bug analysis correctly identified the two interacting root causes

**What didn't:**
- N/A — straightforward fix

**Learnings to codify:**
- Frontend attention state should use cooldown/debounce patterns to avoid notification spam from PTY background noise
