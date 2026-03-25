# Bug Analysis: PR Dashboard Duplicate CTAs and Action Column Overflow

> **Status**: Confirmed | **Date**: 2026-03-25
> **Severity**: Medium
> **Affected Area**: `frontend/src/components/RepoDashboard.svelte`

## Symptoms
- Two identical "Fix Conflicts" buttons appear per row when a PR has merge conflicts
- Action buttons overflow and overlap the Role/Age columns

## Reproduction Steps
1. Have a workspace with open PRs where `mergeable === 'CONFLICTING'`
2. View the RepoDashboard
3. Each conflicting PR row shows two "Fix Conflicts" pills side by side
4. The pills overflow the 120px action column into adjacent columns

## Root Cause
Three independent `{#if}` blocks in the row template render CTA pills for mutually exclusive states without mutual exclusion:

1. **Block 1** (line 168): `{#if pr.mergeable === 'CONFLICTING'}` → renders explicit "Fix Conflicts" button (calls `onFixConflicts`)
2. **Block 2** (line 177): `{#if pr.mergeable === 'MERGEABLE' && pr.state === 'OPEN'}` → renders "Merge" link
3. **Block 3** (line 188): `{#if action.type !== 'none' && action.label}` → renders generic action pill from `derivePrAction()`

When `mergeable === 'CONFLICTING'`, `derivePrAction()` returns `{type: 'fix-conflicts', label: 'Fix Conflicts'}`. Block 1 fires (explicit check) AND Block 3 fires (generic guard passes) — producing two identical "Fix Conflicts" pills.

The overflow is secondary: the action column was only 120px wide, but even a single pill (~110px) plus the 28px "+" button plus 8px gap exceeds 120px.

**How it was introduced:** The explicit "Fix Conflicts" button was added in the `fix-conflicts-button` plan (2026-03-18). The generic `derivePrAction`-driven action pill was added in the `pr-dashboard-usability` plan (2026-03-19). The second plan added Block 3 alongside the existing Blocks 1 and 2 without converting them to an exclusive `{#if}/{:else if}` chain. Both plans' `row` AND `mobileCard` snippets had the same issue.

## Evidence
- Screenshot shows two "Fix Conflicts" pills per row with clear overflow into Role/Age columns
- `pr-state.ts:96-97`: `derivePrAction()` returns `fix-conflicts` for CONFLICTING PRs
- `RepoDashboard.svelte:168` and `:188`: Both conditions independently true for CONFLICTING PRs
- Same pattern duplicated in `mobileCard` snippet (lines 227-257)

## Impact Assessment
- Visual: Pills overlap adjacent columns, breaking table layout
- UX: Two identical buttons confuse users — which one to click?
- Functional: The two pills have different handlers (`onFixConflicts` vs `onPrAction`), so clicking the "wrong" one could trigger unexpected behavior

## Recommended Fix Direction
Convert the three independent `{#if}` blocks to a single `{#if}/{:else if}/{:else if}` chain in both `row` and `mobileCard` snippets. Widen the action column from 120px to 160px to accommodate pill + button without overflow.

## Architecture Review

### Systemic Spread
- **OrgDashboard.svelte** (`frontend/src/components/OrgDashboard.svelte:389-401`): Uses only the generic action pill pattern — no explicit CONFLICTING/MERGEABLE checks. Not affected by this specific bug, but could gain explicit pills in the future without the same mutual exclusion lesson.
- **PrTopBar.svelte** (`frontend/src/components/PrTopBar.svelte`): Uses `derivePrAction()` solely through its state machine — no parallel explicit checks. Clean.

None — the duplication was isolated to RepoDashboard's two snippets (desktop `row` and `mobileCard`).

### Design Gap
The `pr-state.ts` state machine correctly produces a single action per PR state. The design gap is that the template layer bypasses the state machine by adding explicit checks for specific `mergeable` values alongside the state machine output, without recognizing they represent the same states.

A better design: the template should render exactly one CTA per row, using only `derivePrAction()` output. Special behavior for CONFLICTING (calling `onFixConflicts` instead of `onPrAction`) should be dispatched via the action type, not via a separate template branch that duplicates the state machine's decision.

### Testing Gaps
- **Missing test cases:** A visual/integration test that renders a RepoDashboard with a CONFLICTING PR and asserts only one CTA pill exists per row would have caught this. The existing `test/pr-state.test.ts` tests the state machine correctly but doesn't test the template rendering.
- **Infrastructure gaps:** No component rendering tests exist for Svelte components in this project. All tests are unit tests against pure functions or backend integration tests. A component test infrastructure (e.g., `@testing-library/svelte`) would enable testing template logic.

### Harness Context Gaps
- `docs/FRONTEND.md` describes `RepoDashboard.svelte` as "Workspace dashboard: PRs with merge status, activity feed, CTAs" but doesn't mention the relationship between `derivePrAction()` and the explicit CONFLICTING/MERGEABLE template checks, or the requirement that they be mutually exclusive.
- The exec plan `2026-03-19-pr-dashboard-usability.md` Task 3 says "Add a small '+' button next to each PR row's action pills" but doesn't specify that the generic action pill must be exclusive with the existing explicit checks.
