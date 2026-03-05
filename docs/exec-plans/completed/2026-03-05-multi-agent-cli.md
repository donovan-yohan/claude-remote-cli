# Multi-Agent CLI Support Implementation Plan

> **Status**: Completed | **Created**: 2026-03-05 | **Completed**: 2026-03-05
> **Design Doc**: `docs/design-docs/2026-03-05-multi-agent-cli-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to choose between Claude and Codex as the underlying coding agent per session, with a configurable default.

**Architecture:** Add `AgentType = 'claude' | 'codex'` union type. Backend maps abstract concepts (yolo, continue) to agent-specific CLI flags. Frontend exposes agent select in Settings (default) and New Session dialog (per-session override). Config persists `defaultAgent` alongside existing fields.

**Tech Stack:** TypeScript, Express, Svelte 5, node-pty

---

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-05 | Design | Two fixed agents (claude/codex), not extensible | YAGNI — only two agents needed now |
| 2026-03-05 | Design | Agent choice replaces command only, args still apply | Simpler, user manages arg compatibility |
| 2026-03-05 | Design | Map continue to `codex resume --last` | Closest equivalent for Codex session resume |

## Progress

- [x] Task 1: Add AgentType to shared types _(completed 2026-03-05)_
- [x] Task 2: Add agent-aware command/flag mapping to sessions module _(completed 2026-03-05)_
- [x] Task 3: Wire agent parameter through API endpoints _(completed 2026-03-05)_
- [x] Task 4: Add defaultAgent config persistence endpoints _(completed 2026-03-05)_
- [x] Task 5: Add agent select to frontend types and API client _(completed 2026-03-05)_
- [x] Task 6: Add agent select to Settings dialog _(completed 2026-03-05)_
- [x] Task 7: Add agent select to New Session dialog _(completed 2026-03-05)_
- [x] Task 8: Add agent logo badges to session list items _(completed 2026-03-05)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

| Task | Plan said | Actually happened | Why |
|------|-----------|-------------------|-----|
| Task 1 | Only modify types.ts, config.ts, config.test.ts | Also updated sessions.ts to include `agent` field in Session construction, list(), and create return | TypeScript compilation required `agent` on all Session/SessionSummary objects |

---

### Task 1: Add AgentType to shared types

**Files:**
- Modify: `server/types.ts:3` (add AgentType, add `agent` to Session)
- Modify: `server/config.ts:6-13` (add defaultAgent to DEFAULTS)
- Test: `test/config.test.ts`

**Step 1: Add AgentType and update Session and Config interfaces**

In `server/types.ts`, add the type and new fields:

```typescript
export type AgentType = 'claude' | 'codex';
```

Add `agent: AgentType` to the `Session` interface (after `type`):

```typescript
export interface Session {
  id: string;
  type: SessionType;
  agent: AgentType;
  // ... rest unchanged
}
```

Add `defaultAgent: AgentType` to the `Config` interface (after `claudeArgs`):

```typescript
export interface Config {
  // ... existing fields ...
  claudeArgs: string[];
  defaultAgent: AgentType;
  pinHash?: string | undefined;
  rootDirs?: string[] | undefined;
}
```

**Step 2: Add defaultAgent to config DEFAULTS**

In `server/config.ts`, add to DEFAULTS:

```typescript
export const DEFAULTS: Omit<Config, 'pinHash' | 'rootDirs'> = {
  host: '0.0.0.0',
  port: 3456,
  cookieTTL: '24h',
  repos: [],
  claudeCommand: 'claude',
  claudeArgs: [],
  defaultAgent: 'claude',
};
```

**Step 3: Update config test to verify new default**

In `test/config.test.ts`, update the DEFAULTS test:

```typescript
test('DEFAULTS has expected keys and values', () => {
  // ... existing assertions ...
  assert.equal(DEFAULTS.defaultAgent, 'claude');
});
```

Also update `loadConfig merges with defaults for missing fields` test:

```typescript
assert.equal(config.defaultAgent, DEFAULTS.defaultAgent);
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add server/types.ts server/config.ts test/config.test.ts
git commit -m "feat: add AgentType to shared types and config defaults"
```

---

### Task 2: Add agent-aware command/flag mapping to sessions module

**Files:**
- Modify: `server/sessions.ts:9-25` (add agent to CreateParams, add mapping constants)
- Modify: `server/sessions.ts:40-155` (use agent in create, update retry logic)
- Test: `test/sessions.test.ts`

**Step 1: Add agent mapping constants and update CreateParams**

At the top of `server/sessions.ts` (after imports), add:

```typescript
import type { Session, SessionType, AgentType } from './types.js';

