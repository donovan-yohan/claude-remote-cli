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

## CI State Display in PrTopBar + Mobile Scaling

**What:** Improve how CI status renders in the PR top bar with richer state (individual check names, progress indicators) and ensure it scales well on mobile viewports.

**Why:** With real-time webhook-driven CI updates (from the webhook self-service feature), CI state changes will arrive instantly rather than on a 30s poll. The current simple badge doesn't leverage this — it could show per-check status, in-progress animations, and collapse gracefully on mobile.

**Pros:** Better UX for the most-viewed CI information. Real-time updates make check-by-check progress visible. Mobile users get a usable view.

**Cons:** Requires design work (component layout, responsive behavior). May need GraphQL query changes to fetch individual checks rather than just the rollup state.

**Context:** Deferred from the webhook self-service CEO review (scope item #11). The webhook infrastructure must ship first so real-time events are available. Address via `/plan-design-review` to get proper design treatment before implementation.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P2
**Depends on:** Webhook self-service feature (design doc: `docs/design-docs/2026-03-24-webhook-self-service-design.md`)

**Added:** 2026-03-24 (from `/plan-ceo-review` of webhook self-service design)
