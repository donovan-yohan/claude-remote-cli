# Idle-to-Attention State Machine + Unified SidebarItem

> **Status**: Completed | **Created**: 2026-03-24 | **Last Updated**: 2026-03-25
> **Bug Analysis**: `docs/bug-analyses/2026-03-24-idle-to-attention-spurious-transition-bug-analysis.md`
> **Consulted Learnings**: L-014
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-24 | Design | State machine with 6 states (initializing, running, unseen-idle, seen-idle, permission, inactive) | User requested type-safe transitions; 6 states covers initializing distinctly |
| 2026-03-24 | Design | Single backend event `session-backend-state-changed` replaces both `session-state-changed` and `session-idle-changed` | Eliminates two-stream reconciliation that caused the bug class |
| 2026-03-24 | Design | Unified SidebarItem type with `sessions: SessionSummary[]` | Handles multi-session worktrees; array naturally supports aggregate status |
| 2026-03-24 | Design | Frontend derivation — keep 3 APIs, compute SidebarItem[] by joining | Avoids coupling backend to sidebar rendering model |
| 2026-03-24 | Design | `lastKnownBackendState` per SidebarItem for reconnect recovery | Distinguishes "same idle user saw" from "new idle during disconnect" |
| 2026-03-24 | Design | Notifications only fire on running → unseen-idle / running → permission | Prevents spurious notifications on session creation |
| 2026-03-24 | Design | Fix push notification dedup using new backend event | Server-side push was a separate spurious source (Codex finding) |
| 2026-03-24 | Design | Pure transition logic in display-state.ts, reactive state in sessions.svelte.ts | Independently testable pure functions |
| 2026-03-24 | Design | computeBackendState in sessions.ts next to existing fireStateChange | Session state emission stays centralized |
| 2026-03-24 | Design | Clean delete all dead code (~80 lines) | Solo project, no external consumers |

## Architecture

```
BACKEND (merged state computation)
═══════════════════════════════════════════════════
hooks.ts                    pty-handler.ts
  setAgentState()             resetIdleTimer()
  │                           parser override
  ▼                           ▼
sessions.ts: computeBackendState(session)
  ├── merges agentState + idle + hooksActive
  ├── deduplicates (only emits if state changed)
  └── fires onBackendStateChange callbacks
        │
        ▼
ws.ts: broadcastEvent('session-backend-state-changed', {sessionId, state})
index.ts: push.notifySessionAttention (only on running→idle/permission)

FRONTEND (display state machine)
═══════════════════════════════════════════════════
App.svelte
  receives 'session-backend-state-changed'
  │
  ▼
sessions.svelte.ts
  ├── updates lastKnownBackendState on SidebarItem
  ├── calls transitionDisplayState(currentDisplayState, event)
  ├── fires notification if shouldNotify(from, to)
  └── updates SidebarItem.displayState
        │
        ▼
WorkspaceItem.svelte
  reads SidebarItem.displayState → dot color + CSS class
  reads SidebarItem.sessions[] for aggregate status
  reads SidebarItem.kind for context menu actions

STATE MACHINE (display-state.ts — pure function)
═══════════════════════════════════════════════════
States: initializing | running | unseen-idle | seen-idle | permission | inactive

  initializing ──backend-running──▶ running
  initializing ──backend-idle────▶ unseen-idle
  running ──────backend-idle────▶ unseen-idle  ← ATTENTION!
  running ──────backend-perm────▶ permission
  unseen-idle ──user-viewed─────▶ seen-idle
  seen-idle ────backend-running─▶ running
  seen-idle ────backend-idle────▶ seen-idle    ← KEY INVARIANT (no re-trigger)
  seen-idle ────user-submitted──▶ running
  permission ───user-viewed─────▶ seen-idle
  permission ───backend-running─▶ running
  inactive ─────session-started─▶ initializing
  any ──────────session-ended───▶ inactive
```

## Progress

