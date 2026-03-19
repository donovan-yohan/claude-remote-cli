# Fix tmux Unicode Underscore Rendering

> **Status**: Active | **Created**: 2026-03-19 | **Last Updated**: 2026-03-19
> **Bug Analysis**: `docs/bug-analyses/2026-03-19-tmux-underscore-rendering-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-19 | Design | Revert term.reset() to term.clear() with surgical alternate screen exit | reset() wipes terminal state including character set config; clear() preserves it |
| 2026-03-19 | Plan | Single task — one-line change + build verify | Minimal scope, low risk |

## Progress

- [ ] Task 1: Revert term.reset() to term.clear() with alternate screen exit sequence

## Surprises & Discoveries

_None yet._

## Plan Drift

_None yet._

---

### Task 1: Revert term.reset() to term.clear() with alternate screen exit

**Goal:** Fix Unicode characters (⏵, ✗, ●) rendering as underscores in tmux sessions by preserving terminal state across session switches.

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:220`

- [ ] **Step 1: Replace `term.reset()` with `term.clear()` plus alternate screen exit**

At line 220, change:
```typescript
term.reset();
```
to:
```typescript
term.write('\x1b[?1049l'); // Exit alternate screen buffer if active
term.clear();
```

This preserves terminal state (character sets, modes) while still clearing content and exiting any lingering alternate screen buffer from a previous session.

- [ ] **Step 2: Build and test**

Run `npm run build` and `npm test` to verify no regressions.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "fix: revert term.reset() to term.clear() to fix tmux Unicode rendering"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