const AGENT_COMMANDS: Record<AgentType, string> = {
  claude: 'claude',
  codex: 'codex',
};

const AGENT_YOLO_ARGS: Record<AgentType, string[]> = {
  claude: ['--dangerously-skip-permissions'],
  codex: ['--full-auto'],
};

const AGENT_CONTINUE_ARGS: Record<AgentType, string[]> = {
  claude: ['--continue'],
  codex: ['resume', '--last'],
};
```

Update `CreateParams` — replace `command: string` with `agent: AgentType`:

```typescript
type CreateParams = {
  type?: SessionType;
  agent?: AgentType;
  repoName?: string;
  repoPath: string;
  cwd?: string;
  root?: string;
  worktreeName?: string;
  branchName?: string;
  displayName?: string;
  command?: string;  // Keep as optional override, falls back to AGENT_COMMANDS[agent]
  args?: string[];
  cols?: number;
  rows?: number;
  configPath?: string;
};
```

**Step 2: Update the create function to use agent**

In the `create` function body, resolve the command from agent:

```typescript
function create({ type, agent = 'claude', repoName, repoPath, cwd, root, worktreeName, branchName, displayName, command, args = [], cols = 80, rows = 24, configPath }: CreateParams): CreateResult {
  const resolvedCommand = command || AGENT_COMMANDS[agent];
  // ... use resolvedCommand instead of command in pty.spawn calls
```

Update the session object to include `agent`:

```typescript
const session: Session = {
  id,
  type: type || 'worktree',
  agent,
  // ... rest unchanged
};
```

**Step 3: Update retry logic for agent-aware continue stripping**

In `attachHandlers`, update the retry logic (line ~126-127) to strip agent-specific continue args instead of just `'--continue'`:

```typescript
const continueArgs = AGENT_CONTINUE_ARGS[agent];
const canRetrySession = continueArgs.some(a => args.includes(a));

// Inside attachHandlers:
if (canRetry && (Date.now() - spawnTime) < 3000 && exitCode !== 0) {
  const retryArgs = args.filter(a => !continueArgs.includes(a));
  // ... rest of retry logic uses resolvedCommand
```

Update `attachHandlers` call at the bottom:

```typescript
attachHandlers(ptyProcess, continueArgs.some(a => args.includes(a)));
```

**Step 4: Update list() and CreateResult to include agent**

Update `SessionSummary` type alias and list() to include agent:

```typescript
type SessionSummary = Omit<Session, 'pty' | 'scrollback'>;
```

This already works since Session now has `agent`. The `list()` function destructures from session — add `agent` to the destructure:

```typescript
function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, type, agent, root, repoName, repoPath, worktreeName, branchName, displayName, createdAt, lastActivity, idle }) => ({
      id,
      type,
      agent,
      root,
      // ... rest unchanged
```

Also add `agent` to the return value of `create`:

```typescript
return { id, type: session.type, agent: session.agent, root: session.root, ... };
```

**Step 5: Export the mapping constants for use in index.ts**

```typescript
export { create, get, list, kill, resize, updateDisplayName, write, onIdleChange, findRepoSession, AGENT_COMMANDS, AGENT_YOLO_ARGS, AGENT_CONTINUE_ARGS };
```

**Step 6: Update session tests**

Add to `test/sessions.test.ts`:

```typescript
it('agent defaults to claude when not specified', () => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(result.id);
  assert.strictEqual(result.agent, 'claude');
});

it('agent is set when specified', () => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    agent: 'codex',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(result.id);
  assert.strictEqual(result.agent, 'codex');
});

it('list includes agent field', () => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    agent: 'codex',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(result.id);
  const list = sessions.list();
  const session = list.find(s => s.id === result.id);
  assert.ok(session);
  assert.strictEqual(session.agent, 'codex');
});
```

**Step 7: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add server/sessions.ts test/sessions.test.ts
git commit -m "feat: add agent-aware command/flag mapping to sessions"
```

