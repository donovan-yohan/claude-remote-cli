# Learnings

Persistent learnings captured across sessions. Append-only, merge-friendly.

Status: `active` | `superseded`
Categories: `architecture` | `testing` | `patterns` | `workflow` | `debugging` | `performance`

---

### L-001: Non-tmux alternate screen sessions need a viewport freeze layer to support scroll during streaming
- status: active
- category: architecture
- source: /harness:bug 2026-03-20
- branch: master

When building terminal features for alternate screen apps (Claude Code, vim), remember that xterm.js has no scrollback in alternate screen mode (baseY=0). Scroll events reach the TUI app correctly, but the TUI's continuous re-rendering during streaming immediately overrides scroll position. Any feature requiring user-controlled scrolling in non-tmux alternate screen sessions must implement an intermediary buffer layer (screen snapshotting or output gating) — simply forwarding scroll events is insufficient. Tmux copy-mode provides this layer automatically, which is why tmux sessions don't have this problem.

---

### L-002: Mobile WebSocket reconnection must not rely solely on `onclose` — use `visibilitychange` + heartbeat
- status: active
- category: architecture
- source: /harness:bug 2026-03-21
- branch: master

When a mobile browser backgrounds an app, the OS silently kills TCP connections but the browser may not fire WebSocket `onclose` for 30-60+ seconds (or never). Never rely solely on `onclose` for reconnection. Always add: (1) a `visibilitychange` listener that probes socket health when the page becomes visible, and (2) a periodic client-side heartbeat with a response timeout to detect zombie connections. `readyState === OPEN` is unreliable on zombie sockets — always verify with an actual ping/pong exchange.

---

### L-003: UI flows must be updated when the navigation model changes — dead code paths become user-facing bugs
- status: active
- category: architecture
- source: /harness:bug 2026-03-21
- branch: olympus

When migrating from a selection-based model (user picks repo/worktree at creation time) to a context-driven model (workspace already knows its folder), audit ALL UI entry points that create entities. Leftover modals, tabs, and labels that reference the old model become broken flows — not just cosmetic debt. In this case, the "New Terminal" button opened a repo-selection modal instead of calling the existing `createTerminalSession()` API, making terminal creation impossible. Always grep for API functions that become unreachable after an architecture change.

---

### L-004: Session state derived from external systems (git, filesystem) must have a refresh mechanism — snapshot-at-creation is insufficient
- status: active
- category: architecture
- source: /harness:bug 2026-03-22
- branch: mont-blanc

When storing state that mirrors an external system (e.g., `session.branchName` from `git rev-parse`), always implement a refresh mechanism — either a filesystem watcher on the source of truth (`.git/HEAD`), periodic polling, or re-reading on API requests. Snapshot-at-creation creates a hidden staleness contract that users don't expect. In this project, the `WorktreeWatcher` watches directory structure but not `.git/HEAD`, so branch checkouts are invisible. When adding any external-system-derived field to a long-lived object, ask: "what watches for changes to this value?"

---

### L-005: Check `err.code` not `err.message` for Node.js execFile errors
- status: active
- category: debugging
- source: /harness:loop Phase 1 org-dashboard 2026-03-21

Node.js `child_process.execFile` throws with `code: 'ENOENT'` and message `'spawn <cmd> ENOENT'` when a binary isn't in PATH. String-matching the message (`'command not found'`, `'not found'`) fails because the actual message format is `'spawn gh ENOENT'`. Always check `(err as NodeJS.ErrnoException).code === 'ENOENT'` instead.

---

### L-006: GitHub Search API returns issues AND PRs — filter on `pull_request` field
- status: active
- category: patterns
- source: /harness:loop Phase 1 org-dashboard 2026-03-21

`gh api search/issues?q=is:pr+is:open+involves:@me` can return non-PR issues that match on `involves:@me`. The `pull_request` field on each item is the discriminator — skip items where it's absent.

---

### L-007: GitHub Search API does not return `requested_reviewers` — reviewer detection is best-effort
- status: active
- category: patterns
- source: PR #38 review (org-dashboard Phase 1)

The `search/issues` endpoint returns a subset of PR metadata. Notably, `requested_reviewers` is not included — it's only available via the per-PR endpoint (`/repos/{owner}/{repo}/pulls/{number}`). The org dashboard's reviewer detection (`role: 'reviewer'`) is therefore best-effort; PRs where the user is a requested reviewer may display as `role: 'author'` or be filtered out entirely.

---

