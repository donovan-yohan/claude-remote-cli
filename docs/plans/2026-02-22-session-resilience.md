# Session Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PTY WebSocket auto-reconnect so mobile/tab-suspend doesn't lose the session view, and add idle detection with notification dots so users know which sessions need input.

**Architecture:** Client-side reconnect loop in `connectToSession()` with exponential backoff. Server-side idle tracking via PTY output silence timer in sessions module, broadcast over event WebSocket, rendered as notification dots in sidebar.

**Tech Stack:** Vanilla JS (client), TypeScript + node-pty + ws (server), Node.js built-in test runner

---

## Task 1: PTY WebSocket Auto-Reconnect

**Files:**
- Modify: `public/app.js:4-8` (state variables)
- Modify: `public/app.js:314-347` (`connectToSession` function)

**Step 1: Add reconnect state variables**

In `public/app.js`, after line 8 (`var fitAddon = null;`), add:

```javascript
var reconnectTimer = null;
var reconnectAttempt = 0;
```

**Step 2: Replace `connectToSession` with reconnect-aware version**

Replace the entire `connectToSession` function (lines 314-347) with:

```javascript
function connectToSession(sessionId) {
  // Cancel any pending reconnect from a previous session
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;

  if (ws) {
    ws.onclose = null; // prevent reconnect on intentional close
    ws.close();
    ws = null;
  }

  activeSessionId = sessionId;
  noSessionMsg.hidden = true;
  term.clear();
  term.focus();
  closeSidebar();
  updateSessionTitle();

  openPtyWebSocket(sessionId);
}

function openPtyWebSocket(sessionId) {
  var url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  var socket = new WebSocket(url);

  socket.onopen = function () {
    ws = socket;
    reconnectAttempt = 0;
    sendResize();
  };

  socket.onmessage = function (event) {
    term.write(event.data);
  };

  socket.onclose = function (event) {
    // Code 1000 = normal close (PTY exited). Don't reconnect.
    if (event.code === 1000) {
      term.write('\r\n[Session ended]\r\n');
      ws = null;
      return;
    }

    // Only reconnect if this is still the active session
    if (activeSessionId !== sessionId) return;

    ws = null;
    term.write('\r\n[Reconnecting...]\r\n');
    scheduleReconnect(sessionId);
  };

  socket.onerror = function () {
    // onclose will fire after onerror, so reconnect is handled there
  };
}

function scheduleReconnect(sessionId) {
  // Exponential backoff: 1s, 2s, 4s, 8s, capped at 10s
  var delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 10000);
  reconnectAttempt++;

  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    // Abort if user switched sessions
    if (activeSessionId !== sessionId) return;
    // Check session still exists before trying WebSocket
    fetch('/sessions').then(function (res) {
      return res.json();
    }).then(function (sessions) {
      var exists = sessions.some(function (s) { return s.id === sessionId; });
      if (!exists || activeSessionId !== sessionId) {
        term.write('\r\n[Session ended]\r\n');
        return;
      }
      term.clear();
      openPtyWebSocket(sessionId);
    }).catch(function () {
      // Network error — keep trying
      if (activeSessionId === sessionId) {
        scheduleReconnect(sessionId);
      }
    });
  }, delay);
}
```

**Step 3: Test manually**

1. `npm start` — start the server
2. Open browser, connect to a session
3. Open DevTools → Network tab → right-click the WebSocket → Close
4. Verify terminal shows `[Reconnecting...]`
5. Verify it reconnects within ~1s and replays scrollback
6. Kill the session from another tab → verify it shows `[Session ended]` and stops retrying

**Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: auto-reconnect PTY WebSocket on disconnect"
```

---

## Task 2: Add `idle` Field to Session Type

**Files:**
- Modify: `server/types.ts:3-14` (Session interface)

**Step 1: Add idle to Session interface**

In `server/types.ts`, add `idle` to the Session interface after `scrollback`:

```typescript
export interface Session {
  id: string;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  pty: IPty;
  createdAt: string;
  lastActivity: string;
  scrollback: string[];
  idle: boolean;
}
```

**Step 2: Commit**

```bash
git add server/types.ts
git commit -m "feat: add idle field to Session type"
```

---

## Task 3: Idle Tracking in Sessions Module

**Files:**
- Modify: `server/sessions.ts:28` (module-level state)
- Modify: `server/sessions.ts:51-62` (session creation)
- Modify: `server/sessions.ts:76-90` (onData handler)
- Modify: `server/sessions.ts:92-100` (onExit handler)
- Modify: `server/sessions.ts:109-121` (list function)

**Step 1: Write failing test for idle detection**

Add to `test/sessions.test.ts`:

```typescript
it('session starts as not idle', () => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/cat',
    args: [],
  });

  createdIds.push(result.id);

  const session = sessions.get(result.id);
  assert.ok(session);
  assert.strictEqual(session.idle, false);
});

