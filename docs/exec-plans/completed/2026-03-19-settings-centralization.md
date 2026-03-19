# Settings Centralization Implementation Plan

> **Status**: Complete | **Created**: 2026-03-19 | **Last Updated**: 2026-03-19
> **Bug Analysis**: `docs/bug-analyses/2026-03-19-settings-centralization-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-19 | Design | Server-side settings resolution over client-side | Single resolution point eliminates DRY violation; all session creation paths auto-correct |
| 2026-03-19 | Design | Distinguish undefined (use defaults) from false (explicit) via JSON semantics | JSON.stringify omits undefined keys; server checks `key in body` to detect explicit values |
| 2026-03-19 | Design | Use null in PATCH to delete workspace overrides | Standard REST pattern; cleaner than separate DELETE endpoint per key |
| 2026-03-19 | Design | Keep "Resume (YOLO)" context menu as explicit override | Users may want a one-off yolo session without changing their default settings |

## Progress

- [x] Task 1: Add `resolveSessionSettings()` to server/config.ts + tests
- [x] Task 2: Wire resolution into POST /sessions and POST /sessions/repo
- [x] Task 3: Extend workspace settings API for reset-to-default (null values)
- [x] Task 4: Simplify frontend sidebar click handlers
- [x] Task 5: Rename "Session Defaults" to "Global Defaults" in SettingsDialog
- [x] Task 6: Workspace settings dialog — show effective values + reset button

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Add `resolveSessionSettings()` to server/config.ts + tests

**Goal:** Create a single function that resolves session settings by merging global config + workspace overrides, with explicit client overrides taking precedence.

**Files:**
- Modify: `server/config.ts`
- Modify: `test/config.test.ts`

#### Interface

```typescript
export interface ResolvedSessionSettings {
  agent: AgentType;
  yolo: boolean;
  continue: boolean;
  useTmux: boolean;
  claudeArgs: string[];
}

export interface SessionSettingsOverrides {
  agent?: AgentType;
  yolo?: boolean;
  continue?: boolean;
  useTmux?: boolean;
  claudeArgs?: string[];
}

export function resolveSessionSettings(
  config: Config,
  repoPath: string,
  overrides: SessionSettingsOverrides,
): ResolvedSessionSettings;
```

- [ ] **Step 1: Write failing tests for `resolveSessionSettings`**

Add to `test/config.test.ts`:

```typescript
import { resolveSessionSettings } from '../server/config.js';

test('resolveSessionSettings returns global defaults when no workspace or overrides', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    defaultAgent: 'claude',
    defaultContinue: true,
    defaultYolo: false,
    launchInTmux: false,
    claudeArgs: [],
  }), 'utf8');
  const config = loadConfig(configPath);
  const result = resolveSessionSettings(config, '/some/repo', {});
  assert.equal(result.agent, 'claude');
  assert.equal(result.yolo, false);
  assert.equal(result.continue, true);
  assert.equal(result.useTmux, false);
  assert.deepEqual(result.claudeArgs, []);
});

test('resolveSessionSettings applies workspace overrides over globals', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    defaultAgent: 'claude',
    defaultYolo: false,
    defaultContinue: true,
    launchInTmux: false,
    claudeArgs: [],
    workspaceSettings: {
      '/my/repo': { defaultYolo: true, defaultAgent: 'codex' },
    },
  }), 'utf8');
  const config = loadConfig(configPath);
  const result = resolveSessionSettings(config, '/my/repo', {});
  assert.equal(result.agent, 'codex');
  assert.equal(result.yolo, true);
  assert.equal(result.continue, true); // inherited from global
});

test('resolveSessionSettings explicit overrides beat workspace settings', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    defaultAgent: 'claude',
    defaultYolo: true,
    defaultContinue: true,
    launchInTmux: false,
    claudeArgs: [],
    workspaceSettings: {
      '/my/repo': { defaultYolo: true },
    },
  }), 'utf8');
  const config = loadConfig(configPath);
  const result = resolveSessionSettings(config, '/my/repo', { yolo: false });
  assert.equal(result.yolo, false); // explicit false beats workspace true
});

