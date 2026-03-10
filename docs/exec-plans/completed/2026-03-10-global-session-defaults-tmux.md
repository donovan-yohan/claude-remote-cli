# Global Session Defaults & tmux Launch Setting

> **Status**: Complete | **Created**: 2026-03-10 | **Last Updated**: 2026-03-10
> **Design Doc**: `docs/design-docs/2026-03-10-tmux-launch-setting-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-10 | Design | Expand defaultAgent pattern to 3 new settings | Consistent API shape, minimal new concepts |
| 2026-03-10 | Design | Quick-start uses global defaults, dialog allows override | Zero-friction for common case, escape hatch via Customize |
| 2026-03-10 | Design | crc-* prefix for tmux sessions | Server can identify and clean up its own tmux sessions |
| 2026-03-10 | Design | Startup sweep kills orphaned crc-* tmux sessions | Catches crashes, kill -9, package updates |
| 2026-03-10 | Design | Terminal sessions excluded from tmux | Users can run tmux themselves in terminal sessions |

## Progress

- [x] Task 1: Backend types and config defaults _(completed 2026-03-10)_
- [x] Task 2: Config endpoints (GET/PATCH for 3 new settings) _(completed 2026-03-10)_
- [x] Task 3: sessions.ts tmux wrapping + kill cleanup _(completed 2026-03-10)_
- [x] Task 4: Route handlers pass useTmux + defaults _(completed 2026-03-10)_
- [x] Task 5: Startup sweep + graceful shutdown cleanup _(completed 2026-03-10)_
- [x] Task 6: Frontend API helpers _(completed 2026-03-10)_
- [x] Task 7: SettingsDialog — 3 new toggles _(completed 2026-03-10)_
- [x] Task 8: NewSessionDialog — pre-fill from defaults + tmux checkbox _(completed 2026-03-10)_
- [x] Task 9: SessionList — quick-start uses config defaults _(completed 2026-03-10)_
- [x] Task 10: Tests _(completed 2026-03-10)_
- [x] Task 11: config.example.json update _(completed 2026-03-10)_

## Surprises & Discoveries

| Date | What | Impact | Action |
|------|------|--------|--------|
| 2026-03-10 | SessionSummary derived from Session via Omit | Adding fields to Session required updating list() map and create() return | Fixed in backend worker, no plan change needed |

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

## Task 1: Backend types and config defaults

**Files:** `server/types.ts`, `server/config.ts`

### Step 1.1: Add config fields to types.ts

In `server/types.ts`, add three fields to the `Config` interface:

```typescript
// After defaultAgent in Config interface:
defaultContinue: boolean;
defaultYolo: boolean;
launchInTmux: boolean;
```

Add `useTmux?: boolean` and `tmuxSessionName?: string` to the `Session` interface:

```typescript
// After idle in Session interface:
useTmux: boolean;
tmuxSessionName: string;
```

### Step 1.2: Add `useTmux` to CreateParams in sessions.ts

In `server/sessions.ts`, add to `CreateParams`:

```typescript
useTmux?: boolean;
```

### Step 1.3: Add defaults to config.ts

In `server/config.ts`, add to `DEFAULTS`:

```typescript
defaultContinue: true,
defaultYolo: false,
launchInTmux: false,
```

### Verification

`npm run build` should pass with no type errors.

---

## Task 2: Config endpoints

**Files:** `server/index.ts`

### Step 2.1: Add GET/PATCH for defaultContinue

Follow the exact `defaultAgent` pattern at lines 518–533:

```typescript
app.get('/config/defaultContinue', requireAuth, (_req, res) => {
  res.json({ defaultContinue: config.defaultContinue });
});

