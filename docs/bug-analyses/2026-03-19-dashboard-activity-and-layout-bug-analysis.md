# Bug Analysis: Dashboard Activity Feed Broken + Layout Overflows Viewport

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High (activity feed), Medium (layout)
> **Affected Area**: `server/git.ts` (getActivityFeed), `frontend/src/components/RepoDashboard.svelte`

## Symptoms
1. "RECENT ACTIVITY" section always shows "No recent commits (24h)" even on active repos with commits minutes old
2. Dashboard layout expands beyond viewport height — PR table with many entries pushes the page down requiring a full-page scroll instead of sections scrolling independently

## Reproduction Steps

### Activity Feed
1. Navigate to a workspace dashboard for any active repo
2. Observe "No recent commits (24h)" despite recent commits existing
3. Run `git log --since=24h --oneline --max-count=1` — empty output
4. Run `git log --since="24 hours ago" --oneline --max-count=1` — shows commits

### Layout
1. Navigate to a workspace with 10+ open PRs (e.g., extend-api)
2. Observe the PR table expands the full page height
3. "RECENT ACTIVITY" section and CTA buttons are pushed below the fold
4. Entire dashboard scrolls as one long page instead of sections scrolling independently

## Root Cause

### Issue 1: Invalid git date format

**`server/git.ts:110`** uses `--since=24h` which is **not a valid git date format**. Git silently accepts it but matches zero commits.

```typescript
'--since=24h',  // ← BROKEN: "24h" is not a valid git date
```

Valid formats include: `"24 hours ago"`, `"24.hours"`, `"1 day ago"`, or ISO timestamps. The `24h` shorthand is not recognized by git's date parser — git doesn't error, it just returns no results.

**Evidence:**
```bash
$ git log --since=24h --oneline --max-count=1
(empty)
$ git log --since="24 hours ago" --oneline --max-count=1
1c181fb 3.3.0
```

The error is silent because `getActivityFeed` (git.ts:166-168) catches all errors and returns `[]`, and the git command itself exits 0 even with the invalid date.

### Issue 2: No scroll containment in dashboard layout

**`RepoDashboard.svelte:230-240`** has the dashboard as a flex column with `overflow-y: auto` on the outer container, but no height constraints on the inner sections:

```css
.repo-dashboard {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
}
```

The `.pr-list` (line 298) and `.activity-list` (line 449) are both unconstrained flex columns — they expand to their full content height, pushing the entire dashboard beyond the viewport. The `overflow-y: auto` on the outer container means the **whole page** scrolls rather than individual sections.

## Evidence
- `git log --since=24h` returns empty on repos with commits minutes old
- `git log --since="24 hours ago"` returns correct results on the same repos
- Screenshot shows extend-api (very active repo) with "No recent commits (24h)"
- Screenshot shows 14+ PR rows pushing content well beyond viewport with no scroll containment

## Impact Assessment
- **Activity feed**: Broken for ALL repos, ALL users — shows empty on every dashboard
- **Layout**: Affects any workspace with >5 PRs — pushes CTA buttons and activity section below the fold
- **UX**: Users see an empty "Recent Activity" section and may think the repo is inactive

## Recommended Fix Direction

### Fix 1: Git date format (1-line fix)
Change `server/git.ts:110` from `'--since=24h'` to `'--since=24 hours ago'`.

### Fix 2: Dashboard scroll containment
Restructure `RepoDashboard.svelte` layout to:
1. Make the dashboard a fixed-height flex container that fills available viewport space
2. Give `.pr-list` and `.activity-list` their own scroll containers with `overflow-y: auto` and `max-height` constraints (or flex-based sizing)
3. Add gradient fade overlays at top/bottom of each scroll container to indicate more content exists off-screen (CSS `::before`/`::after` pseudo-elements with `pointer-events: none` and a linear-gradient from transparent to background color)
4. Pin the CTA buttons row at the bottom (flex-shrink: 0)
5. Pin section headings as sticky within their scroll containers
