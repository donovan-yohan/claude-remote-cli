# Jira + Linear Integrations + Status Mapping UI

> **Status**: Implemented
> **Phase**: 4 of 5 (Org Dashboard initiative)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/donovanyohan-master-design-20260321-160000.md`
> **Depends on**: Phase 3 (Start Work + ticket transitions)

## Goal

Add first-class Jira and Linear ticket integrations with native metadata (sprints, cycles, priority), and a StatusMappingModal for mapping workflow events to provider-specific transition IDs.

## Approach

### Key Decisions

1. **Auth via environment variables** — `JIRA_API_TOKEN` + `JIRA_EMAIL` + `JIRA_BASE_URL` for Jira, `LINEAR_API_KEY` for Linear. Not stored in config. Settings UI shows boolean "configured" status.
2. **Jira uses workflow transitions, not status IDs** — `GET /rest/api/3/issue/{issueId}/transitions` returns available transitions from current state. StatusMappingModal maps to transition IDs. (Codex finding)
3. **Jira status dropdown scoped by project** — `GET /rest/api/3/project/{projectKey}/statuses` instead of global status list. Requires `projectKey` in Jira config. (Reviewer concern)
4. **Linear requires `teamId`** — needed for `workflowStates` GraphQL query
5. **Each provider has native metadata** — Jira shows sprint, priority, story points; Linear shows cycle, priority, estimate. Not a generic model.
6. **Launchd caveat:** Env vars must be set in the plist for service context — document in settings UI

### Files to Create

| File | Purpose |
|------|---------|
| `server/integration-jira.ts` | Jira REST API client — issues, transitions, project statuses |
| `server/integration-linear.ts` | Linear GraphQL API client — issues, workflow states |
| `frontend/src/components/StatusMappingModal.svelte` | Map workflow events to provider-specific statuses/transitions |

### Files to Modify

| File | Change |
|------|--------|
| `server/types.ts` | Add `jira` and `linear` to integrations config, add Jira/Linear issue types |
| `server/index.ts` | Mount integration-jira and integration-linear routes |
| `server/ticket-transitions.ts` | Add Jira transition calls and Linear state updates |
| `frontend/src/components/TicketsPanel.svelte` | Add Jira and Linear sub-tabs |
| `frontend/src/components/TicketCard.svelte` | Render native metadata per provider |

### Success Criteria

- Jira tickets show with sprint, priority, status
- Linear tickets show with cycle, priority, estimate
- StatusMappingModal fetches real statuses from each provider's API
- Status transitions use Jira workflow transitions (not arbitrary status IDs)
- Auth status shown in settings (boolean, not secrets)