---

### Task 3: Wire agent parameter through API endpoints

**Files:**
- Modify: `server/index.ts:603-823` (accept `agent` in POST /sessions and POST /sessions/repo, use agent-aware args)

**Step 1: Update POST /sessions endpoint**

In `server/index.ts`, update the request body destructure (~line 605):

```typescript
const { repoPath, repoName, worktreePath, branchName, claudeArgs, agent } = req.body as {
  repoPath?: string;
  repoName?: string;
  worktreePath?: string;
  branchName?: string;
  claudeArgs?: string[];
  agent?: AgentType;
};
```

Import `AgentType` from types and `AGENT_COMMANDS, AGENT_CONTINUE_ARGS` from sessions.

Resolve agent early:

```typescript
const resolvedAgent: AgentType = agent || config.defaultAgent || 'claude';
```

Replace all `config.claudeCommand` references with `AGENT_COMMANDS[resolvedAgent]`.

Replace all hardcoded `'--continue'` in args arrays with `...AGENT_CONTINUE_ARGS[resolvedAgent]`:

- Line 632: `args = ['--continue', ...baseArgs]` → `args = [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs]`
- Line 709: same pattern
- Line 806 (repo endpoint): same pattern

Pass `agent: resolvedAgent` to all `sessions.create()` calls.

**Step 2: Update POST /sessions/repo endpoint**

Same pattern — destructure `agent`, resolve it, replace `config.claudeCommand` and `'--continue'`.

```typescript
const { repoPath, repoName, continue: continueSession, claudeArgs, agent } = req.body as {
  repoPath?: string;
  repoName?: string;
  continue?: boolean;
  claudeArgs?: string[];
  agent?: AgentType;
};

const resolvedAgent: AgentType = agent || config.defaultAgent || 'claude';
const args = continueSession
  ? [...AGENT_CONTINUE_ARGS[resolvedAgent], ...baseArgs]
  : [...baseArgs];

const session = sessions.create({
  type: 'repo',
  agent: resolvedAgent,
  repoName: name,
  repoPath,
  cwd: repoPath,
  root,
  displayName: name,
  args,
});
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: wire agent parameter through session API endpoints"
```

---

### Task 4: Add defaultAgent config persistence endpoints

**Files:**
- Modify: `server/index.ts` (add GET /config/defaultAgent and PATCH /config/defaultAgent)

**Step 1: Add GET /config/defaultAgent endpoint**

Add after the `/roots` endpoints block:

```typescript
// GET /config/defaultAgent — get default coding agent
app.get('/config/defaultAgent', requireAuth, (_req, res) => {
  res.json({ defaultAgent: config.defaultAgent || 'claude' });
});
```

**Step 2: Add PATCH /config/defaultAgent endpoint**

```typescript
// PATCH /config/defaultAgent — set default coding agent
app.patch('/config/defaultAgent', requireAuth, (req, res) => {
  const { defaultAgent } = req.body as { defaultAgent?: string };
  if (!defaultAgent || (defaultAgent !== 'claude' && defaultAgent !== 'codex')) {
    res.status(400).json({ error: 'defaultAgent must be "claude" or "codex"' });
    return;
  }
  config.defaultAgent = defaultAgent;
  saveConfig(CONFIG_PATH, config);
  res.json({ defaultAgent: config.defaultAgent });
});
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add defaultAgent config persistence endpoints"
```

---

### Task 5: Add agent select to frontend types and API client

**Files:**
- Modify: `frontend/src/lib/types.ts:1-13` (add agent to SessionSummary)
- Modify: `frontend/src/lib/api.ts:64-99,125-143` (add agent param, add config API functions)

**Step 1: Update frontend SessionSummary type**

In `frontend/src/lib/types.ts`, add `agent` field:

```typescript
export type AgentType = 'claude' | 'codex';

export interface SessionSummary {
  id: string;
  type: 'repo' | 'worktree';
  agent: AgentType;
  // ... rest unchanged
}
```

**Step 2: Add agent param to createSession and createRepoSession**

In `frontend/src/lib/api.ts`, update both function signatures:

```typescript
export async function createSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  worktreePath?: string | undefined;
  branchName?: string | undefined;
  claudeArgs?: string[] | undefined;
  agent?: string | undefined;
}): Promise<SessionSummary> {
```

