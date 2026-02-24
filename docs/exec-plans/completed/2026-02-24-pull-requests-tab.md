# Pull Requests Tab Implementation Plan

> **Status**: Completed | **Created**: 2026-02-24 | **Completed**: 2026-02-24
> **Design Doc**: `docs/design-docs/2026-02-24-pull-requests-tab-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan. REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third "Pull Requests" sidebar tab that fetches PRs via `gh` CLI on the server, shows Author/Reviewer PRs per-repo, with external link on hover and worktree session creation on click.

**Architecture:** New `GET /pull-requests?repo=<path>` server endpoint calls `gh pr list` to fetch open PRs where the authenticated GitHub user is author or reviewer, returning a structured response with error context. Frontend uses `@tanstack/svelte-query` v6 for PR data fetching (cache + manual refresh + loading states), a new `PullRequestItem.svelte` component, and a third tab in `SessionList.svelte`. The sidebar layout is restructured so filters appear below the tab bar, with the repo dropdown highlighted when PRs tab requires a selection.

**Tech Stack:** TypeScript, Express, `gh` CLI (GitHub CLI), Svelte 5 runes, `@tanstack/svelte-query` v6, existing `execFileAsync` pattern.

---

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-24 | Design | Use `gh pr list --json` rather than GitHub REST API | Consistent with existing `gh pr view` pattern; no API tokens to manage |
| 2026-02-24 | Design | Single endpoint returns both author and reviewer PRs | Reduces HTTP round-trips; filter is client-side |
| 2026-02-24 | Design | Move filters below tabs | Enables repo selection gating for PR fetch; avoids overfetching |
| 2026-02-24 | Design | Add `PullRequestItem.svelte` as a new component | PR items have different layout needs vs existing `SessionItem` variants |
| 2026-02-24 | Brainstorm | Highlight/pulse repo dropdown when PRs tab active + no repo selected | Makes required-repo state obvious without changing layout (option 2) |
| 2026-02-24 | Brainstorm | Cache with manual refresh button | PRs don't change frequently within a session; refresh button gives user clear control |
| 2026-02-24 | Brainstorm | Use `@tanstack/svelte-query` v6 for PR fetching | Handles loading/refetching/error states cleanly; v6 has full Svelte 5 runes support |
| 2026-02-24 | Brainstorm | Structured error response `{ prs, error? }` | Frontend shows contextual messages when `gh` unavailable/not authenticated |
| 2026-02-24 | Brainstorm | Open PRs only (`--state open` for both queries) | Closed/merged PRs aren't actionable; YAGNI — add state filter later if needed |
| 2026-02-24 | Brainstorm | 3-step PR click cascade: active session → inactive worktree → create new | PR click is just another entry point to the same worktree lifecycle |

## Progress

- [x] Task 1: Add `PullRequest` and `PullRequestsResponse` types _(completed 2026-02-24)_
- [x] Task 2: Add `GET /pull-requests` server endpoint with structured errors _(completed 2026-02-24)_
- [x] Task 3: Install `@tanstack/svelte-query` v6 and set up QueryClientProvider _(completed 2026-02-24)_
- [x] Task 4: Add `fetchPullRequests` API client function _(completed 2026-02-24)_
- [x] Task 5: Add `'prs'` to `TabId` union and `prRoleFilter` to UI state _(completed 2026-02-24)_
- [x] Task 6: Restructure sidebar layout — move filters below tabs _(completed 2026-02-24)_
- [x] Task 7: Add third tab to `SessionList.svelte` tab bar _(completed 2026-02-24)_
- [x] Task 8: Create `PullRequestItem.svelte` component _(completed 2026-02-24)_
- [x] Task 9: Render PR list in `SessionList.svelte` with svelte-query, error messages, refresh button, repo highlight _(completed 2026-02-24)_
- [x] Task 10: Add Author/Reviewer filter toggle _(completed 2026-02-24)_
- [x] Task 11: PR click cascade — active session → inactive worktree → create new _(completed 2026-02-24)_
- [x] Task 12: Build and manual smoke test _(completed 2026-02-24)_

## Surprises & Discoveries

| 2026-02-24 | `createQuery` in svelte-query v6 for Svelte 5 takes an `Accessor<T>` (function returning options), not a plain object | Used `createQuery<PullRequestsResponse>(() => ({...}))` pattern |
| 2026-02-24 | Adding `'prs'` to `TabId` union caused type error in `NewSessionDialog.svelte` which assigns `ui.activeTab` to a local `'repos' | 'worktrees'` variable | Added fallback: `activeTab = ui.activeTab === 'prs' ? 'repos' : ui.activeTab` |
| 2026-02-24 | PullRequestItem row-2/row-3 uses `padding-left: 20px` instead of spacer elements, consistent with current SessionItem pattern (pill buttons era) | Matched current codebase convention |

## Plan Drift

| Tasks 1-5 | Execute sequentially via separate workers | Implemented directly by orchestrator due to worker permission issues; all tasks batched into two commits | Workers couldn't get Edit/Write permissions |
| Task 8 | PullRequestItem uses spacer elements for row indentation | Used `padding-left: 20px` instead | Matches current SessionItem pattern after pill buttons refactor |

---

### Task 1: Add `PullRequest` and `PullRequestsResponse` types

**Files:**
- Modify: `server/types.ts`
- Modify: `frontend/src/lib/types.ts`

**Step 1: Add interfaces to server types**

In `server/types.ts`, add after the `GitStatus` interface (after line 48):

```typescript
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  author: string;
  role: 'author' | 'reviewer';
  updatedAt: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
}

