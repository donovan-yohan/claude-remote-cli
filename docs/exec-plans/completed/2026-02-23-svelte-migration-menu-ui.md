# Svelte 5 Migration & Menu UI Redesign

> **Status**: Completed | **Created**: 2026-02-23 | **Completed**: 2026-02-24
> **Design Doc**: `docs/plans/2026-02-23-svelte-migration-menu-ui-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-23 | Design | Svelte 5 with runes (not React/Preact/Lit) | Compiles away, tiny runtime, natural reactivity for WebSocket-driven state |
| 2026-02-23 | Design | Standalone Svelte + Vite (not SvelteKit) | Single-page app, SvelteKit would conflict with existing Express server |
| 2026-02-23 | Design | Full rewrite (not incremental migration) | App is ~1950 lines, incremental would mean maintaining two paradigms simultaneously |
| 2026-02-23 | Design | Build to dist/frontend/ | Clean separation alongside dist/server/ and dist/bin/ |
| 2026-02-23 | Design | xterm.js as npm dependency | Proper imports, version-managed, tree-shakeable |
| 2026-02-23 | Design | Git status via gh CLI | Server is the dev machine with full git/gh auth already configured |
| 2026-02-23 | Design | 3-row session item layout | Status dot + name, git icon + metadata, time + diff stats |
| 2026-02-23 | Design | Git icon left-aligned under status dot | Clean use of empty space in left column |
| 2026-02-23 | Design | Fade mask + hover scroll (not ellipsis) | Smoother UX for long names, matches reference screenshots |
| 2026-02-24 | Retrospective | Plan completed — all 10 tasks, 0 drift, 4 surprises | Full Svelte 5 migration + UI redesign shipped |

## Progress

- [x] Task 1: Scaffold Vite + Svelte 5 project _(completed 2026-02-24)_
- [x] Task 2: State modules — Auth, UI, Sessions _(completed 2026-02-24)_
- [x] Task 3: PinGate + App shell components _(completed 2026-02-24)_
- [x] Task 4: Sidebar + Session list components _(completed 2026-02-24)_
- [x] Task 5: Terminal component + WebSocket integration _(completed 2026-02-24)_
- [x] Task 6: Dialogs — New Session, Settings, Delete Worktree, Context Menu _(completed 2026-02-24)_
- [x] Task 7: Update Toast + Event socket integration _(completed 2026-02-24)_
- [x] Task 8: Git status endpoint + Frontend integration _(completed 2026-02-24)_
- [x] Task 9: Session item hover effects — Fade, scroll, action reveal _(completed 2026-02-24)_
- [x] Task 10: Cleanup — Remove old frontend, update docs _(completed 2026-02-24)_

## Surprises & Discoveries

| Date | What | Impact | Resolution |
|------|------|--------|------------|
| 2026-02-24 | @sveltejs/vite-plugin-svelte@7 requires Vite v8 beta | Used v5.1.1 (compatible with Vite 6) instead | No impact — stable release works fine |
| 2026-02-24 | No built-in tsconfig to extend from plugin | Wrote frontend tsconfig from scratch | Minimal — just needed DOM lib + bundler moduleResolution |
| 2026-02-24 | Vite config not at project root | All vite commands need `--config frontend/vite.config.ts` | Updated package.json scripts accordingly |
| 2026-02-24 | Svelte 5 `$state` naming conflict | Local var named `state` conflicts with `$state` rune | Renamed to `sessionState` in App.svelte |

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

Full implementation details: [`docs/plans/2026-02-23-svelte-migration-menu-ui.md`](../plans/2026-02-23-svelte-migration-menu-ui.md)

---

## Outcomes & Retrospective

**Summary:** Full migration from ~3,200 lines of vanilla JS/CSS/HTML to Svelte 5 (runes) + Vite + TypeScript. Added git status endpoint, redesigned session items with 3-row layout, hover effects. Net: +7,452 / -3,699 lines across 51 files in 10 commits.

**What worked:**
- Parallel task execution — Tasks 4+5+7 ran simultaneously, then 6+8+9, cutting wall-clock time significantly
- Clean task scoping with non-overlapping file ownership prevented merge conflicts between parallel workers
- Full rewrite strategy (vs incremental) was correct — no time wasted bridging two paradigms
- Svelte 5 runes (.svelte.ts state modules) provided clean reactive state without boilerplate
- Living plan updates after each task kept progress visible and surprises documented

**What didn't:**
- Svelte 5 `non_reactive_update` warnings for `bind:this` refs — cosmetic but noisy in build output
- Worker-4 accidentally staged worker-5's files in its commit (no harm, but shows parallel workers touching shared staging area)
- No integration testing step between tasks — went straight from unit build checks to cleanup

**Learnings to codify:**
- Avoid naming local variables `state` in .svelte files — conflicts with `$state` rune (documented in patterns.md)
- @sveltejs/vite-plugin-svelte@7 requires Vite v8 beta — use v5.x with Vite 6 for stability
- When vite.config.ts is not at project root, all CLI commands need `--config` flag
- ADR-002 (vanilla JS) superseded — updated to Superseded status
