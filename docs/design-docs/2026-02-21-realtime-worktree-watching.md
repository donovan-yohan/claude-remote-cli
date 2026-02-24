# Real-time Worktree Watching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Push real-time worktree changes to all connected browser clients so the sidebar stays up to date without polling.

**Architecture:** A new `server/watcher.js` module uses `fs.watch` to monitor `.claude/worktrees/` directories inside every git repo discovered from `rootDirs`. When worktrees are added or removed on disk, it emits a debounced event. A new `/ws/events` WebSocket channel broadcasts these events to all authenticated clients. The client opens this channel after auth and calls `refreshAll()` on each event. Root dir changes (add/remove) rebuild the watchers and also trigger a broadcast.

**Tech Stack:** Node.js `fs.watch`, `events.EventEmitter`, existing `ws` WebSocket library

---

### Task 1: Create the file watcher module

**Files:**
- Create: `server/watcher.js`

**Step 1: Write the watcher module**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class WorktreeWatcher extends EventEmitter {
  constructor() {
    super();
    this._watchers = [];
    this._debounceTimer = null;
  }

  /**
   * Tear down all existing watchers and set up new ones for the given root dirs.
   * For each git repo found one level deep under each root, watch .claude/worktrees/.
   */
  rebuild(rootDirs) {
    this._closeAll();

    for (const rootDir of rootDirs) {
      let entries;
      try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const repoPath = path.join(rootDir, entry.name);
        if (!fs.existsSync(path.join(repoPath, '.git'))) continue;
        this._watchRepo(repoPath);
      }
    }
  }

  _watchRepo(repoPath) {
    const worktreeDir = path.join(repoPath, '.claude', 'worktrees');
    if (fs.existsSync(worktreeDir)) {
      this._addWatch(worktreeDir);
    } else {
      // Watch .claude/ so we catch when worktrees/ is created
      const claudeDir = path.join(repoPath, '.claude');
      if (fs.existsSync(claudeDir)) {
        this._addWatch(claudeDir);
      }
    }
  }

  _addWatch(dirPath) {
    try {
      const watcher = fs.watch(dirPath, { persistent: false }, () => {
        this._debouncedEmit();
      });
      watcher.on('error', () => {}); // ignore watch errors silently
      this._watchers.push(watcher);
    } catch (_) {
      // directory may have vanished — ignore
    }
  }

  _debouncedEmit() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.emit('worktrees-changed');
    }, 500);
  }

  _closeAll() {
    for (const w of this._watchers) {
      try { w.close(); } catch (_) {}
    }
    this._watchers = [];
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  close() {
    this._closeAll();
  }
}

module.exports = { WorktreeWatcher };
```

**Step 2: Commit**

```bash
git add server/watcher.js
git commit -m "feat: add WorktreeWatcher module with fs.watch on .claude/worktrees dirs"
```

---

### Task 2: Add events WebSocket channel to ws.js

**Files:**
- Modify: `server/ws.js:19-98`

**Step 1: Extend setupWebSocket to accept a watcher and handle `/ws/events`**

In `ws.js`, the `setupWebSocket` function currently creates one `WebSocketServer`. We need to:

1. Accept a `watcher` parameter
2. Track a set of event-channel clients (`eventClients`)
3. In the `upgrade` handler, route `/ws/events` to a separate handler that adds the client to `eventClients`
4. Listen on `watcher.on('worktrees-changed')` to broadcast to all `eventClients`
5. Export a `broadcastEvent` function so `index.js` can trigger broadcasts from REST routes too

Replace the full content of `server/ws.js` with:

```js
'use strict';

const { WebSocketServer } = require('ws');
const sessions = require('./sessions');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function setupWebSocket(server, authenticatedTokens, watcher) {
  const wss = new WebSocketServer({ noServer: true });
  const eventClients = new Set();

  function broadcastEvent(type) {
    const msg = JSON.stringify({ type: type });
    for (const client of eventClients) {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    }
  }

  // Forward watcher events to all event-channel clients
  if (watcher) {
    watcher.on('worktrees-changed', function () {
      broadcastEvent('worktrees-changed');
    });
  }

  server.on('upgrade', (request, socket, head) => {
    const cookies = parseCookies(request.headers.cookie);
    if (!authenticatedTokens.has(cookies.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Event channel: /ws/events
    if (request.url === '/ws/events') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        eventClients.add(ws);
        ws.on('close', () => { eventClients.delete(ws); });
      });
      return;
    }

    // PTY channel: /ws/:sessionId
    const match = request.url && request.url.match(/^\/ws\/([a-f0-9]+)$/);
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = match[1];
    const session = sessions.get(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, session);
    });
  });

  wss.on('connection', (ws, request, session) => {
    const ptyProcess = session.pty;

    if (session.scrollback && session.scrollback.length > 0) {
      for (const chunk of session.scrollback) {
        ws.send(chunk);
      }
    }

    const dataHandler = ptyProcess.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });

    ws.on('message', (msg) => {
      const str = msg.toString();
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          sessions.resize(session.id, parsed.cols, parsed.rows);
          return;
        }
      } catch (_) {}
      ptyProcess.write(str);
    });

    ws.on('close', () => {
      dataHandler.dispose();
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000);
      }
    });
  });

  return { wss, broadcastEvent };
}

