# Session Loading Shimmer Implementation Plan

> **Status**: Completed | **Created**: 2026-02-26 | **Completed**: 2026-02-26
> **Design Doc**: `docs/design-docs/2026-02-26-session-loading-shimmer-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

**Goal:** Add a CSS shimmer overlay to session list items during async operations (starting, killing, deleting) with disabled interaction.

**Architecture:** Reactive `loadingItems` set in `sessions.svelte.ts` (follows `attentionSessions` pattern). Consumers call `setLoading`/`clearLoading` around async ops. SessionItem receives `isLoading` prop, applies CSS class that triggers `::after` pseudo-element shimmer animation.

**Tech Stack:** Svelte 5 runes, CSS keyframes, TypeScript

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-26 | Design | Overlay shimmer, not skeleton | User already knows what they clicked — retain context |
| 2026-02-26 | Design | All async actions covered | Starting, killing, and deleting all need feedback |
| 2026-02-26 | Design | Disable interaction during loading | Prevents double-submits and conflicting actions |
| 2026-02-26 | Design | State in module, not component | Both SessionList and DeleteWorktreeDialog need to participate |
| 2026-02-26 | Design | Pure CSS animation | No JS overhead, no extra DOM, no new components |

## Progress

- [x] Task 1: Add `loadingItems` state to `sessions.svelte.ts` _(completed 2026-02-26)_
- [x] Task 2: Add `isLoading` prop and shimmer CSS to `SessionItem.svelte` _(completed 2026-02-26)_
- [x] Task 3: Wire loading state in `SessionList.svelte` async handlers _(completed 2026-02-26)_
- [x] Task 4: Wire loading state in `DeleteWorktreeDialog.svelte` _(completed 2026-02-26)_
- [x] Task 5: Type-check and manual verification _(completed 2026-02-26)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Add `loadingItems` state to `sessions.svelte.ts`

**Files:**
- Modify: `frontend/src/lib/state/sessions.svelte.ts`

**Step 1: Add the reactive state and exported functions**

After the existing `let gitStatuses = $state<Record<string, GitStatus>>({});` line (~line 9), add:

```typescript
let loadingItems = $state<Record<string, boolean>>({});
```

Add to the `getSessionState()` return object:

```typescript
get loadingItems() { return loadingItems; },
```

Add three new exported functions after `getSessionStatus`:

```typescript
export function setLoading(key: string): void {
  loadingItems[key] = true;
}

export function clearLoading(key: string): void {
  delete loadingItems[key];
}

export function isItemLoading(key: string): boolean {
  return !!loadingItems[key];
}
```

Note: Named `isItemLoading` (not `isLoading`) to avoid shadowing the SessionItem prop name.

**Step 2: Type-check**

Run: `npm run check:svelte`
Expected: PASS — no type errors

**Step 3: Commit**

```bash
git add frontend/src/lib/state/sessions.svelte.ts
git commit -m "feat: add loadingItems reactive state to session store"
```

---

### Task 2: Add `isLoading` prop and shimmer CSS to `SessionItem.svelte`

**Files:**
- Modify: `frontend/src/components/SessionItem.svelte`

**Step 1: Add the `isLoading` prop**

In the props destructuring (around line 16-34), add `isLoading` with a default of `false`:

```typescript
let {
  variant,
  gitStatus,
  isLoading = false,
  onclick,
  // ... rest unchanged
}: {
  variant: ItemVariant;
  gitStatus?: GitStatus | undefined;
  isLoading?: boolean;
  onclick: () => void;
  // ... rest unchanged
} = $props();
```

**Step 2: Add the `loading` CSS class to the `<li>`**

On the `<li>` element (around line 128), add `class:loading={isLoading}`:

```svelte
<li
  class:active-session={isActive}
  class:inactive-worktree={!isActive}
  class:selected={isSelected}
  class:loading={isLoading}
  onclick={handleClick}
  use:longpressAction
>
```

**Step 3: Add shimmer CSS**

In the `<style>` block, add after the existing `li` rules (after the `li.inactive-worktree:hover` block, around line 235):

```css
li.loading {
  pointer-events: none;
  opacity: 0.7;
}

li.loading::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.04) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  pointer-events: none;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Step 4: Type-check**

Run: `npm run check:svelte`
Expected: PASS — `isLoading` is optional with a default, so existing call sites don't break.

**Step 5: Commit**

```bash
git add frontend/src/components/SessionItem.svelte
git commit -m "feat: add loading shimmer overlay to SessionItem"
```

---

