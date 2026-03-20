---
status: current
created: 2026-03-20
branch: master
supersedes:
implemented-by: docs/exec-plans/active/2026-03-20-local-analytics.md
consulted-learnings: []
---

# Local Analytics & User Behavior Tracking

## Problem

claude-remote-cli has no visibility into how it's being used. There's no way to answer questions like "what features am I underusing?", "where do my clicks go?", or "what should I build next?" — questions that an agent could answer with structured data.

## Goals

- Collect rich behavioral data locally (sessions, UI interactions, agent productivity)
- Store in a format that agents can query directly via SQL
- Zero external infrastructure — everything runs on the host machine
- Minimal footprint in existing codebase

## Non-Goals

- Human-facing dashboards or visualizations (agent-first; can add later)
- Cloud analytics or third-party tracking services
- Session replay or DOM snapshots
- Analytics on/off toggle (single-user personal tool)

## Approach

Thin custom layer: a frontend collector, a server `analytics.ts` module owning `better-sqlite3`, and a well-designed schema optimized for agent queryability. No external analytics framework.

**Why not Plausible/Umami?** Designed for web analytics (pageviews/referrers), require separate infrastructure (Docker/Postgres), agent access requires their API. Overkill for a single-user CLI tool.

**Why not JSONL flat files?** Harder to aggregate, filter by time range, or join across event types. Agents are fluent in SQL.

## Design

### Schema

Single `events` table with a flexible `properties` JSON column. One predictable table is more natural for ad-hoc agent SQL than normalized tables per event type.

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  category    TEXT NOT NULL,  -- 'session', 'ui', 'agent', 'navigation'
  action      TEXT NOT NULL,  -- 'created', 'click', 'permission.approve', 'page.view'
  target      TEXT,           -- data-track value, route path, session ID
  properties  TEXT,           -- JSON blob for event-specific data
  session_id  TEXT,           -- claude-remote-cli session ID (nullable)
  device      TEXT            -- 'desktop' or 'mobile'
);

CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_category_action ON events(category, action);
CREATE INDEX idx_events_target ON events(target);
```

**Example rows:**

| category | action | target | properties |
|----------|--------|--------|------------|
| `session` | `created` | `session-abc` | `{"workspace":"/proj","agent":"claude","mode":"worktree"}` |
| `ui` | `click` | `sidebar.workspace.click` | `{"workspace":"/proj"}` |
| `ui` | `click` | `context-menu.kill` | `{"sessionId":"abc"}` |
| `agent` | `permission.approve` | `session-abc` | `{"tool":"bash","duration_ms":1200}` |
| `agent` | `idle` | `session-abc` | `{"idle_duration_s":45}` |
| `navigation` | `page.view` | `/dashboard` | `{"from":"/terminal"}` |

### Server Module — `analytics.ts`

New single-concern module following the architecture pattern. Owns the `better-sqlite3` dependency exclusively.

**Responsibilities:**
- Opens/creates `analytics.db` in the config directory (`~/.config/claude-remote-cli/analytics.db`)
- Creates schema on first run (`CREATE TABLE IF NOT EXISTS`)
- Exports `trackEvent(event)` for server-side event recording
- Exports Express Router for frontend event ingestion and settings endpoints
- Exports `getDbSize()` for settings UI

**Cross-module dependency justification:** Multiple modules import `trackEvent()` from `analytics.ts`, which introduces a new cross-cutting dependency. This is acceptable because `analytics.ts` is a pure output dependency (like a logger) — callers push data into it but never read from it, and it has no effect on their control flow. The alternative (wiring through `index.ts` callbacks) would add indirection for no isolation benefit, since `trackEvent()` is a fire-and-forget call. This is the same pattern used by `push.ts`, which is also imported by multiple modules.

**Server-side auto-tracking** — existing modules call `trackEvent()` at the point of action (same pattern as `push.ts`):

| Source module | Events |
|---|---|
| `sessions.ts` | `session.created`, `session.ended` (with duration, agent type, workspace) |
| `sdk-handler.ts` | `agent.permission.approve`, `agent.permission.deny`, `agent.turn.completed` (with token counts from SDK `result` event's `usage` field: `{ input_tokens, output_tokens }` — best-effort, omitted if unavailable). **Note:** `sdk-handler.ts` was removed in the SDK chat UI cleanup (2026-03-19). These events will be added when/if SDK mode is re-introduced. |
| `ws.ts` | `agent.idle`, `agent.waiting-for-input` (from existing idle-changed broadcasts) |
| `workspaces.ts` | `workspace.added`, `workspace.removed` |

**Endpoints:**
- `POST /analytics/events` — batch ingest from frontend. Request body: `{ events: Array<{ category: string, action: string, target?: string, properties?: object, session_id?: string, device?: string }> }`. Server assigns `timestamp` at write time. Writes within a single SQLite transaction. Uses existing cookie auth middleware.
- `GET /analytics/size` — returns `{ bytes: number }` via `fs.stat()` on the DB file.
- `DELETE /analytics/events` — truncates the events table (for settings UI "Clear analytics" button). No server-side confirmation — intentional given single-user context; the UI provides a confirmation prompt before calling.

### Frontend Collector — `frontend/src/lib/analytics.ts`

Plain TypeScript module (not Svelte state). Handles auto-capture and explicit tracking.

**Auto-capture click handler** — `document.addEventListener('click', ...)`:
1. Walk up from `event.target` for nearest `data-track` attribute
2. If found: use as `target` (e.g., `sidebar.workspace.click`)
3. If not found: fall back to simple CSS selector (tag + class)
4. Record `category: 'ui'`, `action: 'click'`, element text (truncated 50 chars) in `properties`

**Explicit tracking API:**
```typescript
// session_id parameter is optional — null for global UI (sidebar, settings),
// set to the currently-focused session ID for session-scoped actions
track('navigation', 'page.view', '/dashboard', { from: '/terminal' });
track('session', 'tab.switched', sessionId, { to: 'chat' }, sessionId);
track('ui', 'dialog.opened', 'settings');  // no session_id — global action
```

**`session_id` in frontend events:** The `track()` function accepts an optional `sessionId` parameter. For auto-captured clicks, the collector reads the currently-focused session ID from the existing `ui.svelte.ts` state (`activeSessionId`). Global UI interactions (sidebar, settings dialog, search) have `session_id: null`. Session-scoped interactions (terminal, chat, permission cards) include the active session ID.

**Batching:**
- Events accumulate in an in-memory array
- Flush every 5 seconds or at 20 events, whichever comes first
- Flush on `visibilitychange` via `navigator.sendBeacon()` with a `Blob` typed as `application/json` to ensure the server's JSON body parser accepts it
- Device tagged via existing `isMobile()` from `utils.ts`

### `data-track` Annotation Convention

Dot-separated hierarchy matching component structure. Applied as HTML attributes on interactive elements.

| Component | `data-track` values |
|---|---|
| `Sidebar.svelte` | `sidebar.workspace.click`, `sidebar.session.click` |
| `SmartSearch.svelte` | `search.input`, `search.select` |
| `ContextMenu.svelte` | `context-menu.{action}` (dynamic from item key) |
| `NewSessionDialog` | `dialog.new-session.create`, `dialog.new-session.tab.{name}`, `dialog.new-session.agent` |
| `SettingsDialog` | `dialog.settings.{field}` |
| `Toolbar.svelte` | `toolbar.{button}` |
| `PrTopBar.svelte` | `pr-top-bar.{action}` |
| `SessionTabBar.svelte` | `session-tab.{name}` |
| `Terminal.svelte` | `terminal.focus` |
| `ChatInput.svelte` | `chat.send` |
| `PermissionCard.svelte` | `permission.approve`, `permission.deny` |
| `QuickReplies.svelte` | `quick-reply.click` |
| `FileBrowser.svelte` | `file-browser.expand`, `file-browser.select` |

Unannotated clicks captured via CSS selector fallback. Review uncategorized clicks in DB to decide what deserves promotion to `data-track`.

### Settings Integration

- New row in SettingsDialog: "Analytics DB size: X MB"
- Size fetched via `GET /analytics/size`
- "Clear analytics" button → `DELETE /analytics/events` with confirmation prompt
- No analytics on/off toggle (single-user tool, no conditional tracking paths)

### Data Retention

Keep everything forever. Single-user app volume stays small (estimated <100MB/year of heavy use). Tiered compaction can be added later if needed.

### Agent Access

Direct SQLite file access at `~/.config/claude-remote-cli/analytics.db`. Any agent with shell access can query via `sqlite3`. No API needed — the server doesn't need to be running for analysis.

**Example agent queries:**

```sql
-- Most-used workspaces (last 30 days)
SELECT json_extract(properties, '$.workspace') as workspace, COUNT(*) as sessions
FROM events WHERE category = 'session' AND action = 'created'
AND timestamp > datetime('now', '-30 days') GROUP BY workspace ORDER BY sessions DESC;

