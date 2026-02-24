# Svelte 5 Migration & Menu UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the vanilla JS frontend to Svelte 5 (runes) with Vite, and redesign session list items with git status, hover-reveal actions, and smooth text overflow.

**Architecture:** Standalone Svelte 5 + Vite compiling to `dist/frontend/`. Express serves the built output. State managed via `.svelte.ts` modules using `$state`/`$derived`. xterm.js as npm dependency.

**Tech Stack:** Svelte 5 (runes), Vite, TypeScript, xterm.js (npm), `gh` CLI for git status

---

## Task 1: Scaffold Vite + Svelte 5 Project

**Files:**
- Create: `frontend/vite.config.ts`
- Create: `frontend/svelte.config.js`
- Create: `frontend/tsconfig.json`
- Create: `frontend/src/main.ts`
- Create: `frontend/src/App.svelte`
- Create: `frontend/src/app.css`
- Create: `frontend/index.html`
- Modify: `package.json`
- Modify: `tsconfig.json` (backend — exclude frontend/)

**Step 1: Install Svelte 5 + Vite dependencies**

Run:
```bash
npm install --save svelte
npm install --save-dev vite @sveltejs/vite-plugin-svelte svelte-check
```

**Step 2: Install xterm.js as npm dependency**

Run:
```bash
npm install --save @xterm/xterm @xterm/addon-fit
```

