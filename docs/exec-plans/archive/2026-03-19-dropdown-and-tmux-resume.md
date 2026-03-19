# Plan: Fix Dropdown Menu + Tmux Resume UTF-8

> **Status**: Complete | **Created**: 2026-03-19
> **Source**: `docs/bug-analyses/2026-03-19-dropdown-and-tmux-resume-bug-analysis.md`
> **Branch**: `fix/dropdown-and-tmux-resume`

## Goal
Fix two regressions: (A) context menu dropdown broken by CSS `transform` containing block, (B) tmux resume missing `-u` flag causing broken Unicode rendering.

## Progress

- [x] Task 1: Fix dropdown menu — remove transform from .row-menu-overlay
- [x] Task 2: Fix tmux resume — add -u flag to attach command
- [x] Task 3: Build verification (247/247 tests pass)

---

### Task 1: Fix dropdown menu — remove transform from .row-menu-overlay
**File:** `frontend/src/components/WorkspaceItem.svelte`
**What:** Replace `transform: translateY(-50%)` centering with a non-transform technique that doesn't create a containing block for fixed-positioned descendants.
**How:** Use `top: 0; bottom: 0; display: flex; align-items: center` instead of `top: 50%; transform: translateY(-50%)`.

### Task 2: Fix tmux resume — add -u flag to attach command
**File:** `server/sessions.ts`
**What:** Add `-u` flag to the `tmux attach-session` command when restoring sessions.
**How:** Change `args = ['attach-session', '-t', s.tmuxSessionName]` to `args = ['-u', 'attach-session', '-t', s.tmuxSessionName]`.

### Task 3: Build verification
**What:** Run `npm run build` and `npm test` to verify no regressions.

## Drift Log
(none yet)
