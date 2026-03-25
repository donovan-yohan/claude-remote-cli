---
status: current
---
# Relay PR #48 Review Fixes

> **Status**: Planned
> **Phase**: Post-review fixes for Relay Phases 1-3

## Goal

Address all 21 review findings from the 6-agent PR review + eng review of PR #48, covering security fixes, correctness bugs, error handling, type safety, test coverage, and documentation staleness.

## Approach

Fix all items in a single commit on the existing `table-redesign-tanstack` branch.

## Key Decisions

- Fix all 21 items now (boil the lake) rather than deferring any
- Group into parallel-safe batches by file dependency

## Fixes

### Critical/Security (3)
1. **Webhook body parsing** — mount webhook router before global `express.json()` so HMAC verify callback fires
2. **OAuth CSRF state** — add cryptographic `state` param to OAuth URL, validate on callback
3. **Missing `credentials: 'include'`** — add to `fetchGitHubStatus`, `fetchGitHubAuthUrl`, `disconnectGitHub`

### Correctness (5)
4. **OAuth callback double-mount** — fix route so callback is `/auth/github/callback` not `/auth/github/callback/callback`
5. **StatusDot draft sizing** — add `box-sizing: border-box` to base `.status-dot` class
6. **RepoDashboard template literals** — fix `{workspaceName}` string interpolation
7. **config.ts DEFAULT_PRESETS mutation** — clone defaults instead of assigning by reference
8. **DataTable collapsed group focus** — skip hidden rows in arrow nav, reset on collapse

### Error Handling (4)
9. **api.ts preset mutations** — check `res.ok` in `savePreset`, `deletePreset`, `fetchPresets`
10. **OrgDashboard unhandled rejections** — add try-catch to `handleSaveCurrentView`, `handleDeletePreset`
11. **GraphQL partial errors** — log `json.errors` even when `json.data` is present
12. **org-dashboard GraphQL fallback** — add `console.warn` to bare `catch {}`
13. **Smee silent failures** — add logging to catch blocks and logger.error callback

### Type Safety (2)
14. **Spotlight discriminated union** — refactor `SpotlightResult` from `data: unknown` to typed per variant
15. **reviewDecision + mergeable literal unions** — narrow from `string | null` to actual GitHub values

### Cleanup (3)
16. **Sidebar data-track** — restore `data-track="sidebar.home"` on Relay brand click
17. **Dead code removal** — remove unused `deriveJiraDotStatus` export
18. **Preset validation** — add `sort.column` validation, duplicate name prevention

### Post-connect webhook startup (1)
19. **Smee/polling after OAuth** — start webhook delivery after OAuth callback saves token

### Tests (2)
20. **Preset CRUD tests** — GET/POST/DELETE /presets endpoint tests
21. **GraphQL 200-with-errors test** — cover token expiry error path

### Documentation (1)
22. **Architecture docs** — update module count, remove SmartSearch reference, add new modules

## Files to Modify

| File | Changes |
|------|---------|
| `server/index.ts` | Webhook mount order, OAuth route fix, preset validation, smee logging, post-connect startup |
| `server/github-app.ts` | CSRF state parameter |
| `server/github-graphql.ts` | Partial error logging |
| `server/org-dashboard.ts` | GraphQL fallback logging |
| `server/config.ts` | Clone DEFAULT_PRESETS |
| `server/webhooks.ts` | (no changes — fix is in index.ts mount order) |
| `frontend/src/lib/api.ts` | credentials: include, res.ok checks |
| `frontend/src/lib/types.ts` | Narrow reviewDecision, mergeable |
| `server/types.ts` | Narrow reviewDecision, mergeable |
| `frontend/src/lib/pr-status.ts` | Remove deriveJiraDotStatus |
| `frontend/src/components/Spotlight.svelte` | Discriminated union |
| `frontend/src/components/StatusDot.svelte` | box-sizing |
| `frontend/src/components/Sidebar.svelte` | data-track |
| `frontend/src/components/RepoDashboard.svelte` | Template literals |
| `frontend/src/components/OrgDashboard.svelte` | Try-catch on preset handlers |
| `frontend/src/components/DataTable.svelte` | Collapsed group focus |
| `frontend/src/components/SettingsDialog.svelte` | Clear poll interval |
| `docs/ARCHITECTURE.md` | Module count, new modules, remove SmartSearch |
| `test/presets.test.ts` | New: preset CRUD tests |
| `test/github-graphql.test.ts` | Add 200-with-errors test |