### L-008: GitHub Search API does not return `reviewDecision` — PR status dot defaults to success
- status: active
- category: patterns
- source: PR #38 review (org-dashboard Phase 1)

The `search/issues` endpoint does not include `reviewDecision` (APPROVED, CHANGES_REQUESTED, etc.). The org dashboard's PR status dot (`prStatusDotClass`) falls through to `dot-success` for all open PRs since `reviewDecision` is always null. To show accurate review status, each PR would need a separate API call to the pulls endpoint.

---

### L-009: Org dashboard "All" filter operates on `is:open` backend data — cannot show closed PRs
- status: active
- category: patterns
- source: PR #38 review (org-dashboard Phase 1)

The org dashboard backend queries `is:open` in its GitHub search. The frontend "All" filter operates on the returned dataset, not a separate query — switching from "Open" to "All" shows the same PRs. To support closed/merged PR display, the backend would need a second query or the existing query would need to drop `is:open` (which would increase response size significantly).

---

### L-010: Sidebar group rows must derive identity from the group, not from individual sessions within it
- status: active
- category: architecture
- source: /harness:bug 2026-03-22
- branch: fix-sidenav-tabs-isolation

When a sidebar row represents a group of sessions (e.g., all tabs for a worktree), the row's name and icon must come from the group's identity (worktree path, branch name), not from a "representative" session selected by recency. Picking the most-recently-active session as the representative leaks tab-level details (session type, auto-generated tab name) into the sidebar. Tab identity belongs to the tab bar; sidebar identity belongs to the worktree/group. When adding grouped UI patterns, always ask: "does the group's display change when the user interacts with an individual item within it?"

---

### L-011: Session creation parameters must be stored on the session object if they need to survive restarts
- status: active
- category: architecture
- source: /harness:bug 2026-03-22
- branch: erebus

When session creation accepts flags that affect runtime behavior (yolo mode, custom CLI args, continue mode), these must be stored on the Session object — not just consumed to build a spawn command and discarded. The serialization/restoration cycle can only preserve what's on the session object. In this project, `yolo`, `claudeArgs`, and `args` were converted to CLI arguments at route handler level and passed through to `createPtySession()` as a transient `args` parameter, making it impossible to serialize them for post-update restoration. When adding any creation-time parameter that should persist across restarts, add it to both the `PtySession` interface and `SerializedPtySession`.

---

### L-012: Never call `.refetch()` on a TanStack Query store inside a Svelte 5 `$effect` without `untrack()`
- status: active
- category: debugging
- source: /harness:bug 2026-03-23
- branch: master

TanStack Query's `createQuery` returns a Svelte 5 reactive proxy. Accessing `.refetch` inside a `$effect` tracks the query store as a dependency. When `refetch()` completes, it updates internal state (`isFetching`, `data`), which re-triggers the effect, creating an infinite loop. Always wrap `.refetch()` calls in `untrack()` when used inside `$effect`, or use `queryClient.invalidateQueries()` from outside reactive contexts instead.

---

### L-014: When one module mutates shared config on disk, all modules that read that config must reload — never validate against a startup snapshot
- status: active
- category: architecture
- source: /harness:bug 2026-03-24
- branch: workspace-config-validation

When multiple server modules access the same config file, ensure they all use the same access pattern. If a workspace router reloads config from disk on every request (fresh reads), but the session handler validates against an in-memory object loaded at startup (stale read), any mutations by the workspace router are invisible to the session handler until restart. Either centralize config access behind a single `getConfig()` that always reads from disk, or use an event/notification pattern so disk mutations propagate to in-memory consumers. The workspace router's `getConfig()` pattern is the correct one — the problem is `index.ts` using a stale `let config` loaded once at startup.

---

### L-013: When multiple code paths create the same resource type, they must share a single counter/naming mechanism
- status: active
- category: architecture
- source: /harness:bug 2026-03-23
- branch: master

`POST /sessions` and `POST /workspaces/worktree` both create git worktrees with mountain names, but use different counters (global `config.nextMountainIndex` vs per-workspace `settings.nextMountainIndex`). Worktrees created via one path don't increment the other's counter, causing name collisions that silently break worktree creation. Additionally, resource creation APIs that depend on sequential naming must include collision detection (check if name/branch/directory exists, skip to next) — never assume the counter is accurate. When adding any auto-naming feature, grep for all code paths that create the same resource type and ensure they share one source of truth.

---