it('list includes idle field', () => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/cat',
    args: [],
  });

  createdIds.push(result.id);

  const list = sessions.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0]?.idle, false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `idle` property doesn't exist on session

**Step 3: Add idle tracking and callback registration to sessions module**

In `server/sessions.ts`, add at module level (after line 28):

```typescript
const IDLE_TIMEOUT_MS = 5000; // 5 seconds of no PTY output = idle
type IdleChangeCallback = (sessionId: string, idle: boolean) => void;
let idleChangeCallback: IdleChangeCallback | null = null;

function onIdleChange(cb: IdleChangeCallback): void {
  idleChangeCallback = cb;
}
```

In the `create` function, add `idle: false` to the session object and add an `idleTimer`:

After `scrollback` in the session object (line 61), add:
```typescript
idle: false,
```

Before `ptyProcess.onData` (around line 74), add:
```typescript
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer(): void {
  if (session.idle) {
    session.idle = false;
    if (idleChangeCallback) idleChangeCallback(session.id, false);
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!session.idle) {
      session.idle = true;
      if (idleChangeCallback) idleChangeCallback(session.id, true);
    }
  }, IDLE_TIMEOUT_MS);
}
```

In the `ptyProcess.onData` handler, call `resetIdleTimer()`:

```typescript
ptyProcess.onData((data) => {
  session.lastActivity = new Date().toISOString();
  resetIdleTimer();
  scrollback.push(data);
  // ... rest unchanged
});
```

In the `ptyProcess.onExit` handler, clear the idle timer:

```typescript
ptyProcess.onExit(() => {
  if (idleTimer) clearTimeout(idleTimer);
  if (metaFlushTimer) clearTimeout(metaFlushTimer);
  // ... rest unchanged
});
```

In the `list` function, include `idle` in the returned fields:

```typescript
function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity, idle }) => ({
      id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity, idle,
    }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}
```

Update `SessionSummary` type to include idle:

```typescript
type SessionSummary = Omit<Session, 'pty' | 'scrollback'>;
```

This already works since `idle` is now on `Session` and not omitted.

Export `onIdleChange`:

```typescript
export { create, get, list, kill, resize, updateDisplayName, write, onIdleChange };
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add server/sessions.ts test/sessions.test.ts
git commit -m "feat: add idle tracking to session module"
```

---

## Task 4: Broadcast Idle State Changes via Event WebSocket

**Files:**
- Modify: `server/ws.ts:20` (broadcastEvent signature)
- Modify: `server/ws.ts:24-31` (broadcastEvent implementation)
- Modify: `server/ws.ts:118` (return statement)

**Step 1: Modify broadcastEvent to support data payloads**

Change `broadcastEvent` to accept an optional data object:

```typescript
function broadcastEvent(type: string, data?: Record<string, unknown>): void {
  const msg = JSON.stringify({ type, ...data });
  for (const client of eventClients) {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}
```

**Step 2: Subscribe to session idle changes**

After the `wss.on('connection', ...)` block (before the return statement), add:

```typescript
sessions.onIdleChange((sessionId, idle) => {
  broadcastEvent('session-idle-changed', { sessionId, idle });
});
```

**Step 3: Build and verify no type errors**

Run: `npm run build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add server/ws.ts
git commit -m "feat: broadcast session idle state changes over event WebSocket"
```

---

## Task 5: Unified Status Dot — Client-Side Rendering

**Files:**
- Modify: `public/app.js:86-88` (state variables section)
- Modify: `public/app.js:362-377` (`connectEventSocket` message handler)
- Modify: `public/app.js:314` (`connectToSession` — clear attention state on open)
- Modify: `public/app.js:537-594` (`createActiveSessionLi` — render status dot)
- Modify: `public/app.js:597+` (`createInactiveWorktreeLi` — render gray dot)
- Modify: `public/style.css` (status dot styles + glow animation)

