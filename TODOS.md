# TODOs

## Linear CLI Integration — Proper Ticket Source Tracking

**What:** When re-adding Linear integration via CLI, implement proper ticket source detection using `BranchLink.source` field instead of the prefix length heuristic.

**Why:** The current prefix heuristic in `detectTicketSource()` (`server/ticket-transitions.ts`) uses character count to distinguish Jira (3+ chars before dash) from Linear (2 chars). This is fragile and can misidentify tickets when both integrations are active. The `BranchLink.source` field already exists in `server/types.ts` but isn't always populated during branch scanning.

**What needs to happen:**
1. `server/branch-linker.ts` should set `source: 'linear'` or `source: 'jira'` on branch links during scanning, based on which CLI is available/authenticated
2. `detectTicketSource()` in `server/ticket-transitions.ts` should prefer the explicit `BranchLink.source` over the prefix heuristic
3. The heuristic should only be the fallback when `source` is undefined (e.g., branches created outside claude-remote-cli)

**Depends on:** Linear CLI (`schpet/linear-cli`) getting `--json` support on `linear issue list` (upstream issue #127).

**Added:** 2026-03-22 (from `/plan-eng-review` of Jira CLI rewrite design)
