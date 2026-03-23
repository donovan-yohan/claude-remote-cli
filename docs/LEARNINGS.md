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