### L-016: `position: fixed` inside a `<dialog>` top-layer element uses the dialog as the containing block, not the viewport
- status: active
- category: debugging
- source: commit f88d830 (settings-webhooks branch, 2026-03-24)
- branch: dy/feat/settings-webhooks

When an element with `position: fixed` is a descendant of a `<dialog>` that is in the browser's top layer, the dialog becomes the CSS containing block — not the viewport. This means `inset: 0` fills the dialog, not the screen, and `height: 100%` refers to the dialog's height. The fix: use `position: absolute` on drawers/backdrops inside dialogs, ensure the ancestor dialog content wrapper has `position: relative`, and set `bottom: 0` instead of `height: 100%`. This affects `SettingsToc.svelte` and any future drawer-inside-dialog pattern.

---

### L-017: `exactOptionalPropertyTypes: true` requires explicit `| undefined` in object spread and partial-init assignments
- status: active
- category: patterns
- source: settings-webhooks branch, frontend tsconfig.json
- branch: dy/feat/settings-webhooks

The frontend tsconfig enables `exactOptionalPropertyTypes: true`. Under this setting, TypeScript distinguishes between a property that is absent (`{}`) and one explicitly set to `undefined` (`{foo: undefined}`). This means: (1) you cannot assign `undefined` to an optional property without adding `| undefined` to its type; (2) object spreads from partial sources may produce type errors at the assignment site even if the runtime values are identical. When adding optional fields to interface types used in spread assignments (e.g., `WorkspaceSettings`), declare them as `fieldName?: Type` and never write `fieldName: undefined` at the assignment site — omit the key entirely instead.

---

### L-018: Features gated by browser permissions must surface the permission state in the UI — a settings toggle is not a permission request
- status: active
- category: architecture
- source: /harness:bug 2026-03-25
- branch: everest

When a feature depends on a browser permission (Notifications, Geolocation, Camera, etc.), the settings UI must address two distinct layers: (1) the app-level opt-in (which entities should use the feature) and (2) the browser-level permission (whether the browser allows it at all). A checkbox that only controls layer 1 gives users a false sense of enablement. Always: call the browser permission API when the user enables the feature, display the current permission state (granted/denied/default), and provide guidance if permission was denied. The permission request must be triggered by a user gesture (especially on iOS PWA where this is strictly enforced).

---

### L-019: Silent catch blocks on browser API calls hide broken features — always log or surface permission/subscription failures
- status: active
- category: debugging
- source: /harness:bug 2026-03-25
- branch: everest

When calling browser APIs that can fail due to missing permissions (e.g., `pushManager.subscribe()`, `Notification.requestPermission()`), empty `catch {}` blocks make broken features indistinguishable from working ones. The push notification pipeline had three silent catches that hid the fact that no subscription was ever created. At minimum: log the error in development, and in production surface the failure state in the UI (e.g., "Push notifications unavailable — permission denied"). Never swallow errors from permission-dependent APIs without at least recording the failure in application state.

---

### L-014: Always gate drag-and-drop library activation behind an explicit mode toggle — never leave it always-on
- status: active
- category: patterns
- source: /harness:bug 2026-03-24
- branch: mobile-longpress-drag

When using `svelte-dnd-action` (or any drag-and-drop library) on a scrollable container, pass `dragDisabled: true` by default and only enable it when the user explicitly enters reorder mode. Libraries like `svelte-dnd-action` attach touch event listeners to draggable children and `preventDefault()` on `touchmove`, which blocks native scroll. Having an application-level reorder mode toggle (e.g., `ui.reorderMode`) without wiring it to the library's `dragDisabled` option creates a disconnect — your mode gate is purely cosmetic while the library still steals events. Always check library docs for disable/enable APIs and wire them to your mode state.

---

### L-015: UI status indicators derived from multiple signal sources need a formal state machine — not ad-hoc guards
- status: active
- category: architecture
- source: /harness:bug 2026-03-24
- branch: dy-fix-idle-status-regression

When a display status (e.g., session dot color) is derived from multiple independent signals (PTY idle timer, hook-based agentState, parser reconciliation), ad-hoc guards and cooldown timers will always have edge cases. The root invariant — "only show attention when there's genuinely new content the user hasn't seen" — cannot be enforced by checking individual signals in isolation. Instead, model the display state as a formal state machine with a transition function that accepts semantic events and enforces valid transitions at the type level. The key insight: `seen-idle → unseen-idle` should be an **impossible transition** — the only path to `unseen-idle` must go through `running` first.

---
