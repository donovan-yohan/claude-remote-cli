# TypeScript + ESM Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate claude-remote-cli from JavaScript (CommonJS) to TypeScript (ESM) with full strict mode, tsc compilation to `dist/`, and Node >=24.

**Architecture:** Big bang migration of all 12 server/bin/test files. `tsc` compiles `.ts` → `dist/*.js`. Frontend (`public/`) is unchanged per ADR-002. Tests compile via a separate `tsconfig.test.json` and run with `node --test`.

**Tech Stack:** TypeScript 5.8+, ESM (`"type": "module"`), Node >=24, `node:test`

---

### Task 1: Scaffold TypeScript tooling and config

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Step 1: Install TypeScript and type definitions**

Run:
```bash
npm install -D typescript @types/node @types/express @types/ws @types/bcrypt @types/cookie-parser
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["server/**/*.ts", "bin/**/*.ts"],
  "exclude": ["node_modules", "dist", "public"]
}
```

**Step 3: Create tsconfig.test.json**

```json
{
  "extends": "./tsconfig.json",
  "include": ["server/**/*.ts", "bin/**/*.ts", "test/**/*.ts"]
}
```

**Step 4: Update package.json**

Change these fields:
```json
{
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "bin": { "claude-remote-cli": "dist/bin/claude-remote-cli.js" },
  "files": ["dist/bin/", "dist/server/", "public/", "config.example.json"],
  "scripts": {
    "build": "tsc",
    "start": "tsc && node dist/server/index.js",
    "test": "tsc -p tsconfig.test.json && node --test dist/test/*.test.js",
    "postinstall": "chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true"
  }
}
```

**Step 5: Add `dist/` to .gitignore**

Append `dist/` to `.gitignore`.

**Step 6: Verify the setup compiles (will fail — no .ts files yet, but tsc should run)**

Run: `npx tsc --version`
Expected: TypeScript version printed

**Step 7: Commit**

```bash
git add tsconfig.json tsconfig.test.json package.json package-lock.json .gitignore
git commit -m "chore: add TypeScript tooling and config for ESM migration"
```

---

### Task 2: Create shared type definitions

**Files:**
- Create: `server/types.ts`

**Step 1: Create server/types.ts**

```typescript
import type { IPty } from 'node-pty';

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
}

export interface SessionInfo {
  id: string;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
}

export interface SessionCreateResult {
  id: string;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  pid: number;
  createdAt: string;
}

export interface SessionCreateOpts {
  repoName?: string;
  repoPath: string;
  root?: string;
  worktreeName?: string;
  displayName?: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
}

export interface Config {
  host: string;
  port: number;
  cookieTTL: string;
  repos: Array<{ name: string; path: string; root?: string }>;
  rootDirs?: string[];
  claudeCommand: string;
  claudeArgs: string[];
  pinHash?: string;
}

export type Platform = 'macos' | 'linux';

export interface ServicePaths {
  servicePath: string;
  logDir: string | null;
  label: string;
}

export interface InstallOpts {
  configPath?: string;
  port?: string;
  host?: string;
}

export interface GenerateServiceFileOpts {
  nodePath: string;
  scriptPath: string;
  configPath: string;
  port: string;
  host: string;
  logDir: string | null;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
}

export interface RateLimitEntry {
  count: number;
  lockedUntil: number | null;
}
```

**Step 2: Verify file has no syntax errors**