- [x] Task 1: Display state types + transition function + tests _(completed 2026-03-24)_
- [x] Task 2: Backend computeBackendState + tests _(completed 2026-03-24)_
- [x] Task 3: Wire backend events (hooks, pty-handler, ws, push) _(completed 2026-03-24)_
- [x] Task 4: SidebarItem type + buildSidebarItems function + tests _(completed 2026-03-24)_
- [x] Task 5: Frontend state machine integration (App.svelte, sessions.svelte.ts) _(completed 2026-03-24)_
- [x] Task 6: Collapse WorkspaceItem rendering paths _(completed 2026-03-24 — pragmatic approach)_
- [x] Task 7: Dead code removal + build verification _(completed 2026-03-24)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

| Task 6 | Full template restructure (3 blocks → 1 SidebarItem loop) | Updated dot computation + CSS only, kept existing template structure | Full restructure risks visual regressions; dot rendering from displayState achieves the same bug fix with less blast radius |

---

### Task 1: Display state types + transition function + tests

**Files:** `frontend/src/lib/state/display-state.ts` (new), `test/display-state.test.ts` (new)

**TDD: Write tests first.**

1. Create `test/display-state.test.ts` with table-driven tests:
   - 14 transition tests covering all valid state × event combinations
   - Critical invariant: `seen-idle` + `backend-state-changed(idle)` → `seen-idle` (NOT `unseen-idle`)
   - Idempotent: `unseen-idle` + `backend-state-changed(idle)` → `unseen-idle`
   - Unknown event → current state unchanged
   - 4 `shouldNotify` tests: `running→unseen-idle` (true), `running→permission` (true), `initializing→unseen-idle` (false), `seen-idle→seen-idle` (false)

2. Create `frontend/src/lib/state/display-state.ts`:
   ```typescript
   export type DisplayState = 'initializing' | 'running' | 'unseen-idle' | 'seen-idle' | 'permission' | 'inactive';
   export type BackendDisplayState = 'initializing' | 'running' | 'idle' | 'permission';

   export type DisplayEvent =
     | { type: 'backend-state-changed'; state: BackendDisplayState }
     | { type: 'user-viewed' }
     | { type: 'user-submitted' }
     | { type: 'session-started' }
     | { type: 'session-ended' };

   export function transitionDisplayState(current: DisplayState, event: DisplayEvent): DisplayState { ... }
   export function shouldNotify(from: DisplayState, to: DisplayState): boolean { ... }
   ```

3. Run tests: `npm test -- --test-name-pattern="display-state"`

**Verify:** All 18 tests pass.

---

### Task 2: Backend computeBackendState + tests

**Files:** `server/sessions.ts` (modify), `test/backend-state.test.ts` (new)

**TDD: Write tests first.**

1. Create `test/backend-state.test.ts`:
   - 6 mapping tests: processing→running, initializing→initializing, idle+idle=true→idle, waiting-for-input+idle=true→idle, permission-prompt→permission, error→running
   - 1 deduplication test: calling with same result twice → callback fires once
   - Test the exported `computeBackendState` function directly

2. In `server/sessions.ts`, add:
   ```typescript
   export type BackendDisplayState = 'initializing' | 'running' | 'idle' | 'permission';

   export function computeBackendState(session: Session): BackendDisplayState { ... }
   ```
   - Add `_lastEmittedBackendState` field to session tracking
   - Add `backendStateChangeCallbacks` array
   - Export `onBackendStateChange(cb)` registration function
   - Export `fireBackendStateIfChanged(session)` that computes, deduplicates, and fires

3. Run tests: `npm test -- --test-name-pattern="backend-state"`

**Verify:** All 7 tests pass.

---

### Task 3: Wire backend events

**Files:** `server/hooks.ts`, `server/pty-handler.ts`, `server/ws.ts`, `server/index.ts`

1. **hooks.ts** — In `setAgentState()` helper (line 42), after setting `session.agentState`, call `deps.fireBackendStateIfChanged(session)` instead of `deps.fireStateChange(session.id, state)`. Update `HookDeps` interface accordingly.

