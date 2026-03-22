# Workspace Grouping + Global Dashboard + Cross-Repo PRs

> **Status**: Current
> **Phase**: 1 of 5 (Org Dashboard initiative)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/donovanyohan-master-design-20260321-160000.md`
> **Depends on**: Nothing (first phase)

## Goal

Add workspace grouping and a global "Home" dashboard that aggregates PRs across all repos using a single GitHub Search API call. This is the foundation for the org dashboard initiative.

## Approach

**Dashboard-First (Bottom-Up):** Ship workspace grouping + cross-repo PR aggregation as an independently useful feature. No ticket integrations yet.

### Key Decisions (from eng review + design review)

1. **Nav state:** Derive org view from `activeWorkspacePath === null` — no new state variables. Home button at top of sidebar sets path to null.
2. **Backend:** New `server/org-dashboard.ts` with single GitHub Search API call (`gh api search/issues?q=is:pr+is:open+involves:@me`) + 60s server-side cache. Filter results to workspace repos only.
3. **Config:** Add `workspaceGroups?: Record<string, string[]>` to Config as display-only overlay on `workspaces[]`. Validation: console.warn on invalid/duplicate paths, filter silently. First-group-wins dedup.
4. **PR type:** Extend existing `PullRequest` with optional `repoName?: string` and `repoPath?: string`.
5. **Role detection:** Fetch `gh api /user` once, cache for server lifetime. Check `author.login` and `reviewRequests[].login` per PR.
6. **No new backend route for per-workspace dashboard** — existing `GET /workspaces/dashboard` unchanged.

### Files to Create

| File | Purpose |
|------|---------|
| `server/org-dashboard.ts` | Express router: `GET /org-dashboard/prs` — single Search API call, role detection, server-side cache |
| `frontend/src/components/OrgDashboard.svelte` | Global dashboard component with PR table, filter bar, skeleton loader, empty/error states |

### Files to Modify

| File | Change |
|------|--------|
| `server/types.ts` | Add `workspaceGroups` to Config, add optional `repoName`/`repoPath` to PullRequest |
| `server/config.ts` | Add `workspaceGroups` validation in `loadConfig` with console.warn |
| `server/index.ts` | Mount org-dashboard router |
| `frontend/src/lib/state/ui.svelte.ts` | No changes needed — derive from `activeWorkspacePath === null` |
| `frontend/src/components/Sidebar.svelte` | Add Home button (full-width row above SmartSearch), group headers (collapsible dividers) |
| `frontend/src/App.svelte` | Extend `viewMode` derived to include `'org'` when `activeWorkspacePath === null && workspaces.length > 0` |
| `frontend/src/lib/api.ts` | Add `fetchOrgPrs()` function |

### Design Specifications

**Information Hierarchy:**
1. Header (context): group name + summary stats ("All · 5 repos · 4 open PRs")
2. Filter bar (control): state filter [Open/All/Merged] + sort [Updated/Title/Repo]
3. PR table (primary content)

**Home Button:** Full-width row at top of sidebar, above SmartSearch. Icon + "Home" label. Active state: `var(--accent)` left border. On mobile: closes sidebar.

**Group Headers:** Collapsible dividers, `var(--text-muted)`, uppercase, `letter-spacing: 1.5px`. Groups with 0 valid repos hidden. Ungrouped repos at bottom.

**PR Table:** Reuses RepoDashboard patterns (status dots, action pills, relative timestamps). Repo chips use `deriveColor(repoName)`. Filter dropdowns via existing `SearchableSelect`.

**Interaction States:**

| Feature | Loading | Empty | Error | Partial |
|---|---|---|---|---|
| OrgDashboard PRs | 3 skeleton rows | "No open PRs across your repos. Great work!" + link | "Couldn't reach GitHub." + retry | Show available + warning chip |
| gh CLI missing | N/A | "Install GitHub CLI" + link | N/A | N/A |
| Home (no workspaces) | N/A | Existing EmptyState | N/A | N/A |

**Responsive (< 600px):** PR table becomes card list — title first line, repo chip + status + role second line, action button full-width.

**Accessibility:** `role="table"` with column headers, descriptive `aria-label`s on action buttons, 44px mobile touch targets.

### Tests

- Config validation: valid groups, invalid paths (warn), duplicates (warn+dedup), undefined workspaces, empty groups
- org-dashboard: gh authenticated success, gh not authed error, gh not in PATH, zero results, results filtered to workspace repos, timeout handling

### Success Criteria

- Home button shows global PR dashboard
- PRs aggregated from all workspace repos via single GitHub Search API call
- Group headers divide sidebar when `workspaceGroups` configured
- Ungrouped repos appear in default section
- Sort/filter work on PR table
- Mobile card layout at < 600px
- 300+ existing tests still pass