export interface PullRequestsResponse {
  prs: PullRequest[];
  error?: string | undefined;
}
```

**Step 2: Add matching interfaces to frontend types**

In `frontend/src/lib/types.ts`, add after the `GitStatus` interface (after line 34):

```typescript
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  author: string;
  role: 'author' | 'reviewer';
  updatedAt: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
}

export interface PullRequestsResponse {
  prs: PullRequest[];
  error?: string | undefined;
}
```

**Step 3: Run build to verify types compile**

Run: `npm run build`
Expected: Clean compilation, no type errors.

**Step 4: Commit**

```bash
git add server/types.ts frontend/src/lib/types.ts
git commit -m "feat: add PullRequest and PullRequestsResponse types"
```

---

### Task 2: Add `GET /pull-requests` server endpoint with structured errors

**Files:**
- Modify: `server/index.ts` (add route after the `GET /git-status` handler, around line 325)
- Create: `test/pull-requests.test.ts`

**Step 1: Write the type-validation test**

Create `test/pull-requests.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PullRequest, PullRequestsResponse } from '../server/types.js';

describe('PullRequest types', () => {
  it('constructs a valid author PR', () => {
    const pr: PullRequest = {
      number: 42,
      title: 'Fix bug',
      url: 'https://github.com/owner/repo/pull/42',
      headRefName: 'fix/bug',
      state: 'OPEN',
      author: 'testuser',
      role: 'author',
      updatedAt: '2026-02-24T00:00:00Z',
      additions: 10,
      deletions: 5,
      reviewDecision: 'APPROVED',
    };
    assert.equal(pr.role, 'author');
    assert.equal(pr.state, 'OPEN');
  });

  it('constructs a valid reviewer PR', () => {
    const pr: PullRequest = {
      number: 43,
      title: 'Add feature',
      url: 'https://github.com/owner/repo/pull/43',
      headRefName: 'feat/new',
      state: 'OPEN',
      author: 'otheruser',
      role: 'reviewer',
      updatedAt: '2026-02-24T00:00:00Z',
      additions: 50,
      deletions: 20,
      reviewDecision: null,
    };
    assert.equal(pr.role, 'reviewer');
  });

  it('constructs a valid response with error', () => {
    const response: PullRequestsResponse = {
      prs: [],
      error: 'gh_not_authenticated',
    };
    assert.equal(response.prs.length, 0);
    assert.equal(response.error, 'gh_not_authenticated');
  });

  it('constructs a valid response without error', () => {
    const response: PullRequestsResponse = {
      prs: [{
        number: 1,
        title: 'Test',
        url: 'https://github.com/o/r/pull/1',
        headRefName: 'test',
        state: 'OPEN',
        author: 'user',
        role: 'author',
        updatedAt: '2026-02-24T00:00:00Z',
        additions: 0,
        deletions: 0,
        reviewDecision: null,
      }],
    };
    assert.equal(response.prs.length, 1);
    assert.equal(response.error, undefined);
  });
});
```

**Step 2: Run test**

Run: `npm test`
Expected: PASS

**Step 3: Add the route to `server/index.ts`**

Add the import for `PullRequest` and `PullRequestsResponse` to the existing import from `./types.js`:

```typescript
import type { Config, PullRequest, PullRequestsResponse } from './types.js';
```

Add this route after the `GET /git-status` handler (around line 325):

```typescript
  // GET /pull-requests?repo=<path>
  app.get('/pull-requests', requireAuth, async (req, res) => {
    const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    if (!repoPath) {
      res.status(400).json({ prs: [], error: 'repo query parameter is required' });
      return;
    }

    const fields = 'number,title,url,headRefName,state,author,updatedAt,additions,deletions,reviewDecision';

    // Get current GitHub user
    let currentUser = '';
    try {
      const { stdout: whoami } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], { cwd: repoPath });
      currentUser = whoami.trim();
    } catch {
      const response: PullRequestsResponse = { prs: [], error: 'gh_not_authenticated' };
      res.json(response);
      return;
    }

    // Fetch authored PRs
    const authored: PullRequest[] = [];
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list', '--author', currentUser, '--state', 'open', '--limit', '30',
        '--json', fields,
      ], { cwd: repoPath });
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      for (const pr of raw) {
        authored.push({
          number: pr.number as number,
          title: pr.title as string,
          url: pr.url as string,
          headRefName: pr.headRefName as string,
          state: pr.state as 'OPEN' | 'CLOSED' | 'MERGED',
          author: (pr.author as { login?: string })?.login ?? currentUser,
          role: 'author',
          updatedAt: pr.updatedAt as string,
          additions: (pr.additions as number) ?? 0,
          deletions: (pr.deletions as number) ?? 0,
          reviewDecision: (pr.reviewDecision as string) ?? null,
        });
      }
    } catch { /* no authored PRs or gh error */ }

    // Fetch review-requested PRs
    const reviewing: PullRequest[] = [];
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list', '--search', `review-requested:${currentUser}`, '--state', 'open', '--limit', '30',
        '--json', fields,
      ], { cwd: repoPath });
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      for (const pr of raw) {
        reviewing.push({
          number: pr.number as number,
          title: pr.title as string,
          url: pr.url as string,
          headRefName: pr.headRefName as string,
          state: pr.state as 'OPEN' | 'CLOSED' | 'MERGED',
          author: (pr.author as { login?: string })?.login ?? '',
          role: 'reviewer',
          updatedAt: pr.updatedAt as string,
          additions: (pr.additions as number) ?? 0,
          deletions: (pr.deletions as number) ?? 0,
          reviewDecision: (pr.reviewDecision as string) ?? null,
        });
      }
    } catch { /* no review-requested PRs or gh error */ }

    // Deduplicate: if a PR appears in both (user is author AND reviewer), keep as 'author'
    const seen = new Set(authored.map(pr => pr.number));
    const combined = [...authored, ...reviewing.filter(pr => !seen.has(pr.number))];

    // Sort by updatedAt descending
    combined.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const response: PullRequestsResponse = { prs: combined };
    res.json(response);
  });
