# Fix: Worktree Discovery Missing for Direct Workspaces

> **Status**: Active | **Created**: 2026-03-26 | **Last Updated**: 2026-03-26
> **Bug Analysis**: `docs/bug-analyses/2026-03-26-worktree-discovery-missing-bug-analysis.md`
> **Consulted Learnings**: L-20260326-repo-source-unification
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-26 | Design | Extend existing `scanAllRepos` with workspace merging rather than new helper | Minimizes blast radius — `scanAllRepos` is already used elsewhere, extending it keeps one source of truth |
| 2026-03-26 | Design | Inline fix in GET /worktrees rather than refactoring all callers | Only GET /worktrees has this bug; other endpoints use ?repo= param |

## Progress

- [x] Task 1: Add workspace paths to repo scanning in GET /worktrees
- [x] Task 2: Add test for workspace-only worktree discovery

## Surprises & Discoveries

_None yet._

## Plan Drift

_None yet._

---

### Task 1: Add workspace paths to repo scanning in GET /worktrees

**File:** `server/index.ts`
**What:** After the rootDir scanning loop (line 639), add directly-configured workspaces from `config.workspaces[]` to `reposToScan`, deduplicating by path.

**Steps:**
1. Read `server/index.ts` lines 618-640 (the else branch of GET /worktrees)
2. After the rootDir scanning loop, add:
   ```typescript
   // Also include directly-configured workspaces (may not be under any rootDir)
   const configWorkspaces = getConfig().workspaces ?? [];
   const scannedPaths = new Set(reposToScan.map(r => r.path));
   for (const wp of configWorkspaces) {
     if (scannedPaths.has(wp)) continue;
     const root = roots.find(r => wp.startsWith(r)) || '';
     reposToScan.push({ path: wp, name: wp.split('/').filter(Boolean).pop() || '', root });
   }
   ```
3. Build and verify no compile errors

**Verify:** `npm run build` succeeds

### Task 2: Add test for workspace-only worktree discovery

**File:** `test/worktree.test.ts`
**What:** Add a test that verifies worktrees are discovered for workspaces that exist in `config.workspaces` but not under any `rootDir`.

**Steps:**
1. Read existing worktree tests to understand the test patterns
2. Add a test case that sets up a config with a workspace path not under any rootDir and verifies the GET /worktrees endpoint includes its worktrees
3. Run tests

**Verify:** `npm test` passes with the new test

---

## Deliverable Traceability

| Bug Analysis Deliverable | Plan Task |
|-------------------------|-----------|
| Include config.workspaces in GET /worktrees scan | Task 1 |
| Test workspace-only scenario | Task 2 |

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
