# Global Session Defaults & tmux Launch Setting Design

**Date:** 2026-03-10
**Status:** Approved (v2)

## Problem Or Goal

Users want global defaults for session launch options — continue, yolo, and tmux — so that quick-start actions (clicking an inactive repo or worktree) behave according to their preferences without opening a dialog. The "Customize" flow in `NewSessionDialog` should pre-fill from these defaults but allow per-session overrides.

This expands the existing `defaultAgent` pattern to three additional settings: `defaultContinue`, `defaultYolo`, and `launchInTmux`.

## Constraints

- Settings-backed defaults live in server config and are exposed through small dedicated config endpoints (existing `defaultAgent` pattern).
- Quick-start actions in the sidebar bypass `NewSessionDialog`, so UI-only defaults are insufficient.
- All agent launches funnel through `sessions.create()`. Terminal sessions also use that function through the explicit `command` override.
- Active sessions are in-memory only; the server does not currently recover running sessions after restart.
- The app targets macOS and Linux. tmux is optional and host-dependent.

## Considered Approaches

### 1. Global Persisted Toggle Only

Add persisted boolean settings and apply them to all launches. No per-session overrides.

**Pros**
- Covers every launch path, including quick actions and resume flows
- Minimal UI change: checkboxes in Settings only
- Keeps the backend as the source of truth

**Cons**
- No per-session escape hatch without changing the global default
- Less flexible for mixed workflows

### 2. Settings Defaults Plus Per-Session Overrides (Chosen)

Add global defaults in Settings that pre-fill `NewSessionDialog` checkboxes. Quick-start flows always use global defaults. "Customize" opens the dialog with defaults pre-filled, allowing one-off changes.

**Pros**
- Flexible for mixed workflows
- Quick-start actions are zero-friction (use defaults)
- "Customize" provides the escape hatch without extra UI on quick paths

**Cons**
- Slightly more surface area than toggle-only
- Dialog checkboxes need to sync with server-side defaults on open

### 3. Full tmux-Backed Session Recovery

Treat tmux as the durable session owner, persist tmux metadata, and rehydrate sessions after server restart.

**Pros**
- Strongest durability story
- Makes tmux useful beyond a launch wrapper

**Cons**
- Much larger project: discovery, reconciliation, reattach UX
- Changes the current in-memory session contract
- Too much scope for a settings-driven launch preference

## Chosen Approach

Adopt approach 2. Add `defaultContinue: boolean`, `defaultYolo: boolean`, and `launchInTmux: boolean` to server config alongside the existing `defaultAgent`. Each gets its own `GET`/`PATCH` endpoint pair. Quick-start clicks pass all four defaults to the backend. `NewSessionDialog` initializes its checkboxes from these defaults, and the user can override per-session via "Customize."

## Key Decisions

### D1: Three new config fields following the defaultAgent pattern

```typescript
defaultContinue: boolean;  // default: true (matches current hardcoded behavior)
defaultYolo: boolean;      // default: false
launchInTmux: boolean;     // default: false
```

Each field gets `GET /config/<field>` and `PATCH /config/<field>` endpoints.

### D2: Quick-start flows use global defaults

Clicking an inactive repo or worktree, PR click handlers, and resume flows all read from config defaults. No dialog is opened. The frontend fetches all defaults on load and holds them in a shared config store.

### D3: NewSessionDialog pre-fills from defaults

When the dialog opens (via "Customize" or "New Session"), form state initializes from the global defaults. The user can toggle any checkbox for that one session. The dialog's `open()` function accepts overrides via `options` for pre-filling from context menu actions.

### D4: Scope tmux to agent sessions only

`launchInTmux` applies to Claude and Codex repo/worktree sessions, including continue/resume flows and PR quick actions. `POST /sessions/terminal` is unchanged — terminal users can run tmux themselves.

### D5: Keep tmux wrapping in sessions.ts

