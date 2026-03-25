# Fix: Worktree branch name reuse causes stale PR associations

> **Status**: Active | **Created**: 2026-03-25
> **Source**: `docs/bug-analyses/2026-03-25-worktree-branch-reuse-stale-pr-bug-analysis.md`

## Progress

- [x] Task 1: Add unique suffix to mountain branch names
- [x] Task 2: Add `updatedAt` to PR lookup and PrInfo types
- [x] Task 3: Filter stale PRs in server endpoints
- [x] Task 4: Build and verify

---

### Task 1: Add unique suffix to mountain branch names
**Files:** `server/workspaces.ts`
**What:** In the `POST /workspaces/worktree` handler, after selecting a mountain name, append a 4-char random hex suffix to the branch name (e.g., `kilimanjaro-a3f2`). The directory name stays as the bare mountain name (for readability). The collision check already verifies `git rev-parse --verify <branch>` — the suffix makes collisions virtually impossible, but the check remains as a safety net.

**Details:**
- Generate suffix: `crypto.randomBytes(2).toString('hex')` → 4 hex chars
- Branch name: `(branchPrefix ?? '') + mountainName + '-' + suffix`
- Directory name: stays as `mountainName` (no suffix)
- The collision check loop still works — it checks the full branch name including suffix
- Update the `gitArgs` line to use the new branch name format

### Task 2: Add `updatedAt` to PR lookup and PrInfo types
**Files:** `server/git.ts`, `server/types.ts`, `frontend/src/lib/types.ts`
**What:** Add `updatedAt` field to `getPrForBranch()` query and both `PrInfo` interfaces so consumers can filter by age.

**Details:**
- `getPrForBranch`: add `updatedAt` to the `--json` fields list
- Parse `updatedAt` as a string (ISO 8601) from the response
- Add `updatedAt: string` to `PrInfo` in `server/types.ts` and `frontend/src/lib/types.ts`

### Task 3: Filter stale PRs in server endpoints
**Files:** `server/workspaces.ts`, `server/sessions.ts`
**What:** After calling `getPrForBranch()`, check if the PR is stale (MERGED or CLOSED AND updatedAt > 1 day ago). If stale, treat as no PR found.

**Details:**
- Create helper: `isStale(pr: PrInfo): boolean` — returns true if `pr.state !== 'OPEN' && Date.now() - new Date(pr.updatedAt).getTime() > 86400000`
- `GET /workspaces/pr` (workspaces.ts): if `isStale(pr)`, return 404
- `fetchMetaForSession` (sessions.ts): if `isStale(pr)`, skip PR data and fall through to working tree diff

### Task 4: Build and verify
**What:** Run `npm run build` and `npm test` to verify everything compiles and tests pass.
