# Bug Analysis: Settings Not Centralized — Sidebar Clicks Ignore Global/Workspace Settings

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: Frontend session creation, server session endpoints, settings architecture

## Symptoms

1. Clicking a repo root or inactive worktree in the sidebar starts a session **without** respecting global settings (yolo, agent, tmux, continue)
2. Settings dialog labeled "Session Defaults" is actually the **global** settings — confusing naming
3. Workspace settings have no "reset to default" mechanism — once overridden, no way to revert to global defaults
4. Only the "new worktree" button and the new session dialog respect settings; all other session creation paths are broken

## Reproduction Steps

1. Open Settings dialog, enable "YOLO mode"
2. Click on an inactive worktree in the sidebar to resume it
3. Observe: session starts **without** `--dangerously-skip-permissions` — yolo setting ignored
4. Same behavior for clicking repo root entry, or context menu "Resume"

## Root Cause

**No centralized settings resolution.** Settings are resolved at 5+ different points, each with different behavior:

| Session Creation Path | File:Line | Global? | Workspace? | Yolo | Agent | Tmux | Continue |
|---|---|---|---|---|---|---|---|
| Repo root click | `WorkspaceItem.svelte:295-303` | NO | NO | **missing** | server fallback | server fallback | hardcoded true |
| Inactive worktree click | `WorkspaceItem.svelte:331-340` | NO | NO | **missing** | server fallback | server fallback | NO |
| Context menu "Resume" | `WorkspaceItem.svelte:149-159` | NO | NO | **missing** | none | none | NO |
| Context menu "Resume (YOLO)" | `WorkspaceItem.svelte:168-178` | NO | NO | hardcoded true | none | none | NO |
| New worktree button | `App.svelte:361-403` | YES | YES | YES | YES | YES | NO |
| New session dialog | `NewSessionDialog.svelte` | YES only | NO | YES | YES | YES | YES |

**Server-side also fails to resolve**: Both `POST /sessions` (`index.ts:567`) and `POST /sessions/repo` (`index.ts:807`) treat undefined `yolo` as falsy (no yolo args). The server has `getWorkspaceSettings()` in `config.ts:74` that properly merges global+workspace settings, but **neither session endpoint calls it**.

**Workspace settings API returns raw overrides, not merged**: `GET /workspaces/settings` (`workspaces.ts:436`) returns `config.workspaceSettings[path] ?? {}` — the raw per-workspace object, not merged with globals. There's no mechanism to delete an individual override to fall back to global defaults.

## Evidence

### Sidebar click handlers bypass all settings

**Repo root click** (`WorkspaceItem.svelte:299-303`):
```js
const session = await createRepoSession({
  repoPath: workspace.path,
  repoName: workspace.name,
  continue: true,  // hardcoded — always tries --continue
  // NO yolo, NO agent, NO useTmux
});
```

**Inactive worktree click** (`WorkspaceItem.svelte:335-340`):
```js
const session = await createSession({
  repoPath: workspace.path,
  repoName: workspace.name,
  worktreePath: wt.path,
  branchName: wt.branchName || wt.name,
  // NO yolo, NO agent, NO useTmux, NO continue
});
```

### Server treats undefined yolo as false

**POST /sessions** (`index.ts:594-596`):
```ts
const baseArgs = [
  ...(config.claudeArgs || []),
  ...(yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),  // undefined → falsy → no yolo args
```

Server uses `config.defaultAgent` and `config.launchInTmux` as partial fallbacks for agent/tmux, but NOT for yolo or continue.

### Only handleNewWorktree does proper resolution

**App.svelte:370-379** — the ONLY path that merges global + workspace:
```ts
let yolo = configState.defaultYolo;
let agent: string = configState.defaultAgent;
let useTmux = configState.launchInTmux;
const ws = await fetchWorkspaceSettings(workspace.path);
if (ws.defaultYolo !== undefined) yolo = ws.defaultYolo;
if (ws.defaultAgent) agent = ws.defaultAgent;
if (ws.launchInTmux !== undefined) useTmux = ws.launchInTmux;
```

This logic is duplicated client-side instead of being handled by the server.

### Workspace settings GET returns raw values

**workspaces.ts:436**: `config.workspaceSettings?.[resolved] ?? {}` — returns empty object if no overrides, not merged with globals. No way to "reset to default" because deleting a key requires custom logic not exposed in the API.

## Impact Assessment

- **Users who enable yolo mode globally** get inconsistent behavior — new worktree respects it, sidebar clicks don't
- **Workspace-level settings** are effectively broken for all sidebar-initiated sessions except "new worktree"
- **DRY violation** creates maintenance risk — any new session creation path will likely forget to resolve settings
- **No reset-to-default** means workspace overrides are sticky with no clear way to revert

## Recommended Fix Direction

### 1. Server-side settings resolution (primary fix)

Move settings resolution to the server. When `POST /sessions` or `POST /sessions/repo` receive `undefined` for yolo/agent/useTmux/continue, the server should call `getWorkspaceSettings(config, repoPath)` to fill defaults. This makes all client-side session creation paths automatically correct.

**Key design decision**: Distinguish `undefined` (use server defaults) from `false` (explicitly disabled). The request body already supports this — JSON doesn't send `undefined` keys.

### 2. New endpoint: `GET /sessions/resolved-settings?repoPath=...`

Expose the merged settings for a workspace so the frontend can display effective values (e.g., in workspace settings dialog showing "inherited from global").

### 3. Workspace settings reset

Extend `PATCH /workspaces/settings` to accept `null` values to delete individual overrides:
```json
{ "defaultYolo": null }  // removes override, falls back to global
```

### 4. UI changes

- Rename "Session Defaults" to "Global Defaults" in SettingsDialog
- Workspace settings dialog: show effective values with "overridden" indicators
- Add "Reset to Default" button per setting and/or "Reset All" button
- Remove "Resume (YOLO)" context menu item — yolo should come from settings, not a special menu entry

### 5. Clean up frontend DRY

After server resolves settings, remove the manual merging in `handleNewWorktree` (App.svelte:370-379) — just send `repoPath` and let the server do the rest.