### Task 3: Wire loading state in `SessionList.svelte` async handlers

**Files:**
- Modify: `frontend/src/components/SessionList.svelte`

**Step 1: Add imports**

Update the import from `sessions.svelte.js` to include `setLoading`, `clearLoading`, `isItemLoading`:

```typescript
import { getSessionState, getSessionStatus, clearAttention, refreshAll, setLoading, clearLoading, isItemLoading } from '../lib/state/sessions.svelte.js';
```

**Step 2: Wire `handleStartRepoSession`**

Replace the existing function (around line 238-254):

```typescript
async function handleStartRepoSession(repo: RepoInfo, yolo = false) {
  const key = repo.path;
  setLoading(key);
  try {
    const session = await api.createRepoSession({
      repoPath: repo.path,
      repoName: repo.name,
      continue: true,
      ...(yolo && { claudeArgs: ['--dangerously-skip-permissions'] }),
    });
    await refreshAll();
    if (session?.id) onSelectSession(session.id);
  } catch (err: unknown) {
    if (err instanceof ConflictError && err.sessionId) {
      await refreshAll();
      onSelectSession(err.sessionId);
    }
  } finally {
    clearLoading(key);
  }
}
```

**Step 3: Wire `handleStartWorktreeSession`**

Replace the existing function (around line 219-236). Remove the `startingWorktreePath` local state (line 27) — `loadingItems` replaces it:

```typescript
async function handleStartWorktreeSession(wt: WorktreeInfo, yolo = false) {
  const key = wt.path;
  if (isItemLoading(key)) return;
  setLoading(key);
  try {
    const session = await api.createSession({
      repoPath: wt.repoPath,
      repoName: wt.repoName,
      worktreePath: wt.path,
      ...(yolo && { claudeArgs: ['--dangerously-skip-permissions'] }),
    });
    await refreshAll();
    if (session?.id) onSelectSession(session.id);
  } catch {
    // Ignore — user can retry
  } finally {
    clearLoading(key);
  }
}
```

Delete the line `let startingWorktreePath: string | null = null;` (line 27).

**Step 4: Wire `handleKillSession`**

Replace the existing function (around line 198-204):

```typescript
async function handleKillSession(session: SessionSummary) {
  const key = session.id;
  setLoading(key);
  try {
    await api.killSession(session.id);
    await refreshAll();
    if (sessionState.activeSessionId === session.id) {
      sessionState.activeSessionId = null;
    }
  } finally {
    clearLoading(key);
  }
}
```

**Step 5: Wire `handlePRClick`**

Replace the existing function (around line 154-196):

```typescript
async function handlePRClick(pr: PullRequest, repo: RepoInfo, yolo = false) {
  const claudeArgs = yolo ? ['--dangerously-skip-permissions'] : undefined;

  // Step 1: Active session for this branch? → route to it
  const existingSession = findSessionForBranch(pr.headRefName);
  if (existingSession) {
    clearAttention(existingSession.id);
    onSelectSession(existingSession.id);
    return;
  }

  // Step 2: Inactive worktree for this branch? → resume it
  const existingWorktree = findWorktreeForBranch(pr.headRefName);
  if (existingWorktree) {
    const key = existingWorktree.path;
    setLoading(key);
    try {
      const session = await api.createSession({
        repoPath: existingWorktree.repoPath,
        repoName: existingWorktree.repoName,
        worktreePath: existingWorktree.path,
        claudeArgs,
      });
      await refreshAll();
      if (session?.id) {
        onSelectSession(session.id);
      }
    } catch { /* user can retry */ } finally {
      clearLoading(key);
    }
    return;
  }

  // Step 3: No local worktree → create new worktree + session
  const key = repo.path + ':' + pr.headRefName;
  setLoading(key);
  try {
    const session = await api.createSession({
      repoPath: repo.path,
      repoName: repo.name,
      branchName: pr.headRefName,
      claudeArgs,
    });
    await refreshAll();
    if (session?.id) {
      onSelectSession(session.id);
    }
  } catch { /* user can retry */ } finally {
    clearLoading(key);
  }
}
```

**Step 6: Pass `isLoading` prop to all SessionItem instances**

For each `<SessionItem>` in the template, add the `isLoading` prop. The key must match what the handler uses:

Active repo sessions (repos tab, around line 289):
```svelte
<SessionItem
  variant={{ kind: 'active', session, status: getSessionStatus(session), isSelected: sessionState.activeSessionId === session.id }}
  gitStatus={sessionState.gitStatuses[session.repoPath + ':' + session.worktreeName]}
  isLoading={isItemLoading(session.id)}
  onclick={() => handleSelectSession(session)}
  onkill={() => handleKillSession(session)}
  onrename={() => handleRenameSession(session)}
/>
```

