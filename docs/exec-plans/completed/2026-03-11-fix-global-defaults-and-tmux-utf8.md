# Fix Global Defaults & tmux UTF-8 Implementation Plan

> **Status**: Completed | **Created**: 2026-03-11 | **Completed**: 2026-03-11
> **Bug Analysis**: `docs/bug-analyses/2026-03-11-global-defaults-and-tmux-rendering-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

**Goal:** Fix two bugs: (1) stale config defaults on quick-start session creation, (2) missing Unicode characters in tmux sessions.

**Architecture:** Create a shared reactive config store (`config.svelte.ts`) following the existing `sessions.svelte.ts` pattern. Both `SessionList` and `SettingsDialog` read/write through this store. For tmux, add `-u` flag to the spawn command.

**Tech Stack:** Svelte 5 runes, TypeScript, node-pty, tmux

---

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-11 | Design | Shared reactive store for config defaults | Mirrors existing `sessions.svelte.ts` pattern; avoids stale state |
| 2026-03-11 | Design | Add `-u` flag to tmux spawn | Forces UTF-8 mode regardless of locale |

## Progress

- [x] Task 1: Add `-u` flag to tmux spawn (backend) _(completed 2026-03-11)_
- [x] Task 2: Create shared config store (frontend) _(completed 2026-03-11)_
- [x] Task 3: Wire SettingsDialog to shared config store _(completed 2026-03-11)_
- [x] Task 4: Wire SessionList to shared config store _(completed 2026-03-11)_
- [x] Task 5: Wire NewSessionDialog to shared config store _(completed 2026-03-11)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Add `-u` flag to tmux spawn (backend)

**Files:**
- Modify: `server/sessions.ts:52-61` — `resolveTmuxSpawn()`
- Modify: `test/sessions.test.ts:320-326` — update existing test assertion

- [ ] **Step 1: Update the existing test assertion for resolveTmuxSpawn**

In `test/sessions.test.ts`, update the test at line 320:

```typescript
it('resolveTmuxSpawn returns correct tmux command and args', () => {
  const result = resolveTmuxSpawn('claude', ['--continue'], 'test-session');
  assert.deepStrictEqual(result, {
    command: 'tmux',
    args: ['-u', 'new-session', '-s', 'test-session', '--', 'claude', '--continue'],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — current `resolveTmuxSpawn` returns args without `-u`

- [ ] **Step 3: Add `-u` flag to resolveTmuxSpawn**

In `server/sessions.ts`, update `resolveTmuxSpawn()`:

```typescript
function resolveTmuxSpawn(
  command: string,
  args: string[],
  tmuxSessionName: string,
): { command: string; args: string[] } {
  return {
    command: 'tmux',
    args: ['-u', 'new-session', '-s', tmuxSessionName, '--', command, ...args],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/sessions.ts test/sessions.test.ts
git commit -m "fix: add -u flag to tmux spawn for UTF-8 support"
```

---

### Task 2: Create shared config store (frontend)

**Files:**
- Create: `frontend/src/lib/state/config.svelte.ts`

- [ ] **Step 1: Create the shared config state module**

Create `frontend/src/lib/state/config.svelte.ts`:

```typescript
import * as api from '../api.js';

let defaultContinue = $state(true);
let defaultYolo = $state(false);
let launchInTmux = $state(false);
let defaultAgent = $state('claude');

export function getConfigState() {
  return {
    get defaultContinue() { return defaultContinue; },
    set defaultContinue(v: boolean) { defaultContinue = v; },
    get defaultYolo() { return defaultYolo; },
    set defaultYolo(v: boolean) { defaultYolo = v; },
    get launchInTmux() { return launchInTmux; },
    set launchInTmux(v: boolean) { launchInTmux = v; },
    get defaultAgent() { return defaultAgent; },
    set defaultAgent(v: string) { defaultAgent = v; },
  };
}

export async function refreshConfig(): Promise<void> {
  try {
    const [cont, yolo, tmux, agent] = await Promise.all([
      api.fetchDefaultContinue().catch(() => true),
      api.fetchDefaultYolo().catch(() => false),
      api.fetchLaunchInTmux().catch(() => false),
      api.fetchDefaultAgent().catch(() => 'claude'),
    ]);
    defaultContinue = cont;
    defaultYolo = yolo;
    launchInTmux = tmux;
    defaultAgent = agent;
  } catch { /* use current values */ }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/state/config.svelte.ts
git commit -m "feat: add shared reactive config state store"
```

---

### Task 3: Wire SettingsDialog to shared config store

**Files:**
- Modify: `frontend/src/components/dialogs/SettingsDialog.svelte`

- [ ] **Step 1: Replace local state with shared config store**

In `SettingsDialog.svelte`, make the following changes:

**Add import** (replace existing api imports for config fetchers):

```typescript
import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';
import { addRoot, removeRoot, fetchRoots } from '../../lib/api.js';
import { setDefaultAgent, setDefaultContinue, setDefaultYolo, setLaunchInTmux } from '../../lib/api.js';
```

**Replace local config state** — remove the local `selectedAgent`, `defaultContinue`, `defaultYolo`, `launchInTmux` declarations (lines 10-13) and add:

```typescript
const config = getConfigState();
```

**Update the `open()` function** — replace the config-fetching block (lines 29-46) with:

```typescript
export async function open() {
  error = '';
  newRootPath = '';
  devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
  await loadRoots();
  await refreshConfig();
  dialogEl.showModal();
}
```

**Update template bindings** — change all references from local state to `config.*`:
- `selectedAgent` → `config.defaultAgent`
- `defaultContinue` → `config.defaultContinue`
- `defaultYolo` → `config.defaultYolo`
- `launchInTmux` → `config.launchInTmux`

**Update handler functions** to use the config store:

```typescript
async function handleAgentChange() {
  error = '';
  try { await setDefaultAgent(config.defaultAgent); } catch { error = 'Failed to update default agent.'; }
}

async function handleContinueChange() {
  error = '';
  try { await setDefaultContinue(config.defaultContinue); } catch { error = 'Failed to update continue default.'; }
}

async function handleYoloChange() {
  error = '';
  try { await setDefaultYolo(config.defaultYolo); } catch { error = 'Failed to update yolo default.'; }
}

async function handleTmuxChange() {
  error = '';
  try {
    await setLaunchInTmux(config.launchInTmux);
  } catch (err) {
    config.launchInTmux = false;
    error = err instanceof Error ? err.message : 'Failed to update tmux setting.';
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dialogs/SettingsDialog.svelte
git commit -m "refactor: wire SettingsDialog to shared config store"
```

---

### Task 4: Wire SessionList to shared config store

**Files:**
- Modify: `frontend/src/components/SessionList.svelte`

- [ ] **Step 1: Replace local configDefaults with shared config store**

In `SessionList.svelte`, make the following changes:

**Replace config imports** — remove `fetchDefaultContinue`, `fetchDefaultYolo`, `fetchLaunchInTmux` from the api import. Add:

```typescript
import { getConfigState, refreshConfig } from '../lib/state/config.svelte.js';
```

**Replace local configDefaults** — remove lines 29-42 (the `configDefaults` $state and `onMount` block). Add:

```typescript
const config = getConfigState();

onMount(() => { refreshConfig(); });
```

**Update all handlers** that reference `configDefaults`:

In `handlePRClick` (existing worktree path, ~line 197):
- `yolo: yolo || configDefaults.defaultYolo` → `yolo: yolo || config.defaultYolo`
- `useTmux: configDefaults.launchInTmux` → `useTmux: config.launchInTmux`

In `handlePRClick` (new worktree path, ~line 216):
- Same replacements

In `handleStartWorktreeSession` (~line 263):
- `yolo: yolo || configDefaults.defaultYolo` → `yolo: yolo || config.defaultYolo`
- `useTmux: configDefaults.launchInTmux` → `useTmux: config.launchInTmux`

In `handleStartRepoSession` (~line 283):
- `continue: configDefaults.defaultContinue` → `continue: config.defaultContinue`
- `yolo: yolo || configDefaults.defaultYolo` → `yolo: yolo || config.defaultYolo`
- `useTmux: configDefaults.launchInTmux` → `useTmux: config.launchInTmux`

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run full tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SessionList.svelte
git commit -m "fix: use shared config store in SessionList for fresh defaults"
```

---

### Task 5: Wire NewSessionDialog to shared config store

**Files:**
- Modify: `frontend/src/components/dialogs/NewSessionDialog.svelte`

- [ ] **Step 1: Replace local config fetching with shared config store**

In `NewSessionDialog.svelte`, make the following changes:

**Replace config imports** — remove `fetchDefaultAgent`, `fetchDefaultContinue`, `fetchDefaultYolo`, `fetchLaunchInTmux` from the api import. Add:

```typescript
import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';
```

**Add config access** after existing declarations:

```typescript
const config = getConfigState();
```

**Update `open()` function** — replace the agent + config fetch block (lines 152-170) with:

```typescript
await refreshConfig();
selectedAgent = config.defaultAgent as AgentType;
if (options?.agent) selectedAgent = options.agent;

yoloMode = config.defaultYolo;
continueExisting = config.defaultContinue;
useTmux = config.launchInTmux;

if (options?.yolo !== undefined) yoloMode = options.yolo;
if (options?.useTmux !== undefined) useTmux = options.useTmux;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run full tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dialogs/NewSessionDialog.svelte
git commit -m "refactor: wire NewSessionDialog to shared config store"
```

---

## Outcomes & Retrospective

**What worked:**
- Parallel task dispatch: Tasks 1+2 in parallel, then 3+4+5 in parallel — fast execution
- Shared reactive store pattern mirrors existing `sessions.svelte.ts` — zero friction
- Code review caught dead catch block and missing error rollback before merge

**What didn't:**
- Initial plan didn't include error rollback in SettingsDialog handlers — caught by review agents
- Plan's getter/setter proxy in config store was over-engineered — simplifier correctly replaced with direct `$state` object

**Learnings to codify:**
- When writing to shared state from UI controls with two-way binding, always capture previous value before async API call and rollback on failure
- `$state({...})` on a plain object is sufficient for reactive stores in Svelte 5 — manual getter/setter proxies are unnecessary indirection
- Per-promise `.catch()` inside `Promise.all` makes the outer try/catch dead code — pick one strategy