Run: `npx tsc --noEmit server/types.ts`
Expected: No errors (may warn about missing files it imports from, that's ok)

**Step 3: Commit**

```bash
git add server/types.ts
git commit -m "feat: add shared TypeScript type definitions"
```

---

### Task 3: Migrate server/config.js → server/config.ts

**Files:**
- Delete: `server/config.js`
- Create: `server/config.ts`
- Delete: `test/config.test.js`
- Create: `test/config.test.ts`

**Step 1: Create server/config.ts**

```typescript
import fs from 'node:fs';
import type { Config } from './types.js';

export const DEFAULTS: Config = {
  host: '0.0.0.0',
  port: 3456,
  cookieTTL: '24h',
  repos: [],
  claudeCommand: 'claude',
  claudeArgs: [],
};

export function loadConfig(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<Config>;
  return { ...DEFAULTS, ...parsed };
}

export function saveConfig(configPath: string, config: Config): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
```

**Step 2: Create test/config.test.ts**

```typescript
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { DEFAULTS, loadConfig, saveConfig } from '../server/config.js';

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-remote-cli-config-test-'));
});

afterEach(() => {
  for (const file of fs.readdirSync(tmpDir)) {
    fs.unlinkSync(path.join(tmpDir, file));
  }
});

after(() => {
  fs.rmdirSync(tmpDir);
});

test('loadConfig loads a JSON config file', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const data = { port: 4000, host: '127.0.0.1' };
  fs.writeFileSync(configPath, JSON.stringify(data), 'utf8');

  const config = loadConfig(configPath);
  assert.equal(config.port, 4000);
  assert.equal(config.host, '127.0.0.1');
});

test('loadConfig merges with defaults for missing fields', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ port: 9000 }), 'utf8');

  const config = loadConfig(configPath);
  assert.equal(config.port, 9000);
  assert.equal(config.host, DEFAULTS.host);
  assert.equal(config.cookieTTL, DEFAULTS.cookieTTL);
  assert.deepEqual(config.repos, DEFAULTS.repos);
  assert.equal(config.claudeCommand, DEFAULTS.claudeCommand);
  assert.deepEqual(config.claudeArgs, DEFAULTS.claudeArgs);
});

test('loadConfig throws if config file not found', () => {
  const configPath = path.join(tmpDir, 'nonexistent.json');
  assert.throws(() => loadConfig(configPath), /Config file not found/);
});

test('saveConfig writes JSON with 2-space indent', () => {
  const configPath = path.join(tmpDir, 'output.json');
  const config = { ...DEFAULTS, port: 3456, host: '0.0.0.0' };

  saveConfig(configPath, config);

  const raw = fs.readFileSync(configPath, 'utf8');
  assert.equal(raw, JSON.stringify(config, null, 2));
});

test('DEFAULTS has expected keys and values', () => {
  assert.equal(DEFAULTS.host, '0.0.0.0');
  assert.equal(DEFAULTS.port, 3456);
  assert.equal(DEFAULTS.cookieTTL, '24h');
  assert.deepEqual(DEFAULTS.repos, []);
  assert.equal(DEFAULTS.claudeCommand, 'claude');
  assert.deepEqual(DEFAULTS.claudeArgs, []);
});
```

**Step 3: Delete old files**

```bash
rm server/config.js test/config.test.js
```

**Step 4: Verify compilation**

Run: `npx tsc -p tsconfig.test.json --noEmit`
Expected: May have errors from other files that still reference config.js — that's expected at this stage.

**Step 5: Commit**

```bash
git add server/config.ts test/config.test.ts
git rm server/config.js test/config.test.js
git commit -m "refactor: migrate config module to TypeScript ESM"
```

---

### Task 4: Migrate server/auth.js → server/auth.ts

**Files:**
- Delete: `server/auth.js`
- Create: `server/auth.ts`
- Delete: `test/auth.test.js`
- Create: `test/auth.test.ts`

**Step 1: Create server/auth.ts**

```typescript
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { RateLimitEntry } from './types.js';

const SALT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const attemptMap = new Map<string, RateLimitEntry>();

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export function isRateLimited(ip: string): boolean {
  const entry = attemptMap.get(ip);
  if (!entry) return false;

  if (entry.lockedUntil) {
    if (Date.now() < entry.lockedUntil) {
      return true;
    }
    attemptMap.delete(ip);
  }

  return false;
}

export function recordFailedAttempt(ip: string): void {
  const entry = attemptMap.get(ip) ?? { count: 0, lockedUntil: null };
  entry.count += 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }

  attemptMap.set(ip, entry);
}

export function clearRateLimit(ip: string): void {
  attemptMap.delete(ip);
}

export function generateCookieToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function _resetForTesting(): void {
  attemptMap.clear();
}
```

**Step 2: Create test/auth.test.ts**

The old test used `require.cache` busting. In ESM we use the new `_resetForTesting()` export.

```typescript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPin,
  verifyPin,
  recordFailedAttempt,
  isRateLimited,
  clearRateLimit,
  generateCookieToken,
  _resetForTesting,
} from '../server/auth.js';

beforeEach(() => {
  _resetForTesting();
});

test('hashPin returns bcrypt hash starting with $2b$', async () => {
  const hash = await hashPin('1234');
  assert.ok(hash.startsWith('$2b$'), `Expected hash to start with $2b$, got: ${hash}`);
});

test('verifyPin returns true for correct PIN', async () => {
  const hash = await hashPin('1234');
  const result = await verifyPin('1234', hash);
  assert.equal(result, true);
});

test('verifyPin returns false for wrong PIN', async () => {
  const hash = await hashPin('1234');
  const result = await verifyPin('9999', hash);
  assert.equal(result, false);
});

test('rate limiter blocks after 5 failures', () => {
  const ip = '127.0.0.1';
  for (let i = 0; i < 5; i++) {
    recordFailedAttempt(ip);
  }
  assert.equal(isRateLimited(ip), true);
});

test('rate limiter allows under threshold', () => {
  const ip = '127.0.0.1';
  for (let i = 0; i < 4; i++) {
    recordFailedAttempt(ip);
  }
  assert.equal(isRateLimited(ip), false);
});

test('generateCookieToken returns non-empty string', () => {
  const token = generateCookieToken();
  assert.ok(typeof token === 'string' && token.length > 0);
});
```

**Step 3: Delete old files and commit**

```bash
git rm server/auth.js test/auth.test.js
git add server/auth.ts test/auth.test.ts
git commit -m "refactor: migrate auth module to TypeScript ESM"
```

---

### Task 5: Migrate server/sessions.js → server/sessions.ts

**Files:**
- Delete: `server/sessions.js`
- Create: `server/sessions.ts`
- Delete: `test/sessions.test.js`
- Create: `test/sessions.test.ts`

**Step 1: Create server/sessions.ts**

```typescript
import * as pty from 'node-pty';
import crypto from 'node:crypto';
import type { Session, SessionInfo, SessionCreateResult, SessionCreateOpts } from './types.js';

const sessions = new Map<string, Session>();

const MAX_SCROLLBACK = 256 * 1024;

export function create(opts: SessionCreateOpts): SessionCreateResult {
  const id = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const ptyProcess = pty.spawn(opts.command, opts.args ?? [], {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: opts.repoPath,
    env: env as Record<string, string>,
  });

  const scrollback: string[] = [];
  let scrollbackBytes = 0;

  const session: Session = {
    id,
    root: opts.root ?? '',
    repoName: opts.repoName ?? '',
    repoPath: opts.repoPath,
    worktreeName: opts.worktreeName ?? '',
    displayName: opts.displayName ?? opts.worktreeName ?? opts.repoName ?? '',
    pty: ptyProcess,
    createdAt,
    lastActivity: createdAt,
    scrollback,
  };
  sessions.set(id, session);

  ptyProcess.onData((data: string) => {
    session.lastActivity = new Date().toISOString();
    scrollback.push(data);
    scrollbackBytes += data.length;
    while (scrollbackBytes > MAX_SCROLLBACK && scrollback.length > 1) {
      scrollbackBytes -= scrollback.shift()!.length;
    }
  });

  ptyProcess.onExit(() => {
    sessions.delete(id);
  });

  return {
    id,
    root: session.root,
    repoName: session.repoName,
    repoPath: opts.repoPath,
    worktreeName: session.worktreeName,
    displayName: session.displayName,
    pid: ptyProcess.pid,
    createdAt,
  };
}

export function get(id: string): Session | undefined {
  return sessions.get(id);
}

export function list(): SessionInfo[] {
  return Array.from(sessions.values())
    .map(({ id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity }) => ({
      id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity,
    }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export function updateDisplayName(id: string, displayName: string): { id: string; displayName: string } {
  const session = sessions.get(id);
  if (!session) throw new Error('Session not found: ' + id);
  session.displayName = displayName;
  return { id, displayName };
}

export function kill(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.kill('SIGTERM');
  sessions.delete(id);
}

export function resize(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.resize(cols, rows);
}
```

**Step 2: Create test/sessions.test.ts**

```typescript
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as sessions from '../server/sessions.js';

const createdIds: string[] = [];

afterEach(() => {
  for (const id of createdIds) {
    try {
      const session = sessions.get(id);
      if (session) sessions.kill(id);
    } catch {
      // Already killed
    }
  }
  createdIds.length = 0;
});

describe('sessions', () => {
  it('list returns empty array initially', () => {
    const result = sessions.list();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('create spawns PTY and adds session to registry', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
      cols: 80,
      rows: 24,
    });

    createdIds.push(result.id);

    assert.ok(result.id, 'should have an id');
    assert.equal(result.repoName, 'test-repo');
    assert.equal(result.repoPath, '/tmp');
    assert.ok(typeof result.pid === 'number', 'should have a numeric pid');
    assert.ok(result.createdAt, 'should have a createdAt timestamp');

    const allSessions = sessions.list();
    assert.equal(allSessions.length, 1);
    assert.equal(allSessions[0]?.id, result.id);
  });

  it('get returns session by id', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });

    createdIds.push(result.id);

    const session = sessions.get(result.id);
    assert.ok(session, 'should return the session');
    assert.equal(session.id, result.id);
    assert.equal(session.repoName, 'test-repo');
    assert.ok(session.pty, 'get should include the pty object');
  });

  it('get returns undefined for nonexistent id', () => {
    const session = sessions.get('nonexistent-id-12345');
    assert.equal(session, undefined);
  });

  it('kill removes session from registry', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });

    createdIds.push(result.id);

    sessions.kill(result.id);
    createdIds.splice(createdIds.indexOf(result.id), 1);

    const session = sessions.get(result.id);
    assert.equal(session, undefined, 'session should be removed after kill');

    const allSessions = sessions.list();
    assert.ok(!allSessions.some((s) => s.id === result.id), 'killed session should not appear in list');
  });

  it('kill throws for nonexistent session', () => {
    assert.throws(
      () => sessions.kill('nonexistent-id'),
      /Session not found/,
    );
  });

  it('resize throws for nonexistent session', () => {
    assert.throws(
      () => sessions.resize('nonexistent-id', 100, 40),
      /Session not found/,
    );
  });
});
```

**Step 3: Delete old files and commit**

```bash
git rm server/sessions.js test/sessions.test.js
git add server/sessions.ts test/sessions.test.ts
git commit -m "refactor: migrate sessions module to TypeScript ESM"
```

---

### Task 6: Migrate server/watcher.js → server/watcher.ts

**Files:**
- Delete: `server/watcher.js`
- Create: `server/watcher.ts`

**Step 1: Create server/watcher.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class WorktreeWatcher extends EventEmitter {
  private _watchers: fs.FSWatcher[] = [];
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  rebuild(rootDirs: string[]): void {
    this._closeAll();

    for (const rootDir of rootDirs) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
      } catch {
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

  private _watchRepo(repoPath: string): void {
    const worktreeDir = path.join(repoPath, '.claude', 'worktrees');
    if (fs.existsSync(worktreeDir)) {
      this._addWatch(worktreeDir);
    } else {
      const claudeDir = path.join(repoPath, '.claude');
      if (fs.existsSync(claudeDir)) {
        this._addWatch(claudeDir);
      }
    }
  }

  private _addWatch(dirPath: string): void {
    try {
      const watcher = fs.watch(dirPath, { persistent: false }, () => {
        this._debouncedEmit();
      });
      watcher.on('error', () => {});
      this._watchers.push(watcher);
    } catch {
      // Directory may have been removed between check and watch
    }
  }

  private _debouncedEmit(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.emit('worktrees-changed');
    }, 500);
  }

  private _closeAll(): void {
    for (const w of this._watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    this._watchers = [];
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  close(): void {
    this._closeAll();
  }
}
```

**Step 2: Delete old file and commit**

```bash
git rm server/watcher.js
git add server/watcher.ts
git commit -m "refactor: migrate watcher module to TypeScript ESM"
```

---

### Task 7: Migrate server/ws.js → server/ws.ts

**Files:**
- Delete: `server/ws.js`
- Create: `server/ws.ts`

**Step 1: Create server/ws.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import * as sessions from './sessions.js';
import type { WorktreeWatcher } from './watcher.js';
import type { Session } from './types.js';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
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

export function setupWebSocket(
  server: Server,
  authenticatedTokens: Set<string>,
  watcher: WorktreeWatcher | null,
): { wss: WebSocketServer; broadcastEvent: (type: string) => void } {
  const wss = new WebSocketServer({ noServer: true });
  const eventClients = new Set<WebSocket>();

  function broadcastEvent(type: string): void {
    const msg = JSON.stringify({ type });
    for (const client of eventClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  if (watcher) {
    watcher.on('worktrees-changed', () => {
      broadcastEvent('worktrees-changed');
    });
  }

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const cookies = parseCookies(request.headers.cookie);
    if (!authenticatedTokens.has(cookies['token'] ?? '')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (request.url === '/ws/events') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        eventClients.add(ws);
        ws.on('close', () => { eventClients.delete(ws); });
      });
      return;
    }

    const match = request.url?.match(/^\/ws\/([a-f0-9]+)$/);
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = match[1]!;
    const session = sessions.get(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      handleConnection(ws, session);
    });
  });

  return { wss, broadcastEvent };
}

function handleConnection(ws: WebSocket, session: Session): void {
  const ptyProcess = session.pty;

  for (const chunk of session.scrollback) {
    ws.send(chunk);
  }

  const dataHandler = ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('message', (msg: Buffer) => {
    const str = msg.toString();
    try {
      const parsed = JSON.parse(str) as { type?: string; cols?: number; rows?: number };
      if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
        sessions.resize(session.id, parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON, treat as terminal input
    }
    ptyProcess.write(str);
  });

  ws.on('close', () => {
    dataHandler.dispose();
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000);
    }
  });
}
```

**Step 2: Delete old file and commit**

```bash
git rm server/ws.js
git add server/ws.ts
git commit -m "refactor: migrate ws module to TypeScript ESM"
```

---

### Task 8: Migrate server/service.js → server/service.ts

**Files:**
- Delete: `server/service.js`
- Create: `server/service.ts`
- Delete: `test/service.test.js`
- Create: `test/service.test.ts`

**Step 1: Create server/service.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from './config.js';
import type { Platform, ServicePaths, InstallOpts, GenerateServiceFileOpts, ServiceStatus } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SERVICE_LABEL = 'com.claude-remote-cli';
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '~';
export const CONFIG_DIR = path.join(HOME, '.config', 'claude-remote-cli');

export function getPlatform(): Platform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  throw new Error('Unsupported platform: ' + process.platform + '. Only macOS and Linux are supported.');
}

export function getServicePaths(): ServicePaths {
  const platform = getPlatform();
  if (platform === 'macos') {
    return {
      servicePath: path.join(HOME, 'Library', 'LaunchAgents', SERVICE_LABEL + '.plist'),
      logDir: path.join(CONFIG_DIR, 'logs'),
      label: SERVICE_LABEL,
    };
  }
  return {
    servicePath: path.join(HOME, '.config', 'systemd', 'user', 'claude-remote-cli.service'),
    logDir: null,
    label: 'claude-remote-cli',
  };
}

export function generateServiceFile(platform: Platform, opts: GenerateServiceFileOpts): string {
  const { nodePath, scriptPath, configPath, port, host, logDir } = opts;

  if (platform === 'macos') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>--config</string>
    <string>${configPath}</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--host</string>
    <string>${host}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(logDir!, 'stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir!, 'stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>`;
  }

  return `[Unit]
Description=Claude Remote CLI
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${scriptPath} --config ${configPath} --port ${port} --host ${host}
Restart=on-failure
RestartSec=5
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target`;
}

export function isInstalled(): boolean {
  const { servicePath } = getServicePaths();
  return fs.existsSync(servicePath);
}

export function install(opts: InstallOpts): void {
  const platform = getPlatform();
  const { servicePath, logDir } = getServicePaths();

  if (isInstalled()) {
    throw new Error('Service is already installed. Run `claude-remote-cli uninstall` first.');
  }

  const nodePath = process.execPath;
  const scriptPath = path.resolve(__dirname, '..', 'bin', 'claude-remote-cli.js');
  const configPath = opts.configPath ?? path.join(CONFIG_DIR, 'config.json');
  const port = opts.port ?? String(DEFAULTS.port);
  const host = opts.host ?? DEFAULTS.host;

  const content = generateServiceFile(platform, { nodePath, scriptPath, configPath, port, host, logDir });

  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  if (logDir) fs.mkdirSync(logDir, { recursive: true });

  fs.writeFileSync(servicePath, content, 'utf8');

  if (platform === 'macos') {
    execSync('launchctl load -w ' + servicePath, { stdio: 'inherit' });
  } else {
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync('systemctl --user enable --now claude-remote-cli', { stdio: 'inherit' });
  }

  console.log('Service installed and started.');
  if (logDir) {
    console.log('Logs: ' + logDir);
  } else {
    console.log('Logs: journalctl --user -u claude-remote-cli -f');
  }
}

export function uninstall(): void {
  const platform = getPlatform();
  const { servicePath } = getServicePaths();

  if (!isInstalled()) {
    throw new Error('Service is not installed.');
  }

  if (platform === 'macos') {
    try {
      execSync('launchctl unload ' + servicePath, { stdio: 'inherit' });
    } catch {
      // Ignore errors from already-unloaded services
    }
  } else {
    try {
      execSync('systemctl --user disable --now claude-remote-cli', { stdio: 'inherit' });
    } catch {
      // Ignore errors from already-disabled services
    }
  }

  fs.unlinkSync(servicePath);
  console.log('Service uninstalled.');
}

export function status(): ServiceStatus {
  const platform = getPlatform();

  if (!isInstalled()) {
    return { installed: false, running: false };
  }

  const running = checkRunning(platform);
  return { installed: true, running };
}

function checkRunning(platform: Platform): boolean {
  if (platform === 'macos') {
    try {
      const out = execSync('launchctl list ' + SERVICE_LABEL, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return !out.includes('"LastExitStatus" = -1');
    } catch {
      return false;
    }
  }

  try {
    execSync('systemctl --user is-active claude-remote-cli', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}
```

**Step 2: Create test/service.test.ts**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPlatform,
  getServicePaths,
  generateServiceFile,
  isInstalled,
} from '../server/service.js';

test('getPlatform returns macos or linux', () => {
  const platform = getPlatform();
  assert.ok(platform === 'macos' || platform === 'linux',
    'Expected macos or linux, got ' + platform);
});

test('getServicePaths returns expected keys', () => {
  const paths = getServicePaths();
  assert.ok(paths.servicePath, 'missing servicePath');
  assert.equal(typeof paths.label, 'string', 'label should be a string');
  assert.ok('logDir' in paths, 'missing logDir key');
});

test('generateServiceFile for macos contains plist XML', () => {
  const content = generateServiceFile('macos', {
    nodePath: '/usr/local/bin/node',
    scriptPath: '/usr/local/lib/node_modules/claude-remote-cli/bin/claude-remote-cli.js',
    configPath: '/Users/test/.config/claude-remote-cli/config.json',
    port: '3456',
    host: '0.0.0.0',
    logDir: '/Users/test/.config/claude-remote-cli/logs',
  });
  assert.match(content, /<!DOCTYPE plist/, 'should be plist XML');
  assert.match(content, /com\.claude-remote-cli/, 'should have label');
  assert.match(content, /RunAtLoad/, 'should have RunAtLoad');
  assert.match(content, /KeepAlive/, 'should have KeepAlive');
  assert.match(content, /3456/, 'should include port');
});

test('generateServiceFile for linux contains systemd unit', () => {
  const content = generateServiceFile('linux', {
    nodePath: '/usr/bin/node',
    scriptPath: '/usr/lib/node_modules/claude-remote-cli/bin/claude-remote-cli.js',
    configPath: '/home/test/.config/claude-remote-cli/config.json',
    port: '3456',
    host: '0.0.0.0',
    logDir: null,
  });
  assert.match(content, /\[Unit\]/, 'should have Unit section');
  assert.match(content, /\[Service\]/, 'should have Service section');
  assert.match(content, /\[Install\]/, 'should have Install section');
  assert.match(content, /Restart=on-failure/, 'should restart on failure');
  assert.match(content, /3456/, 'should include port');
});

test('isInstalled returns false when service file does not exist', () => {
  assert.equal(isInstalled(), false);
});
```

**Step 3: Delete old files and commit**

```bash
git rm server/service.js test/service.test.js
git add server/service.ts test/service.test.ts
git commit -m "refactor: migrate service module to TypeScript ESM"
```

---

### Task 9: Migrate server/index.js → server/index.ts

**Files:**
- Delete: `server/index.js`
- Create: `server/index.ts`

**Step 1: Create server/index.ts**

This is the largest file (308 lines). Key changes: ESM imports, `__dirname` replacement, typed Express handlers, typed config.

```typescript
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';

import { loadConfig, saveConfig, DEFAULTS } from './config.js';
import * as auth from './auth.js';
import * as sessions from './sessions.js';
import { setupWebSocket } from './ws.js';
import { WorktreeWatcher } from './watcher.js';
import type { Config } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = process.env.CLAUDE_REMOTE_CONFIG ?? path.join(__dirname, '..', 'config.json');

function parseTTL(ttl: string | undefined): number {
  if (typeof ttl !== 'string') return 24 * 60 * 60 * 1000;
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1]!, 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default:  return 24 * 60 * 60 * 1000;
  }
}