app.patch('/config/defaultContinue', requireAuth, (req, res) => {
  const { defaultContinue } = req.body as { defaultContinue?: boolean };
  if (typeof defaultContinue !== 'boolean') {
    res.status(400).json({ error: 'defaultContinue must be a boolean' });
    return;
  }
  config.defaultContinue = defaultContinue;
  saveConfig(CONFIG_PATH, config);
  res.json({ defaultContinue: config.defaultContinue });
});
```

### Step 2.2: Add GET/PATCH for defaultYolo

Same pattern as above.

### Step 2.3: Add GET/PATCH for launchInTmux

Same pattern, but PATCH validates tmux availability:

```typescript
app.patch('/config/launchInTmux', requireAuth, async (req, res) => {
  const { launchInTmux } = req.body as { launchInTmux?: boolean };
  if (typeof launchInTmux !== 'boolean') {
    res.status(400).json({ error: 'launchInTmux must be a boolean' });
    return;
  }
  if (launchInTmux) {
    try {
      await execFileAsync('tmux', ['-V']);
    } catch {
      res.status(400).json({ error: 'tmux is not installed or not in PATH' });
      return;
    }
  }
  config.launchInTmux = launchInTmux;
  saveConfig(CONFIG_PATH, config);
  res.json({ launchInTmux: config.launchInTmux });
});
```

### Verification

`npm run build` passes.

---

## Task 3: sessions.ts tmux wrapping + kill cleanup

**Files:** `server/sessions.ts`

### Step 3.1: Add tmux session name generator

```typescript
function generateTmuxSessionName(displayName: string, id: string): string {
  const sanitized = displayName.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30);
  return `crc-${sanitized}-${id.slice(0, 8)}`;
}
```

### Step 3.2: Add tmux command wrapping helper

```typescript
function resolveTmuxSpawn(
  command: string,
  args: string[],
  tmuxSessionName: string,
): { command: string; args: string[] } {
  return {
    command: 'tmux',
    args: ['new-session', '-s', tmuxSessionName, '--', command, ...args],
  };
}
```

Export `resolveTmuxSpawn` and `generateTmuxSessionName` for testing.

### Step 3.3: Use tmux wrapping in create()

In the `create` function, after resolving `resolvedCommand` and before `pty.spawn`:

```typescript
const useTmux = !command && !!params.useTmux; // only for agent sessions
let spawnCommand = resolvedCommand;
let spawnArgs = args;
const tmuxSessionName = useTmux ? generateTmuxSessionName(displayName || repoName || 'session', id) : '';

if (useTmux) {
  const tmux = resolveTmuxSpawn(resolvedCommand, args, tmuxSessionName);
  spawnCommand = tmux.command;
  spawnArgs = tmux.args;
}
```

Update `pty.spawn` to use `spawnCommand, spawnArgs`.

Store `useTmux` and `tmuxSessionName` on the session object.

### Step 3.4: Update retry-without-continue to rebuild tmux wrapper

In `attachHandlers`, the retry path currently does:
```typescript
const retryPty = pty.spawn(resolvedCommand, retryArgs, ...);
```

Change to:
```typescript
let retryCommand = resolvedCommand;
let retrySpawnArgs = retryArgs;
if (useTmux && tmuxSessionName) {
  const tmux = resolveTmuxSpawn(resolvedCommand, retryArgs, tmuxSessionName);
  retryCommand = tmux.command;
  retrySpawnArgs = tmux.args;
}
const retryPty = pty.spawn(retryCommand, retrySpawnArgs, ...);
```

### Step 3.5: Add tmux cleanup to kill()

In the `kill` function, after `session.pty.kill('SIGTERM')`:

```typescript
if (session.tmuxSessionName) {
  execFile('tmux', ['kill-session', '-t', session.tmuxSessionName], () => {});
}
```

Import `execFile` from `node:child_process`.

### Step 3.6: Export killAllTmuxSessions for shutdown

```typescript
function killAllTmuxSessions(): void {
  for (const session of sessions.values()) {
    if (session.tmuxSessionName) {
      execFile('tmux', ['kill-session', '-t', session.tmuxSessionName], () => {});
    }
  }
}
```

Export it.

### Verification

`npm run build` passes.

---

## Task 4: Route handlers pass useTmux + defaults

**Files:** `server/index.ts`

### Step 4.1: POST /sessions — read useTmux from body

Add `useTmux` to the destructured body type. Pass it to `sessions.create()`:

```typescript
const { repoPath, repoName, worktreePath, branchName, claudeArgs, yolo, agent, useTmux } = req.body as { ... useTmux?: boolean; };
```

In all `sessions.create()` calls within this handler, add:
```typescript
useTmux: useTmux ?? config.launchInTmux,
```

### Step 4.2: POST /sessions/repo — same pattern

Add `useTmux` to the destructured body. Pass to `sessions.create()`:

```typescript
useTmux: useTmux ?? config.launchInTmux,
```

### Step 4.3: POST /sessions/terminal — no change

Terminal sessions don't pass `useTmux`. The `sessions.create()` function ignores it when `command` is set.

### Verification

`npm run build` passes.

---

## Task 5: Startup sweep + graceful shutdown cleanup

**Files:** `server/index.ts`

### Step 5.1: Add startup tmux cleanup

After `config` is loaded and before `server.listen()`, add:

```typescript
// Clean up orphaned tmux sessions from previous runs
try {
  const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
  const crcSessions = stdout.trim().split('\n').filter(name => name.startsWith('crc-'));
  for (const name of crcSessions) {
    execFileAsync('tmux', ['kill-session', '-t', name]).catch(() => {});
  }
  if (crcSessions.length > 0) {
    console.log(`Cleaned up ${crcSessions.length} orphaned tmux session(s).`);
  }
} catch {
  // tmux not installed or no sessions — ignore
}
```

### Step 5.2: Add graceful shutdown handler

Import `killAllTmuxSessions` from sessions. Before `server.listen()`:

```typescript
import { killAllTmuxSessions } from './sessions.js';

