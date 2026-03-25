---
status: current
---
# Jira Integration — CLI-Based Rewrite via acli

> **Status**: Current
> **Source**: `/office-hours` design doc + `/plan-eng-review` decisions + acli verification
> **Supersedes**: Phase 4 design (2026-03-21-org-dashboard-phase4-design.md)

## Goal

Replace the Jira integration's direct REST API calls (requiring manual env var setup) with `acli` CLI calls, matching the GitHub integration's zero-config pattern. Remove the Linear integration entirely (defer until Linear CLI matures).

## Approach

### Key Decisions

1. **CLI-based, like GitHub** — `execFile('acli', [...])` replaces `fetch()` to Jira REST API. Auth delegated to acli's own OAuth flow (`acli jira auth login --web`).
2. **Remove `/configured` endpoint** — handle everything inline from `/issues` error codes (matches GitHub pattern). Frontend always shows the Jira tab; displays setup instructions on error. *(Eng review Issue 1)*
3. **Transition names, not IDs** — `acli jira workitem transition --key KEY --status "Name" --yes`. StatusMappingModal stores transition names. *(Eng review Issue 2)*
4. **Remove Linear entirely** — not feature-flagged. Git history is the recovery path. Linear CLI (`schpet/linear-cli`) lacks `--json` on `linear issue list`.
5. **Prefix heuristic for detectTicketSource()** — 3+ uppercase chars before dash = Jira, GH- = GitHub. No CLI availability check. *(Eng review Issue 4)*
6. **Explicitly list dead code removals** — `isValidJiraUrl()`, `buildAuthHeader()`, `getEnvVars()`, `linearStateUpdate()`. *(Eng review Issue 3)*

### Verified acli Command Reference

All commands verified locally against `acli v1.3.14-stable` authenticated to `paywithextend.atlassian.net`.

**Auth check:**
```bash
acli jira auth status
# Authenticated: exit 0, prints site + email
# Not authenticated: exit 1, prints "use 'acli jira auth login'"
```

**Issue search:**
```bash
acli jira workitem search --jql "assignee=currentUser() AND status NOT IN (Done, Closed) ORDER BY updated DESC" --json --limit 50
```
JSON output per issue:
- `key` → issue key (e.g., "EX-38798")
- `fields.summary` → title
- `fields.status.name` → status name
- `fields.priority.name` → priority name (nullable)
- `fields.assignee.displayName` → assignee name (nullable)
- `self` → API URL (construct browse URL from auth status site URL + `/browse/{key}`)
- **NOT available in search:** `updatedAt`, `sprint`, `storyPoints` (custom fields blocked by acli `--fields` allowlist). Results arrive pre-sorted by updated DESC from JQL.

**Transitions:**
```bash
acli jira workitem transition --key "EX-123" --status "Dev In Progress" --yes
# --status takes transition NAME (not ID)
# --yes skips interactive confirmation
```

**Statuses listing (workaround):**
No `acli jira project statuses` command exists. Get unique statuses by searching issues:
```bash
acli jira workitem search --jql "project = EX" --fields "status" --json --limit 50
# Parse unique fields.status.name values from results
```

**Browse URL construction:**
```bash
acli jira auth status
# Output: "Site: paywithextend.atlassian.net"
# Browse URL: https://{site}/browse/{key}
```

### Data Mapping

| JiraIssue field | acli source | Available? |
|---|---|---|
| `key` | `item.key` | Yes |
| `title` | `item.fields.summary` | Yes |
| `url` | Constructed: `https://{site}/browse/{key}` | Yes |
| `status` | `item.fields.status.name` | Yes |
| `priority` | `item.fields.priority?.name ?? null` | Yes |
| `assignee` | `item.fields.assignee?.displayName ?? null` | Yes |
| `projectKey` | `item.key.split('-')[0]` | Yes (derived) |
| `updatedAt` | N/A — JQL sorts, no timestamp in response | Set to `''` |
| `sprint` | N/A — custom field blocked by acli | Set to `null` |
| `storyPoints` | N/A — custom field blocked by acli | Set to `null` |

### Implementation Steps

#### 1. Rewrite `server/integration-jira.ts`

Replace fetch-based handlers with execFile('acli') calls:

- **Remove** `GET /configured` endpoint entirely
- **Rewrite** `GET /issues`:
  - Run `acli jira auth status` to get site URL (cache for server lifetime)
  - Run `acli jira workitem search --jql ... --json --limit 50`
  - Parse JSON, map to `JiraIssue[]` per data mapping table
  - Error handling: ENOENT → `acli_not_in_path`, non-zero+auth stderr → `acli_not_authenticated`, timeout → `jira_fetch_failed`
  - Keep 60s in-memory cache
- **Rewrite** `GET /statuses?projectKey=X`:
  - Run `acli jira workitem search --jql "project = X" --fields "status" --json --limit 50`
  - Extract unique `fields.status.name` values, return as `JiraStatus[]`
