# Execution Plan: Org Dashboard Phase 1

> **Status**: Active | **Created**: 2026-03-21
> **Source**: `docs/design-docs/2026-03-21-org-dashboard-phase1-design.md`

## Progress

- [x] Task 1: Backend types — add `workspaceGroups` to Config, extend `PullRequest`
- [x] Task 2: Config validation — validate `workspaceGroups` in `loadConfig`
- [x] Task 3: Org dashboard backend — `server/org-dashboard.ts` (NEW)
- [x] Task 4: Mount router — `server/index.ts`
- [x] Task 5: Backend tests — config validation + org-dashboard route tests
- [x] Task 6: Frontend types + API — extend PullRequest, add OrgPrsResponse, add fetchOrgPrs()
- [x] Task 7: OrgDashboard component — `frontend/src/components/OrgDashboard.svelte` (NEW)
- [x] Task 8: Sidebar changes — Home button + group headers
- [x] Task 9: App.svelte — extend `viewMode` to include `'org'`
- [x] Task 10: Verify — build + all tests pass (310/310)