// ... in main():
function gracefulShutdown() {
  killAllTmuxSessions();
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

### Verification

`npm run build` passes. `npm test` passes.

---

## Task 6: Frontend API helpers

**Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`

### Step 6.1: Add useTmux to OpenSessionOptions

In `frontend/src/lib/types.ts`:

```typescript
export interface OpenSessionOptions {
  yolo?: boolean;
  useTmux?: boolean;
  tab?: 'repos' | 'worktrees';
  branchName?: string;
  agent?: AgentType;
  claudeArgs?: string;
}
```

### Step 6.2: Add useTmux to API request bodies

In `frontend/src/lib/api.ts`, add `useTmux?: boolean` to both `createSession` and `createRepoSession` body types.

### Step 6.3: Add fetch/set helpers for new settings

```typescript
export async function fetchDefaultContinue(): Promise<boolean> {
  const data = await json<{ defaultContinue: boolean }>(await fetch('/config/defaultContinue'));
  return data.defaultContinue;
}

export async function setDefaultContinue(value: boolean): Promise<void> {
  const res = await fetch('/config/defaultContinue', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultContinue: value }),
  });
  if (!res.ok) throw new Error('Failed to update defaultContinue');
}

export async function fetchDefaultYolo(): Promise<boolean> {
  const data = await json<{ defaultYolo: boolean }>(await fetch('/config/defaultYolo'));
  return data.defaultYolo;
}

export async function setDefaultYolo(value: boolean): Promise<void> {
  const res = await fetch('/config/defaultYolo', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultYolo: value }),
  });
  if (!res.ok) throw new Error('Failed to update defaultYolo');
}

export async function fetchLaunchInTmux(): Promise<boolean> {
  const data = await json<{ launchInTmux: boolean }>(await fetch('/config/launchInTmux'));
  return data.launchInTmux;
}

export async function setLaunchInTmux(value: boolean): Promise<void> {
  const res = await fetch('/config/launchInTmux', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ launchInTmux: value }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error || 'Failed to update launchInTmux');
  }
}
```

### Verification

Frontend builds: `npx vite build --config frontend/vite.config.ts`.

---

## Task 7: SettingsDialog — 3 new toggles

**Files:** `frontend/src/components/dialogs/SettingsDialog.svelte`

### Step 7.1: Import new API helpers

Add to imports:
```typescript
import { fetchRoots, addRoot, removeRoot, fetchDefaultAgent, setDefaultAgent, fetchDefaultContinue, setDefaultContinue, fetchDefaultYolo, setDefaultYolo, fetchLaunchInTmux, setLaunchInTmux } from '../../lib/api.js';
```

### Step 7.2: Add state variables

```typescript
let defaultContinue = $state(true);
let defaultYolo = $state(false);
let launchInTmux = $state(false);
```

### Step 7.3: Fetch values in open()

After fetching `selectedAgent`:
```typescript
try { defaultContinue = await fetchDefaultContinue(); } catch { defaultContinue = true; }
try { defaultYolo = await fetchDefaultYolo(); } catch { defaultYolo = false; }
try { launchInTmux = await fetchLaunchInTmux(); } catch { launchInTmux = false; }
```

### Step 7.4: Add change handlers

```typescript
async function handleContinueChange() {
  error = '';
  try { await setDefaultContinue(defaultContinue); } catch { error = 'Failed to update continue default.'; }
}

