# Bug Analysis: PR Dashboard Usability — Scroll, Search, Action Buttons

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: RepoDashboard.svelte, App.svelte, backend workspaces.ts

## Symptoms
- PR list is clipped when it exceeds the viewport height — no scrolling
- "Code Review" button opens GitHub in a new tab instead of launching a worktree session with the review prompt
- No way to start a generic session on a specific PR's branch from the dashboard
- No pagination or search to filter PRs when the list is long

## Reproduction Steps
1. Open dashboard for a repo with 10+ open PRs
2. Observe the PR list is clipped at the bottom with no scroll
3. Click "Code Review" on any PR — opens GitHub URL instead of starting a review session
4. Look for a per-PR button to start a normal session — none exists
5. Look for search/filter — none exists

## Root Cause

### 1. No Scroll (layout clipping)
- `App.svelte:683` — `.terminal-area` has `overflow: hidden`
- `RepoDashboard.svelte:251` — `.pr-list` has `overflow: hidden`
- The dashboard content area has no scroll container. When the PR list exceeds the viewport, content is simply clipped. The `overflow: hidden` on `.terminal-area` is needed for the terminal view but prevents the dashboard from scrolling.

### 2. Code Review links to GitHub
- `RepoDashboard.svelte:142-151` — The action pill is an `<a href={pr.url}>` tag linking to GitHub
- Should instead: create a worktree for the PR branch (via `POST /workspaces/worktree` with `branch: pr.headRefName`), create a session in that worktree, and inject the code review prompt (similar to `PrTopBar.svelte` which uses `getActionPrompt()` + `sendPtyData()`)
- The `PrTopBar` component already has the correct pattern for in-session review (lines 87-103), but the dashboard doesn't use it — it just links out

### 3. No per-PR session button
- Each PR row only shows conditional pills: "Fix Conflicts", "Merge", and the derived action (usually "Code Review")
- No generic "+" or "Open" button exists per-PR to check out that branch in a worktree and start a normal session
- The existing CTA buttons (`+ Start Session`, `+ New Worktree`) at lines 192-197 are workspace-level and don't reference a specific PR branch

### 4. No pagination or search
- Backend (`workspaces.ts:288-378`): hard-codes `gh pr list --limit 30` per query type (authored + review-requested), deduplicates, returns all
- Frontend: iterates `data.prs` with `{#each}` — no filtering, pagination, or virtualization
- No search input or filter controls exist in the component

## Evidence
- `RepoDashboard.svelte:251`: `.pr-list { overflow: hidden }` — direct cause of clipping
- `App.svelte:683`: `.terminal-area { overflow: hidden }` — parent also clips
- `RepoDashboard.svelte:142-144`: `<a href={pr.url} target="_blank">` — Code Review links to GitHub
- `RepoDashboard.svelte:99-156`: `{#each data.prs as pr}` — renders all PRs, no pagination
- `workspaces.ts:323,336`: `--limit 30` — backend fetches up to 60 PRs (30 authored + 30 review-requested)
- Screenshot shows ~16 PRs visible before clipping, confirming the scroll issue with moderate PR count

## Impact Assessment
- **Scroll**: Users cannot see or interact with PRs beyond the viewport fold — breaks the dashboard for any repo with more than ~10-12 PRs
- **Code Review button**: Defeats the purpose of the integrated review workflow — users have to manually create worktrees and type the review prompt
- **No per-PR session button**: Users must manually create a worktree, switch to it, and know the branch name to work on a specific PR
- **No search/pagination**: With 30+ PRs, finding a specific one requires scrolling through an unfiltered list (if scroll even worked)

## Recommended Fix Direction

### 1. Scroll fix
- Add `overflow-y: auto` to `.repo-dashboard` so the dashboard scrolls within `.terminal-area`
- Keep `overflow: hidden` on `.terminal-area` (needed for terminal) — the dashboard becomes a scrollable child

### 2. Code Review → worktree + session
- Change the "Code Review" pill from `<a>` to `<button>`
- On click: call a new prop callback (e.g., `onCodeReview(pr)`) that:
  1. Creates a worktree via `POST /workspaces/worktree` with `branch: pr.headRefName`
  2. Creates a session in that worktree
  3. Sends the review prompt via PTY once the session connects
- Reuse the existing `getActionPrompt()` from `pr-state.ts` for the prompt text

### 3. Per-PR "+" button
- Add a small "+" or "Open" button to each PR row
- On click: similar to Code Review but without injecting the review prompt — just checkout the branch in a worktree and start a normal session

### 4. Search/filter
- Add a search input above the PR list that filters by title or PR number (client-side filtering of the existing data is sufficient given the 30-60 PR limit)
- Pagination is lower priority since the hard limit is already 60 PRs — search/filter + scroll fixes the immediate usability issue