test('resolveSessionSettings uses override claudeArgs, not global', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    defaultAgent: 'claude',
    defaultYolo: false,
    defaultContinue: true,
    launchInTmux: false,
    claudeArgs: ['--global-arg'],
  }), 'utf8');
  const config = loadConfig(configPath);
  const result = resolveSessionSettings(config, '/some/repo', { claudeArgs: ['--custom'] });
  assert.deepEqual(result.claudeArgs, ['--custom']); // override replaces, not appends
});

test('resolveSessionSettings falls through to globals when no workspace exists', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    defaultAgent: 'codex',
    defaultYolo: true,
    defaultContinue: false,
    launchInTmux: true,
    claudeArgs: ['--verbose'],
  }), 'utf8');
  const config = loadConfig(configPath);
  const result = resolveSessionSettings(config, '/nonexistent/repo', {});
  assert.equal(result.agent, 'codex');
  assert.equal(result.yolo, true);
  assert.equal(result.continue, false);
  assert.equal(result.useTmux, true);
  assert.deepEqual(result.claudeArgs, ['--verbose']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `resolveSessionSettings` is not exported from config.ts

- [ ] **Step 3: Implement `resolveSessionSettings` in server/config.ts**

Add after `getWorkspaceSettings`:

```typescript
export interface ResolvedSessionSettings {
  agent: AgentType;
  yolo: boolean;
  continue: boolean;
  useTmux: boolean;
  claudeArgs: string[];
}

export interface SessionSettingsOverrides {
  agent?: AgentType;
  yolo?: boolean;
  continue?: boolean;
  useTmux?: boolean;
  claudeArgs?: string[];
}

export function resolveSessionSettings(
  config: Config,
  repoPath: string,
  overrides: SessionSettingsOverrides,
): ResolvedSessionSettings {
  const ws = getWorkspaceSettings(config, repoPath);
  return {
    agent: overrides.agent ?? ws.defaultAgent ?? config.defaultAgent ?? 'claude',
    yolo: overrides.yolo ?? ws.defaultYolo ?? config.defaultYolo ?? false,
    continue: overrides.continue ?? ws.defaultContinue ?? config.defaultContinue ?? true,
    useTmux: overrides.useTmux ?? ws.launchInTmux ?? config.launchInTmux ?? false,
    claudeArgs: overrides.claudeArgs ?? ws.claudeArgs ?? config.claudeArgs ?? [],
  };
}
```

Note: `getWorkspaceSettings` already merges global+workspace, so we could just use it directly. But `overrides` (from client request) take highest precedence. The resolution order is: explicit client override > workspace setting > global config > hardcoded default.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/config.ts test/config.test.ts
git commit -m "feat: add resolveSessionSettings() for centralized settings resolution"
```

---

### Task 2: Wire resolution into POST /sessions and POST /sessions/repo

**Goal:** Both session creation endpoints use `resolveSessionSettings()` instead of inline resolution. When clients omit settings, the server fills them from global + workspace config.

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Update POST /sessions endpoint**

In `server/index.ts`, add import:
```typescript
import { resolveSessionSettings } from './config.js';
```

Replace the existing resolution logic in POST /sessions (around line 592-598):

```typescript
// Before (lines 592-598):
const resolvedAgent: AgentType = agent || config.defaultAgent || 'claude';
const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
const baseArgs = [
  ...(config.claudeArgs || []),
  ...(yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
  ...(claudeArgs || []),
];

// After:
const resolved = resolveSessionSettings(config, repoPath, {
  agent,
  yolo,
  useTmux,
  claudeArgs,
});
const resolvedAgent = resolved.agent;
const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
const baseArgs = [
  ...(resolved.claudeArgs),
  ...(resolved.yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
];
```

Also update the `useTmux` reference later in the session creation:
```typescript
// Before:
useTmux: useTmux ?? config.launchInTmux,
// After:
useTmux: resolved.useTmux,
```

- [ ] **Step 2: Update POST /sessions/repo endpoint**

Apply the same pattern to POST /sessions/repo (around line 824-838):

```typescript
// Before:
const resolvedAgent: AgentType = agent || config.defaultAgent || 'claude';
const baseArgs = [
  ...(config.claudeArgs || []),
  ...(yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
  ...(claudeArgs || []),
];
const args = continueSession ? [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs] : [...baseArgs];

// After:
const resolved = resolveSessionSettings(config, repoPath, {
  agent,
  yolo,
  continue: continueSession,
  useTmux,
  claudeArgs,
});
const resolvedAgent = resolved.agent;
const baseArgs = [
  ...(resolved.claudeArgs),
  ...(resolved.yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
];
const args = resolved.continue ? [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs] : [...baseArgs];
```

And update the `useTmux` reference:
```typescript
useTmux: resolved.useTmux,
```

- [ ] **Step 3: Build and verify**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: session endpoints use resolveSessionSettings for centralized defaults"
```

---

### Task 3: Extend workspace settings API for reset-to-default (null values)

**Goal:** Allow `PATCH /workspaces/settings` to accept `null` to delete individual overrides, and add a `?merged=true` query param to `GET /workspaces/settings` that returns merged values with override indicators.

**Files:**
- Modify: `server/workspaces.ts`
- Modify: `server/config.ts` (add `deleteWorkspaceSettingKeys`)

- [ ] **Step 1: Add `deleteWorkspaceSettingKeys` to server/config.ts**

```typescript
export function deleteWorkspaceSettingKeys(
  configPath: string,
  config: Config,
  workspacePath: string,
  keys: string[],
): void {
  if (!config.workspaceSettings?.[workspacePath]) return;
  for (const key of keys) {
    delete (config.workspaceSettings[workspacePath] as Record<string, unknown>)[key];
  }
  // Clean up empty workspace entries
  if (Object.keys(config.workspaceSettings[workspacePath]!).length === 0) {
    delete config.workspaceSettings[workspacePath];
  }
  saveConfig(configPath, config);
}
```

- [ ] **Step 1b: Add tests for `deleteWorkspaceSettingKeys`**

Add to `test/config.test.ts`:

```typescript
import { deleteWorkspaceSettingKeys } from '../server/config.js';

test('deleteWorkspaceSettingKeys removes specified keys', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const config = {
    ...DEFAULTS,
    workspaceSettings: {
      '/my/repo': { defaultYolo: true, defaultAgent: 'codex' as const, branchPrefix: 'dy/' },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  deleteWorkspaceSettingKeys(configPath, config, '/my/repo', ['defaultYolo', 'defaultAgent']);
  assert.equal(config.workspaceSettings!['/my/repo']!.defaultYolo, undefined);
  assert.equal(config.workspaceSettings!['/my/repo']!.defaultAgent, undefined);
  assert.equal(config.workspaceSettings!['/my/repo']!.branchPrefix, 'dy/');
});

test('deleteWorkspaceSettingKeys removes entire workspace entry when empty', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const config = {
    ...DEFAULTS,
    workspaceSettings: {
      '/my/repo': { defaultYolo: true },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  deleteWorkspaceSettingKeys(configPath, config, '/my/repo', ['defaultYolo']);
  assert.equal(config.workspaceSettings!['/my/repo'], undefined);
});

test('deleteWorkspaceSettingKeys is no-op for nonexistent workspace', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const config = { ...DEFAULTS };
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  assert.doesNotThrow(() => deleteWorkspaceSettingKeys(configPath, config, '/no/such/repo', ['defaultYolo']));
});
```

- [ ] **Step 2: Add `deleteWorkspaceSettingKeys` to the import in workspaces.ts**

In `server/workspaces.ts`, update the import (line 10):

```typescript
// Before:
import { loadConfig, saveConfig, getWorkspaceSettings, setWorkspaceSettings } from './config.js';
// After:
import { loadConfig, saveConfig, getWorkspaceSettings, setWorkspaceSettings, deleteWorkspaceSettingKeys } from './config.js';
```

- [ ] **Step 3: Update PATCH /workspaces/settings to handle null values**

In `server/workspaces.ts`, update the PATCH handler (around line 444):

```typescript
router.patch('/settings', async (req: Request, res: Response) => {
  const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;
  if (!workspacePath) {
    res.status(400).json({ error: 'path query parameter is required' });
    return;
  }

  const resolved = path.resolve(workspacePath);
  const updates = req.body as Record<string, unknown>;

  const config = getConfig();

  // Separate null values (deletions) from actual updates
  const keysToDelete: string[] = [];
  const keysToUpdate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      keysToDelete.push(key);
    } else {
      keysToUpdate[key] = value;
    }
  }

  // Apply deletions
  if (keysToDelete.length > 0) {
    deleteWorkspaceSettingKeys(configPath, config, resolved, keysToDelete);
  }

  // Apply updates
  if (Object.keys(keysToUpdate).length > 0) {
    const current: WorkspaceSettings = config.workspaceSettings?.[resolved] ?? {};
    const merged: WorkspaceSettings = { ...current, ...keysToUpdate as Partial<WorkspaceSettings> };
    config.workspaceSettings = { ...config.workspaceSettings, [resolved]: merged };
    saveConfig(configPath, config);
  }

  // Return the current effective settings
  const final = config.workspaceSettings?.[resolved] ?? {};
  res.json(final);
});
```

- [ ] **Step 3: Add merged query param to GET /workspaces/settings**

Update the GET handler (around line 426):

```typescript
router.get('/settings', async (req: Request, res: Response) => {
  const workspacePath = typeof req.query.path === 'string' ? req.query.path : undefined;
  const merged = req.query.merged === 'true';

  if (!workspacePath) {
    res.status(400).json({ error: 'path query parameter is required' });
    return;
  }

  const config = getConfig();
  const resolved = path.resolve(workspacePath);

  if (merged) {
    // Return merged settings (global + workspace) with override indicators
    const globalDefaults = {
      defaultAgent: config.defaultAgent,
      defaultContinue: config.defaultContinue,
      defaultYolo: config.defaultYolo,
      launchInTmux: config.launchInTmux,
    };
    const wsOverrides = config.workspaceSettings?.[resolved] ?? {};
    const effective = getWorkspaceSettings(config, resolved);
    const overridden: string[] = [];
    for (const key of ['defaultAgent', 'defaultContinue', 'defaultYolo', 'launchInTmux'] as const) {
      if (wsOverrides[key] !== undefined) overridden.push(key);
    }
    res.json({ settings: effective, overridden });
  } else {
    const settings: WorkspaceSettings = config.workspaceSettings?.[resolved] ?? {};
    res.json(settings);
  }
});
```

- [ ] **Step 4: Build and verify**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/config.ts server/workspaces.ts
git commit -m "feat: workspace settings API supports null for reset-to-default and merged query"
```

---

### Task 4: Simplify frontend sidebar click handlers

**Goal:** Sidebar click handlers no longer need to resolve settings client-side — the server handles it. Remove the manual settings merging from `handleNewWorktree` and stop hardcoding/omitting settings in WorkspaceItem click handlers.

**Files:**
- Modify: `frontend/src/components/WorkspaceItem.svelte`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Simplify WorkspaceItem repo root click**

In `WorkspaceItem.svelte`, the repo root click handler (around line 299) currently passes only `continue: true`. Remove the hardcode — let server resolve from settings:

```typescript
// Before:
const session = await createRepoSession({
  repoPath: workspace.path,
  repoName: workspace.name,
  continue: true,
});

// After:
const session = await createRepoSession({
  repoPath: workspace.path,
  repoName: workspace.name,
});
```

The server will now resolve `continue`, `yolo`, `agent`, and `useTmux` from global + workspace settings.

- [ ] **Step 2: Context menu "Resume" already works correctly**

The "Resume" context menu item (line 149) passes no settings — this is now correct because the server will resolve defaults. No change needed.

The "Resume (YOLO)" context menu item (line 168) explicitly passes `yolo: true` — this is correct behavior (explicit override). No change needed.

- [ ] **Step 3: Simplify handleNewWorktree in App.svelte**

Remove the manual settings resolution (lines 370-379) since the server now handles it:

```typescript
// Before:
let yolo = configState.defaultYolo;
let agent: string = configState.defaultAgent;
let useTmux = configState.launchInTmux;
try {
  const ws = await fetchWorkspaceSettings(workspace.path);
  if (ws.defaultYolo !== undefined) yolo = ws.defaultYolo;
  if (ws.defaultAgent) agent = ws.defaultAgent;
  if (ws.launchInTmux !== undefined) useTmux = ws.launchInTmux;
} catch { /* use global defaults */ }

const { branchName, worktreePath } = await createWorktree(workspace.path);
const session = await createSession({
  repoPath: workspace.path,
  repoName: workspace.name,
  worktreePath,
  branchName,
  yolo,
  agent,
  useTmux,
  needsBranchRename: true,
});

// After:
const { branchName, worktreePath } = await createWorktree(workspace.path);
const session = await createSession({
  repoPath: workspace.path,
  repoName: workspace.name,
  worktreePath,
  branchName,
  needsBranchRename: true,
});
```

- [ ] **Step 4: Build frontend and verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WorkspaceItem.svelte frontend/src/App.svelte
git commit -m "fix: sidebar click handlers delegate settings resolution to server"
```

---

### Task 5: Rename "Session Defaults" to "Global Defaults" in SettingsDialog

**Goal:** The global settings dialog correctly labels its section as "Global Defaults" since these are the defaults for all workspaces, not per-session settings.

**Files:**
- Modify: `frontend/src/components/dialogs/SettingsDialog.svelte`

- [ ] **Step 1: Update the section title and description**

```svelte
<!-- Before: -->
<h3 class="section-title">Session Defaults</h3>
<p class="section-desc">Default options for new sessions. Override per-session via Customize.</p>

<!-- After: -->
<h3 class="section-title">Global Defaults</h3>
<p class="section-desc">Default options for all workspaces. Override per-workspace in workspace settings.</p>
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dialogs/SettingsDialog.svelte
git commit -m "fix: rename 'Session Defaults' to 'Global Defaults' in settings dialog"
```

---

### Task 6: Workspace settings dialog — show effective values + reset button

**Goal:** The workspace settings dialog shows the effective (merged) value for each setting, indicates which are overridden from global, and provides a "Reset to Defaults" button.

**Files:**
- Modify: `frontend/src/lib/api.ts` — add `fetchMergedWorkspaceSettings`
- Modify: `frontend/src/components/dialogs/WorkspaceSettingsDialog.svelte`

- [ ] **Step 1: Add fetchMergedWorkspaceSettings to api.ts**

```typescript
export interface MergedWorkspaceSettings {
  settings: WorkspaceSettings;
  overridden: string[];
}

export async function fetchMergedWorkspaceSettings(workspacePath: string): Promise<MergedWorkspaceSettings> {
  return json<MergedWorkspaceSettings>(
    await fetch('/workspaces/settings?merged=true&path=' + encodeURIComponent(workspacePath))
  );
}
```

- [ ] **Step 2: Update WorkspaceSettingsDialog to track overrides**

Add state tracking for overrides and original values:

```typescript
let overriddenKeys = $state<string[]>([]);
// Track the original merged values to detect user changes on save
let originalSettings = $state<WorkspaceSettings>({});
```

Update `open()` to fetch merged settings:

```typescript
const [mergedResult, branchList] = await Promise.all([
  fetchMergedWorkspaceSettings(path),
  fetchBranches(path).catch(() => [] as string[]),
]);
branches = branchList;
applySettings(mergedResult.settings);
originalSettings = { ...mergedResult.settings };
overriddenKeys = mergedResult.overridden;
```

Update `handleSave()` to only persist fields that the user actually changed (preventing globals from being promoted to workspace overrides on save-without-change):

```typescript
async function handleSave() {
  saving = true;
  error = '';
  saveSuccess = false;
  try {
    const settings: Record<string, unknown> = {};
    // Only include session default fields if user changed them from the effective value
    if (defaultAgent !== originalSettings.defaultAgent) settings.defaultAgent = defaultAgent;
    if (defaultContinue !== originalSettings.defaultContinue) settings.defaultContinue = defaultContinue;
    if (defaultYolo !== originalSettings.defaultYolo) settings.defaultYolo = defaultYolo;
    if (launchInTmux !== originalSettings.launchInTmux) settings.launchInTmux = launchInTmux;
    // Always include non-boolean fields if they have values
    if (defaultBranch) settings.defaultBranch = defaultBranch;
    if (remote) settings.remote = remote;
    if (branchPrefix) settings.branchPrefix = branchPrefix;
    if (promptCodeReview) settings.promptCodeReview = promptCodeReview;
    if (promptCreatePr) settings.promptCreatePr = promptCreatePr;
    if (promptBranchRename) settings.promptBranchRename = promptBranchRename;
    if (promptGeneral) settings.promptGeneral = promptGeneral;
    if (Object.keys(settings).length > 0) {
      await updateWorkspaceSettings(workspacePath, settings);
    }
    saveSuccess = true;
    setTimeout(() => { saveSuccess = false; }, 2000);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to save settings.';
  } finally {
    saving = false;
  }
}
```

- [ ] **Step 3: Add "Reset to Defaults" button**

Add above the Save button in the footer:

```svelte
{#if overriddenKeys.some(k => ['defaultAgent', 'defaultContinue', 'defaultYolo', 'launchInTmux'].includes(k))}
  <button class="btn btn-ghost" onclick={handleResetSessionDefaults} disabled={saving}>
    Reset to Global
  </button>
{/if}
```

Add handler:

```typescript
async function handleResetSessionDefaults() {
  saving = true;
  error = '';
  try {
    await updateWorkspaceSettings(workspacePath, {
      defaultAgent: null,
      defaultContinue: null,
      defaultYolo: null,
      launchInTmux: null,
    } as unknown as WorkspaceSettings);
    // Re-fetch merged settings to update UI
    const merged = await fetchMergedWorkspaceSettings(workspacePath);
    applySettings(merged.settings);
    overriddenKeys = merged.overridden;
    saveSuccess = true;
    setTimeout(() => { saveSuccess = false; }, 2000);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to reset settings.';
  } finally {
    saving = false;
  }
}
```

- [ ] **Step 4: Add visual indicator for overridden settings**

Add a subtle indicator next to the SESSION DEFAULTS section title when any session defaults are overridden:

```svelte
<h3 class="section-label">
  SESSION DEFAULTS
  {#if overriddenKeys.some(k => ['defaultAgent', 'defaultContinue', 'defaultYolo', 'launchInTmux'].includes(k))}
    <span class="override-badge">overridden</span>
  {/if}
</h3>
```

Add CSS:

```css
.override-badge {
  font-size: 0.68rem;
  font-weight: 400;
  color: var(--accent);
  letter-spacing: 0;
  text-transform: none;
  margin-left: 6px;
}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/dialogs/WorkspaceSettingsDialog.svelte
git commit -m "feat: workspace settings show effective values with override indicator and reset button"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Server-side settings resolution eliminated all DRY violations in one move
- Parallel task execution (Tasks 1+3, then 4+5+6) cut orchestration time
- Plan reviewer caught two real bugs (claudeArgs double-count, save-on-open promoting globals)

**What didn't:**
- `exactOptionalPropertyTypes` caught a type error at edit time — plan should have accounted for this TypeScript strictness

**Learnings to codify:**
- When adding functions that accept request body fields, always use `| undefined` on optional properties for `exactOptionalPropertyTypes` compat
- Server-side default resolution is the right pattern for settings — clients should send only explicit overrides, server fills defaults