- **Delete** dead code: `getEnvVars()`, `buildAuthHeader()`, `JiraSearchResult` interface
- **Update** `IntegrationJiraDeps` to include `execAsync` injection (like `IntegrationGitHubDeps`)

#### 2. Rewrite `jiraTransition()` in `server/ticket-transitions.ts`

- Replace REST API POST with: `execFile('acli', ['jira', 'workitem', 'transition', '--key', ticketId, '--status', transitionName, '--yes'])`
- Add `execAsync` dependency injection for testability
- **Delete** dead code: `isValidJiraUrl()`, `linearStateUpdate()`
- **Simplify** `detectTicketSource()`: remove `LINEAR_API_KEY` check, remove `'linear'` branch. Keep prefix heuristic only.
- **Simplify** `getStatusMapping()`: remove `linear` parameter, only read `config.integrations.jira`
- **Delete** all `linear` branches in `transitionOnSessionCreate()` and `checkPrTransitions()`

#### 3. Remove Linear integration

- Delete `server/integration-linear.ts`
- Remove Linear route mounting from `server/index.ts`
- Remove from `server/types.ts`: `LinearIssue`, `LinearIssuesResponse`, `LinearState`
- Narrow `BranchLink.source`: `'github' | 'jira' | 'linear' | undefined` → `'github' | 'jira' | undefined`
- Narrow `TicketContext.source`: `'github' | 'jira' | 'linear'` → `'github' | 'jira'`
- Remove `Config.integrations.linear` from type (existing configs harmlessly ignored)
- Remove Linear tab from `frontend/src/components/TicketsPanel.svelte`
- Remove `fetchLinearConfigured`, `fetchLinearIssues`, `fetchLinearStates` from `frontend/src/lib/api.ts`
- Remove `fetchJiraConfigured` from `frontend/src/lib/api.ts` (endpoint removed)
- Remove Linear status mapping from `frontend/src/components/StatusMappingModal.svelte`
- Delete `test/integration-linear.test.ts`

#### 4. Update frontend

- **TicketsPanel.svelte**: Always show Jira tab (no configured check). On error, show setup instructions:
  - `acli_not_in_path`: "Install the Atlassian CLI: `brew install acli`, then `acli jira auth login --web`"
  - `acli_not_authenticated`: "Run `acli jira auth login --web` to connect your Jira account"
  - `jira_auth_failed`: "Run `acli jira auth login --web` to re-authenticate"
- **StatusMappingModal.svelte**: Jira dropdown now stores transition **names** (not IDs). Label should say "Status name" not "Transition ID".

#### 5. Rewrite tests

- **Rewrite** `test/integration-jira.test.ts`: mock `execFile` instead of `globalThis.fetch`. Follow `test/integration-github.test.ts` pattern with `makeMockExec()`.
  - Test: acli not found (ENOENT)
  - Test: acli not authenticated (stderr)
  - Test: acli timeout
  - Test: acli success with JSON mapping
  - Test: empty results
  - Test: cache hit (second call within 60s)
  - Test: statuses route deduplication
  - Test: statuses route missing projectKey → 400
- **Update** `test/ticket-transitions.test.ts`: remove Linear test cases, add acli-based jiraTransition tests
- **Delete** `test/integration-linear.test.ts`

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `server/integration-jira.ts` | Rewrite | execFile('acli') replaces fetch(), remove /configured |
| `server/integration-linear.ts` | Delete | Remove Linear integration |
| `server/index.ts` | Modify | Remove Linear route mounting |
| `server/types.ts` | Modify | Remove Linear types, narrow source unions |
| `server/ticket-transitions.ts` | Rewrite | acli-based jiraTransition(), delete Linear code |
| `frontend/src/components/TicketsPanel.svelte` | Modify | Remove Linear tab + configured check, update setup messages |
| `frontend/src/components/StatusMappingModal.svelte` | Modify | Remove Linear, change ID→name labels |
| `frontend/src/lib/api.ts` | Modify | Remove Linear + Jira configured API calls |
| `test/integration-jira.test.ts` | Rewrite | Mock execFile instead of HTTP |
| `test/integration-linear.test.ts` | Delete | Remove Linear tests |
| `test/ticket-transitions.test.ts` | Modify | Remove Linear cases, add acli transition tests |

## Constraints

1. Same route API — existing frontend calls (`fetchJiraIssues()`, `fetchJiraStatuses()`) continue to work
2. Same response shapes — `JiraIssue`, `JiraIssuesResponse`, `JiraStatus` types unchanged
3. No env var fallback — clean break from API token approach
4. `Config.integrations.jira.projectKey` retained for StatusMappingModal
5. `Config.integrations.jira.statusMappings` now stores transition **names** instead of IDs