-- Click heatmap: what do you interact with most?
SELECT target, COUNT(*) as clicks FROM events
WHERE category = 'ui' AND action = 'click' AND target IS NOT NULL
GROUP BY target ORDER BY clicks DESC LIMIT 20;

-- Permission approve/deny ratio over time
SELECT date(timestamp) as day,
  SUM(CASE WHEN action = 'permission.approve' THEN 1 ELSE 0 END) as approved,
  SUM(CASE WHEN action = 'permission.deny' THEN 1 ELSE 0 END) as denied
FROM events WHERE category = 'agent' GROUP BY day;

-- Desktop vs mobile usage split
SELECT device, COUNT(*) FROM events GROUP BY device;

-- Average session duration by agent type
SELECT json_extract(properties, '$.agent') as agent,
  AVG(json_extract(properties, '$.duration_s')) as avg_duration
FROM events WHERE category = 'session' AND action = 'ended' GROUP BY agent;

-- Time-of-day usage pattern
SELECT strftime('%H', timestamp) as hour, COUNT(*) as events
FROM events GROUP BY hour ORDER BY hour;

-- Feature discovery: unused UI elements
SELECT DISTINCT target FROM events WHERE category = 'ui' AND action = 'click';

-- Quick replies: useful or ignored?
SELECT COUNT(*) FROM events WHERE target = 'quick-reply.click';
```

## Dependencies

- `better-sqlite3` — synchronous SQLite bindings for Node.js. Native addon (like `node-pty`), requires compilation. Well-maintained, widely used, no external processes. Ships with prebuilt binaries for macOS arm64/x64, Linux, and Windows — no custom `postinstall` script needed (unlike `node-pty` which requires a fixup). The existing `postinstall` script does not need modification.

## New Files

| File | Purpose |
|------|---------|
| `server/analytics.ts` | Server module: SQLite connection, `trackEvent()`, Express Router |
| `frontend/src/lib/analytics.ts` | Frontend collector: auto-capture, explicit tracking, batching |

## Modified Files

| File | Change |
|------|--------|
| `server/index.ts` | Mount analytics Router, initialize DB |
| `server/sessions.ts` | `trackEvent()` calls for session created/ended |
| `server/sdk-handler.ts` | `trackEvent()` calls for permission approve/deny, turn completed |
| `server/ws.ts` | `trackEvent()` calls for idle/waiting-for-input state changes |
| `server/workspaces.ts` | `trackEvent()` calls for workspace added/removed |
| `frontend/src/App.svelte` | Initialize analytics collector on mount |
| `frontend/src/components/dialogs/SettingsDialog.svelte` | Analytics DB size display + clear button |
| ~15 frontend components | Add `data-track` attributes to interactive elements |
| `package.json` | Add `better-sqlite3` dependency |
| `docs/ARCHITECTURE.md` | Add `analytics.ts` to Code Map table, update module count, add dependency flow note |
