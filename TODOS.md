# TODOs

## Linear CLI Integration — Proper Ticket Source Tracking

**What:** When re-adding Linear integration via CLI, ensure ticket source detection is driven by the `BranchLink.source` field and extended to support a `'linear'` source, without reintroducing the old prefix-length heuristic.

**Why:** As of the Jira-only rewrite, `detectTicketSource()` (`server/ticket-transitions.ts`) no longer uses the Jira-vs-Linear prefix-length heuristic, `BranchLink.source` (`server/types.ts`) does not include `'linear'`, and `server/branch-linker.ts` always sets a concrete source (currently Jira) for extracted IDs. This TODO documents the work required to cleanly support Linear again without relying on fragile prefix rules.

**What needs to happen:**
1. Re-introduce `'linear'` as an allowed value for `BranchLink.source` and extend `server/branch-linker.ts` to set `source: 'linear'` (or `'jira'`) during scanning, based on which CLI is available/authenticated when both integrations exist.
2. Update `detectTicketSource()` in `server/ticket-transitions.ts` to handle `'linear'` via the explicit `BranchLink.source` value (no prefix-length heuristic).
3. If we later support branches created outside our tooling and without a `source`, introduce a new, well-tested fallback heuristic that is explicitly Jira/Linear-aware; for now, no heuristic is required because `branch-linker` always sets `source`.

**Depends on:** Linear CLI (`schpet/linear-cli`) getting `--json` support on `linear issue list` (upstream issue #127).

**Added:** 2026-03-22 (from `/plan-eng-review` of Jira CLI rewrite design)