module.exports = { setupWebSocket };
```

**Step 2: Commit**

```bash
git add server/ws.js
git commit -m "feat: add /ws/events channel for real-time worktree change broadcasts"
```

---

### Task 3: Wire watcher and broadcast into index.js

**Files:**
- Modify: `server/index.js:10-13` (imports)
- Modify: `server/index.js:297-303` (server setup)
- Modify: `server/index.js:207-230` (POST/DELETE /roots routes)

**Step 1: Import the watcher**

At `server/index.js:10`, add the import:

```js
const { WorktreeWatcher } = require('./watcher');
```

**Step 2: Create the watcher, wire it into WebSocket setup, and rebuild after root changes**

At the bottom of `main()`, before `server.listen(...)`:

```js
  const watcher = new WorktreeWatcher();
  watcher.rebuild(config.rootDirs || []);

  const server = http.createServer(app);
  const { broadcastEvent } = setupWebSocket(server, authenticatedTokens, watcher);
```

(Remove the old `const server = http.createServer(app);` and `setupWebSocket(server, authenticatedTokens);` lines.)

**Step 3: Update POST /roots to rebuild watcher and broadcast**

After `saveConfig(CONFIG_PATH, config);` in the POST /roots handler, add:

```js
    watcher.rebuild(config.rootDirs);
    broadcastEvent('worktrees-changed');
```

**Step 4: Update DELETE /roots to rebuild watcher and broadcast**

After `saveConfig(CONFIG_PATH, config);` in the DELETE /roots handler, add:

```js
    watcher.rebuild(config.rootDirs);
    broadcastEvent('worktrees-changed');
```

**Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: wire WorktreeWatcher into server startup and root dir routes"
```

---

### Task 4: Add client-side event WebSocket listener

**Files:**
- Modify: `public/app.js:84-88` (initApp function)
- Modify: `public/app.js:668-671` (settings close handler)

**Step 1: Add event WebSocket connection in initApp**

After `refreshAll();` in the `initApp()` function (~line 87), add:

```js
    connectEventSocket();
```

**Step 2: Write the connectEventSocket function**

Add this function in `app.js` (after the `refreshAll` function, around line 179):

```js
  var eventWs = null;

  function connectEventSocket() {
    if (eventWs) {
      eventWs.close();
      eventWs = null;
    }

    var url = wsProtocol + '//' + location.host + '/ws/events';
    eventWs = new WebSocket(url);

    eventWs.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'worktrees-changed') {
          loadRepos();
          refreshAll();
        }
      } catch (_) {}
    };

    eventWs.onclose = function () {
      // Auto-reconnect after 3 seconds
      setTimeout(function () {
        connectEventSocket();
      }, 3000);
    };

    eventWs.onerror = function () {
      // onclose will fire after this, triggering reconnect
    };
  }
```

**Step 3: Add refreshAll call when settings dialog closes**

In the `settingsClose` click handler (~line 668), add `refreshAll();` after `loadRepos();`:

```js
  settingsClose.addEventListener('click', function () {
    settingsDialog.close();
    loadRepos();
    refreshAll();
  });
```

**Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add event WebSocket client for real-time sidebar updates"
```

---

### Task 5: Update README with platform note

**Files:**
- Modify: `README.md:27-29` (Prerequisites section)

**Step 1: Add platform note**

After the Prerequisites heading, add a platform note:

```markdown
## Platform Support

Tested on **macOS** and **Linux**. Windows is not currently tested — file watching and PTY spawning may behave differently.
```

**Step 2: Update Architecture section**

Add `watcher.js` to the architecture diagram:

```
│   ├── watcher.js    # File watcher for .claude/worktrees/ changes
```

**Step 3: Add a Features bullet**

In the Features list, add:

```markdown
- **Real-time updates** — worktree changes on disk are pushed to the browser instantly via WebSocket
```

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add platform support note and real-time updates to README"
```

---

### Task 6: Manual smoke test

**Step 1: Start the server**

```bash
node server/index.js --config ./config.json
```

**Step 2: Open the app in a browser, authenticate with PIN**

**Step 3: In a separate terminal, create a worktree directory in a watched repo**

```bash
mkdir -p /path/to/watched-repo/.claude/worktrees/test-worktree
```

**Step 4: Verify the sidebar updates within ~1 second without manual refresh**

**Step 5: Remove the test worktree**

```bash
rm -rf /path/to/watched-repo/.claude/worktrees/test-worktree
```

**Step 6: Verify the sidebar updates again**

**Step 7: Open Settings, add a new root dir, click Done — verify sidebar refreshes**

**Step 8: Clean up and commit any fixes if needed**