**Color scheme:**
| State | CSS class | Color | Description |
|-------|-----------|-------|-------------|
| Running | `.status-dot--running` | Green (#4ade80) | PTY actively producing output |
| Idle | `.status-dot--idle` | Blue (#60a5fa) | Active session, no output for 5s |
| Needs attention | `.status-dot--attention` | Yellow-orange glow (#f59e0b) | Idle + user hasn't viewed yet |
| Inactive | `.status-dot--inactive` | Gray (#6b7280) | Worktree with no running session |

**Step 1: Add attention tracking state**

After `var allRepos = [];` (line 89), add:

```javascript
var attentionSessions = {}; // sessionId -> true if idle and user hasn't viewed
```

**Step 2: Handle session-idle-changed events**

In the `connectEventSocket` `onmessage` handler, add a case for the new event type:

```javascript
eventWs.onmessage = function (event) {
  try {
    var msg = JSON.parse(event.data);
    if (msg.type === 'worktrees-changed') {
      loadRepos();
      refreshAll();
    } else if (msg.type === 'session-idle-changed') {
      if (msg.idle && msg.sessionId !== activeSessionId) {
        attentionSessions[msg.sessionId] = true;
      }
      if (!msg.idle) {
        delete attentionSessions[msg.sessionId];
      }
      renderUnifiedList();
    }
  } catch (_) {}
};
```

**Step 3: Clear attention when opening a session**

In `connectToSession`, after setting `activeSessionId = sessionId;`, add:

```javascript
delete attentionSessions[sessionId];
```

**Step 4: Create `getSessionStatus` helper**

Add a helper function (near `connectToSession`) that determines status:

```javascript
function getSessionStatus(session) {
  if (attentionSessions[session.id]) return 'attention';
  if (session.idle) return 'idle';
  return 'running';
}
```

**Step 5: Render the status dot in `createActiveSessionLi`**

In `createActiveSessionLi`, after creating `nameSpan` and before appending it to `infoDiv`, add:

```javascript
var status = getSessionStatus(session);
var dot = document.createElement('span');
dot.className = 'status-dot status-dot--' + status;
```

Prepend the dot to `infoDiv` (before nameSpan):

```javascript
infoDiv.appendChild(dot);
infoDiv.appendChild(nameSpan);
infoDiv.appendChild(subSpan);
```

**Step 6: Render gray dot in `createInactiveWorktreeLi`**

In `createInactiveWorktreeLi`, add a gray dot before the name span:

```javascript
var dot = document.createElement('span');
dot.className = 'status-dot status-dot--inactive';
infoDiv.appendChild(dot);
infoDiv.appendChild(nameSpan);
```

**Step 7: Add CSS for status dots**

In `public/style.css`, after the `.session-name` rule (around line 277), add:

```css
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 8px;
  margin-top: 2px;
}

.status-dot--running {
  background: #4ade80;
}

.status-dot--idle {
  background: #60a5fa;
}

.status-dot--attention {
  background: #f59e0b;
  box-shadow: 0 0 6px 2px rgba(245, 158, 11, 0.5);
  animation: attention-glow 2s ease-in-out infinite;
}

@keyframes attention-glow {
  0%, 100% { box-shadow: 0 0 4px 1px rgba(245, 158, 11, 0.3); }
  50% { box-shadow: 0 0 8px 3px rgba(245, 158, 11, 0.6); }
}

.status-dot--inactive {
  background: #6b7280;
}
```

Also update `.session-info` to use `align-items: flex-start` so the dot aligns with the name:

```css
.session-info {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
  flex: 1;
  align-items: center;
}
```

Note: this changes session-info from column to row+wrap layout. The name span and sub span need adjustments:

```css
.session-name {
  /* existing styles unchanged */
}

.session-sub {
  width: 100%;
  padding-left: 16px; /* indent under name, past the dot */
}

.session-time {
  width: 100%;
  padding-left: 16px;
}
```

**Step 8: Test manually**

1. `npm start`
2. Open a session running Claude — verify green dot while it streams output
3. Wait for Claude to finish — verify dot turns blue (idle)
4. Switch to another session — verify the first session's dot becomes yellow-orange glow (attention)
5. Click back to first session — verify glow clears, dot returns to blue
6. Check inactive worktrees in sidebar — verify gray dots

**Step 9: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: unified session status dots (running/idle/attention/inactive)"
```

---

## Task 6: Build, Full Test, Version Bump

**Step 1: Build**

Run: `npm run build`
Expected: Clean compile, no errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Manual smoke test**

1. Start server, connect on mobile browser
2. Lock phone screen, wait 10s, unlock
3. Verify terminal shows `[Reconnecting...]` then seamlessly resumes
4. Verify idle dots appear for sessions awaiting input
5. Verify dots clear on session open

**Step 4: Commit any fixes if needed, then bump version**

```bash
npm version patch
```