2. **pty-handler.ts** — In `resetIdleTimer()` (line 213), after toggling `session.idle`, call `fireBackendStateIfChanged(session)`. In the parser override block (line 252-271), after setting `session.agentState`, call `fireBackendStateIfChanged(session)` instead of iterating `stateChangeCallbacks`.

3. **ws.ts** — Replace `sessions.onIdleChange` + `sessions.onStateChange` subscriptions (lines 150-158) with single `sessions.onBackendStateChange` subscription that broadcasts `session-backend-state-changed`.

4. **index.ts** — Replace `sessions.onIdleChange` push notification listener (line 487-499) with `sessions.onBackendStateChange` that only fires push on transitions TO idle/permission FROM running. Add `lastPushState` tracking to deduplicate.

5. Update `createHooksRouter` call in index.ts (line 317-321) to pass new deps.

**Verify:** `npm run build` succeeds. Existing hooks.test.ts still passes.

---

### Task 4: SidebarItem type + buildSidebarItems function + tests

**Files:** `frontend/src/lib/types.ts` (modify), `frontend/src/lib/state/sessions.svelte.ts` (modify), `test/sidebar-items.test.ts` (new)

**TDD: Write tests first.**

1. Create `test/sidebar-items.test.ts`:
   - Active session → SidebarItem with sessions array containing it, displayState from backend
   - Inactive worktree (no session) → SidebarItem with empty sessions, displayState=inactive
   - Idle repo (no session) → SidebarItem with kind=repo, displayState=inactive
   - Multi-session worktree → single SidebarItem with sessions array length > 1
   - Repo root uses actual checked-out branch (from workspace.defaultBranch enrichment)
   - Reconciliation: existing seen-idle preserved when backend state unchanged
   - Reconciliation: running→idle transition detected on refresh
   - Reconciliation: disappeared session → inactive

2. Add `SidebarItem` interface to `frontend/src/lib/types.ts`:
   ```typescript
   export interface SidebarItem {
     id: string;                    // worktree path (stable across active/inactive)
     kind: 'repo' | 'worktree';
     path: string;
     repoPath: string;
     displayName: string;
     branchName: string;
     lastActivity: string;
     displayState: DisplayState;
     lastKnownBackendState: BackendDisplayState | null;
     sessions: SessionSummary[];
   }
   ```

3. Extract `buildSidebarItems(sessions, worktrees, workspaces, existingItems)` as a pure function in `sessions.svelte.ts` (or a separate util). This function:
   - Groups sessions by worktreePath (or workspacePath for repo root)
   - Merges with worktrees and workspace repos
   - Preserves displayState from existingItems when lastKnownBackendState matches
   - Applies transitions when backend state changed

4. Run tests: `npm test -- --test-name-pattern="sidebar-items"`

**Verify:** All 8 tests pass.

---

### Task 5: Frontend state machine integration

**Files:** `frontend/src/App.svelte`, `frontend/src/lib/state/sessions.svelte.ts`

1. **sessions.svelte.ts** — Replace `attentionSessions`, `dismissedSessions`, `setAttention()`, `setAgentState()`, `clearAttention()`, `getSessionStatus()` with:
   - `sidebarItems = $state<SidebarItem[]>([])` — the unified reactive state
   - `handleBackendStateChanged(sessionId, backendState)` — finds the SidebarItem, applies `transitionDisplayState`, fires notification via `shouldNotify`
   - `handleUserViewed(sessionId)` — transitions to `seen-idle`
   - `handleUserSubmitted(sessionId)` — transitions to `running`
   - Updated `refreshAll()` that calls `buildSidebarItems` with reconciliation
   - Export `getSidebarItemsForWorkspace(path)` replacing `getSessionsForWorkspace`

2. **App.svelte** — Replace event handlers:
   - Remove `session-state-changed` handler (line 290-291)
   - Remove `session-idle-changed` handler (line 292-293)
   - Add `session-backend-state-changed` handler → calls `handleBackendStateChanged`
   - Replace `clearAttention(sessionId)` calls with `handleUserViewed(sessionId)`
   - Import `handleBackendStateChanged`, `handleUserViewed`, `handleUserSubmitted` instead of old functions

