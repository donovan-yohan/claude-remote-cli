# Bug Analysis: Idle-to-Attention Spurious Transition

> **Status**: Confirmed | **Date**: 2026-03-24
> **Severity**: High
> **Affected Area**: frontend/state/sessions.svelte.ts, server/pty-handler.ts idle timer, server/hooks.ts

## Symptoms
- Session shows "idle" (blue dot), user has already viewed it
- Without any new message or meaningful output, the dot transitions from blue to orange (attention)
- Occurs after the user has been away from the session for ~30+ seconds
- Happens even when Claude is genuinely idle and waiting for input with nothing new to show

## Reproduction Steps
1. Open a Claude session, let it complete a task (blue idle dot)
2. Click on it to view it — attention clears
3. Switch to a different session
4. Wait 30+ seconds (cooldown expiry)
5. Any PTY noise occurs (cursor positioning, terminal escape, tmux status refresh)
6. Observe: the idle session's dot goes from blue to orange without any new content

## Root Cause

Three interacting problems, all stemming from the absence of a formal state machine:

### Problem 1: The 30-second cooldown is a timer, not a semantic guard

The March 13 oscillation fix (see `2026-03-13-status-indicator-oscillation-bug-analysis.md`) added a `dismissedSessions` map with a 30-second cooldown. When the user views a session, `clearAttention()` records `dismissedSessions[id] = Date.now()`. For 30 seconds, `setAttention()` skips re-triggering.

But after 30 seconds, the cooldown expires. The system has no concept of "the user has seen this idle state" — only "don't bother the user for 30 seconds." After that window, any idle timer cycle re-triggers attention.

**`sessions.svelte.ts:143-150`** — the cooldown check:
```typescript
if (idle && sessionId !== activeSessionId && session?.type !== 'terminal') {
    const dismissedAt = dismissedSessions[sessionId];
    if (dismissedAt && Date.now() - dismissedAt < ATTENTION_COOLDOWN_MS) {
      return; // Within 30s — suppress
    }
    delete dismissedSessions[sessionId];
    attentionSessions[sessionId] = true; // After 30s — re-triggers!
}
```

### Problem 2: Idle timer cycles don't distinguish meaningful from spurious transitions

The backend idle timer (`pty-handler.ts:213-225`) fires on ANY PTY data, including invisible terminal control sequences. An idle session can cycle `idle→active→idle` from a single cursor repositioning escape sequence, producing a `session-idle-changed` event that looks identical to "Claude finished a task."

The frontend `setAttention()` guard at line 141 checks `session.agentState !== 'idle'`, but when the Stop hook has already set agentState to `'idle'`, this guard passes — allowing idle-based attention to fire.

### Problem 3: Multiple independent paths can set attention with no coordination

There are three uncoordinated paths that can set `attentionSessions[id] = true`:

| Path | Trigger | When it fires |
|------|---------|---------------|
| `setAttention(id, idle: true)` | Backend idle timer cycle | Every 5s silence after any PTY data |
| `setAgentState(id, 'waiting-for-input')` | Hook `idle_prompt` or parser reconciliation | When Claude prompts for input |
| `setAgentState(id, 'waiting-for-input')` | Parser override after 30s stale hooks | When parser re-detects `^> $` prompt |

Each path independently decides "this needs attention" without checking whether the user has already seen the session in this exact state. The parser reconciliation path (fires when hooks go stale after 30s) is particularly problematic — it re-detects the `^> $` prompt that was already visible when the user last viewed the session, triggering `setAgentState('waiting-for-input')` which sets attention.

### Combined effect

```
User views idle session → clearAttention → dismissedSessions[id] = now
  ... 30 seconds pass ...
ANY of:
  - PTY noise → idle timer reset → 5s later idle:true → setAttention → ORANGE
  - Parser reconciliation → waiting-for-input → setAgentState → ORANGE
  - Hook fires 'idle' (reconnect, etc.) → agentState='idle' → next idle cycle → ORANGE
```

The fundamental issue: **there is no formal state machine governing display status transitions.** The system has two independent signal sources (idle flag + agentState), one derived concept (attention), and three mutation paths with ad-hoc guards. This makes it impossible to enforce the invariant "a session the user has already seen in its current state should not re-trigger attention."

## Evidence
- `frontend/src/lib/state/sessions.svelte.ts:101`: `ATTENTION_COOLDOWN_MS = 30_000` — a 30-second timer, not semantic state
- `frontend/src/lib/state/sessions.svelte.ts:133-158`: `setAttention()` — no "seen state" tracking
- `frontend/src/lib/state/sessions.svelte.ts:111-131`: `setAgentState()` — independent attention-setting path
- `frontend/src/lib/state/sessions.svelte.ts:141`: Guard `session.agentState !== 'idle'` — passes when agentState IS 'idle', allowing idle-based attention
- `server/pty-handler.ts:213-225`: `resetIdleTimer()` fires on ALL PTY data including control sequences
- `server/pty-handler.ts:252-271`: Parser reconciliation overrides after 30s of stale hooks
- `server/hooks.ts:185`: Stop hook sets agentState to 'idle' — doesn't interact with attention
- Prior analysis: `2026-03-13-status-indicator-oscillation-bug-analysis.md` identified the same root problem; the 30s cooldown was a partial mitigation, not a fix

