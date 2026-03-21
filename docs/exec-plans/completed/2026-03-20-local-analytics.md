# Local Analytics & User Behavior Tracking Implementation Plan

> **Status**: Complete | **Created**: 2026-03-20 | **Last Updated**: 2026-03-20
> **Design Doc**: `docs/design-docs/2026-03-20-local-analytics-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-20 | Design | SQLite via better-sqlite3 over JSONL or external services | Agents are fluent in SQL; zero infrastructure; single file |
| 2026-03-20 | Design | Single `events` table with JSON `properties` column | One predictable table for ad-hoc agent queries beats normalized per-type tables |
| 2026-03-20 | Design | Auto-capture clicks via `data-track` attributes + CSS fallback | Semantic naming gives agents clean signals; fallback catches unannotated elements |
| 2026-03-20 | Design | Frontend batches to `POST /analytics/events` every 5s or 20 events | Beacon flush on page hide with `application/json` Blob for compat |
| 2026-03-20 | Design | Direct SQLite file access for agent queries (no API) | Agents have shell access; server doesn't need to be running for analysis |
| 2026-03-20 | Design | Cross-module `trackEvent()` imports justified as pure output dependency | Same pattern as `push.ts` — fire-and-forget, no control flow effect |

## Progress

- [x] Task 1: Install better-sqlite3 and add type declarations
- [x] Task 2: Create server/analytics.ts — SQLite schema, trackEvent(), Express Router
- [x] Task 3: Write analytics unit tests
- [x] Task 4: Mount analytics Router in server/index.ts
- [x] Task 5: Add trackEvent() calls to existing server modules
- [x] Task 6: Create frontend/src/lib/analytics.ts — collector, batching, auto-capture
- [x] Task 7: Initialize analytics in App.svelte
- [x] Task 8: Add data-track attributes to frontend components
- [x] Task 9: Add analytics section to SettingsDialog
- [x] Task 10: Update docs (ARCHITECTURE.md, QUALITY.md)

## Surprises & Discoveries

- `sdk-handler.ts` was removed in the SDK chat UI cleanup — 3 event types from the design spec are deferred
- `isMobileDevice` is a boolean constant, not a function (caught by Codex review)
- `exactOptionalPropertyTypes` in frontend tsconfig requires `T | null` not `T | undefined`
- Worktree sessions set `repoPath` to the worktree path, not the workspace root — use `root` field instead

## Plan Drift

- Task 5: Removed sdk-handler.ts tracking (module doesn't exist)
- Task 8: Reduced from ~15 to 10 components (ChatInput, PermissionCard, QuickReplies removed with SDK UI)

---

## File Structure

**New files:**
| File | Purpose |
|------|---------|
| `server/analytics.ts` | Server module: SQLite connection, `trackEvent()`, Express Router (`/analytics/*`) |
| `frontend/src/lib/analytics.ts` | Frontend collector: auto-capture, explicit `track()`, batching, beacon flush |
| `test/analytics.test.ts` | Unit tests for analytics module |

**Modified files:**
| File | Change |
|------|--------|
| `package.json` | Add `better-sqlite3` + `@types/better-sqlite3` |
| `server/index.ts` | Import and mount analytics Router, initialize DB |
| `server/sessions.ts` | `trackEvent()` on create/kill |
| `server/ws.ts` | `trackEvent()` on idle/state changes |
| `server/workspaces.ts` | `trackEvent()` on workspace add/remove |

**Note:** The design spec references `sdk-handler.ts` for permission/turn tracking, but that module was removed in the SDK chat UI remnant cleanup (completed 2026-03-19). Those events (`agent.permission.approve/deny`, `agent.turn.completed`) are not trackable in the current PTY-only architecture. If SDK mode is re-added in the future, tracking should be added at that time.
| `frontend/src/App.svelte` | Import and call `initAnalytics()` on mount |
| `frontend/src/lib/api.ts` | Add `fetchAnalyticsSize()` and `clearAnalytics()` functions |
| `frontend/src/components/dialogs/SettingsDialog.svelte` | Analytics DB size display + clear button |
| 10 frontend components | Add `data-track` attributes (WorkspaceItem, Sidebar, SmartSearch, ContextMenu, Toolbar, PrTopBar, SessionTabBar, Terminal, FileBrowser, NewSessionDialog) |
| `docs/ARCHITECTURE.md` | Add `analytics.ts` to Code Map, update module count |
| `docs/QUALITY.md` | Add analytics test file to test table |

---

### Task 1: Install better-sqlite3 and add type declarations

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
```

- [ ] **Step 2: Install type declarations**

```bash
npm install -D @types/better-sqlite3
```

- [ ] **Step 3: Verify build still compiles**

Run: `npm run build:server`
Expected: PASS — no type errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add better-sqlite3 for local analytics"
```

---

### Task 2: Create server/analytics.ts — SQLite schema, trackEvent(), Express Router

**Files:**
- Create: `server/analytics.ts`

- [ ] **Step 1: Create the analytics module**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Router } from 'express';
import type { Request, Response } from 'express';

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  category    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  properties  TEXT,
  session_id  TEXT,
  device      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_category_action ON events(category, action);
CREATE INDEX IF NOT EXISTS idx_events_target ON events(target);
`;

export interface AnalyticsEvent {
  category: string;
  action: string;
  target?: string;
  properties?: Record<string, unknown>;
  session_id?: string;
  device?: string;
}

export function initAnalytics(configDir: string): void {
  const dbPath = path.join(configDir, 'analytics.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
}

export function closeAnalytics(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function trackEvent(event: AnalyticsEvent): void {
  if (!db) return;
  try {
    db.prepare(
      'INSERT INTO events (category, action, target, properties, session_id, device) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      event.category,
      event.action,
      event.target ?? null,
      event.properties ? JSON.stringify(event.properties) : null,
      event.session_id ?? null,
      event.device ?? null,
    );
  } catch {
    // Analytics write failure is non-fatal
  }
}

export function getDbPath(configDir: string): string {
  return path.join(configDir, 'analytics.db');
}

export function getDbSize(configDir: string): number {
  try {
    const stat = fs.statSync(getDbPath(configDir));
    return stat.size;
  } catch {
    return 0;
  }
}

export function createAnalyticsRouter(configDir: string): Router {
  const router = Router();

  // POST /analytics/events — batch ingest from frontend
  router.post('/events', (req: Request, res: Response) => {
    const { events } = req.body as { events?: AnalyticsEvent[] };
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'events array required' });
      return;
    }

    if (!db) {
      res.status(503).json({ error: 'Analytics not initialized' });
      return;
    }

    const insert = db.prepare(
      'INSERT INTO events (category, action, target, properties, session_id, device) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const insertMany = db.transaction((evts: AnalyticsEvent[]) => {
      for (const evt of evts) {
        insert.run(
          evt.category,
          evt.action,
          evt.target ?? null,
          evt.properties ? JSON.stringify(evt.properties) : null,
          evt.session_id ?? null,
          evt.device ?? null,
        );
      }
    });

    try {
      insertMany(events);
      res.json({ ok: true, count: events.length });
    } catch {
      res.status(500).json({ error: 'Failed to write events' });
    }
  });

  // GET /analytics/size — DB file size in bytes
  router.get('/size', (_req: Request, res: Response) => {
    res.json({ bytes: getDbSize(configDir) });
  });

  // DELETE /analytics/events — truncate events table
  router.delete('/events', (_req: Request, res: Response) => {
    if (!db) {
      res.status(503).json({ error: 'Analytics not initialized' });
      return;
    }
    try {
      db.exec('DELETE FROM events');
      db.exec('VACUUM');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to clear analytics' });
    }
  });

  return router;
}
```

- [ ] **Step 2: Verify the server compiles**

Run: `npm run build:server`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/analytics.ts
git commit -m "feat: add server/analytics.ts — SQLite schema, trackEvent, Express Router"
```

---

### Task 3: Write analytics unit tests

**Files:**
- Create: `test/analytics.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { initAnalytics, closeAnalytics, trackEvent, getDbSize, getDbPath } from '../server/analytics.js';
import type { AnalyticsEvent } from '../server/analytics.js';

let tmpDir!: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-remote-cli-analytics-test-'));
});

afterEach(() => {
  closeAnalytics();
  // Clean up DB files between tests
  for (const entry of fs.readdirSync(tmpDir)) {
    fs.unlinkSync(path.join(tmpDir, entry));
  }
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

test('initAnalytics creates database and schema', () => {
  initAnalytics(tmpDir);
  const dbPath = getDbPath(tmpDir);
  assert.ok(fs.existsSync(dbPath), 'DB file should exist');

  const db = new Database(dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  assert.ok(tables.some(t => t.name === 'events'), 'events table should exist');
  db.close();
});

test('trackEvent inserts a row', () => {
  initAnalytics(tmpDir);

  trackEvent({
    category: 'session',
    action: 'created',
    target: 'session-123',
    properties: { workspace: '/proj', agent: 'claude' },
    session_id: 'session-123',
    device: 'desktop',
  });

  const db = new Database(getDbPath(tmpDir), { readonly: true });
  const rows = db.prepare('SELECT * FROM events').all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.category, 'session');
  assert.equal(rows[0]!.action, 'created');
  assert.equal(rows[0]!.target, 'session-123');
  assert.equal(rows[0]!.device, 'desktop');

  const props = JSON.parse(rows[0]!.properties as string) as Record<string, unknown>;
  assert.equal(props.workspace, '/proj');
  assert.equal(props.agent, 'claude');
  db.close();
});

test('trackEvent handles optional fields as null', () => {
  initAnalytics(tmpDir);

  trackEvent({ category: 'ui', action: 'click' });

  const db = new Database(getDbPath(tmpDir), { readonly: true });
  const rows = db.prepare('SELECT * FROM events').all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.target, null);
  assert.equal(rows[0]!.properties, null);
  assert.equal(rows[0]!.session_id, null);
  assert.equal(rows[0]!.device, null);
  db.close();
});

test('trackEvent is no-op before initAnalytics', () => {
  // Should not throw
  trackEvent({ category: 'test', action: 'noop' });
});

test('getDbSize returns file size after writes', () => {
  initAnalytics(tmpDir);
  const sizeBefore = getDbSize(tmpDir);
  assert.ok(sizeBefore > 0, 'DB file should have non-zero size after init');

  for (let i = 0; i < 10; i++) {
    trackEvent({ category: 'bulk', action: 'test', properties: { i } });
  }

  const sizeAfter = getDbSize(tmpDir);
  assert.ok(sizeAfter >= sizeBefore, 'Size should grow after writes');
});

test('getDbSize returns 0 for non-existent path', () => {
  assert.equal(getDbSize('/nonexistent/path'), 0);
});

test('initAnalytics is idempotent (schema already exists)', () => {
  initAnalytics(tmpDir);
  trackEvent({ category: 'test', action: 'first' });
  closeAnalytics();

  // Re-init should not throw or lose data
  initAnalytics(tmpDir);
  const db = new Database(getDbPath(tmpDir), { readonly: true });
  const rows = db.prepare('SELECT * FROM events').all();
  assert.equal(rows.length, 1);
  db.close();
});

// ── Router endpoint tests ──────────────────────────────────────────────
// These test the Express Router in isolation (same pattern as fs-browse.test.ts)

import express from 'express';
import http from 'node:http';
import { createAnalyticsRouter } from '../server/analytics.js';

test('POST /analytics/events batch inserts events', async () => {
  initAnalytics(tmpDir);
  const app = express();
  app.use(express.json());
  app.use('/analytics', createAnalyticsRouter(tmpDir));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const res = await fetch(`http://localhost:${port}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [
      { category: 'ui', action: 'click', target: 'test-btn' },
      { category: 'session', action: 'created' },
    ]}),
  });
  const data = await res.json() as { ok: boolean; count: number };
  assert.equal(data.ok, true);
  assert.equal(data.count, 2);

  const db = new Database(getDbPath(tmpDir), { readonly: true });
  const rows = db.prepare('SELECT * FROM events').all();
  assert.equal(rows.length, 2);
  db.close();

  server.close();
});

test('GET /analytics/size returns bytes', async () => {
  initAnalytics(tmpDir);
  const app = express();
  app.use('/analytics', createAnalyticsRouter(tmpDir));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const res = await fetch(`http://localhost:${port}/analytics/size`);
  const data = await res.json() as { bytes: number };
  assert.ok(data.bytes > 0);

  server.close();
});

test('DELETE /analytics/events clears all events', async () => {
  initAnalytics(tmpDir);
  trackEvent({ category: 'test', action: 'to-delete' });

  const app = express();
  app.use(express.json());
  app.use('/analytics', createAnalyticsRouter(tmpDir));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const res = await fetch(`http://localhost:${port}/analytics/events`, { method: 'DELETE' });
  const data = await res.json() as { ok: boolean };
  assert.equal(data.ok, true);

  const db = new Database(getDbPath(tmpDir), { readonly: true });
  const rows = db.prepare('SELECT * FROM events').all();
  assert.equal(rows.length, 0);
  db.close();

  server.close();
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all analytics tests green

- [ ] **Step 3: Commit**

```bash
git add test/analytics.test.ts
git commit -m "test: add analytics module unit tests"
```

---

### Task 4: Mount analytics Router in server/index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add imports at top of index.ts**

Add after the `push` import (line 22):

```typescript
import { initAnalytics, closeAnalytics, createAnalyticsRouter } from './analytics.js';
```

- [ ] **Step 2: Initialize analytics after config load**

Add after `push.ensureVapidKeys(config, CONFIG_PATH, saveConfig);` (line 176):

```typescript
  // Initialize analytics
  const configDir = path.dirname(CONFIG_PATH);
  initAnalytics(configDir);
```

Then find the duplicate declaration on line 252:
```typescript
  const configDir = path.dirname(CONFIG_PATH);
  const restoredCount = await restoreFromDisk(configDir);
```
Remove the duplicate `const configDir` line (it's now declared earlier). The `restoreFromDisk(configDir)` call stays — it now uses the variable declared above. The result should be:
```typescript
  const restoredCount = await restoreFromDisk(configDir);
```

- [ ] **Step 3: Mount the analytics Router**

Add after the workspace router mount (line 249):

```typescript
  // Mount analytics router
  const analyticsRouter = createAnalyticsRouter(path.dirname(CONFIG_PATH));
  app.use('/analytics', requireAuth, analyticsRouter);
```

- [ ] **Step 4: Add closeAnalytics to graceful shutdown**

Add `closeAnalytics();` at the start of `gracefulShutdown()`:

```typescript
  function gracefulShutdown() {
    closeAnalytics();
    server.close();
    // ... rest unchanged
  }
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build:server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat: mount analytics Router and initialize DB on startup"
```

---

### Task 5: Add trackEvent() calls to existing server modules

**Files:**
- Modify: `server/sessions.ts`
- Modify: `server/ws.ts`
- Modify: `server/workspaces.ts`

- [ ] **Step 1: Track session created/ended in sessions.ts**

Add import at top:
```typescript
import { trackEvent } from './analytics.js';
```

In `create()` function, after `const { session: ptySession, result } = createPtySession(...)` (line 129), add:
```typescript
  trackEvent({
    category: 'session',
    action: 'created',
    target: id,
    properties: {
      agent,
      type: type ?? 'worktree',
      workspace: root ?? repoPath,  // root is the configured workspace path; repoPath may be worktree path
      mode: command ? 'terminal' : 'agent',
    },
    session_id: id,
  });
```

In `kill()` function, before `sessions.delete(id)` (line 191), add:
```typescript
  const durationS = Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000);
  trackEvent({
    category: 'session',
    action: 'ended',
    target: id,
    properties: {
      agent: session.agent,
      type: session.type,
      workspace: session.root || session.repoPath,  // root is the configured workspace path
      duration_s: durationS,
    },
    session_id: id,
  });
```

- [ ] **Step 2: Track idle/state changes in ws.ts**

Add import at top:
```typescript
import { trackEvent } from './analytics.js';
```

In the `sessions.onIdleChange` callback (line 257), add tracking:
```typescript
  sessions.onIdleChange((sessionId, idle) => {
    broadcastEvent('session-idle-changed', { sessionId, idle });
    if (idle) {
      trackEvent({ category: 'agent', action: 'idle', target: sessionId, session_id: sessionId });
    }
  });
```

In the `sessions.onStateChange` callback (line 261), add tracking:
```typescript
  sessions.onStateChange((sessionId, state) => {
    broadcastEvent('session-state-changed', { sessionId, state });
    if (state === 'waiting-for-input') {
      trackEvent({ category: 'agent', action: 'waiting-for-input', target: sessionId, session_id: sessionId });
    }
  });
```

- [ ] **Step 3: Track workspace changes in workspaces.ts**

Add import at top (after other server imports):
```typescript
import { trackEvent } from './analytics.js';
```

In the POST `/` handler (~line 181, after `saveConfig(configPath, config);`), add:
```typescript
    trackEvent({ category: 'workspace', action: 'added', target: resolved, properties: { name: path.basename(resolved) } });
```

In the DELETE `/` handler (~line 216, after `saveConfig(configPath, config);`), add:
```typescript
    trackEvent({ category: 'workspace', action: 'removed', target: resolved });
```

- [ ] **Step 4: Verify build compiles and tests pass**

Run: `npm run build:server && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/sessions.ts server/ws.ts server/workspaces.ts
git commit -m "feat: add trackEvent() calls to sessions, ws, and workspaces modules"
```

---

### Task 6: Create frontend/src/lib/analytics.ts — collector, batching, auto-capture

**Files:**
- Create: `frontend/src/lib/analytics.ts`

- [ ] **Step 1: Create the frontend analytics module**

```typescript
import { isMobileDevice } from './utils.js';

interface PendingEvent {
  category: string;
  action: string;
  target?: string | null;
  properties?: Record<string, unknown> | null;
  session_id?: string | null;
  device: string;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 20;

let queue: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let device: string = 'desktop';
let getActiveSessionId: (() => string | null) | null = null;

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];

  const body = JSON.stringify({ events: batch });

  // Use sendBeacon if available (works during page unload)
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon('/analytics/events', blob);
  } else {
    fetch('/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

export function track(
  category: string,
  action: string,
  target?: string,
  properties?: Record<string, unknown>,
  sessionId?: string,
): void {
  queue.push({
    category,
    action,
    target: target ?? null,
    properties: properties ?? null,
    session_id: sessionId ?? null,
    device,
  });

  if (queue.length >= FLUSH_THRESHOLD) {
    flush();
  }
}

function getTrackValue(el: Element): string | null {
  let current: Element | null = el;
  while (current) {
    const val = current.getAttribute('data-track');
    if (val) return val;
    current = current.parentElement;
  }
  return null;
}

function buildSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return tag + cls;
}

function handleClick(e: MouseEvent): void {
  const el = e.target as Element | null;
  if (!el) return;

  const trackValue = getTrackValue(el);
  const target = trackValue || buildSelector(el);

  const text = (el.textContent || '').trim().slice(0, 50) || null;

  // Only attach session_id for session-scoped UI (terminal, session-tab).
  // Global UI (sidebar, dialog, search, pr-top-bar) gets session_id: null.
  const SESSION_SCOPED_PREFIXES = ['terminal.', 'session-tab.'];
  const isSessionScoped = trackValue != null && SESSION_SCOPED_PREFIXES.some(p => trackValue.startsWith(p));
  const sessionId = isSessionScoped ? (getActiveSessionId?.() ?? null) : null;

  track('ui', 'click', target, text ? { text } : undefined, sessionId ?? undefined);
}

export function initAnalytics(activeSessionIdGetter: () => string | null): void {
  device = isMobileDevice ? 'mobile' : 'desktop';
  getActiveSessionId = activeSessionIdGetter;

  // Auto-capture clicks
  document.addEventListener('click', handleClick, { capture: true, passive: true });

  // Periodic flush
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  // Flush on page hide (tab switch, close, navigation)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
}

export function destroyAnalytics(): void {
  flush();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  document.removeEventListener('click', handleClick, { capture: true } as EventListenerOptions);
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npm run check:svelte`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/analytics.ts
git commit -m "feat: add frontend analytics collector with auto-capture and batching"
```

---

### Task 7: Initialize analytics in App.svelte

**Files:**
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Import and initialize analytics**

Add import at top of `<script>` block (after other lib imports):
```typescript
  import { initAnalytics, destroyAnalytics } from './lib/analytics.js';
```

In the existing `onMount` callback, add near the top:
```typescript
    initAnalytics(() => sessionState.activeSessionId);
```

Also add navigation tracking. Import `track` alongside `initAnalytics`:
```typescript
  import { initAnalytics, destroyAnalytics, track } from './lib/analytics.js';
```

Add a `$effect` that fires whenever the active view changes (session vs dashboard). This catches all navigation paths (direct click, session creation callbacks, PR flows, etc.) without having to instrument each one:
```typescript
  $effect(() => {
    // Reactive: fires when activeSessionId changes
    const id = sessionState.activeSessionId;
    if (id) {
      track('navigation', 'page.view', '/terminal', { sessionId: id });
    } else {
      track('navigation', 'page.view', '/dashboard', { workspace: ui.activeWorkspacePath });
    }
  });
```
Place this inside the `<script>` block after the `onMount` call. This is cleaner than tracking in individual navigation functions because it catches all paths that change `activeSessionId`.

- [ ] **Step 2: Verify frontend compiles**

Run: `npm run check:svelte`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat: initialize analytics collector on app mount"
```

---

### Task 8: Add data-track attributes to frontend components

**Files:**
- Modify: `frontend/src/components/WorkspaceItem.svelte`
- Modify: `frontend/src/components/Sidebar.svelte`
- Modify: `frontend/src/components/SmartSearch.svelte`
- Modify: `frontend/src/components/ContextMenu.svelte`
- Modify: `frontend/src/components/Toolbar.svelte`
- Modify: `frontend/src/components/PrTopBar.svelte`
- Modify: `frontend/src/components/SessionTabBar.svelte`
- Modify: `frontend/src/components/Terminal.svelte`
- Modify: `frontend/src/components/FileBrowser.svelte`
- Modify: `frontend/src/components/dialogs/NewSessionDialog.svelte`

**Note:** ChatInput.svelte, PermissionCard.svelte, and QuickReplies.svelte do not exist (removed with SDK chat UI). Skip those.

- [ ] **Step 1: WorkspaceItem.svelte — workspace and session clicks**

File: `frontend/src/components/WorkspaceItem.svelte`

Add to the workspace header `<div class="workspace-header">` (~line 199):
```svelte
data-track="sidebar.workspace.click"
```

Add to active session `<li class="session-row">` (~line 247):
```svelte
data-track="sidebar.session.click"
```

Add to idle repo root `<li class="session-row inactive">` (~line 291):
```svelte
data-track="sidebar.repo.click"
```

Add to inactive worktree `<li class="session-row inactive">` (~line 327):
```svelte
data-track="sidebar.worktree.click"
```

Add to add-worktree row `<div class="add-worktree-row">` (~line 380):
```svelte
data-track="sidebar.new-worktree"
```

- [ ] **Step 2: Sidebar.svelte — sidebar buttons**

File: `frontend/src/components/Sidebar.svelte`

Add to the settings button (~line 231):
```svelte
data-track="sidebar.settings"
```

Add to the add-workspace button (~line 227):
```svelte
data-track="sidebar.add-workspace"
```

- [ ] **Step 3: SmartSearch.svelte — search input and results**

File: `frontend/src/components/SmartSearch.svelte`

Add to the `<input class="search-input">` (~line 82):
```svelte
data-track="search.input"
```

Add to each `<li class="dropdown-item">` in the results loop (~line 99):
```svelte
data-track="search.select"
```

- [ ] **Step 4: ContextMenu.svelte — menu items (dynamic)**

File: `frontend/src/components/ContextMenu.svelte`

Add to the trigger button `<button class="context-menu-trigger">` (~line 90):
```svelte
data-track="context-menu.open"
```

Add to each `<li class="context-menu-item">` in the items loop (~line 114), using the item's label dynamically:
```svelte
data-track="context-menu.{item.label.toLowerCase().replace(/\s+/g, '-')}"
```

- [ ] **Step 5: Toolbar.svelte — mobile toolbar buttons (dynamic)**

File: `frontend/src/components/Toolbar.svelte`

Add to each `<button class="tb-btn">` in both the copy-mode loop (~line 148) and normal-mode loop (~line 159):
```svelte
data-track="toolbar.{btn.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}"
```

- [ ] **Step 6: PrTopBar.svelte — action buttons**

File: `frontend/src/components/PrTopBar.svelte`

Add to the PR link `<a class="pr-link">` (~line 129):
```svelte
data-track="pr-top-bar.open-pr"
```

Add to the secondary action button (~line 154):
```svelte
data-track="pr-top-bar.secondary-action"
```

Add to the primary action button (~line 163):
```svelte
data-track="pr-top-bar.primary-action"
```

- [ ] **Step 7: SessionTabBar.svelte — tab and new-session buttons**

File: `frontend/src/components/SessionTabBar.svelte`

Add to each `<button class="tab">` in the session tab loop (~line 78):
```svelte
data-track="session-tab.select"
```

Add to the tab close `<span class="tab-close">` (~line 90):
```svelte
data-track="session-tab.close"
```

Add to the new-session menu button (~line 103):
```svelte
data-track="session-tab.new-menu"
```

Add to the new Claude session item (~line 115):
```svelte
data-track="session-tab.new-claude"
```

Add to the new terminal item (~line 123):
```svelte
data-track="session-tab.new-terminal"
```

- [ ] **Step 8: Terminal.svelte — terminal container and scroll FABs**

File: `frontend/src/components/Terminal.svelte`

Add to `<div class="terminal-wrapper">` (~line 584):
```svelte
data-track="terminal.focus"
```

Add to scroll FAB buttons (~lines 621-623):
```svelte
data-track="terminal.scroll-up"
data-track="terminal.scroll-down"
data-track="terminal.scroll-bottom"
```

- [ ] **Step 9: FileBrowser.svelte — expand and select**

File: `frontend/src/components/FileBrowser.svelte`

Add to `<button class="expand-btn">` (~line 270):
```svelte
data-track="file-browser.expand"
```

Add to `<input type="checkbox" class="node-checkbox">` (~line 285):
```svelte
data-track="file-browser.select"
```

- [ ] **Step 10: NewSessionDialog.svelte — tabs, agent, submit**

File: `frontend/src/components/dialogs/NewSessionDialog.svelte`

Add to the Repo Session tab button (~line 246):
```svelte
data-track="dialog.new-session.tab.repos"
```

Add to the Worktree tab button (~line 253):
```svelte
data-track="dialog.new-session.tab.worktrees"
```

Add to the agent `<select>` (~line 267):
```svelte
data-track="dialog.new-session.agent"
```

Add to the submit button (~line 393):
```svelte
data-track="dialog.new-session.create"
```

- [ ] **Step 11: Verify frontend compiles**

Run: `npm run check:svelte`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add data-track attributes to all interactive frontend components"
```

---

### Task 9: Add analytics section to SettingsDialog

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/dialogs/SettingsDialog.svelte`

- [ ] **Step 1: Add API functions to api.ts**

Add at the end of `api.ts`:

```typescript
export async function fetchAnalyticsSize(): Promise<{ bytes: number }> {
  return json<{ bytes: number }>(await fetch('/analytics/size'));
}

export async function clearAnalytics(): Promise<void> {
  const res = await fetch('/analytics/events', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear analytics');
}
```

- [ ] **Step 2: Add analytics section to SettingsDialog**

Add import in the `<script>` block:
```typescript
  import { fetchAnalyticsSize, clearAnalytics } from '../../lib/api.js';
```

Add state variables:
```typescript
  let analyticsSize = $state<number | null>(null);
  let clearing = $state(false);
```

In the `open()` function, add:
```typescript
    fetchAnalyticsSize().then(d => { analyticsSize = d.bytes; }).catch(() => {});
```

Add handler function:
```typescript
  async function handleClearAnalytics() {
    if (!confirm('Clear all analytics data? This cannot be undone.')) return;
    clearing = true;
    try {
      await clearAnalytics();
      analyticsSize = 0;
    } catch {
      error = 'Failed to clear analytics.';
    } finally {
      clearing = false;
    }
  }
```

Add section in template (before the Version section):
```svelte
      <!-- Analytics section -->
      <section class="settings-section">
        <h3 class="section-title">Analytics</h3>
        <div class="version-row">
          <span class="version-current">
            DB size: {analyticsSize !== null ? (analyticsSize / 1024 / 1024).toFixed(1) + ' MB' : '...'}
          </span>
          <button
            class="btn btn-ghost btn-sm"
            onclick={handleClearAnalytics}
            disabled={clearing}
            data-track="dialog.settings.clear-analytics"
          >
            {clearing ? 'Clearing\u2026' : 'Clear'}
          </button>
        </div>
      </section>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `npm run check:svelte`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/dialogs/SettingsDialog.svelte
git commit -m "feat: add analytics DB size and clear button to settings dialog"
```

---

### Task 10: Update docs (ARCHITECTURE.md, QUALITY.md)

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/QUALITY.md`

- [ ] **Step 1: Update ARCHITECTURE.md**

Update the module count in the Code Map intro. The current text says "Twelve" but the actual count is already 14 (including `types.ts` and `output-parsers/`). Adding `analytics.ts` makes it 15. Update to: "Fifteen TypeScript modules compiled to `dist/server/` via `tsc`."

Add `analytics.ts` row to the module table:
```
| `analytics.ts` | Local analytics: SQLite-backed event tracking, `trackEvent()`, batch ingest endpoint, DB size/clear endpoints |
```

Update the Architecture Invariant to mention that `analytics.ts` is a pure output dependency importable by multiple modules (same as `push.ts`).

- [ ] **Step 2: Update QUALITY.md**

Add `analytics.test.ts` to the Test Files table:
```
| `test/analytics.test.ts` | Analytics DB init, trackEvent insertion, optional fields, idempotency, DB size |
```

Update the test file count. The current text says "Ten" but the actual count is already 15. Adding `analytics.test.ts` makes it 16. Update to: "Sixteen test files covering all server modules".

- [ ] **Step 3: Verify everything builds and tests pass**

Run: `npm run build && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/QUALITY.md
git commit -m "docs: update architecture and quality docs for analytics module"
```

---

## Outcomes & Retrospective

**What worked:**
- Codex review caught 5 real bugs before any code was written (isMobileDevice type, exactOptionalPropertyTypes, workspace root, workspaces.ts variable names, session_id scoping)
- Parallelizing tasks (T4+T5+T6, then T7+T8+T9) cut execution time roughly in half
- Single-table schema with JSON properties was quick to implement and test

**What didn't:**
- Design spec referenced sdk-handler.ts which was already removed — design docs should verify module existence before referencing them
- ARCHITECTURE.md and QUALITY.md had stale counts before this feature — the drift accumulated over many PRs

**Learnings to codify:**
- When adding a cross-module import (like analytics.ts), verify the architecture invariant section explicitly allows it
- Frontend `$effect` runs on mount — use a `previous` guard for tracking transitions
- Batch endpoints should skip malformed items, not rollback the entire transaction