3. **App.svelte** — Update `navigateToSession` and `handleSelectSession` to call `handleUserViewed` instead of `clearAttention`.

**Verify:** `npm run build` succeeds. Manual smoke test: session dots render correctly.

---

### Task 6: Collapse WorkspaceItem rendering paths

**Files:** `frontend/src/components/WorkspaceItem.svelte`, `frontend/src/components/Sidebar.svelte`

1. **Sidebar.svelte** — Update to pass `SidebarItem[]` per workspace instead of separate `sessionGroups` + `inactiveWorktrees`. The SidebarItem array already contains both active and inactive items.

2. **WorkspaceItem.svelte** — Replace the three `{#each}` rendering blocks (active sessions at line 256, idle repo root at line 305, inactive worktrees at line 339) with a single `{#each sidebarItems}` block:
   - Dot class derived from `item.displayState` (one mapping, not three code paths)
   - Row styling: `class:selected`, `class:attention`, `class:inactive` from displayState
   - Secondary row: branchName, lastActivity, PR match — all from SidebarItem fields
   - Context menu: branch on `item.kind` + `item.displayState` for action set
   - Group aggregate status: highest-priority displayState across item.sessions

3. **CSS consolidation** — Remove duplicated `.dot-inactive`, `.session-row.inactive` styles. Use single `.status-dot--{displayState}` class set:
   - `--initializing`: gray (#6b7280)
   - `--running`: green (#4ade80)
   - `--unseen-idle`: amber with glow (#fbbf24)
   - `--seen-idle`: blue (#60a5fa)
   - `--permission`: yellow with glow (#eab308)
   - `--inactive`: gray (#555)

**Verify:** `npm run build` succeeds. Sidebar renders all item types with correct dot colors.

---

### Task 7: Dead code removal + build verification

**Files:** `frontend/src/lib/state/sessions.svelte.ts`, `frontend/src/lib/ws.ts`, `server/sessions.ts`, `server/ws.ts`

1. Remove from `sessions.svelte.ts`:
   - `attentionSessions` reactive state
   - `dismissedSessions` reactive state
   - `ATTENTION_COOLDOWN_MS` constant
   - `setAttention()` function
   - `clearAttention()` function
   - `setAgentState()` function
   - `getSessionStatus()` function
   - Attention pruning in `refreshAll()`

2. Remove from `server/ws.ts`:
   - `sessions.onIdleChange` subscription
   - `session-idle-changed` broadcast

3. Remove from `server/sessions.ts`:
   - `onIdleChange` callback registration (if no longer used after Task 3)
   - `idleChangeCallbacks` array (if fully replaced)
   - Old `onStateChange` / `stateChangeCallbacks` (if fully replaced by `onBackendStateChange`)

4. Remove from `App.svelte`:
   - Old imports: `setAttention`, `setAgentState`, `clearAttention`, `getSessionStatus`

5. Run full verification:
   ```bash
   npm run build && npm test
   ```

**Verify:** Build succeeds. All tests pass. No TypeScript errors. No unused imports.

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- TDD for pure functions (display-state.ts, computeBackendState) — tests caught the sessionToBackendState/server divergence during review
- Parallel dispatch of Tasks 1+2 saved ~2 minutes
- Pragmatic approach to Task 6 (dot computation only, not full template restructure) avoided visual regressions

**What didn't:**
- Review agent removed idleChangeCallbacks too aggressively (broke the parameter passing chain from sessions.ts → pty-handler.ts), required manual fix
- The `!` non-null assertions in sidebar-items.ts triggered strict-mode diagnostics from the IDE despite working at runtime — should use explicit guards from the start

**Learnings to codify:**
- L-014 already captures the state machine insight
- New: when migrating from dual-signal (idle + agentState) to merged-signal, the frontend derivation function (`sessionToBackendState`) MUST mirror the server's `computeBackendState` exactly — divergence causes initial-load display to disagree with live updates
