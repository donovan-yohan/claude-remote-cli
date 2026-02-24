# Svelte 5 Migration & Menu UI Redesign

> **Status**: Active | **Created**: 2026-02-23 | **Last Updated**: 2026-02-24
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
- [ ] Task 10: Cleanup — Remove old frontend, update docs

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

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
