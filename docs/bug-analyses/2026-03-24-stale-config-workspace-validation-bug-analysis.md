# Bug Analysis: Stale In-Memory Config Rejects Newly Added Workspaces

> **Status**: Confirmed | **Date**: 2026-03-24
> **Severity**: High
> **Affected Area**: server/index.ts — POST /sessions workspace validation

## Symptoms
- After adding a new workspace via the UI, attempting to open a session in that workspace returns HTTP 400 with `{"error":"workspacePath is not a configured workspace"}`
- The workspace appears in the sidebar (fetched via `/workspaces` which reads from disk) but session creation fails
- A server restart fixes the issue

## Reproduction Steps
1. Start the server
2. Add a new workspace via the UI (POST /workspaces)
3. Click on the newly added workspace to open a session
4. Observe 400 error: `{"error":"workspacePath is not a configured workspace"}`

## Root Cause

The `config` object in `server/index.ts` is loaded **once at server startup** (line 146) and stored as a mutable `let` variable. It is never reloaded when workspaces change.

The workspace router (`server/workspaces.ts`) correctly reloads config from disk on every request via a `getConfig()` helper (line 113-115). When a workspace is added via `POST /workspaces`, the router saves the updated config to disk (line 172) — but the `config` variable in `index.ts` still references the original startup object.

The `POST /sessions` handler at `index.ts:971` validates `workspacePath` against `config.workspaces`, which is the **stale in-memory copy** that doesn't include any workspaces added after server startup.

**Two separate config access patterns exist in the server:**
1. **Workspace router**: Reloads from disk every request (`getConfig()`) — always fresh
2. **index.ts**: Uses a single in-memory `config` loaded at startup — stale after any workspace mutation

This is a classic stale-state bug caused by two modules accessing the same resource (config file) through different patterns without synchronization.

## Evidence

- `server/index.ts:144-146` — config loaded once: `let config = loadConfig(CONFIG_PATH)`
- `server/index.ts:971-972` — stale check: `const configuredWorkspaces = config.workspaces ?? []`
- `server/workspaces.ts:113-115` — fresh reload: `function getConfig() { return loadConfig(configPath); }`
- `server/workspaces.ts:161-172` — adds to disk config, never touches index.ts's `config`
- No config reload mechanism, no file watcher, no event bus between modules

## Impact Assessment
- **Every newly added workspace is unusable** until server restart
- The workspace appears in the sidebar (fetched from disk) but sessions can't be created
- Also affects `getWorkspacePaths()` callback at line 407, branch watchers at lines 253/279/281, and session restore at line 395 — all read from the stale config
- Removing workspaces has the inverse bug: removed workspaces remain valid for session creation until restart

## Recommended Fix Direction

The `POST /sessions` handler (and other stale config consumers in `index.ts`) should reload the workspace list from disk before validating, consistent with how the workspace router already works. Options:

1. **Minimal fix**: Re-read `config.workspaces` from disk at the point of use in `POST /sessions` (and other stale consumers)
2. **Structural fix**: Replace the `let config` with a `getConfig()` function pattern matching the workspace router, so all config reads in `index.ts` are fresh
3. **Event-driven fix**: Have the workspace router emit an event when workspaces change, and `index.ts` listens to reload its config — most robust but more complex