```typescript
export async function createRepoSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  continue?: boolean | undefined;
  claudeArgs?: string[] | undefined;
  agent?: string | undefined;
}): Promise<SessionSummary> {
```

**Step 3: Add defaultAgent API functions**

```typescript
export async function fetchDefaultAgent(): Promise<string> {
  const data = await json<{ defaultAgent: string }>(await fetch('/config/defaultAgent'));
  return data.defaultAgent;
}

export async function setDefaultAgent(agent: string): Promise<void> {
  const res = await fetch('/config/defaultAgent', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultAgent: agent }),
  });
  if (!res.ok) throw new Error('Failed to update default agent');
}
```

**Step 4: Build frontend**

Run: `npm run build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat: add agent type and API functions to frontend"
```

---

### Task 6: Add agent select to Settings dialog

**Files:**
- Modify: `frontend/src/components/dialogs/SettingsDialog.svelte`

**Step 1: Add imports and state**

Add to imports:

```typescript
import { fetchDefaultAgent, setDefaultAgent } from '../../lib/api.js';
```

Add state variable:

```typescript
let selectedAgent = $state('claude');
```

**Step 2: Load default agent on open**

Update the `open()` function to load the current default:

```typescript
export async function open() {
  error = '';
  newRootPath = '';
  devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
  await loadRoots();
  try {
    selectedAgent = await fetchDefaultAgent();
  } catch {
    selectedAgent = 'claude';
  }
  dialogEl.showModal();
}
```

**Step 3: Add handler for agent change**

```typescript
async function handleAgentChange() {
  error = '';
  try {
    await setDefaultAgent(selectedAgent);
  } catch {
    error = 'Failed to update default agent.';
  }
}
```

**Step 4: Add UI section**

Add between the Root Directories section and Developer Tools section:

```svelte
<!-- Default coding agent section -->
<section class="settings-section">
  <h3 class="section-title">Default Coding Agent</h3>
  <p class="section-desc">CLI used when creating new sessions.</p>
  <select
    class="agent-select"
    bind:value={selectedAgent}
    onchange={handleAgentChange}
  >
    <option value="claude">Claude</option>
    <option value="codex">Codex</option>
  </select>
</section>
```

**Step 5: Add styles**

```css
.agent-select {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.9rem;
  padding: 7px 10px;
  width: 100%;
  box-sizing: border-box;
}
```

**Step 6: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 7: Commit**

```bash
git add frontend/src/components/dialogs/SettingsDialog.svelte
git commit -m "feat: add default coding agent select to Settings dialog"
```

---

### Task 7: Add agent select to New Session dialog

**Files:**
- Modify: `frontend/src/components/dialogs/NewSessionDialog.svelte`

**Step 1: Add imports and state**

Add to imports:

```typescript
import { fetchBranches, createSession, createRepoSession, fetchRepos, fetchDefaultAgent } from '../../lib/api.js';
import type { RepoInfo, AgentType } from '../../lib/types.js';
```

Add state:

```typescript
let selectedAgent = $state<AgentType>('claude');
```

**Step 2: Load default agent on open**

In the `open()` function, after loading repos:

```typescript
try {
  selectedAgent = await fetchDefaultAgent() as AgentType;
} catch {
  selectedAgent = 'claude';
}
```

**Step 3: Update reset to include agent**

```typescript
function reset() {
  // ... existing resets ...
  // Don't reset selectedAgent — it's loaded from server config in open()
}
```

**Step 4: Update handleSubmit for agent-aware arg mapping**

Replace the hardcoded yolo arg with agent-aware mapping:

```typescript
async function handleSubmit() {
  const repoPath = selectedRepoPath;
  if (!repoPath) return;

  const claudeArgs: string[] = [];
  if (yoloMode) {
    const yoloArgs: Record<AgentType, string> = {
      claude: '--dangerously-skip-permissions',
      codex: '--full-auto',
    };
    claudeArgs.push(yoloArgs[selectedAgent]);
  }
  if (claudeArgsInput.trim()) {
    claudeArgsInput.trim().split(/\s+/).forEach(arg => {
      if (arg) claudeArgs.push(arg);
    });
  }

  try {
    let session;
    if (activeTab === 'repos') {
      session = await createRepoSession({
        repoPath,
        repoName: repoPath.split('/').filter(Boolean).pop(),
        continue: continueExisting,
        claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
        agent: selectedAgent,
      });
    } else {
      session = await createSession({
        repoPath,
        repoName: repoPath.split('/').filter(Boolean).pop(),
        branchName: branchInput.trim() || undefined,
        claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
        agent: selectedAgent,
      });
    }
    // ... rest unchanged
```

