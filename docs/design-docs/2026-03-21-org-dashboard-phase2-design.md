---
status: implemented
---
# GitHub Issues + Branch Linking

> **Status**: Planned
> **Phase**: 2 of 5 (Org Dashboard initiative)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/donovanyohan-master-design-20260321-160000.md`
> **Depends on**: Phase 1 (workspace grouping + org dashboard shell)

## Goal

Add GitHub Issues integration to the org dashboard with a Tickets tab, and implement branch-name-based ticket linking that works retroactively for branches created outside claude-remote-cli.

## Approach

### Key Decisions

1. **GitHub Issues via `gh issue list --json`** — uses existing CLI, no new auth
2. **Branch linking patterns:** Jira/Linear: `/([A-Z]{2,}-\d+)/i`, GitHub Issues: `/(?:^|[/-])gh-(\d+)(?:[/-]|$)/`
3. **Branch-linker data model:** `Map<ticketId, Array<{repoPath, branchName, hasActiveSession}>>` — supports multi-repo tickets (Codex review finding)
4. **Caching:** 60s TTL in-memory cache, invalidated on worktree create/delete via session lifecycle callbacks
5. **Ticket IDs normalized to uppercase** for cache keys
6. **PR table ticket chips:** Once branch-linker ships, PR rows show linked ticket ID as chip

### Files to Create

| File | Purpose |
|------|---------|
| `server/integration-github.ts` | `gh issue list --json` with 60s cache, returns assigned issues for workspace repos |
| `server/branch-linker.ts` | Scans branches across repos for ticket ID patterns, caches results |
| `frontend/src/components/TicketsPanel.svelte` | Tabbed ticket view (GitHub Issues tab initially) |
| `frontend/src/components/TicketCard.svelte` | Individual ticket with status, linked branch indicator, "Start Work" button |

### Files to Modify

| File | Change |
|------|--------|
| `server/types.ts` | Add `integrations` to Config, add GitHub Issue types |
| `server/index.ts` | Mount integration-github and branch-linker routes |
| `server/sessions.ts` | Add callback registration for branch-linker cache invalidation |
| `frontend/src/components/OrgDashboard.svelte` | Add Tickets tab alongside PRs tab |
| `frontend/src/lib/api.ts` | Add `fetchGithubIssues()`, `fetchBranchLinks()` |

### Reviewer Concerns (from eng/Codex review)

- Branch-linker must use `Array<>` not single-entry per ticket ID
- Cache invalidation requires new callback wiring in `sessions.ts`
- GitHub Issues `gh-42` convention is restrictive for retroactive linking — document this limitation
- Forked PR review: use `gh pr checkout` instead of raw branch names for the "Review" button

### Success Criteria

- GitHub Issues tab shows assigned issues across workspace repos
- Branch names containing ticket IDs are linked bidirectionally
- PR rows show ticket ID chips for linked branches
- "Start Work" button visible on ticket cards (action deferred to Phase 3)