async function handleYoloChange() {
  error = '';
  try { await setDefaultYolo(defaultYolo); } catch { error = 'Failed to update yolo default.'; }
}

async function handleTmuxChange() {
  error = '';
  try {
    await setLaunchInTmux(launchInTmux);
  } catch (err) {
    launchInTmux = false;
    error = err instanceof Error ? err.message : 'Failed to update tmux setting.';
  }
}
```

### Step 7.5: Add UI section

After the "Default Coding Agent" section and before "Developer Tools":

```svelte
<!-- Session defaults section -->
<section class="settings-section">
  <h3 class="section-title">Session Defaults</h3>
  <p class="section-desc">Default options for new sessions. Override per-session via Customize.</p>
  <div class="devtools-row">
    <input id="default-continue" type="checkbox" class="dialog-checkbox" bind:checked={defaultContinue} onchange={handleContinueChange} />
    <label for="default-continue" class="devtools-label">Continue existing session</label>
  </div>
  <div class="devtools-row">
    <input id="default-yolo" type="checkbox" class="dialog-checkbox" bind:checked={defaultYolo} onchange={handleYoloChange} />
    <label for="default-yolo" class="devtools-label">YOLO mode (skip permission checks)</label>
  </div>
  <div class="devtools-row">
    <input id="default-tmux" type="checkbox" class="dialog-checkbox" bind:checked={launchInTmux} onchange={handleTmuxChange} />
    <label for="default-tmux" class="devtools-label">Launch in tmux</label>
  </div>
</section>
```

### Verification

Frontend builds. Settings dialog shows new toggles.

---

## Task 8: NewSessionDialog — pre-fill from defaults + tmux checkbox

**Files:** `frontend/src/components/dialogs/NewSessionDialog.svelte`

### Step 8.1: Import new API helpers

Add `fetchDefaultContinue, fetchDefaultYolo, fetchLaunchInTmux` to imports.

### Step 8.2: Add useTmux state

```typescript
let useTmux = $state(false);
```

### Step 8.3: Fetch defaults in open()

After fetching `selectedAgent`, add:
```typescript
try { yoloMode = await fetchDefaultYolo(); } catch { yoloMode = false; }
try { continueExisting = await fetchDefaultContinue(); } catch { continueExisting = false; }
try { useTmux = await fetchLaunchInTmux(); } catch { useTmux = false; }
```

Apply options overrides after:
```typescript
if (options?.yolo !== undefined) yoloMode = options.yolo;
if (options?.useTmux !== undefined) useTmux = options.useTmux;
```

### Step 8.4: Add tmux checkbox to template

After the yolo checkbox (shown in both tabs):

```svelte
<!-- Launch in tmux -->
<div class="dialog-field dialog-field--inline">
  <input id="ns-tmux" type="checkbox" class="dialog-checkbox" bind:checked={useTmux} />
  <label for="ns-tmux" class="dialog-label-inline">Launch in tmux</label>
</div>
```

### Step 8.5: Pass useTmux on submit

In `handleSubmit`, add `useTmux` to both `createRepoSession` and `createSession` calls:

```typescript
// repos tab:
session = await createRepoSession({
  ...existing fields...,
  useTmux,
});

// worktrees tab:
session = await createSession({
  ...existing fields...,
  useTmux,
});
```

### Step 8.6: Reset useTmux in reset()

Add `useTmux = false;` to the `reset()` function.

### Verification

Frontend builds. Dialog shows tmux checkbox, pre-fills from server defaults.

---

## Task 9: SessionList — quick-start uses config defaults

**Files:** `frontend/src/components/SessionList.svelte`

### Step 9.1: Import config fetch helpers

Add to imports:
```typescript
import { fetchDefaultContinue, fetchDefaultYolo, fetchLaunchInTmux } from '../lib/api.js';
```

### Step 9.2: Add config state and load on mount

```typescript
let configDefaults = $state({ defaultContinue: true, defaultYolo: false, launchInTmux: false });