```

**Step 4: Run build and tests**

Run: `npm run build && npm test`
Expected: Clean compilation, all tests pass.

**Step 5: Commit**

```bash
git add server/index.ts test/pull-requests.test.ts
git commit -m "feat: add GET /pull-requests endpoint with structured error response"
```

---

### Task 3: Install `@tanstack/svelte-query` v6 and set up QueryClientProvider

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `frontend/src/App.svelte` (wrap with QueryClientProvider)

**Step 1: Install the dependency**

Run: `npm install @tanstack/svelte-query`

**Step 2: Add QueryClientProvider to App.svelte**

Read `frontend/src/App.svelte` to understand its structure, then wrap the root layout with `<QueryClientProvider>`. The provider needs to be at the top level of the component tree.

Add to the script section of `App.svelte`:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 minutes
      gcTime: 10 * 60 * 1000,    // 10 minutes
      refetchOnWindowFocus: false,
    },
  },
});
```

Wrap the existing template content with:

```svelte
<QueryClientProvider client={queryClient}>
  <!-- existing content -->
</QueryClientProvider>
```

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add package.json package-lock.json frontend/src/App.svelte
git commit -m "feat: install @tanstack/svelte-query v6 and add QueryClientProvider"
```

---

### Task 4: Add `fetchPullRequests` API client function

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Add the function**

In `frontend/src/lib/api.ts`, add `PullRequestsResponse` to the existing import (line 1):

```typescript
import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus, PullRequestsResponse } from './types.js';
```

Add the function after `fetchGitStatus` (after line 49):

```typescript
export async function fetchPullRequests(repoPath: string): Promise<PullRequestsResponse> {
  return json<PullRequestsResponse>(await fetch('/pull-requests?repo=' + encodeURIComponent(repoPath)));
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add fetchPullRequests API client function"
```

---

### Task 5: Add `'prs'` to `TabId` union and `prRoleFilter` to UI state

**Files:**
- Modify: `frontend/src/lib/state/ui.svelte.ts`

**Step 1: Update `TabId` and add `prRoleFilter`**

In `frontend/src/lib/state/ui.svelte.ts`, change line 1:

```typescript
export type TabId = 'repos' | 'worktrees' | 'prs';
```

Add a `prRoleFilter` state variable after `searchFilter` (after line 7):

```typescript
let prRoleFilter = $state<'all' | 'author' | 'reviewer'>('all');
```

Add getter/setter to `getUi()` return object (after `searchFilter` entries):

```typescript
    get prRoleFilter() { return prRoleFilter; },
    set prRoleFilter(v: 'all' | 'author' | 'reviewer') { prRoleFilter = v; },
```

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Commit**

```bash
git add frontend/src/lib/state/ui.svelte.ts
git commit -m "feat: add prs tab ID and role filter to UI state"
```

---

### Task 6: Restructure sidebar layout — move filters below tabs

**Files:**
- Modify: `frontend/src/components/Sidebar.svelte`
- Modify: `frontend/src/components/SessionList.svelte`

The key structural change: Move `<SessionFilters />` from `Sidebar.svelte` into `SessionList.svelte`, placing it between the tab bar and the scrollable list.

**Step 1: Remove filters from Sidebar**

In `frontend/src/components/Sidebar.svelte`:
- Remove the `import SessionFilters` line (line 4)
- Remove the `<SessionFilters />` line (line 30)

**Step 2: Add filters to SessionList**

In `frontend/src/components/SessionList.svelte`:
- Add: `import SessionFilters from './SessionFilters.svelte';`
- Insert `<SessionFilters />` between the closing `</div>` of `.session-list-tabs` and the opening `<ul class="session-list">`

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.svelte frontend/src/components/SessionList.svelte
git commit -m "refactor: move filters below tab bar in sidebar"
```

---

### Task 7: Add third tab to `SessionList.svelte` tab bar

**Files:**
- Modify: `frontend/src/components/SessionList.svelte`

**Step 1: Add PRs tab button**

Add a third tab button inside `.session-list-tabs` (after the Worktrees button):

```svelte
  <button
    class="sidebar-tab"
    class:active={ui.activeTab === 'prs'}
    onclick={() => { ui.activeTab = 'prs'; }}
  >
    PRs <span class="tab-count">{prsCount}</span>
  </button>
```

**Step 2: Add derived count and filtered list**

Add imports:

```typescript
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { PullRequest, PullRequestsResponse } from '../lib/types.js';
```

Add the svelte-query hook for PR fetching. This replaces the hand-rolled state in `sessions.svelte.ts` — PR state lives in svelte-query's cache instead:

```typescript
  // PR fetching via svelte-query
  let prRepoPath = $derived((() => {
    if (ui.activeTab !== 'prs' || !ui.repoFilter) return null;
    const repo = state.repos.find(r => r.name === ui.repoFilter);
    return repo?.path ?? null;
  })());

  const prQuery = createQuery({
    queryKey: ['pull-requests', prRepoPath],
    queryFn: () => prRepoPath ? api.fetchPullRequests(prRepoPath) : Promise.resolve({ prs: [] } as PullRequestsResponse),
    enabled: !!prRepoPath,
  });

  let prData = $derived($prQuery.data);
  let prError = $derived(prData?.error ?? null);
  let prList = $derived(prData?.prs ?? []);

  let filteredPullRequests = $derived(
    prList.filter(pr => {
      if (ui.prRoleFilter !== 'all' && pr.role !== ui.prRoleFilter) return false;
      if (ui.searchFilter && pr.title.toLowerCase().indexOf(ui.searchFilter.toLowerCase()) === -1) return false;
      return true;
    })
  );

  let prsCount = $derived(filteredPullRequests.length);
```

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add frontend/src/components/SessionList.svelte
git commit -m "feat: add PRs tab with svelte-query data fetching"
```

---

### Task 8: Create `PullRequestItem.svelte` component

**Files:**
- Create: `frontend/src/components/PullRequestItem.svelte`

**Step 1: Create the component**

Three-row layout matching `SessionItem.svelte` conventions:
- Row 1: PR state icon + title (overflow scroll) + review badge + external link (↗)
- Row 2: `#number · author` + role badge (Author/Reviewer)
- Row 3: relative time + diff stats

```svelte
<script lang="ts">
  import type { PullRequest } from '../lib/types.js';
  import { formatRelativeTime } from '../lib/utils.js';

  let {
    pr,
    isActiveSession,
    onclick,
  }: {
    pr: PullRequest;
    isActiveSession: boolean;
    onclick: () => void;
  } = $props();

  let stateIcon = $derived(
    pr.state === 'OPEN' ? '○' :
    pr.state === 'MERGED' ? '⬤' :
    '⊗'
  );

  let stateClass = $derived(
    pr.state === 'OPEN' ? 'pr-state pr-open' :
    pr.state === 'MERGED' ? 'pr-state pr-merged' :
    'pr-state pr-closed'
  );

  let roleBadge = $derived(pr.role === 'author' ? 'Author' : 'Reviewer');

  let reviewIcon = $derived(
    pr.reviewDecision === 'APPROVED' ? '✓' :
    pr.reviewDecision === 'CHANGES_REQUESTED' ? '✗' :
    pr.reviewDecision === 'REVIEW_REQUIRED' ? '⏳' :
    ''
  );

  let reviewClass = $derived(
    pr.reviewDecision === 'APPROVED' ? 'review-approved' :
    pr.reviewDecision === 'CHANGES_REQUESTED' ? 'review-changes' :
    'review-pending'
  );

  let relativeTime = $derived(formatRelativeTime(pr.updatedAt));

  function handleExternalClick(e: MouseEvent) {
    e.stopPropagation();
    window.open(pr.url, '_blank', 'noopener');
  }

  function measureOverflow(node: HTMLElement) {
    const update = () => {
      const overflow = node.scrollWidth - node.clientWidth;
      if (overflow > 0) {
        node.style.setProperty('--scroll-distance', `-${overflow}px`);
        node.classList.add('has-overflow');
      } else {
        node.classList.remove('has-overflow');
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return { destroy() { ro.disconnect(); } };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class="pr-item"
  class:active-session={isActiveSession}
  onclick={onclick}
>
  <div class="pr-info">
    <div class="pr-row-1">
      <span class={stateClass}>{stateIcon}</span>
      <span class="pr-title" use:measureOverflow>{pr.title}</span>
      <div class="pr-actions">
        {#if reviewIcon}
          <span class="review-badge {reviewClass}" title={pr.reviewDecision ?? ''}>{reviewIcon}</span>
        {/if}
        <button class="external-link-btn" aria-label="Open in GitHub" onclick={handleExternalClick}>↗</button>
      </div>
    </div>
    <div class="pr-row-2">
      <span class="row-2-spacer"></span>
      <span class="pr-meta">#{pr.number} · {pr.author}</span>
      <span class="role-badge role-{pr.role}">{roleBadge}</span>
    </div>
    {#if relativeTime || pr.additions || pr.deletions}
      <div class="pr-row-3">
        <span class="row-3-spacer"></span>
        <span class="pr-time">{relativeTime}</span>
        {#if pr.additions || pr.deletions}
          <span class="git-diff">
            {#if pr.additions}<span class="diff-add">+{pr.additions}</span>{/if}
            {#if pr.deletions}<span class="diff-del">-{pr.deletions}</span>{/if}
          </span>
        {/if}
      </div>
    {/if}
  </div>
</li>

<style>
  li.pr-item {
    display: flex;
    align-items: flex-start;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: 6px;
    margin: 2px 6px;
    font-size: 0.8rem;
    color: var(--text-muted);
    touch-action: manipulation;
    transition: background 0.15s, border-color 0.15s;
    background: transparent;
    border: 1px solid var(--border);
    opacity: 0.8;
  }

  li.pr-item:hover {
    opacity: 1;
    border-color: var(--accent);
  }

  li.pr-item.active-session {
    background: var(--bg);
    border-color: var(--accent);
    opacity: 1;
  }

  .pr-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .pr-row-1 {
    display: flex;
    align-items: center;
    gap: 0;
    min-width: 0;
  }

  .pr-state {
    font-size: 0.65rem;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    margin-right: 4px;
  }

  .pr-open { color: #4ade80; }
  .pr-merged { color: #a78bfa; }
  .pr-closed { color: #f87171; }

  .pr-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 500;
    color: var(--text);
  }

  .pr-title.has-overflow {
    mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
  }

  li:hover .pr-title.has-overflow {
    mask-image: none;
    -webkit-mask-image: none;
    animation: text-scroll 4s linear 0.5s forwards;
  }

  @keyframes text-scroll {
    0%, 5% { transform: translateX(0); }
    45%, 55% { transform: translateX(var(--scroll-distance)); }
    95%, 100% { transform: translateX(0); }
  }

  .pr-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s 0.1s;
  }

  li:hover .pr-actions {
    opacity: 1;
  }

  @media (hover: none) {
    .pr-actions { opacity: 1; }
  }

  .external-link-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    touch-action: manipulation;
    flex-shrink: 0;
    transition: color 0.15s, transform 0.15s;
  }

  .external-link-btn:hover {
    color: var(--accent);
    transform: scale(1.1);
  }

  .review-badge {
    font-size: 0.7rem;
    padding: 0 3px;
  }

  .review-approved { color: #4ade80; }
  .review-changes { color: #f87171; }
  .review-pending { color: #f59e0b; }

  .pr-row-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 0;
  }

  .row-2-spacer {
    display: inline-block;
    width: 20px;
    flex-shrink: 0;
  }

  .pr-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .role-badge {
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .role-author {
    background: rgba(96, 165, 250, 0.15);
    color: #60a5fa;
  }

  .role-reviewer {
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
  }

  .pr-row-3 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .row-3-spacer {
    display: inline-block;
    width: 20px;
    flex-shrink: 0;
  }

  .pr-time {
    font-size: 0.65rem;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .git-diff {
    display: flex;
    gap: 4px;
    font-size: 0.65rem;
    font-family: monospace;
  }

  .diff-add { color: #4ade80; }
  .diff-del { color: #f87171; }
</style>
```

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Commit**

```bash
git add frontend/src/components/PullRequestItem.svelte
git commit -m "feat: create PullRequestItem component"
```

---

### Task 9: Render PR list in `SessionList.svelte` with error messages, refresh button, repo highlight

**Files:**
- Modify: `frontend/src/components/SessionList.svelte`
- Modify: `frontend/src/components/SessionFilters.svelte` (add repo highlight class)

**Step 1: Add PR tab content to template**

In the `<ul class="session-list">` section, change `{:else}` to `{:else if ui.activeTab === 'worktrees'}` and add PRs block:

```svelte
<ul class="session-list">
  {#if ui.activeTab === 'repos'}
    <!-- ... existing repos content unchanged ... -->
  {:else if ui.activeTab === 'worktrees'}
    <!-- ... existing worktrees content unchanged ... -->
  {:else}
    {#if !ui.repoFilter}
      <li class="pr-hint">Select a repo to view pull requests</li>
    {:else if $prQuery.isLoading}
      <li class="pr-hint">Loading pull requests...</li>
    {:else if prError === 'gh_not_authenticated'}
      <li class="pr-hint">GitHub CLI not authenticated<br /><span class="pr-hint-sub">Run <code>gh auth login</code> on the host</span></li>
    {:else if prError}
      <li class="pr-hint">Could not fetch pull requests</li>
    {:else if filteredPullRequests.length === 0}
      <li class="pr-hint">No open pull requests</li>
    {:else}
      {#each filteredPullRequests as pr (pr.number)}
        <PullRequestItem
          {pr}
          isActiveSession={!!findSessionForBranch(pr.headRefName)}
          onclick={() => handlePRClick(pr)}
        />
      {/each}
    {/if}
  {/if}
</ul>
```

**Step 2: Add refresh button**

Add a refresh button above the PR list (inside the PRs tab block, before the conditional content). Place it between the `{:else}` and the first `{#if !ui.repoFilter}`:

```svelte
  {:else}
    {#if ui.repoFilter}
      <div class="pr-toolbar">
        <button
          class="refresh-btn"
          onclick={() => $prQuery.refetch()}
          disabled={$prQuery.isFetching}
          aria-label="Refresh pull requests"
        >
          <span class:spinning={$prQuery.isFetching}>↻</span>
        </button>
      </div>
    {/if}
    {#if !ui.repoFilter}
      <!-- ... rest of conditionals ... -->
```

**Step 3: Add repo highlight CSS class to SessionFilters**

In `SessionFilters.svelte`, add a class to the repo `<select>` when PRs tab is active and no repo is selected:

```svelte
  <select
    value={ui.repoFilter}
    class:highlight={ui.activeTab === 'prs' && !ui.repoFilter}
    onchange={(e) => { ui.repoFilter = (e.target as HTMLSelectElement).value; }}
  >
```

Add style:

```css
  select.highlight {
    border-color: var(--accent);
    animation: pulse-border 2s ease-in-out infinite;
  }

  @keyframes pulse-border {
    0%, 100% { border-color: var(--accent); box-shadow: 0 0 0 0 rgba(217, 119, 87, 0); }
    50% { border-color: var(--accent); box-shadow: 0 0 6px 2px rgba(217, 119, 87, 0.3); }
  }
```

**Step 4: Add styles for PR toolbar and hints**

Add to `SessionList.svelte` `<style>`:

```css
  .pr-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 10px 0;
  }

  .refresh-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 2px 6px;
    transition: color 0.15s, border-color 0.15s;
  }

  .refresh-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinning {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  :global(.pr-hint) {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
    padding: 20px 12px;
    opacity: 0.6;
    list-style: none;
  }

  :global(.pr-hint-sub) {
    font-size: 0.65rem;
    opacity: 0.8;
    display: block;
    margin-top: 4px;
  }

  :global(.pr-hint code) {
    background: var(--bg);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.65rem;
  }
```

**Step 5: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 6: Commit**

```bash
git add frontend/src/components/SessionList.svelte frontend/src/components/SessionFilters.svelte
git commit -m "feat: render PR list with error messages, refresh button, and repo highlight"
```

---

### Task 10: Add Author/Reviewer filter toggle

**Files:**
- Modify: `frontend/src/components/SessionFilters.svelte`

**Step 1: Add role filter segmented button**

After the `<input>` element in `SessionFilters.svelte`, add (only visible when PRs tab is active):

```svelte
  {#if ui.activeTab === 'prs'}
    <div class="role-filter">
      <button
        class="role-btn"
        class:active={ui.prRoleFilter === 'all'}
        onclick={() => { ui.prRoleFilter = 'all'; }}
      >All</button>
      <button
        class="role-btn"
        class:active={ui.prRoleFilter === 'author'}
        onclick={() => { ui.prRoleFilter = 'author'; }}
      >Author</button>
      <button
        class="role-btn"
        class:active={ui.prRoleFilter === 'reviewer'}
        onclick={() => { ui.prRoleFilter = 'reviewer'; }}
      >Reviewer</button>
    </div>
  {/if}
```

Add styles:

```css
  .role-filter {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .role-btn {
    flex: 1;
    padding: 5px 8px;
    background: var(--bg);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .role-btn:last-child {
    border-right: none;
  }

  .role-btn:hover {
    color: var(--text);
  }

  .role-btn.active {
    background: var(--accent);
    color: #fff;
  }
```

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Commit**

```bash
git add frontend/src/components/SessionFilters.svelte
git commit -m "feat: add Author/Reviewer role filter for PRs tab"
```

---

### Task 11: PR click cascade — active session → inactive worktree → create new

**Files:**
- Modify: `frontend/src/components/SessionList.svelte`
- Modify: `frontend/src/components/Sidebar.svelte`

**Step 1: Implement the 3-step click handler**

In `SessionList.svelte`, add helpers and handler:

```typescript
  function findSessionForBranch(branchName: string): SessionSummary | undefined {
    return state.sessions.find(s =>
      s.type === 'worktree' && s.worktreeName === branchName
    );
  }

  function findWorktreeForBranch(branchName: string): WorktreeInfo | undefined {
    return state.worktrees.find(wt => wt.name === branchName);
  }

  async function handlePRClick(pr: PullRequest) {
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
      try {
        const session = await api.createSession({
          repoPath: existingWorktree.repoPath,
          repoName: existingWorktree.repoName,
          worktreePath: existingWorktree.path,
        });
        await refreshAll();
        if (session?.id) {
          onSelectSession(session.id);
        }
      } catch { /* user can retry */ }
      return;
    }

    // Step 3: No local worktree → create new worktree + session
    const repo = state.repos.find(r => r.name === ui.repoFilter);
    if (!repo) return;

    try {
      const session = await api.createSession({
        repoPath: repo.path,
        repoName: repo.name,
        branchName: pr.headRefName,
      });
      await refreshAll();
      if (session?.id) {
        onSelectSession(session.id);
      }
    } catch { /* user can retry */ }
  }
```

**Step 2: Update Sidebar new session label**

In `Sidebar.svelte`, update the `newSessionLabel` derived:

```typescript
  let newSessionLabel = $derived(
    ui.activeTab === 'repos' ? '+ New Session' :
    ui.activeTab === 'prs' ? '+ New Session' :
    '+ New Worktree'
  );
```

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add frontend/src/components/SessionList.svelte frontend/src/components/Sidebar.svelte
git commit -m "feat: implement PR click cascade with worktree resume support"
```

---

### Task 12: Build and manual smoke test

**Files:** None (verification only)

**Step 1: Full build**

Run: `npm run build`
Expected: Clean compilation, zero errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Manual smoke test**

Run: `npm start`

Verify:
1. Sidebar shows three tabs: Repos, Worktrees, PRs
2. Filters (root, repo, search) appear below the tab bar
3. Clicking PRs tab with no repo selected highlights repo dropdown with pulsing accent border
4. "Select a repo to view pull requests" hint shown
5. Selecting a repo triggers PR fetch (loading state shown)
6. If `gh` not authenticated, shows "GitHub CLI not authenticated — run `gh auth login`"
7. PRs display with correct state icons (green = open)
8. Author/Reviewer segmented toggle filters the list
9. Refresh button (↻) fetches fresh data; spins while fetching
10. Hovering a PR shows external link button (↗) and review badge
11. Clicking external link opens GitHub PR URL in new tab
12. Clicking a PR with an active session routes to that session
13. Clicking a PR with an inactive worktree resumes that worktree
14. Clicking a PR with no local worktree creates a new worktree + session
15. Active session PRs show highlighted border

**Step 4: Final commit if any adjustments needed**

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
