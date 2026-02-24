# Pull Requests Tab Design

> Date: 2026-02-24
> Status: Approved

## Problem

Users need a way to see their GitHub pull requests (as author and reviewer) directly in the sidebar, and quickly jump into a worktree session for any PR branch. Currently there's no PR visibility — users must check GitHub separately.

## Decisions

- **Third tab**: Add "PRs" tab alongside Repos and Worktrees
- **Filters below tabs**: Move root/repo/search filters below the tab bar so repo selection gates PR fetching (avoids overfetching)
- **`gh` CLI on server**: Use `gh pr list --json` to fetch PRs — consistent with existing `gh pr view` pattern in git-status route, no API tokens to manage
- **Single endpoint, client-side filtering**: `GET /pull-requests?repo=<path>` returns both author and reviewer PRs; Author/Reviewer toggle is client-side
- **Open PRs only**: Both author and reviewer queries use `--state open` — closed/merged PRs aren't actionable
- **Repo selection UX**: When PRs tab is active and no repo selected, highlight/pulse the repo dropdown with accent color
- **Caching with manual refresh**: Cache PR results per repo, add a refresh button. Use `@tanstack/svelte-query` v6 (Svelte 5 runes support) for the PRs endpoint only — handles loading/refetching/error states cleanly
- **Structured error response**: Endpoint returns `{ prs: [...], error?: string }` so frontend can show contextual messages when `gh` is unavailable or not authenticated
- **PR click cascade**: 3-step resolution on click — (1) active session for branch → route to it, (2) inactive worktree for branch → resume it, (3) no local worktree → create new worktree + session
- **New component**: `PullRequestItem.svelte` with PR state icon, title, external link on hover, author, role badge, review status, time, diff stats

## Data Model

### Server: `PullRequest` interface (`server/types.ts`)

```typescript
interface PullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;  // branch name
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  author: string;       // GitHub login
  role: 'author' | 'reviewer';
  updatedAt: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
}
```

### Server: `PullRequestsResponse` (`server/types.ts`)

```typescript
interface PullRequestsResponse {
  prs: PullRequest[];
  error?: string | undefined;  // 'gh_not_installed', 'gh_not_authenticated', etc.
}
```

### Frontend: Matching interfaces in `frontend/src/lib/types.ts`

## Backend

### `GET /pull-requests?repo=<path>`

1. Validate `repo` query param
2. Get current GitHub user via `gh api user --jq .login`
3. If `gh` not available/authenticated → return `{ prs: [], error: 'gh_not_authenticated' }`
4. Fetch authored PRs: `gh pr list --author <user> --state open --limit 30 --json <fields>`
5. Fetch review-requested PRs: `gh pr list --search review-requested:<user> --state open --limit 30 --json <fields>`
6. Deduplicate (if user is both author and reviewer, keep as 'author')
7. Sort by `updatedAt` descending
8. Return `{ prs: [...] }`

## Frontend

### Layout Change

Before: `Sidebar → [Filters, SessionList(tabs + list)]`
After: `Sidebar → [SessionList(tabs, filters, list)]`

Filters move inside `SessionList.svelte`, rendered between tab bar and scrollable list.

### PRs Tab Behavior

- No repo selected → highlight repo dropdown, show "Select a repo to view pull requests"
- Repo selected → fetch PRs via `@tanstack/svelte-query` v6 `createQuery()`
- Loading state → "Loading pull requests..."
- `gh` error → contextual message (e.g. "GitHub CLI not authenticated — run `gh auth login`")
- Results → list of `PullRequestItem` components
- Author/Reviewer segmented toggle (All | Author | Reviewer) — only visible on PRs tab
- Manual refresh button (↻)

### PR Click Cascade

```
click PR →
  1. find active session where worktreeName matches pr.headRefName
     → yes: route to that session
  2. find inactive worktree where name matches pr.headRefName
     → yes: resume worktree (createSession with worktreePath)
  3. neither found
     → create new worktree + session (createSession with branchName)
```

### `PullRequestItem.svelte` Layout

- Row 1: `[state icon ○/⬤/⊗] [PR title with overflow scroll] [review badge ✓/✗/⏳] [↗ external link]`
- Row 2: `[spacer] [#number · author] [Author/Reviewer badge]`
- Row 3: `[spacer] [relative time] [+adds -dels]`

### UI State Additions

- `TabId`: `'repos' | 'worktrees' | 'prs'`
- `prRoleFilter`: `'all' | 'author' | 'reviewer'`

## Non-Goals

- Showing closed/merged PRs (can add later with state filter)
- Migrating existing sessions/worktrees/repos fetching to svelte-query (keep existing `$state` pattern)
- PR comments or review threads
- Creating PRs from the UI