Route handlers decide what session to create. `sessions.ts` decides how the process is spawned, because it already owns PTY lifecycle, retry-without-continue behavior, and kill cleanup. A small helper resolves the actual spawn command and args from `{ agent, command, args, useTmux }` — this is the clean test seam.

### D6: Use crc-* prefixed tmux session names

Generate a tmux session name like `crc-feat-auth-a1b2c3d4` (sanitized display label + short id). Store the name in server-side session state. The `crc-` prefix gives the server visibility into all tmux sessions it has created.

### D7: Fail early when tmux is unavailable

`PATCH /config/launchInTmux` validates tmux availability via `tmux -V` and returns 400 if tmux is not installed. Session creation should not silently fall back to direct launches.

### D8: Explicit kills tear down tmux

When the user kills a session, the server SIGTERMs the PTY client and best-effort runs `tmux kill-session -t <name>`. Normal agent exit collapses the tmux session naturally because tmux is launched with the agent command as the window command.

### D9: Startup sweep for orphaned tmux sessions

On server startup, list `tmux list-sessions`, filter for `crc-*` prefix, and kill any found (since all in-memory sessions are gone after restart). This catches orphans from crashes, `kill -9`, package updates, etc.

### D10: Graceful shutdown cleanup

On SIGTERM/SIGINT, iterate all active sessions and kill their tmux sessions before exiting.

### D11: Preserve existing continue retry semantics

The "retry without continue args if the session exits quickly" behavior stays. When tmux is enabled, the retry path rebuilds the tmux-wrapped spawn command around the stripped inner agent args.

### D12: Keep the API shape consistent

Each setting uses its own endpoint pair rather than an aggregate settings payload. This matches the existing `defaultAgent` pattern and keeps changes incremental.

## Implementation Handoff Notes

### Backend (server/)

- `server/types.ts`: Add `defaultContinue`, `defaultYolo`, `launchInTmux` to `Config` interface. Add `useTmux` and `tmuxSessionName` to session state types. Add `useTmux` to `CreateParams`.
- `server/config.ts`: Add defaults (`defaultContinue: true`, `defaultYolo: false`, `launchInTmux: false`).
- `server/index.ts`: Add 6 new config endpoints (GET/PATCH for each field). Update `POST /sessions` and `POST /sessions/repo` to read `useTmux` from request body (with fallback to `config.launchInTmux`). Pass `useTmux` into `sessions.create()`. Add startup tmux cleanup. Add graceful shutdown tmux cleanup.
- `server/sessions.ts`: Add `useTmux` to `CreateParams`. Add helper to resolve spawn command/args with optional tmux wrapping. Store `tmuxSessionName` in session state. On kill, best-effort `tmux kill-session`. Update retry-without-continue to rebuild tmux wrapper.
- `config.example.json`: Add all three new fields.

### Frontend (frontend/)

- `frontend/src/lib/api.ts`: Add fetch/set helpers for `defaultContinue`, `defaultYolo`, `launchInTmux`. Add `useTmux` to session creation request bodies.
- `frontend/src/lib/types.ts`: Add `useTmux` to `OpenSessionOptions`.
- `frontend/src/components/dialogs/SettingsDialog.svelte`: Add three new toggles below "Default Coding Agent": Continue by default, YOLO mode by default, Launch in tmux.
- `frontend/src/components/dialogs/NewSessionDialog.svelte`: Initialize `yoloMode`, `continueExisting`, and new `useTmux` from global defaults. Add tmux checkbox to both tabs. Pass `useTmux` on submit.
- `frontend/src/components/SessionList.svelte`: Update quick-start handlers to pass `continue`, `yolo`, and `useTmux` from config defaults instead of hardcoding.

### Tests

- `test/config.test.ts`: Test new config fields load/save correctly.
- `test/sessions.test.ts`: Test tmux command wrapping helper. Test that `useTmux: true` produces correct spawn args. Test retry-without-continue rebuilds tmux wrapper. Mock `tmux kill-session` in kill tests.