**Step 5: Add agent select UI**

Add after the Repo select field (before the branch input), so it appears for both tabs:

```svelte
<!-- Coding agent select -->
<div class="dialog-field">
  <label class="dialog-label" for="ns-agent">Coding agent</label>
  <select
    id="ns-agent"
    class="dialog-select"
    bind:value={selectedAgent}
  >
    <option value="claude">Claude</option>
    <option value="codex">Codex</option>
  </select>
</div>
```

**Step 6: Update the extra args label to be agent-generic**

Change label from "Extra claude args" to "Extra args":

```svelte
<label class="dialog-label" for="ns-args">Extra args (optional)</label>
```

Update placeholder similarly:

```svelte
placeholder="e.g. --model claude-3-5-sonnet"
```

Keep the placeholder as-is (it's just an example) or make it generic:

```svelte
placeholder="e.g. --verbose"
```

**Step 7: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 8: Commit**

```bash
git add frontend/src/components/dialogs/NewSessionDialog.svelte
git commit -m "feat: add coding agent select to New Session dialog"
```

---

### Task 8: Add agent logo badges to session list items

**Files:**
- Create: `frontend/src/components/AgentBadge.svelte`
- Modify: `frontend/src/components/SessionItem.svelte:138-144` (add badge next to status dot)

**Step 1: Create AgentBadge component**

Create `frontend/src/components/AgentBadge.svelte` with inline SVG icons for Claude (sparkle symbol) and Codex (OpenAI knot):

```svelte
<script lang="ts">
  import type { AgentType } from '../lib/types.js';

  let { agent }: { agent: AgentType } = $props();
</script>

{#if agent === 'claude'}
  <svg class="agent-badge" viewBox="0 0 512 509.64" xmlns="http://www.w3.org/2000/svg" aria-label="Claude">
    <path fill="currentColor" fill-rule="nonzero" d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"/>
  </svg>
{:else}
  <svg class="agent-badge" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Codex">
    <path fill="currentColor" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
  </svg>
{/if}

<style>
  .agent-badge {
    width: 10px;
    height: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
</style>
```

**Step 2: Add badge to SessionItem**

In `frontend/src/components/SessionItem.svelte`, import the component:

```typescript
import AgentBadge from './AgentBadge.svelte';
```

Add a derived for the agent value:

```typescript
let agentType = $derived(variant.kind === 'active' ? variant.session.agent : undefined);
```

In the template, add the badge below the status dot in `session-row-1` (after `<span class={statusDotClass}></span>`):

```svelte
<div class="session-row-1">
  <div class="status-stack">
    <span class={statusDotClass}></span>
    {#if agentType}
      <AgentBadge agent={agentType} />
    {/if}
  </div>
  <span class="session-name" use:scrollOnHover>
    <span class="session-name-text">{displayName}</span>
  </span>
</div>
```

**Step 3: Add styles for the status stack**

```css
.status-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add frontend/src/components/AgentBadge.svelte frontend/src/components/SessionItem.svelte
git commit -m "feat: add agent logo badges to session list items"
```

---

## Outcomes & Retrospective

**What worked:**
- Agent flag mapping via `Record<AgentType, string[]>` kept the abstraction clean and easy to extend
- Parallel task execution (Tasks 2+4, then 6+7+8) cut wall-clock time significantly
- TypeScript caught Session construction issues early (Task 1 drift)

**What didn't:**
- SVG icon sourcing was painful — multiple CDNs returned 404/403/429 before finding working direct URLs
- Task 1 scope was too narrow — plan didn't account for TypeScript requiring `agent` on all Session object constructions

**Learnings to codify:**
- When adding a required field to a core interface, plan for all construction sites in the same task
- For inline SVG icons, prefer direct file URLs over CDN endpoints which may rate-limit or block