## Impact Assessment
- **User trust**: Users learn that orange dots are unreliable — "it's probably nothing" → they start ignoring genuine attention signals
- **Notification system**: Any push/desktop notification built on `attentionSessions` will produce spurious alerts every ~30 seconds per idle session
- **Multi-session workflows**: Users running 3-5 sessions see a constant stream of false orange dots, making it impossible to identify which sessions actually need attention
- **Regression of prior fix**: The March 13 oscillation fix reduced frequency from "every 5 seconds" to "every 30+ seconds" but didn't solve the fundamental problem

## Valid vs Invalid Attention Transitions for an Idle Session

**Valid (should trigger orange):**
- Session transitions `processing → idle/waiting-for-input` with NEW output the user hasn't seen
- Session hits a permission prompt
- Session encounters an error

**Invalid (should NOT trigger orange):**
- Session was already idle, user saw it, PTY noise caused idle timer to cycle — no new content
- Session was waiting-for-input, user saw it, parser reconciliation re-detects the same prompt
- Cooldown expired on a session that hasn't changed state since user last viewed it
- WebSocket reconnect re-emits the same idle state

The key invariant: **attention should only trigger when a session transitions to a state that contains content the user has not yet seen.**

## Recommended Fix Direction

### Architecture: Session Display State Machine

Replace the current ad-hoc attention tracking with a formal state machine that enforces valid transitions:

```
States:
  - running        (green dot — agent is processing)
  - unseen-idle    (orange dot — agent finished, user hasn't seen)
  - seen-idle      (blue dot — agent idle, user has viewed)
  - permission     (yellow dot — needs permission approval)

Valid transitions:
  running → unseen-idle    (agent stops/idles — attention!)
  running → permission     (tool needs approval)
  unseen-idle → seen-idle  (user views session)
  seen-idle → running      (user submits prompt or agent resumes)
  permission → running     (user approves/denies)
  permission → seen-idle   (user views and dismisses)

INVALID transitions (enforced by type system):
  seen-idle → unseen-idle  (NEVER — requires going through running first)
  unseen-idle → unseen-idle (idempotent — no re-trigger)
```

This state machine should be:
1. **Defined as a TypeScript discriminated union or enum** with a transition function
2. **The single source of truth** — `attentionSessions`, `dismissedSessions`, and the idle flag checks in `setAttention`/`setAgentState` all collapse into the state machine
3. **Driven by semantic events** (`agent-finished`, `user-viewed`, `user-submitted`) not PTY-level signals (`idle: true/false`)
4. **Enforced at the type level** — the transition function only accepts valid `(currentState, event) → newState` pairs

### Unified sidebar item type

Currently the sidebar renders three separate types — `SessionSummary` (active), `WorktreeInfo` (inactive worktree), `RepoInfo` (idle repo root) — through separate code paths with duplicated styling. This creates maintenance burden: branch names, display names, and visual consistency must be kept in sync across three rendering paths. The `defaultBranch` on `Workspace`/`RepoInfo` is the remote default (from `git symbolic-ref origin/HEAD`), not the currently checked-out branch, so idle repo roots show "master" even when a feature branch is checked out.

The state machine should be paired with a unified `SidebarItem` type that makes `inactive` just another display state:

```typescript
interface SidebarItem {
  // Identity
  id: string;               // sessionId (active) or path (inactive)
  kind: 'repo' | 'worktree';
  path: string;
  repoPath: string;

  // Display (shared across all states — always present)
  displayName: string;
  branchName: string;        // actual checked-out branch, not remote default
  lastActivity: string;

  // State machine
  displayState: 'running' | 'unseen-idle' | 'seen-idle' | 'permission' | 'inactive';

  // Only present when active (displayState !== 'inactive')
  session?: SessionSummary;
}
```

Benefits:
- **One rendering path, one set of styles** — no more `session-row.inactive` vs `status-dot--idle` duplication
- **Metadata survives active→inactive transitions** — display name and branch name are on the item, not on the session
- **`kind` governs operations, not display** — `'repo' | 'worktree'` controls context menu actions (delete worktree, resume, etc.), not how the item looks
- **Branch name accuracy** — repo roots read the actual checked-out branch (`git symbolic-ref --short HEAD`) instead of the remote default
- **`inactive` is a display state, not a type boundary** — no separate `WorktreeInfo`/`RepoInfo` rendering logic

### Specific changes needed:
1. Define `SidebarItem` as a unified frontend type with a `displayState` field governed by the state machine
2. Replace `attentionSessions` + `dismissedSessions` + inline guards with the `displayState` field
3. Create a `transitionDisplayState(current, event)` pure function that enforces valid transitions
4. Collapse the three `WorkspaceItem.svelte` rendering paths (active session, inactive worktree, idle repo) into one
5. Backend: emit semantic events (`agent-finished-turn`, `agent-needs-input`) instead of raw `idle: true/false`
6. Backend: for repo roots, read the actual checked-out branch on refresh (already done in `GET /workspaces` enrichment at `server/index.ts:585`) — propagate this to the sidebar item's `branchName`
7. Frontend: the only way to reach `unseen-idle` is through `running` → `unseen-idle`; the only way to leave `seen-idle` is through `seen-idle` → `running`
8. The idle timer becomes an implementation detail of detecting `running → unseen-idle`, not a direct attention trigger