**Step 3: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  root: 'frontend',
  build: {
    outDir: path.resolve(__dirname, 'dist/frontend'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/sessions': 'http://localhost:3000',
      '/repos': 'http://localhost:3000',
      '/branches': 'http://localhost:3000',
      '/worktrees': 'http://localhost:3000',
      '/roots': 'http://localhost:3000',
      '/version': 'http://localhost:3000',
      '/update': 'http://localhost:3000',
      '/git-status': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

**Step 4: Create `frontend/svelte.config.js`**

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

**Step 5: Create `frontend/tsconfig.json`**

```json
{
  "extends": "@sveltejs/vite-plugin-svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["svelte"],
    "baseUrl": ".",
    "paths": {
      "$lib/*": ["src/lib/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"],
  "exclude": ["node_modules"]
}
```

**Step 6: Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>Claude Remote CLI</title>
  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="theme-color" content="#1a1a1a" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
  <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
</body>
</html>
```

**Step 7: Create `frontend/src/app.css`**

Port the CSS variables and global reset from `public/style.css`:

```css
:root {
  --bg: #1a1a1a;
  --surface: #2b2b2b;
  --accent: #d97757;
  --text: #ececec;
  --text-muted: #9b9b9b;
  --border: #3d3d3d;
  --sidebar-width: 240px;
  --toolbar-height: auto;
}

[hidden] { display: none !important; }

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
}

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
```

All other styles will be scoped inside Svelte components.

**Step 8: Create `frontend/src/main.ts`**

```ts
import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
```

**Step 9: Create minimal `frontend/src/App.svelte`**

```svelte
<script lang="ts">
  // Placeholder — will be replaced in Task 3
</script>

<h1>Claude Remote CLI</h1>
<p>Svelte 5 migration in progress</p>
```

**Step 10: Move PWA static assets**

Move `public/manifest.json`, `public/sw.js`, `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png` to `frontend/public/` (Vite copies these to output root).

Run:
```bash
mkdir -p frontend/public
cp public/manifest.json public/sw.js public/icon.svg public/icon-192.png public/icon-512.png frontend/public/
```

**Step 11: Update backend `tsconfig.json`**

Add `frontend/` to the exclude list so `tsc` doesn't try to compile Svelte files:

In `tsconfig.json`, add `"frontend/"` to the `exclude` array.

**Step 12: Update `package.json` scripts and files**

Update scripts:
```json
{
  "scripts": {
    "build": "tsc && vite build",
    "build:server": "tsc",
    "build:frontend": "vite build",
    "dev": "vite --config frontend/vite.config.ts",
    "start": "tsc && vite build && node dist/server/index.js",
    "test": "tsc -p tsconfig.test.json && node --test dist/test/*.test.js",
    "postinstall": "chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true"
  },
  "files": [
    "dist/"
  ]
}
```

**Step 13: Update Express static path in `server/index.ts`**

Change line 166 from:
```ts
app.use(express.static(path.join(__dirname, '..', '..', 'public')));
```
to:
```ts
app.use(express.static(path.join(__dirname, '..', 'frontend')));
```

(Because `dist/server/index.js` → `dist/frontend/` is `../frontend`)

**Step 14: Verify the scaffold builds and runs**

Run:
```bash
npm run build
```

Expected: Both `tsc` and `vite build` succeed. `dist/frontend/index.html` exists.

Run:
```bash
npm start
```

Expected: Server starts, visiting `localhost:3000` shows the placeholder Svelte app.

**Step 15: Commit**

```bash
git add frontend/ package.json package-lock.json tsconfig.json server/index.ts
git commit -m "feat: scaffold Svelte 5 + Vite frontend build pipeline"
```

---

## Task 2: State Modules — Auth, UI, Sessions

**Files:**
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/state/auth.svelte.ts`
- Create: `frontend/src/lib/state/ui.svelte.ts`
- Create: `frontend/src/lib/state/sessions.svelte.ts`
- Create: `frontend/src/lib/ws.ts`
- Create: `frontend/src/lib/utils.ts`

**Step 1: Create `frontend/src/lib/types.ts`**

Shared frontend types. These mirror the server's REST responses:

```ts
export interface SessionSummary {
  id: string;
  type: 'repo' | 'worktree';
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  idle: boolean;
}

export interface WorktreeInfo {
  name: string;
  path: string;
  repoName: string;
  repoPath: string;
  root: string;
  displayName: string;
  lastActivity: string;
}

export interface RepoInfo {
  name: string;
  path: string;
  root: string;
}

export interface GitStatus {
  prState: 'open' | 'merged' | 'closed' | null;
  additions: number;
  deletions: number;
}
```

**Step 2: Create `frontend/src/lib/utils.ts`**

Port helper functions from `app.js`:

```ts
export function rootShortName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

export function formatRelativeTime(isoString: string): string {
  if (!isoString) return '';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return diffDay + 'd ago';
  const d = new Date(isoString);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

export const isMobileDevice = typeof window !== 'undefined' && 'ontouchstart' in window;
```

**Step 3: Create `frontend/src/lib/api.ts`**

Typed fetch wrappers for all REST endpoints:

```ts
import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus } from './types.js';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function authenticate(pin: string): Promise<void> {
  const res = await fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Authentication failed');
  }
}

export async function checkAuth(): Promise<boolean> {
  const res = await fetch('/sessions');
  return res.ok;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  return json<SessionSummary[]>(await fetch('/sessions'));
}

export async function fetchWorktrees(): Promise<WorktreeInfo[]> {
  return json<WorktreeInfo[]>(await fetch('/worktrees'));
}

export async function fetchRepos(): Promise<RepoInfo[]> {
  return json<RepoInfo[]>(await fetch('/repos'));
}

export async function fetchRoots(): Promise<string[]> {
  return json<string[]>(await fetch('/roots'));
}

export async function fetchBranches(repoPath: string): Promise<string[]> {
  return json<string[]>(await fetch('/branches?repo=' + encodeURIComponent(repoPath)));
}

export async function fetchGitStatus(repoPath: string, branch: string): Promise<GitStatus> {
  return json<GitStatus>(await fetch('/git-status?repo=' + encodeURIComponent(repoPath) + '&branch=' + encodeURIComponent(branch)));
}

export async function createSession(body: {
  repoPath: string;
  repoName?: string;
  worktreePath?: string;
  branchName?: string;
  claudeArgs?: string[];
}): Promise<SessionSummary> {
  return json<SessionSummary>(await fetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

export async function createRepoSession(body: {
  repoPath: string;
  repoName?: string;
  continue?: boolean;
  claudeArgs?: string[];
}): Promise<SessionSummary> {
  const res = await fetch('/sessions/repo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const data = await res.json() as { sessionId?: string };
    throw Object.assign(new Error('conflict'), { sessionId: data.sessionId });
  }
  return json<SessionSummary>(res);
}

export async function killSession(id: string): Promise<void> {
  await fetch('/sessions/' + id, { method: 'DELETE' });
}

export async function renameSession(id: string, displayName: string): Promise<void> {
  await fetch('/sessions/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
}

export async function deleteWorktree(worktreePath: string, repoPath: string): Promise<void> {
  const res = await fetch('/worktrees', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreePath, repoPath }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Failed to delete worktree');
  }
}

export async function addRoot(path: string): Promise<string[]> {
  return json<string[]>(await fetch('/roots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }));
}

export async function removeRoot(path: string): Promise<string[]> {
  return json<string[]>(await fetch('/roots', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }));
}

export async function uploadImage(sessionId: string, data: string, mimeType: string): Promise<{ path: string; clipboardSet: boolean }> {
  return json<{ path: string; clipboardSet: boolean }>(await fetch('/sessions/' + sessionId + '/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mimeType }),
  }));
}

export async function checkVersion(): Promise<{ current: string; latest: string | null; updateAvailable: boolean }> {
  return json<{ current: string; latest: string | null; updateAvailable: boolean }>(await fetch('/version'));
}

export async function triggerUpdate(): Promise<{ ok: boolean; restarting?: boolean; error?: string }> {
  return json<{ ok: boolean; restarting?: boolean; error?: string }>(await fetch('/update', { method: 'POST' }));
}
```

**Step 4: Create `frontend/src/lib/state/auth.svelte.ts`**

```ts
import { authenticate as apiAuth, checkAuth } from '../api.js';

let authenticated = $state(false);
let pinError = $state<string | null>(null);
let checking = $state(true);

export function getAuth() {
  return {
    get authenticated() { return authenticated; },
    get pinError() { return pinError; },
    get checking() { return checking; },
  };
}

export async function checkExistingAuth(): Promise<void> {
  checking = true;
  try {
    authenticated = await checkAuth();
  } catch {
    authenticated = false;
  } finally {
    checking = false;
  }
}

export async function submitPin(pin: string): Promise<void> {
  pinError = null;
  try {
    await apiAuth(pin);
    authenticated = true;
  } catch (err) {
    pinError = err instanceof Error ? err.message : 'Authentication failed';
  }
}
```

**Step 5: Create `frontend/src/lib/state/ui.svelte.ts`**

```ts
export type TabId = 'repos' | 'worktrees';

let sidebarOpen = $state(false);
let activeTab = $state<TabId>('repos');
let rootFilter = $state('');
let repoFilter = $state('');
let searchFilter = $state('');

export function getUi() {
  return {
    get sidebarOpen() { return sidebarOpen; },
    set sidebarOpen(v: boolean) { sidebarOpen = v; },
    get activeTab() { return activeTab; },
    set activeTab(v: TabId) { activeTab = v; },
    get rootFilter() { return rootFilter; },
    set rootFilter(v: string) { rootFilter = v; },
    get repoFilter() { return repoFilter; },
    set repoFilter(v: string) { repoFilter = v; },
    get searchFilter() { return searchFilter; },
    set searchFilter(v: string) { searchFilter = v; },
  };
}

export function openSidebar(): void { sidebarOpen = true; }
export function closeSidebar(): void { sidebarOpen = false; }
```

**Step 6: Create `frontend/src/lib/state/sessions.svelte.ts`**

```ts
import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus } from '../types.js';
import * as api from '../api.js';

let sessions = $state<SessionSummary[]>([]);
let worktrees = $state<WorktreeInfo[]>([]);
let repos = $state<RepoInfo[]>([]);
let activeSessionId = $state<string | null>(null);
let attentionSessions = $state<Record<string, boolean>>({});
let gitStatuses = $state<Record<string, GitStatus>>({});

export function getSessionState() {
  return {
    get sessions() { return sessions; },
    get worktrees() { return worktrees; },
    get repos() { return repos; },
    get activeSessionId() { return activeSessionId; },
    set activeSessionId(id: string | null) { activeSessionId = id; },
    get attentionSessions() { return attentionSessions; },
    get gitStatuses() { return gitStatuses; },
  };
}

export async function refreshAll(): Promise<void> {
  try {
    const [s, w, r] = await Promise.all([
      api.fetchSessions(),
      api.fetchWorktrees(),
      api.fetchRepos(),
    ]);
    sessions = s;
    worktrees = w;
    repos = r;

    // Prune stale attention flags
    const activeIds = new Set(sessions.map(s => s.id));
    for (const id of Object.keys(attentionSessions)) {
      if (!activeIds.has(id)) delete attentionSessions[id];
    }
  } catch { /* silent */ }
}

export function setAttention(sessionId: string, idle: boolean): void {
  if (idle && sessionId !== activeSessionId) {
    attentionSessions[sessionId] = true;
  } else {
    delete attentionSessions[sessionId];
  }
}

export function clearAttention(sessionId: string): void {
  delete attentionSessions[sessionId];
}

export function setGitStatus(key: string, status: GitStatus): void {
  gitStatuses[key] = status;
}

export function getSessionStatus(session: SessionSummary): 'attention' | 'idle' | 'running' {
  if (attentionSessions[session.id]) return 'attention';
  if (session.idle) return 'idle';
  return 'running';
}
```

**Step 7: Create `frontend/src/lib/ws.ts`**

```ts
import type { Terminal } from '@xterm/xterm';

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

type EventCallback = (msg: { type: string; sessionId?: string; idle?: boolean }) => void;

let eventWs: WebSocket | null = null;
let ptyWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 30;

export function connectEventSocket(onMessage: EventCallback): void {
  if (eventWs) { eventWs.close(); eventWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/events';
  eventWs = new WebSocket(url);

  eventWs.onmessage = (event) => {
    try { onMessage(JSON.parse(event.data as string)); } catch {}
  };

  eventWs.onclose = () => {
    setTimeout(() => connectEventSocket(onMessage), 3000);
  };

  eventWs.onerror = () => {};
}

export function connectPtySocket(
  sessionId: string,
  term: Terminal,
  onResize: () => void,
  onSessionEnd: () => void,
): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;

  if (ptyWs) { ptyWs.onclose = null; ptyWs.close(); ptyWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  const socket = new WebSocket(url);

  socket.onopen = () => {
    ptyWs = socket;
    reconnectAttempt = 0;
    onResize();
  };

  socket.onmessage = (event) => { term.write(event.data as string); };

  socket.onclose = (event) => {
    if (event.code === 1000) {
      term.write('\r\n[Session ended]\r\n');
      ptyWs = null;
      onSessionEnd();
      return;
    }
    ptyWs = null;
    if (reconnectAttempt === 0) term.write('\r\n[Reconnecting...]\r\n');
    scheduleReconnect(sessionId, term, onResize, onSessionEnd);
  };

  socket.onerror = () => {};
}

function scheduleReconnect(
  sessionId: string,
  term: Terminal,
  onResize: () => void,
  onSessionEnd: () => void,
): void {
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    term.write('\r\n[Gave up reconnecting after ' + MAX_RECONNECT_ATTEMPTS + ' attempts]\r\n');
    return;
  }
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
  reconnectAttempt++;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      const res = await fetch('/sessions');
      const sessions = await res.json() as Array<{ id: string }>;
      if (!sessions.some(s => s.id === sessionId)) {
        term.write('\r\n[Session ended]\r\n');
        onSessionEnd();
        return;
      }
      term.clear();
      connectPtySocket(sessionId, term, onResize, onSessionEnd);
    } catch {
      scheduleReconnect(sessionId, term, onResize, onSessionEnd);
    }
  }, delay);
}

export function sendPtyData(data: string): void {
  if (ptyWs && ptyWs.readyState === WebSocket.OPEN) ptyWs.send(data);
}

export function sendPtyResize(cols: number, rows: number): void {
  if (ptyWs && ptyWs.readyState === WebSocket.OPEN) {
    ptyWs.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

export function isPtyConnected(): boolean {
  return ptyWs !== null && ptyWs.readyState === WebSocket.OPEN;
}
```

**Step 8: Verify the modules compile**

Run:
```bash
npm run build:frontend
```

Expected: Vite build succeeds (though the app doesn't do much yet).

**Step 9: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: add Svelte state modules, API layer, and WebSocket manager"
```

---

## Task 3: PinGate + App Shell Components

**Files:**
- Create: `frontend/src/components/PinGate.svelte`
- Modify: `frontend/src/App.svelte`

**Step 1: Create `frontend/src/components/PinGate.svelte`**

```svelte
<script lang="ts">
  import { getAuth, submitPin } from '../lib/state/auth.svelte.js';

  const auth = getAuth();
  let pinValue = $state('');

  async function handleSubmit() {
    const pin = pinValue.trim();
    if (!pin) return;
    await submitPin(pin);
    if (auth.pinError) {
      pinValue = '';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }
</script>

<div class="pin-gate">
  <div class="pin-container">
    <h1>Claude Remote CLI</h1>
    <p>Enter PIN to continue</p>
    <input
      type="password"
      inputmode="numeric"
      maxlength="20"
      placeholder="PIN"
      bind:value={pinValue}
      onkeydown={handleKeydown}
      autofocus
    />
    <button onclick={handleSubmit}>Unlock</button>
    {#if auth.pinError}
      <p class="error">{auth.pinError}</p>
    {/if}
  </div>
</div>

<style>
  .pin-gate {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--bg);
    padding: 1rem;
  }
  .pin-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
    max-width: 320px;
    text-align: center;
  }
  .pin-container h1 { font-size: 1.5rem; color: var(--text); }
  .pin-container p { color: var(--text-muted); font-size: 0.95rem; }
  input {
    width: 100%;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 1.2rem;
    text-align: center;
    outline: none;
    -webkit-appearance: none;
  }
  input:focus { border-color: var(--accent); }
  button {
    width: 100%;
    padding: 14px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }
  button:active { opacity: 0.8; }
  .error { color: var(--accent); font-size: 0.9rem; }
</style>
```

**Step 2: Update `frontend/src/App.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth, checkExistingAuth } from './lib/state/auth.svelte.js';
  import PinGate from './components/PinGate.svelte';

  const auth = getAuth();

  onMount(() => {
    checkExistingAuth();
  });
</script>

{#if auth.checking}
  <!-- Loading -->
{:else if !auth.authenticated}
  <PinGate />
{:else}
  <p>Authenticated! Main app will go here.</p>
{/if}
```

**Step 3: Verify PIN gate works**

Run:
```bash
npm run build && npm start
```

Navigate to `localhost:3000`. Expected: see PIN gate, enter PIN, see "Authenticated!" message.

**Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: add PinGate component and App shell with auth flow"
```

---

## Task 4: Sidebar + Session List Components

**Files:**
- Create: `frontend/src/components/Sidebar.svelte`
- Create: `frontend/src/components/SessionFilters.svelte`
- Create: `frontend/src/components/SessionList.svelte`
- Create: `frontend/src/components/SessionItem.svelte`
- Modify: `frontend/src/App.svelte`

**Step 1: Create `frontend/src/components/SessionFilters.svelte`**

Port the sidebar filters (root select, repo select, text search) with scoped styles. Use `$props()` for filter values and callbacks. Bind to the `ui` state module.

**Step 2: Create `frontend/src/components/SessionItem.svelte`**

This is the key redesigned component. It handles both active sessions and inactive worktrees/repos via props:

```svelte
<script lang="ts">
  import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus } from '../lib/types.js';
  import { formatRelativeTime, rootShortName } from '../lib/utils.js';

  type ItemVariant =
    | { kind: 'active'; session: SessionSummary; status: 'running' | 'idle' | 'attention'; isSelected: boolean }
    | { kind: 'inactive-worktree'; worktree: WorktreeInfo }
    | { kind: 'idle-repo'; repo: RepoInfo };

  let { variant, gitStatus, onclick, oncontextmenu, onkill, onrename }: {
    variant: ItemVariant;
    gitStatus?: GitStatus;
    onclick: () => void;
    oncontextmenu?: (e: MouseEvent) => void;
    onkill?: () => void;
    onrename?: () => void;
  } = $props();

  // Derive display values from variant
  let displayName = $derived(/* ... based on variant kind */);
  let rootName = $derived(/* ... */);
  let repoName = $derived(/* ... */);
  let lastActivity = $derived(/* ... */);
  let statusClass = $derived(/* ... */);
  let gitIcon = $derived(/* ... based on gitStatus?.prState */);
</script>
```

Layout uses the 3-row design:
- Row 1: status dot + name (with fade mask) + hover-reveal action buttons
- Row 2: git icon (under dot) + root + repo
- Row 3: relative time + diff stats

CSS implements:
- `mask-image: linear-gradient(to right, black 80%, transparent)` for text fade
- `li:hover .session-actions { opacity: 1; }` for hover-reveal buttons
- `li:hover .session-name { animation: scroll-reveal; }` for smooth text scroll on hover
- No `flex-wrap` on the info container (fixes the wrapping bug)

**Step 3: Create `frontend/src/components/SessionList.svelte`**

Port the filtering and rendering logic from `renderUnifiedList()` in `app.js`. Uses `$derived` to compute filtered/sorted lists from session state + UI filter state.

**Step 4: Create `frontend/src/components/Sidebar.svelte`**

Composes SessionFilters, tab buttons, SessionList, and action buttons (New Session, Settings).

**Step 5: Wire sidebar into App.svelte**

Update `App.svelte` to render Sidebar when authenticated.

**Step 6: Verify sidebar renders with data**

Build and run, check that sessions and worktrees appear in the sidebar with the new 3-row layout.

**Step 7: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add Sidebar, SessionList, and redesigned SessionItem components"
```

---

## Task 5: Terminal Component + WebSocket Integration

**Files:**
- Create: `frontend/src/components/Terminal.svelte`
- Create: `frontend/src/components/Toolbar.svelte`
- Create: `frontend/src/components/MobileHeader.svelte`
- Create: `frontend/src/components/MobileInput.svelte`
- Modify: `frontend/src/App.svelte`

**Step 1: Create `frontend/src/components/Terminal.svelte`**

Wrap xterm.js with Svelte lifecycle:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { connectPtySocket, sendPtyData, sendPtyResize } from '../lib/ws.js';
  import { getSessionState } from '../lib/state/sessions.svelte.js';
  import { isMobileDevice } from '../lib/utils.js';

  let { sessionId }: { sessionId: string | null } = $props();

  let containerEl: HTMLDivElement;
  let term: Terminal;
  let fitAddon: FitAddon;

  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, monospace',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4' },
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();

    term.onData((data) => sendPtyData(data));

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      sendPtyResize(term.cols, term.rows);
    });
    ro.observe(containerEl);

    return () => { ro.disconnect(); term.dispose(); };
  });

  // React to sessionId changes
  $effect(() => {
    if (sessionId && term) {
      term.clear();
      connectPtySocket(sessionId, term,
        () => sendPtyResize(term.cols, term.rows),
        () => { /* session ended */ }
      );
    }
  });
</script>

<div class="terminal-container" bind:this={containerEl}></div>
```

**Step 2: Create Toolbar, MobileHeader, and MobileInput components**

Port the touch toolbar, mobile header, and mobile input proxy from `app.js`. The mobile input logic (composition handling, batched sends, debug panel) goes into `MobileInput.svelte`.

**Step 3: Wire Terminal into App.svelte**

Update App.svelte to show the terminal area alongside the sidebar. Handle session connection — clicking a session in the sidebar sets `activeSessionId`, which triggers the Terminal `$effect`.

**Step 4: Port clipboard paste + image upload + drag-and-drop**

Move the image paste/upload/drop handlers into the Terminal component. The upload function calls `api.uploadImage()`.

**Step 5: Port the keyboard-aware viewport handler**

Move the `visualViewport` resize logic into App.svelte or a dedicated action.

**Step 6: Verify terminal connects and works**

Build, run, create a session, verify terminal I/O works on both desktop and mobile.

**Step 7: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add Terminal, Toolbar, MobileHeader, and MobileInput components"
```

---

## Task 6: Dialogs — New Session, Settings, Delete Worktree, Context Menu

**Files:**
- Create: `frontend/src/components/dialogs/NewSessionDialog.svelte`
- Create: `frontend/src/components/dialogs/SettingsDialog.svelte`
- Create: `frontend/src/components/dialogs/DeleteWorktreeDialog.svelte`
- Create: `frontend/src/components/ContextMenu.svelte`

**Step 1: Create `NewSessionDialog.svelte`**

Port the new session dialog including:
- Root/repo/branch selects
- Branch autocomplete dropdown
- Continue checkbox (repo tab) / branch input (worktree tab)
- Custom path fallback
- Yolo mode checkbox
- Dialog field-level styles (scoped)

Use `<dialog>` element with Svelte's `bind:this` + `.showModal()` / `.close()`.

**Step 2: Create `SettingsDialog.svelte`**

Port settings: root directories list, add/remove, developer tools toggle.

**Step 3: Create `DeleteWorktreeDialog.svelte`**

Port delete confirmation dialog.

**Step 4: Create `ContextMenu.svelte`**

Port right-click / long-press context menu with "Resume in yolo mode" and "Delete worktree" options. Handle positioning and click-outside dismissal.

**Step 5: Wire dialogs into App.svelte**

Import and render all dialogs, pass open/close state and callbacks.

**Step 6: Verify all dialog flows work**

Test: new session (both repo and worktree tabs), settings (add/remove root), delete worktree, context menu.

**Step 7: Commit**

```bash
git add frontend/src/components/dialogs/ frontend/src/components/ContextMenu.svelte
git commit -m "feat: add dialog components — NewSession, Settings, DeleteWorktree, ContextMenu"
```

---

## Task 7: Update Toast + Event Socket Integration

**Files:**
- Create: `frontend/src/components/UpdateToast.svelte`
- Create: `frontend/src/components/ImageToast.svelte`
- Modify: `frontend/src/App.svelte`

**Step 1: Create `UpdateToast.svelte`**

Port the update-available toast. Check version on mount, show toast if update available. Trigger update via `api.triggerUpdate()`.

**Step 2: Create `ImageToast.svelte`**

Port the image paste feedback toast.

**Step 3: Wire event socket in App.svelte**

On auth, call `connectEventSocket()` with a callback that:
- On `worktrees-changed`: calls `refreshAll()` and re-fetches repos
- On `session-idle-changed`: calls `setAttention()`

**Step 4: Verify events flow correctly**

Start two sessions, verify idle/attention state updates in the sidebar, verify worktree changes reflect in real-time.

**Step 5: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add UpdateToast, ImageToast, and event socket integration"
```

---

## Task 8: Git Status Endpoint + Frontend Integration

**Files:**
- Modify: `server/index.ts` (add `/git-status` route)
- Modify: `server/types.ts` (add `GitStatus` type)
- Modify: `frontend/src/lib/state/sessions.svelte.ts` (fetch git status)
- Modify: `frontend/src/components/SessionItem.svelte` (render git status)

**Step 1: Add `GitStatus` type to `server/types.ts`**

```ts
export interface GitStatus {
  prState: 'open' | 'merged' | 'closed' | null;
  additions: number;
  deletions: number;
}
```

**Step 2: Add `/git-status` endpoint to `server/index.ts`**

After the `/branches` endpoint, add:

```ts
// GET /git-status?repo=<path>&branch=<name>
app.get('/git-status', requireAuth, async (req, res) => {
  const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
  const branch = typeof req.query.branch === 'string' ? req.query.branch : undefined;
  if (!repoPath || !branch) {
    res.status(400).json({ error: 'repo and branch query parameters are required' });
    return;
  }

  let prState: 'open' | 'merged' | 'closed' | null = null;
  let additions = 0;
  let deletions = 0;

  // Try gh CLI for PR status
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', branch,
      '--repo', repoPath,
      '--json', 'state,additions,deletions',
    ], { cwd: repoPath });
    const data = JSON.parse(stdout) as { state?: string; additions?: number; deletions?: number };
    if (data.state) prState = data.state.toLowerCase() as 'open' | 'merged' | 'closed';
    if (typeof data.additions === 'number') additions = data.additions;
    if (typeof data.deletions === 'number') deletions = data.deletions;
  } catch {
    // No PR or gh not available — fall back to git diff
    try {
      const { stdout } = await execFileAsync('git', [
        'diff', '--shortstat', 'HEAD...main',
      ], { cwd: repoPath });
      const addMatch = stdout.match(/(\d+) insertion/);
      const delMatch = stdout.match(/(\d+) deletion/);
      if (addMatch) additions = parseInt(addMatch[1]!, 10);
      if (delMatch) deletions = parseInt(delMatch[1]!, 10);
    } catch { /* no diff data */ }
  }

  res.json({ prState, additions, deletions });
});
```

**Step 3: Fetch git status lazily in sessions state**

In `sessions.svelte.ts`, after `refreshAll()`, debounce-fetch git status for each worktree that has a branch name:

```ts
let gitStatusTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshGitStatuses(): Promise<void> {
  if (gitStatusTimer) clearTimeout(gitStatusTimer);
  gitStatusTimer = setTimeout(async () => {
    for (const wt of worktrees) {
      const branch = wt.name; // worktree dir name is typically the branch
      const key = wt.repoPath + ':' + branch;
      if (gitStatuses[key]) continue; // already cached
      try {
        const status = await api.fetchGitStatus(wt.repoPath, branch);
        gitStatuses[key] = status;
      } catch { /* silent */ }
    }
  }, 500);
}
```

**Step 4: Render git status in SessionItem.svelte**

Use the `gitStatus` prop to render:
- PR icon (open/merged/closed/none) in the left column under the status dot
- `+additions -deletions` in green/red on row 3

**Step 5: Verify git status displays**

Create a worktree with a branch that has a PR. Verify the icon and diff stats render.

**Step 6: Commit**

```bash
git add server/index.ts server/types.ts frontend/src/
git commit -m "feat: add git status endpoint and render PR icons + diff stats in sidebar"
```

---

## Task 9: Session Item Hover Effects — Fade, Scroll, Action Reveal

**Files:**
- Modify: `frontend/src/components/SessionItem.svelte`

**Step 1: Implement CSS fade mask on text overflow**

Replace `text-overflow: ellipsis` with:

```css
.session-name {
  mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
  overflow: hidden;
  white-space: nowrap;
}
```

**Step 2: Implement hover scroll reveal**

On `li:hover`, remove the mask and smoothly translate the name text to reveal overflow:

```css
li:hover .session-name {
  mask-image: none;
  -webkit-mask-image: none;
  animation: text-scroll 4s linear 0.5s;
}

@keyframes text-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(var(--scroll-distance)); }
}
```

Use a Svelte action or `$effect` to measure text overflow and set `--scroll-distance` as a CSS variable.

**Step 3: Implement hover-reveal action buttons**

```css
.session-actions {
  opacity: 0;
  transition: opacity 0.15s;
}
li:hover .session-actions {
  opacity: 1;
}
```

On mobile, use a different trigger (the actions are always visible, or revealed via swipe/long-press).

**Step 4: Verify hover effects work smoothly**

Test with long session names. Verify fade → scroll → fade back on mouse enter/leave.

**Step 5: Commit**

```bash
git add frontend/src/components/SessionItem.svelte
git commit -m "feat: add fade mask, hover scroll reveal, and hover-reveal actions"
```

---

## Task 10: Cleanup — Remove Old Frontend, Update Docs

**Files:**
- Delete: `public/app.js`
- Delete: `public/style.css`
- Delete: `public/index.html`
- Delete: `public/vendor/xterm.js`
- Delete: `public/vendor/addon-fit.js`
- Delete: `public/vendor/xterm.css`
- Keep: `public/` directory can be removed entirely (all assets moved to `frontend/public/`)
- Modify: `CLAUDE.md` — update architecture section
- Modify: `docs/guides/architecture.md` — add frontend build info

**Step 1: Delete old frontend files**

```bash
rm -rf public/
```

**Step 2: Verify everything still works**

```bash
npm run build && npm start
```

Navigate to `localhost:3000`, test full flow: PIN → sidebar → session creation → terminal → settings → dialogs.

**Step 3: Update CLAUDE.md architecture section**

Update the Architecture description to mention Svelte 5 + Vite, and update the directory listing:
- `frontend/` — Svelte 5 SPA source (TypeScript + Svelte components), compiled by Vite to `dist/frontend/`
- Remove `public/` from the listing

**Step 4: Update `docs/guides/architecture.md`**

Add section on frontend build pipeline.

**Step 5: Run tests**

```bash
npm test
```

Expected: All server-side tests pass (they don't test frontend).

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove old vanilla JS frontend, update docs for Svelte migration"
```

---

## Summary of Tasks

| # | Task | Key Outcome |
|---|------|-------------|
| 1 | Scaffold Vite + Svelte 5 | Build pipeline, project structure, Express integration |
| 2 | State modules | Auth, UI, Sessions state with runes + API layer + WebSocket manager |
| 3 | PinGate + App shell | Auth flow working in Svelte |
| 4 | Sidebar + SessionItem | Redesigned 3-row session items with filtering |
| 5 | Terminal + Mobile | xterm.js wrapper, toolbar, mobile input proxy |
| 6 | Dialogs | New session, settings, delete worktree, context menu |
| 7 | Toasts + Events | Update toast, image toast, event socket wiring |
| 8 | Git status | Server endpoint + frontend display of PR icons and diff stats |
| 9 | Hover effects | Fade mask, scroll reveal, action button reveal |
| 10 | Cleanup | Remove old frontend, update docs |