// Load defaults when component mounts
$effect(() => {
  (async () => {
    try {
      const [cont, yolo, tmux] = await Promise.all([
        fetchDefaultContinue(),
        fetchDefaultYolo(),
        fetchLaunchInTmux(),
      ]);
      configDefaults = { defaultContinue: cont, defaultYolo: yolo, launchInTmux: tmux };
    } catch { /* use defaults */ }
  })();
});
```

### Step 9.3: Update handleStartRepoSession

Change hardcoded `continue: true` and conditional yolo:

```typescript
async function handleStartRepoSession(repo: RepoInfo, yolo = false) {
  const key = repo.path;
  if (isItemLoading(key)) return;
  setLoading(key);
  try {
    const session = await api.createRepoSession({
      repoPath: repo.path,
      repoName: repo.name,
      continue: configDefaults.defaultContinue,
      yolo: yolo || configDefaults.defaultYolo,
      useTmux: configDefaults.launchInTmux,
    });
    // ... rest unchanged
```

### Step 9.4: Update handleStartWorktreeSession

```typescript
async function handleStartWorktreeSession(wt: WorktreeInfo, yolo = false) {
  const key = wt.path;
  if (isItemLoading(key)) return;
  setLoading(key);
  try {
    const session = await api.createSession({
      repoPath: wt.repoPath,
      repoName: wt.repoName,
      worktreePath: wt.path,
      yolo: yolo || configDefaults.defaultYolo,
      useTmux: configDefaults.launchInTmux,
    });
    // ... rest unchanged
```

### Step 9.5: Update handlePRClick

For the worktree resume path (step 2) and new worktree path (step 3), add `useTmux: configDefaults.launchInTmux` and `yolo: yolo || configDefaults.defaultYolo`.

### Verification

Frontend builds.

---

## Task 10: Tests

**Files:** `test/config.test.ts`, `test/sessions.test.ts`

### Step 10.1: Config test — new defaults

Add test that `loadConfig` returns correct defaults for the three new fields when they're not present in the config file.

### Step 10.2: Sessions test — tmux wrapping

Test `resolveTmuxSpawn` produces correct command and args.

Test `generateTmuxSessionName` sanitizes display names correctly.

### Step 10.3: Sessions test — useTmux in create

This requires mocking `pty.spawn`. If existing tests already mock it, add a test that verifies:
- When `useTmux: true`, spawn is called with `'tmux'` as the command
- When `useTmux: false` or absent, spawn is called with the agent command directly

### Verification

`npm test` passes.

---

## Task 11: config.example.json update

**Files:** `config.example.json`

Add the three new fields plus the missing `defaultAgent`:

```json
{
  "host": "0.0.0.0",
  "port": 3456,
  "cookieTTL": "24h",
  "rootDirs": [
    "/Users/you/code/work",
    "/Users/you/code/personal"
  ],
  "claudeCommand": "claude",
  "claudeArgs": [],
  "defaultAgent": "claude",
  "defaultContinue": true,
  "defaultYolo": false,
  "launchInTmux": false
}
```

### Verification

`npm run build` and `npm test` pass.

---

## Review Fixes (Post-Implementation)

Review found 18 actionable findings across 6 agents. Fixed 12 in two commits:

- **Graceful shutdown**: Close HTTP server, kill PTYs, delay before exit
- **DRY config endpoints**: Generic `boolConfigEndpoints()` replaces 56 lines of copy-paste
- **DRY API helpers**: `fetchConfigBool`/`setConfigBool` replaces 6 verbose functions
- **`$effect` → `onMount`**: SessionList one-time fetch uses idiomatic `onMount`
- **Parallel fetches**: `Promise.all` in NewSessionDialog and SettingsDialog
- **DESIGN.md**: Clarified re-attach vs reconnect terminology
- **Tests**: useTmux defaults, custom command disables tmux, list includes tmux fields, DEFAULTS assertions

Deferred (low priority): discriminated union for tmux types, naming unification (launchInTmux vs useTmux), startup tmux validation, consolidated config endpoint.

## Outcomes & Retrospective

**What worked:**
- Parallel worker dispatch (4 implementation + 1 test, then 2 fix workers) completed fast
- DRY refactors significantly reduced code volume without changing behavior
- `boolConfigEndpoints` pattern is reusable for future boolean config settings

**What didn't:**
- Initial implementation had 18 review findings — mostly DRY violations and missing error handling
- 6 review agents generated overlapping findings that needed manual dedup

**Learnings to codify:**
- When adding N similar config endpoints, create a generic helper from the start
- Graceful shutdown should close server + kill processes, not just fire-and-forget
- Use `onMount` for one-time fetches in Svelte 5, not `$effect`
