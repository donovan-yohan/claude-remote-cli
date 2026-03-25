# Bug Analysis: Triple dots menu hidden on mobile

> **Status**: Confirmed | **Date**: 2026-03-25
> **Severity**: Medium
> **Affected Area**: WorkspaceItem.svelte sidebar

## Symptoms
- Triple dots (context menu trigger) not visible on mobile
- No way to access session/worktree actions on mobile without knowing the long-press gesture
- Recurring pattern: desktop/mobile behavioral divergence introduces regressions

## Reproduction Steps
1. Open the app on a mobile device (or viewport < 600px)
2. Look at any session or worktree row in the sidebar
3. Triple dots are completely hidden — no visual affordance for the action menu

## Root Cause
Two redundant mechanisms both hide the trigger on mobile:

1. **CSS**: Mobile media query at line 748 sets `.row-menu-overlay { display: none }` — hides the entire overlay container
2. **JS**: `hideTrigger={isMobile}` prop passed to `ContextMenu` tells it not to render the `<button>` trigger at all

The original intent was "mobile uses long-press instead of dots" but this removes the only visible affordance, making the menu undiscoverable.

## Evidence
- `WorkspaceItem.svelte:748-751`: `@media (max-width: 600px) { .row-menu-overlay { display: none; } }`
- `WorkspaceItem.svelte:300,378`: `hideTrigger={isMobile}` on both ContextMenu instances
- `WorkspaceItem.svelte:101`: `isMobile` derived from `window.matchMedia('(max-width: 600px)')`

## Impact Assessment
- All mobile users lose access to session/worktree context menu (delete, settings, etc.)
- Long-press is undiscoverable without the dots affordance

## Recommended Fix Direction
1. Remove `display: none` in mobile media query, replace with `opacity: 1` (always visible)
2. Remove `hideTrigger={isMobile}` so the trigger button renders on all devices
3. Clean up unused `isMobile` variable

## Architecture Review

### Systemic Spread
The `isMobile` JS detection + CSS media query dual-mechanism pattern is isolated to WorkspaceItem.svelte. No other components use this exact pattern. However, the broader issue — implementing different desktop/mobile behavior through ad-hoc per-component checks — is a recurring source of regressions in this project.

### Design Gap
There is no centralized "responsive behavior" system. Each component independently decides how to handle mobile vs desktop using a mix of CSS media queries and JS `matchMedia` checks. When a feature needs different behavior on mobile vs desktop, there's no pattern to follow — developers make ad-hoc choices that are easy to get wrong and hard to audit.

### Testing Gaps
No responsive/mobile-specific tests exist. The test suite doesn't verify that interactive elements are accessible at different viewport widths.

### Harness Context Gaps
FRONTEND.md doesn't document a pattern for "visible on mobile, hover-reveal on desktop" — a common UI need.
