---
status: implemented
---
# Start Work Flow + Ticket Status Transitions

> **Status**: Planned
> **Phase**: 3 of 5 (Org Dashboard initiative)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/donovanyohan-master-design-20260321-160000.md`
> **Depends on**: Phase 2 (GitHub Issues + branch linking)

## Goal

Enable "Start Work" from a ticket card — user picks a repo, Claude launches a worktree with ticket context injected as the initial prompt. Auto-transition ticket status as work progresses (started → in progress, PR opened → code review, PR merged → ready for QA).

## Approach

### Pre-Phase Gate

**Validate Claude Code's `--message` flag** (or `--initial-prompt` or equivalent) works in interactive PTY mode. If unavailable, fall back to writing `.claude/initial-context.md` in the worktree directory.

### Key Decisions

1. **Server-side prompt assembly:** Frontend sends `ticketContext` to `POST /sessions`, server reads `promptStartWork` template, substitutes `{title}`, `{description}`, `{ticketId}`, `{ticketUrl}` placeholders
2. **Ticket context injection:** Via `claudeArgs` with validated flag (TBD)
3. **Status transitions piggybacked on existing data fetches** — not separate polling
4. **Idempotency guard:** Store last-transitioned-state per ticket to prevent re-firing (Codex finding)
5. **GitHub Issues transitions:** Label-based (hardcoded label names in Phase 3; StatusMappingModal deferred to Phase 4)
6. **Repo auto-select:** Case-insensitive prefix match of project key against repo name
7. **Session creation rollback:** If context injection fails, keep worktree, show warning

### Files to Create

| File | Purpose |
|------|---------|
| `server/ticket-transitions.ts` | Auto-transition engine with idempotency guard |
| `frontend/src/components/StartWorkModal.svelte` | Repo picker + initial action + branch prefix |

### Files to Modify

| File | Change |
|------|--------|
| `server/types.ts` | Add `IntegrationStatusMap`, `ticketContext` to session creation params, `promptStartWork` to WorkspaceSettings |
| `server/index.ts` | Handle `ticketContext` in `POST /sessions`, call ticket-transitions on worktree create |
| `server/org-dashboard.ts` | Call `ticket-transitions.checkPrTransitions()` after PR fetch |
| `frontend/src/components/TicketCard.svelte` | Wire "Start Work" button to open StartWorkModal |

### Reviewer Concerns

- `--message` flag must be validated before implementation begins
- Transition engine must be idempotent (store last state per ticket)
- Handle case where ticket branch already exists (existing worktree — confirm before injecting new prompt)
- Transitions only fire when dashboard/PrTopBar is active — document this limitation

### Success Criteria

- "Start Work" creates worktree with ticket context as initial prompt
- `promptStartWork` template in WorkspaceSettings is respected
- Ticket transitions fire on worktree create, PR open, PR merge
- Transitions are idempotent (no re-firing on refresh)
- GitHub Issues use label-based transitions