Idle repos (repos tab, around line 301):
```svelte
<SessionItem
  variant={{ kind: 'idle-repo', repo }}
  isLoading={isItemLoading(repo.path)}
  onclick={() => handleStartRepoSession(repo)}
  onresumeYolo={() => handleStartRepoSession(repo, true)}
  onNewWorktree={() => onNewWorktree(repo)}
/>
```

Active worktree sessions (worktrees tab, around line 312):
```svelte
<SessionItem
  variant={{ kind: 'active', session, status: getSessionStatus(session), isSelected: sessionState.activeSessionId === session.id }}
  gitStatus={sessionState.gitStatuses[session.repoPath + ':' + session.worktreeName]}
  isLoading={isItemLoading(session.id)}
  onclick={() => handleSelectSession(session)}
  onkill={() => handleKillSession(session)}
  onrename={() => handleRenameSession(session)}
/>
```

Inactive worktrees (worktrees tab, around line 340):
```svelte
<SessionItem
  variant={{ kind: 'inactive-worktree', worktree: wt }}
  gitStatus={sessionState.gitStatuses[wt.repoPath + ':' + wt.name]}
  isLoading={isItemLoading(wt.path)}
  onclick={() => handleStartWorktreeSession(wt)}
  onresumeYolo={() => handleStartWorktreeSession(wt, true)}
  ondelete={() => onDeleteWorktree(wt)}
/>
```

**Step 7: Type-check**

Run: `npm run check:svelte`
Expected: PASS

**Step 8: Commit**

```bash
git add frontend/src/components/SessionList.svelte
git commit -m "feat: wire loading shimmer to all SessionList async handlers"
```

---

### Task 4: Wire loading state in `DeleteWorktreeDialog.svelte`

**Files:**
- Modify: `frontend/src/components/dialogs/DeleteWorktreeDialog.svelte`

**Step 1: Add imports**

Add `setLoading` and `clearLoading` to the import from sessions state:

```typescript
import { refreshAll, setLoading, clearLoading } from '../../lib/state/sessions.svelte.js';
```

**Step 2: Wire `handleConfirm`**

Replace the existing function (around line 23-35):

```typescript
async function handleConfirm() {
  if (!worktree || deleting) return;
  deleting = true;
  error = '';
  setLoading(worktree.path);
  try {
    await deleteWorktree(worktree.path, worktree.repoPath);
    dialogEl.close();
    await refreshAll();
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to delete worktree.';
    deleting = false;
  } finally {
    if (worktree) clearLoading(worktree.path);
  }
}
```

**Step 3: Type-check**

Run: `npm run check:svelte`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/dialogs/DeleteWorktreeDialog.svelte
git commit -m "feat: wire loading shimmer to worktree delete dialog"
```

---

### Task 5: Type-check and manual verification

**Step 1: Full type check**

Run: `npm run check`
Expected: PASS — both `tsc` and `svelte-check` pass.

**Step 2: Full build**

Run: `npm run build`
Expected: PASS — builds successfully.

**Step 3: Full test suite**

Run: `npm test`
Expected: PASS — no regressions in existing server tests.

**Step 4: Manual verification**

Run: `npm start`

Verify in browser:
1. Click an idle repo → card shows shimmer, can't click again, shimmer disappears when session starts
2. Kill a running session → card shows shimmer briefly before disappearing
3. Click an inactive worktree → card shows shimmer until session starts
4. Delete a worktree via dialog → worktree card in sidebar shows shimmer while deleting
5. Verify shimmer doesn't conflict with attention glow or selected state

**Step 5: Commit (if any tweaks needed)**

```bash
git commit -am "fix: adjust shimmer styling after manual testing"
```

---

## Outcomes & Retrospective

**What worked:**
- Clean parallel execution — Tasks 1+2 and Tasks 3+4 ran concurrently with no conflicts
- `attentionSessions` pattern was a perfect template for `loadingItems`
- CSS-only shimmer required zero JS animation code
- Removing `startingWorktreePath` in favor of centralized `loadingItems` simplified SessionList

**What didn't:**
- Nothing notable — straightforward implementation

**Learnings to codify:**
- The `Record<string, boolean>` + `$state` pattern (used by `attentionSessions` and now `loadingItems`) is the standard way to track per-item boolean flags in session state