function promptPin(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface RepoEntry {
  name: string;
  path: string;
  root: string;
}

function scanReposInRoot(rootDir: string): RepoEntry[] {
  const repos: RepoEntry[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return repos;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (fs.existsSync(path.join(fullPath, '.git'))) {
      repos.push({ name: entry.name, path: fullPath, root: rootDir });
    }
  }
  return repos;
}

function scanAllRepos(rootDirs: string[]): RepoEntry[] {
  const repos: RepoEntry[] = [];
  for (const rootDir of rootDirs) {
    repos.push(...scanReposInRoot(rootDir));
  }
  return repos;
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(CONFIG_PATH);
  } catch {
    config = { ...DEFAULTS };
    saveConfig(CONFIG_PATH, config);
  }

  if (process.env.CLAUDE_REMOTE_PORT) config.port = parseInt(process.env.CLAUDE_REMOTE_PORT, 10);
  if (process.env.CLAUDE_REMOTE_HOST) config.host = process.env.CLAUDE_REMOTE_HOST;

  if (!config.pinHash) {
    const pin = await promptPin('Set up a PIN for claude-remote-cli:');
    config.pinHash = await auth.hashPin(pin);
    saveConfig(CONFIG_PATH, config);
    console.log('PIN set successfully.');
  }

  const authenticatedTokens = new Set<string>();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.token as string | undefined;
    if (!token || !authenticatedTokens.has(token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  const watcher = new WorktreeWatcher();
  watcher.rebuild(config.rootDirs ?? []);

  const server = http.createServer(app);
  const { broadcastEvent } = setupWebSocket(server, authenticatedTokens, watcher);

  app.post('/auth', async (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (auth.isRateLimited(ip)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    const { pin } = req.body as { pin?: string };
    if (!pin) {
      res.status(400).json({ error: 'PIN required' });
      return;
    }

    const valid = await auth.verifyPin(pin, config.pinHash!);
    if (!valid) {
      auth.recordFailedAttempt(ip);
      res.status(401).json({ error: 'Invalid PIN' });
      return;
    }

    auth.clearRateLimit(ip);
    const token = auth.generateCookieToken();
    authenticatedTokens.add(token);

    const ttlMs = parseTTL(config.cookieTTL);
    setTimeout(() => authenticatedTokens.delete(token), ttlMs);

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: ttlMs,
    });

    res.json({ ok: true });
  });

  app.get('/sessions', requireAuth, (_req: Request, res: Response) => {
    res.json(sessions.list());
  });

  app.get('/repos', requireAuth, (_req: Request, res: Response) => {
    const repos = scanAllRepos(config.rootDirs ?? []);
    if (config.repos) {
      for (const repo of config.repos) {
        if (!repos.some((r) => r.path === repo.path)) {
          repos.push({ ...repo, root: repo.root ?? '' });
        }
      }
    }
    res.json(repos);
  });

  app.get('/worktrees', requireAuth, (req: Request, res: Response) => {
    const repoParam = req.query.repo as string | undefined;
    const roots = config.rootDirs ?? [];
    const worktrees: Array<{ name: string; path: string; repoName: string; repoPath: string; root: string }> = [];

    let reposToScan: RepoEntry[];
    if (repoParam) {
      const root = roots.find((r) => repoParam.startsWith(r)) ?? '';
      reposToScan = [{ path: repoParam, name: repoParam.split('/').filter(Boolean).pop() ?? '', root }];
    } else {
      reposToScan = scanAllRepos(roots);
    }

    for (const repo of reposToScan) {
      const worktreeDir = path.join(repo.path, '.claude', 'worktrees');
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        worktrees.push({
          name: entry.name,
          path: path.join(worktreeDir, entry.name),
          repoName: repo.name,
          repoPath: repo.path,
          root: repo.root,
        });
      }
    }

    res.json(worktrees);
  });

  app.get('/roots', requireAuth, (_req: Request, res: Response) => {
    res.json(config.rootDirs ?? []);
  });

  app.post('/roots', requireAuth, (req: Request, res: Response) => {
    const { path: rootPath } = req.body as { path?: string };
    if (!rootPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    if (!config.rootDirs) config.rootDirs = [];
    if (config.rootDirs.includes(rootPath)) {
      res.status(409).json({ error: 'Root already exists' });
      return;
    }
    config.rootDirs.push(rootPath);
    saveConfig(CONFIG_PATH, config);
    watcher.rebuild(config.rootDirs);
    broadcastEvent('worktrees-changed');
    res.status(201).json(config.rootDirs);
  });

  app.delete('/roots', requireAuth, (req: Request, res: Response) => {
    const { path: rootPath } = req.body as { path?: string };
    if (!rootPath || !config.rootDirs) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    config.rootDirs = config.rootDirs.filter((r) => r !== rootPath);
    saveConfig(CONFIG_PATH, config);
    watcher.rebuild(config.rootDirs);
    broadcastEvent('worktrees-changed');
    res.json(config.rootDirs);
  });

  app.post('/sessions', requireAuth, (req: Request, res: Response) => {
    const { repoPath, repoName, worktreePath, claudeArgs } = req.body as {
      repoPath?: string;
      repoName?: string;
      worktreePath?: string;
      claudeArgs?: string[];
    };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    const name = repoName ?? repoPath.split('/').filter(Boolean).pop() ?? 'session';
    const baseArgs = claudeArgs ?? config.claudeArgs ?? [];

    const roots = config.rootDirs ?? [];
    const root = roots.find((r) => repoPath.startsWith(r)) ?? '';

    let args: string[];
    let cwd: string;
    let worktreeName: string;

    if (worktreePath) {
      args = [...baseArgs];
      cwd = worktreePath;
      worktreeName = worktreePath.split('/').pop() ?? '';
    } else {
      worktreeName = 'mobile-' + name + '-' + Date.now().toString(36);
      args = ['--worktree', worktreeName, ...baseArgs];
      cwd = repoPath;
    }

    const session = sessions.create({
      repoName: name,
      repoPath: cwd,
      root,
      worktreeName,
      displayName: worktreeName,
      command: config.claudeCommand,
      args,
    });
    res.status(201).json(session);
  });

  app.delete('/sessions/:id', requireAuth, (req: Request, res: Response) => {
    try {
      sessions.kill(req.params.id);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  app.patch('/sessions/:id', requireAuth, (req: Request, res: Response) => {
    const { displayName } = req.body as { displayName?: string };
    if (!displayName) {
      res.status(400).json({ error: 'displayName is required' });
      return;
    }
    try {
      const updated = sessions.updateDisplayName(req.params.id, displayName);
      const session = sessions.get(req.params.id);
      if (session?.pty) {
        session.pty.write('/rename "' + displayName.replace(/"/g, '\\"') + '"\r');
      }
      res.json(updated);
    } catch {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`claude-remote-cli listening on ${config.host}:${config.port}`);
  });
}

main().catch(console.error);
```

**Step 2: Delete old file and commit**

```bash
git rm server/index.js
git add server/index.ts
git commit -m "refactor: migrate index module to TypeScript ESM"
```

---

### Task 10: Migrate bin/claude-remote-cli.js → bin/claude-remote-cli.ts

**Files:**
- Delete: `bin/claude-remote-cli.js`
- Create: `bin/claude-remote-cli.ts`

**Step 1: Create bin/claude-remote-cli.ts**

```typescript
#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: claude-remote-cli [options]
       claude-remote-cli <command>

Commands:
  install            Install as a background service (survives reboot)
  uninstall          Stop and remove the background service
  status             Show whether the service is running

Options:
  --bg               Shortcut: install and start as background service
  --port <port>      Override server port (default: 3456)
  --host <host>      Override bind address (default: 0.0.0.0)
  --config <path>    Path to config.json (default: ~/.config/claude-remote-cli/config.json)
  --version, -v      Show version
  --help, -h         Show this help`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json') as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function resolveConfigPath(): string {
  const explicit = getArg('--config');
  if (explicit) return explicit;
  // Lazy import to avoid loading service module for --help/--version
  const { CONFIG_DIR } = await import('../server/service.js');
  return path.join(CONFIG_DIR, 'config.json');
}

function runServiceCommand(fn: () => void): never {
  try {
    fn();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

const command = args[0];
if (command === 'install' || command === 'uninstall' || command === 'status' || args.includes('--bg')) {
  const service = await import('../server/service.js');

  if (command === 'uninstall') {
    runServiceCommand(() => { service.uninstall(); });
  } else if (command === 'status') {
    runServiceCommand(() => {
      const st = service.status();
      if (!st.installed) {
        console.log('Service is not installed.');
      } else if (st.running) {
        console.log('Service is installed and running.');
      } else {
        console.log('Service is installed but not running.');
      }
    });
  } else {
    const { DEFAULTS } = await import('../server/config.js');
    runServiceCommand(() => {
      service.install({
        configPath: resolveConfigPath(),
        port: getArg('--port') ?? String(DEFAULTS.port),
        host: getArg('--host') ?? DEFAULTS.host,
      });
    });
  }
}

const configPath = resolveConfigPath();
const configDir = path.dirname(configPath);

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

process.env.CLAUDE_REMOTE_CONFIG = configPath;
const portArg = getArg('--port');
if (portArg) process.env.CLAUDE_REMOTE_PORT = portArg;
const hostArg = getArg('--host');
if (hostArg) process.env.CLAUDE_REMOTE_HOST = hostArg;

await import('../server/index.js');
```

**NOTE:** The CLI uses top-level `await` which is valid in ESM. The `resolveConfigPath` function needs to be async since it uses dynamic import. Alternatively, we can restructure to avoid async in resolveConfigPath by eagerly importing service at the top. The implementor should adjust to get `tsc` happy — the key constraint is that the logic must match the current behavior.

**Step 2: Delete old file and commit**

```bash
git rm bin/claude-remote-cli.js
git add bin/claude-remote-cli.ts
git commit -m "refactor: migrate CLI entry point to TypeScript ESM"
```

---

### Task 11: Fix compilation errors and get tsc passing

**Files:**
- Potentially any `.ts` file

**Step 1: Run tsc and capture all errors**

Run: `npx tsc -p tsconfig.test.json --noEmit 2>&1`
Expected: List of type errors to fix

**Step 2: Fix each error**

Common issues to expect:
- `import.meta.url` needs `"module": "NodeNext"` (already set)
- `require('../package.json')` may need `resolveJsonModule: true` in tsconfig
- Express route handler return types (void vs Response)
- Optional property access with `exactOptionalPropertyTypes`
- `catch` clause typing

Fix each error one at a time, re-running `npx tsc --noEmit` after each fix.

**Step 3: Get a clean build**

Run: `npm run build`
Expected: Compiles to `dist/` with no errors

**Step 4: Run tests**

Run: `npm test`
Expected: All 23 tests pass

**Step 5: Commit**

```bash
git add -A
git commit -m "fix: resolve TypeScript compilation errors"
```

---

### Task 12: Verify all old .js files are removed and cleanup

**Files:**
- Verify: no `.js` files remain in `server/` or `test/` (except compiled `dist/`)
- Verify: no `.js` files remain in `bin/` (except compiled `dist/`)

**Step 1: Check for leftover .js files**

Run: `ls server/*.js bin/*.js test/*.js 2>&1`
Expected: "No such file or directory" for all three

**Step 2: Verify dist/ output structure**

Run: `ls dist/server/ dist/bin/ dist/test/`
Expected: `.js` and `.d.ts` files for each module

**Step 3: Run the full test suite**

Run: `npm test`
Expected: All 23 tests pass

**Step 4: Smoke test the CLI**

Run: `node dist/bin/claude-remote-cli.js --help`
Expected: Help text printed

Run: `node dist/bin/claude-remote-cli.js status`
Expected: "Service is not installed."

Run: `node dist/bin/claude-remote-cli.js --version`
Expected: Version number printed

**Step 5: Commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: clean up migration artifacts"
```

---

### Task 13: Update ADRs and documentation

**Files:**
- Modify: `docs/adrs/001-modular-express-server-architecture.md`
- Modify: `docs/adrs/005-nodejs-builtin-test-runner.md`
- Modify: `docs/adrs/006-dual-distribution-npm-global-local-dev.md`
- Create: `docs/adrs/008-typescript-esm-migration.md`
- Modify: `docs/guides/architecture.md`
- Modify: `docs/guides/testing.md`
- Modify: `docs/guides/deployment.md`
- Modify: `CLAUDE.md`

**Step 1: Update ADR-001** — Change module file extensions from `.js` to `.ts` in the decision table. Add note that modules are TypeScript source compiled to `dist/`.

**Step 2: Update ADR-005** — Update test command to reflect `tsc -p tsconfig.test.json && node --test dist/test/*.test.js`. Note that test source files are `.ts`.

**Step 3: Update ADR-006** — Update `bin` to `dist/bin/claude-remote-cli.js`, `files` to `dist/` paths, add `build` script reference.

**Step 4: Create ADR-008** — Document the TypeScript + ESM migration decision. Status: Accepted. Cover: why TypeScript, why ESM, why tsc (not tsx), why full strict, why Node >=24, frontend exclusion per ADR-002.

**Step 5: Update architecture.md** — Update Server Modules table to reference `.ts` files. Add build step documentation.

**Step 6: Update testing.md** — Update test commands and file extensions.

**Step 7: Update deployment.md** — Add `npm run build` to pre-publish checklist.

**Step 8: Update CLAUDE.md** — Update commands table (`npm run build`, updated `npm start` and `npm test`). Update architecture section to mention TypeScript. Add Node >=24 to gotchas.

**Step 9: Run `/adr:update`** to regenerate `.claude/rules/architecture.md`

**Step 10: Commit**

```bash
git add -A
git commit -m "docs: update ADRs and guides for TypeScript ESM migration"
```

---

### Task 14: Final integration test and version bump

**Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: Clean compilation

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: CLI smoke test**

Run: `node dist/bin/claude-remote-cli.js --help`
Run: `node dist/bin/claude-remote-cli.js --version`
Run: `node dist/bin/claude-remote-cli.js status`

**Step 4: Install/uninstall smoke test**

Run: `node dist/bin/claude-remote-cli.js install --port 3457`
Run: `node dist/bin/claude-remote-cli.js status`
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3457`
Run: `node dist/bin/claude-remote-cli.js uninstall`
Run: `node dist/bin/claude-remote-cli.js status`

**Step 5: Version bump**

Run: `npm version major` (this is a breaking change — Node >=24 requirement)

**Step 6: Push**

Run: `git push && git push --tags`
