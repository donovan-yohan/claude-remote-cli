# Start Work Flow + Ticket Status Transitions — Implementation Plan

> **Status**: Completed | **Created**: 2026-03-21 | **Last Updated**: 2026-03-21
> **Design Doc**: `docs/design-docs/2026-03-21-org-dashboard-phase3-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-21 | Design | Prompt injection via `onStateChange` + `pty.write()` on first `waiting-for-input` | More robust than CLI flags — works across all agents (Claude, Codex), no flag validation needed |
| 2026-03-21 | Design | Label-based GitHub transitions (hardcoded label names) | Phase 3 scope; StatusMappingModal deferred to Phase 4 |
| 2026-03-21 | Design | In-memory idempotency map for transitions | No persistence needed — transitions only fire during active server lifetime |
| 2026-03-21 | Design | Repo auto-select uses issue's `repoPath` directly | GitHub Issues already carry `repoName`/`repoPath` from Phase 2, no prefix matching needed |
| 2026-03-21 | Review | StartWorkModal uses POST /sessions with branchName only (no separate createWorktree) | Server's POST /sessions already handles worktree creation + existing-branch redirect (409). Avoids double-creating. |
| 2026-03-21 | Review | Use `ticketContext.repoPath` for workspace settings lookup | `repoPath` in session is the worktree dir, not workspace root — settings are keyed by workspace root |
| 2026-03-21 | Review | getBranchLinks callback for org-dashboard PR transitions | checkPrTransitions needs real branch links, not empty object — self-call to branch-linker endpoint |
| 2026-03-21 | Review | Removed `{description}` from default promptStartWork template | GitHubIssue type doesn't include body field — `gh issue list --json` doesn't return it |

## Progress

- [x] Task 1: Add ticket context types (server + frontend)
- [x] Task 2: Create ticket-transitions server module
- [x] Task 3: Add initial prompt injection to session lifecycle
- [x] Task 4: Handle ticketContext in POST /sessions route
- [x] Task 5: Create StartWorkModal frontend component
- [x] Task 6: Wire TicketCard → StartWorkModal and transitions into org-dashboard
- [x] Task 7: Tests for ticket-transitions (329/329 pass)

## Surprises & Discoveries

- `exactOptionalPropertyTypes` requires `string | undefined` not just `string` for optional fields
- Svelte 5 `$derived` is read-only — cannot be used with `bind:value`
- Loopback HTTP to self requires auth cookies; internal function call is better
- `fireStateChange` iterates `stateChangeCallbacks` array — splicing during iteration can skip entries

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/types.ts` | Modify | Add `TicketContext`, `TransitionState`, `promptStartWork` to `WorkspaceSettings` |
| `server/ticket-transitions.ts` | Create | Transition engine: label add/remove via `gh issue edit`, idempotency guard |
| `server/sessions.ts` | Modify | Add `initialPrompt` field, inject on first `waiting-for-input` |
| `server/index.ts` | Modify | Accept `ticketContext` in POST /sessions, wire transition callbacks |
| `server/org-dashboard.ts` | Modify | Call `checkPrTransitions()` after PR fetch |
| `frontend/src/lib/types.ts` | Modify | Add `TicketContext`, `promptStartWork` to `WorkspaceSettings` |
| `frontend/src/lib/api.ts` | Modify | Add `ticketContext` to `createSession` params |
| `frontend/src/components/StartWorkModal.svelte` | Create | Repo picker, branch name input, start action |
| `frontend/src/components/TicketCard.svelte` | Modify | Enable "Start Work" button, open modal |
| `frontend/src/components/TicketsPanel.svelte` | Modify | Pass `onStartWork` callback through to TicketCard |
| `test/ticket-transitions.test.ts` | Create | Unit tests for transition engine |

---

### Task 1: Add ticket context types (server + frontend)

**Files:**
- Modify: `server/types.ts`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add server types**

In `server/types.ts`, add after the `BranchLinksResponse` type (line ~225):

```typescript
export interface TicketContext {
  ticketId: string;
  title: string;
  description?: string;
  url: string;
  source: 'github';
  repoPath: string;
  repoName: string;
}

export type TransitionState = 'none' | 'in-progress' | 'code-review' | 'ready-for-qa';
```

Add `promptStartWork` to `WorkspaceSettings` interface (after `promptFixConflicts`):

```typescript
  promptStartWork?: string;
```

- [ ] **Step 2: Add frontend types**

In `frontend/src/lib/types.ts`, add after `BranchLinksResponse` (line ~118):

```typescript
export interface TicketContext {
  ticketId: string;
  title: string;
  description?: string;
  url: string;
  source: 'github';
  repoPath: string;
  repoName: string;
}
```

Add `promptStartWork` to `WorkspaceSettings` interface:

```typescript
  promptStartWork?: string;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add server/types.ts frontend/src/lib/types.ts
git commit -m "feat(types): add TicketContext, TransitionState, and promptStartWork types"
```

---

### Task 2: Create ticket-transitions server module

**Files:**
- Create: `server/ticket-transitions.ts`
- Create: `test/ticket-transitions.test.ts`

- [ ] **Step 1: Write failing tests for ticket-transitions**

Create `test/ticket-transitions.test.ts`:

```typescript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import type { Server } from 'node:http';

import { createTicketTransitionsRouter, type TicketTransitionsDeps } from '../server/ticket-transitions.js';
import type { TicketContext } from '../server/types.js';

type MockExec = (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>;

let tmpDir: string;
let server: Server;
let baseUrl: string;

function makeApp(execMock: MockExec) {
  const app = express();
  app.use(express.json());
  const deps: TicketTransitionsDeps = {
    execAsync: execMock as TicketTransitionsDeps['execAsync'],
  };
  const { router, transitionOnSessionCreate, checkPrTransitions } = createTicketTransitionsRouter(deps);
  app.use('/ticket-transitions', router);
  return { app, transitionOnSessionCreate, checkPrTransitions };
}

function listen(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-transitions-test-'));
});

after(() => {
  if (server) server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('transitionOnSessionCreate', () => {
  test('adds in-progress label to GitHub issue', async () => {
    const calls: Array<{ args: unknown[] }> = [];
    const execMock: MockExec = async (...args) => {
      calls.push({ args });
      return { stdout: '', stderr: '' };
    };
    const { transitionOnSessionCreate } = makeApp(execMock);

    const ctx: TicketContext = {
      ticketId: 'GH-42',
      title: 'Fix bug',
      url: 'https://github.com/owner/repo/issues/42',
      source: 'github',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };
    await transitionOnSessionCreate(ctx);

    // Should call gh issue edit to add label
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    const cmdArgs = call.args[1] as string[];
    assert.ok(cmdArgs.includes('issue'));
    assert.ok(cmdArgs.includes('edit'));
    assert.ok(cmdArgs.includes('42'));
    assert.ok(cmdArgs.includes('--add-label'));
    assert.ok(cmdArgs.includes('in-progress'));
  });

  test('is idempotent — does not re-fire same transition', async () => {
    const calls: Array<{ args: unknown[] }> = [];
    const execMock: MockExec = async (...args) => {
      calls.push({ args });
      return { stdout: '', stderr: '' };
    };
    const { transitionOnSessionCreate } = makeApp(execMock);

    const ctx: TicketContext = {
      ticketId: 'GH-99',
      title: 'Another bug',
      url: 'https://github.com/owner/repo/issues/99',
      source: 'github',
      repoPath: '/fake/repo',
      repoName: 'repo',
    };
    await transitionOnSessionCreate(ctx);
    await transitionOnSessionCreate(ctx);

    // Only 1 call — second was deduplicated
    assert.equal(calls.length, 1);
  });
});

describe('checkPrTransitions', () => {
  test('adds code-review label when PR is OPEN for a linked ticket', async () => {
    const calls: Array<{ args: unknown[] }> = [];
    const execMock: MockExec = async (...args) => {
      calls.push({ args });
      return { stdout: '', stderr: '' };
    };
    const { checkPrTransitions } = makeApp(execMock);

    const prs = [{
      number: 10,
      headRefName: 'gh-42-fix-bug',
      state: 'OPEN' as const,
      repoPath: '/fake/repo',
    }];
    const branchLinks = {
      'GH-42': [{ repoPath: '/fake/repo', repoName: 'repo', branchName: 'gh-42-fix-bug', hasActiveSession: false }],
    };

    await checkPrTransitions(prs, branchLinks);

    assert.ok(calls.length >= 1);
    const labelCall = calls.find(c => {
      const args = c.args[1] as string[];
      return args.includes('--add-label') && args.includes('code-review');
    });
    assert.ok(labelCall, 'Should add code-review label');
  });

  test('adds ready-for-qa label when PR is MERGED for a linked ticket', async () => {
    const calls: Array<{ args: unknown[] }> = [];
    const execMock: MockExec = async (...args) => {
      calls.push({ args });
      return { stdout: '', stderr: '' };
    };
    const { checkPrTransitions } = makeApp(execMock);

    const prs = [{
      number: 10,
      headRefName: 'gh-42-fix-bug',
      state: 'MERGED' as const,
      repoPath: '/fake/repo',
    }];
    const branchLinks = {
      'GH-42': [{ repoPath: '/fake/repo', repoName: 'repo', branchName: 'gh-42-fix-bug', hasActiveSession: false }],
    };

    await checkPrTransitions(prs, branchLinks);

    const labelCall = calls.find(c => {
      const args = c.args[1] as string[];
      return args.includes('--add-label') && args.includes('ready-for-qa');
    });
    assert.ok(labelCall, 'Should add ready-for-qa label');
  });

  test('is idempotent for PR transitions', async () => {
    const calls: Array<{ args: unknown[] }> = [];
    const execMock: MockExec = async (...args) => {
      calls.push({ args });
      return { stdout: '', stderr: '' };
    };
    const { checkPrTransitions } = makeApp(execMock);

    const prs = [{
      number: 10,
      headRefName: 'gh-55-feature',
      state: 'OPEN' as const,
      repoPath: '/fake/repo',
    }];
    const branchLinks = {
      'GH-55': [{ repoPath: '/fake/repo', repoName: 'repo', branchName: 'gh-55-feature', hasActiveSession: false }],
    };

    await checkPrTransitions(prs, branchLinks);
    const firstCount = calls.length;
    await checkPrTransitions(prs, branchLinks);

    // No new calls on second invocation
    assert.equal(calls.length, firstCount);
  });

  test('handles gh CLI errors gracefully', async () => {
    const execMock: MockExec = async () => {
      throw new Error('gh not found');
    };
    const { checkPrTransitions } = makeApp(execMock);

    const prs = [{
      number: 10,
      headRefName: 'gh-42-fix-bug',
      state: 'OPEN' as const,
      repoPath: '/fake/repo',
    }];
    const branchLinks = {
      'GH-42': [{ repoPath: '/fake/repo', repoName: 'repo', branchName: 'gh-42-fix-bug', hasActiveSession: false }],
    };

    // Should not throw
    await checkPrTransitions(prs, branchLinks);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "ticket-transitions"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ticket-transitions.ts**

Create `server/ticket-transitions.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Router } from 'express';

import type { TicketContext, TransitionState, BranchLink } from './types.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 10_000;

export interface TicketTransitionsDeps {
  execAsync?: typeof execFileAsync;
}

// Minimal PR shape needed for transition checks
interface PrForTransition {
  number: number;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  repoPath?: string | undefined;
}

// In-memory idempotency guard: ticketId -> last transitioned state
const transitionMap = new Map<string, TransitionState>();

/**
 * Extracts the issue number from a GH-style ticket ID (e.g. "GH-42" -> "42").
 */
function ghIssueNumber(ticketId: string): string | null {
  const match = ticketId.match(/^GH-(\d+)$/i);
  return match ? match[1]! : null;
}

/**
 * Adds a label to a GitHub issue via gh CLI.
 * Errors are caught and logged — transitions are best-effort.
 */
async function addLabel(
  exec: typeof execFileAsync,
  repoPath: string,
  issueNumber: string,
  label: string,
): Promise<void> {
  try {
    await exec('gh', ['issue', 'edit', issueNumber, '--add-label', label], {
      cwd: repoPath,
      timeout: GH_TIMEOUT_MS,
    });
  } catch (err) {
    console.error(`[ticket-transitions] Failed to add label "${label}" to #${issueNumber}:`, err);
  }
}

/**
 * Removes a label from a GitHub issue via gh CLI.
 */
async function removeLabel(
  exec: typeof execFileAsync,
  repoPath: string,
  issueNumber: string,
  label: string,
): Promise<void> {
  try {
    await exec('gh', ['issue', 'edit', issueNumber, '--remove-label', label], {
      cwd: repoPath,
      timeout: GH_TIMEOUT_MS,
    });
  } catch {
    // Label may not exist — non-fatal
  }
}

export function createTicketTransitionsRouter(deps: TicketTransitionsDeps) {
  const exec = deps.execAsync ?? execFileAsync;
  const router = Router();

  /**
   * Transition a ticket to "in-progress" when a worktree/session is created.
   * Idempotent — will not re-fire if already in "in-progress" or later state.
   */
  async function transitionOnSessionCreate(ctx: TicketContext): Promise<void> {
    const current = transitionMap.get(ctx.ticketId);
    if (current && current !== 'none') return; // Already transitioned

    transitionMap.set(ctx.ticketId, 'in-progress');

    if (ctx.source === 'github') {
      const issueNum = ghIssueNumber(ctx.ticketId);
      if (!issueNum) return;
      await addLabel(exec, ctx.repoPath, issueNum, 'in-progress');
    }
  }

  /**
   * Check PRs against branch links and transition tickets:
   * - PR OPEN → "code-review" label
   * - PR MERGED → "ready-for-qa" label
   * Idempotent per ticket per state.
   */
  async function checkPrTransitions(
    prs: PrForTransition[],
    branchLinks: Record<string, BranchLink[]>,
  ): Promise<void> {
    for (const pr of prs) {
      // Find which ticket this PR's branch is linked to
      for (const [ticketId, links] of Object.entries(branchLinks)) {
        const linked = links.some((l) => l.branchName === pr.headRefName);
        if (!linked) continue;

        const current = transitionMap.get(ticketId);

        if (pr.state === 'OPEN' && current !== 'code-review' && current !== 'ready-for-qa') {
          transitionMap.set(ticketId, 'code-review');

          if (ticketId.startsWith('GH-')) {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'in-progress');
            await addLabel(exec, repoPath, issueNum, 'code-review');
          }
        } else if (pr.state === 'MERGED' && current !== 'ready-for-qa') {
          transitionMap.set(ticketId, 'ready-for-qa');

          if (ticketId.startsWith('GH-')) {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'code-review');
            await addLabel(exec, repoPath, issueNum, 'ready-for-qa');
          }
        }
      }
    }
  }

  return { router, transitionOnSessionCreate, checkPrTransitions };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npm test -- --test-name-pattern "ticket-transitions"`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/ticket-transitions.ts test/ticket-transitions.test.ts
git commit -m "feat: add ticket-transitions module with idempotent label-based status transitions"
```

---

### Task 3: Add initial prompt injection to session lifecycle

**Files:**
- Modify: `server/types.ts` (add `initialPrompt` to `PtySession`)
- Modify: `server/sessions.ts` (accept `initialPrompt`, inject on first `waiting-for-input`)

- [ ] **Step 1: Add initialPrompt field to PtySession**

In `server/types.ts`, add to the `PtySession` interface (after `branchRenamePrompt?`):

```typescript
  initialPrompt?: string;
```

- [ ] **Step 2: Add initialPrompt handling in sessions.ts**

In `server/sessions.ts`, modify the `CreateParams` type to include `initialPrompt`:

```typescript
type CreateParams = Omit<CreatePtyParams, 'id'> & {
  id?: string;
  needsBranchRename?: boolean;
  branchRenamePrompt?: string;
  initialPrompt?: string;
};
```

In the `create()` function, after `branchRenamePrompt` handling (around line 143), add:

```typescript
  if (initialPrompt) {
    ptySession.initialPrompt = initialPrompt;
  }
```

In `server/sessions.ts`, add a one-shot initial prompt injection by registering a state change listener inside `create()`. After the `fireSessionCreate` call (line 145), add:

```typescript
  if (initialPrompt) {
    const promptHandler = (changedId: string, state: AgentState) => {
      if (changedId === id && state === 'waiting-for-input' && ptySession.initialPrompt) {
        const prompt = ptySession.initialPrompt;
        ptySession.initialPrompt = undefined; // one-shot
        // Small delay to ensure the agent's input handler is ready
        setTimeout(() => {
          try { ptySession.pty.write(prompt + '\n'); }
          catch (err) { console.error('[sessions] Failed to inject initial prompt:', err); }
        }, 500);
        // Remove this handler after firing
        const idx = stateChangeCallbacks.indexOf(promptHandler);
        if (idx !== -1) stateChangeCallbacks.splice(idx, 1);
      }
    };
    stateChangeCallbacks.push(promptHandler);
  }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add server/types.ts server/sessions.ts
git commit -m "feat: add initial prompt injection via PTY on first waiting-for-input state"
```

---

### Task 4: Handle ticketContext in POST /sessions route

**Files:**
- Modify: `server/index.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Import ticket-transitions in server/index.ts**

Add to imports at top of `server/index.ts`:

```typescript
import { createTicketTransitionsRouter } from './ticket-transitions.js';
```

In the `startServer()` function, after the branch-linker router creation, create the ticket transitions instance:

```typescript
  const { router: ticketTransitionsRouter, transitionOnSessionCreate, checkPrTransitions } = createTicketTransitionsRouter({});
  app.use('/ticket-transitions', requireAuth, ticketTransitionsRouter);
```

- [ ] **Step 2: Accept ticketContext in POST /sessions body**

In the POST /sessions handler (line ~631), add `ticketContext` to the destructured body:

```typescript
  const { repoPath, repoName, worktreePath, branchName, claudeArgs, yolo, agent, useTmux, cols, rows, needsBranchRename, branchRenamePrompt, ticketContext } = req.body as {
    // ... existing fields ...
    ticketContext?: { ticketId: string; title: string; description?: string; url: string; source: 'github'; repoPath: string; repoName: string };
  };
```

- [ ] **Step 3: Build initial prompt from ticketContext + workspace promptStartWork template**

After `resolveSessionSettings` (line ~654), add prompt assembly:

```typescript
  let initialPrompt: string | undefined;
  if (ticketContext) {
    // Use ticketContext.repoPath (workspace root) for settings lookup, not the
    // resolved worktree repoPath which points to .worktrees/<name>
    const settings = config.workspaceSettings?.[ticketContext.repoPath];
    const template = settings?.promptStartWork ??
      'You are working on ticket {ticketId}: {title}\n\nTicket URL: {ticketUrl}\n\nPlease start by understanding the issue and proposing an approach.';
    initialPrompt = template
      .replace(/\{ticketId\}/g, ticketContext.ticketId)
      .replace(/\{title\}/g, ticketContext.title)
      .replace(/\{ticketUrl\}/g, ticketContext.url);
  }
```

> **Note:** `{description}` is removed from the default template because `GitHubIssue` does not carry the issue body. The `gh issue list --json` output used in Phase 2 does not include `body`. Users can add `{description}` to their custom `promptStartWork` template if they extend the API later.

- [ ] **Step 4: Pass initialPrompt to session creation calls**

In every `sessions.create()` call within the POST /sessions handler, add `initialPrompt` to the params object. There are multiple call sites:

1. The main worktree session creation at the bottom (~line 837): add `initialPrompt,` to the params
2. The existing-worktree session creation (~line 789): add `initialPrompt,`
3. The repo session fallback (~line 764): add `initialPrompt,`

- [ ] **Step 5: Fire transition on session create with ticketContext**

After the `res.status(201).json(session)` at the end of POST /sessions (line ~865), add (but before the return):

```typescript
    if (ticketContext) {
      transitionOnSessionCreate(ticketContext).catch((err) => {
        console.error('[index] transition on session create failed:', err);
      });
    }
```

Do the same for the other session creation return paths inside POST /sessions.

- [ ] **Step 6: Add ticketContext to frontend API createSession params**

In `frontend/src/lib/api.ts`, add `ticketContext` to the `createSession` body type:

```typescript
export async function createSession(body: {
  repoPath: string;
  // ... existing fields ...
  ticketContext?: {
    ticketId: string;
    title: string;
    description?: string;
    url: string;
    source: 'github';
    repoPath: string;
    repoName: string;
  };
}): Promise<SessionSummary> {
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add server/index.ts frontend/src/lib/api.ts
git commit -m "feat: accept ticketContext in session creation, build initial prompt, fire transitions"
```

---

### Task 5: Create StartWorkModal frontend component

**Files:**
- Create: `frontend/src/components/StartWorkModal.svelte`

- [ ] **Step 1: Create StartWorkModal.svelte**

Create `frontend/src/components/StartWorkModal.svelte` — a modal that shows ticket info, lets user confirm repo (auto-selected from issue), pick branch name, and launch a worktree session with ticket context injected:

```svelte
<script lang="ts">
  import type { GitHubIssue } from '../lib/types.js';
  import { createSession, ConflictError } from '../lib/api.js';

  let {
    issue,
    open = false,
    onClose,
    onSessionCreated,
  }: {
    issue: GitHubIssue;
    open: boolean;
    onClose: () => void;
    onSessionCreated: (sessionId: string) => void;
  } = $props();

  let branchName = $state(`gh-${issue.number}`);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function handleStart() {
    if (loading) return;
    loading = true;
    error = null;

    try {
      // POST /sessions with branchName — server handles worktree creation
      // (git worktree add -b <branch>) and existing-branch redirect internally.
      // Do NOT call createWorktree separately — the session endpoint owns
      // the full worktree lifecycle including branch-exists detection.
      const session = await createSession({
        repoPath: issue.repoPath,
        repoName: issue.repoName,
        branchName,
        ticketContext: {
          ticketId: `GH-${issue.number}`,
          title: issue.title,
          url: issue.url,
          source: 'github',
          repoPath: issue.repoPath,
          repoName: issue.repoName,
        },
      });

      onSessionCreated(session.id);
      onClose();
    } catch (err) {
      if (err instanceof ConflictError) {
        // Branch already exists with an active session — open it directly
        onSessionCreated(err.sessionId);
        onClose();
        return;
      }
      error = err instanceof Error ? err.message : 'Failed to start work';
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !loading) handleStart();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onkeydown={handleKeydown} onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick|stopPropagation>
      <div class="modal-header">
        <span class="modal-title">Start Work</span>
        <button class="modal-close" onclick={onClose}>&times;</button>
      </div>

      <div class="modal-body">
        <div class="ticket-info">
          <span class="ticket-info-label">Ticket</span>
          <span class="ticket-info-value">#{issue.number} — {issue.title}</span>
        </div>

        <div class="ticket-info">
          <span class="ticket-info-label">Repo</span>
          <span class="ticket-info-value">{issue.repoName}</span>
        </div>

        <div class="field">
          <label class="field-label" for="branch-name">Branch Name</label>
          <input
            id="branch-name"
            class="field-input"
            type="text"
            bind:value={branchName}
            placeholder="gh-{issue.number}"
          />
        </div>

        {#if error}
          <div class="error-msg">{error}</div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={onClose} disabled={loading}>Cancel</button>
        <button class="btn btn-primary" onclick={handleStart} disabled={loading}>
          {#if loading}Starting...{:else}Start Work{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 90%;
    max-width: 420px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .modal-title {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .modal-close:hover {
    color: var(--text);
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ticket-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ticket-info-label {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .ticket-info-value {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field-input {
    padding: 8px 10px;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    outline: none;
    transition: border-color 0.12s;
  }

  .field-input:focus {
    border-color: var(--accent);
  }

  .error-msg {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--status-error);
    padding: 6px 8px;
    background: rgba(255, 100, 100, 0.1);
    border-radius: 4px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 7px 16px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: none;
    color: var(--text-muted);
  }

  .btn-secondary:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .btn-primary {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
    font-weight: 600;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
</style>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StartWorkModal.svelte
git commit -m "feat: add StartWorkModal component for ticket-driven worktree creation"
```

---

### Task 6: Wire TicketCard → StartWorkModal and transitions into org-dashboard

**Files:**
- Modify: `frontend/src/components/TicketCard.svelte`
- Modify: `frontend/src/components/TicketsPanel.svelte`
- Modify: `frontend/src/components/OrgDashboard.svelte`
- Modify: `server/org-dashboard.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Update TicketCard to emit start-work event**

In `frontend/src/components/TicketCard.svelte`, add an `onStartWork` callback prop:

```typescript
  let { issue, branchLinks = [], onStartWork }: {
    issue: GitHubIssue;
    branchLinks?: BranchLink[];
    onStartWork?: (issue: GitHubIssue) => void;
  } = $props();
```

Replace the disabled Start Work button with an enabled one:

```svelte
  <div class="ticket-actions">
    <button
      class="start-work-btn"
      class:start-work-btn--active={!!onStartWork}
      onclick={() => onStartWork?.(issue)}
      disabled={!onStartWork}
    >
      Start Work
    </button>
  </div>
```

Update styles — replace the `.start-work-btn` block:

```css
  .start-work-btn {
    padding: 5px 12px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: not-allowed;
    opacity: 0.45;
    white-space: nowrap;
    transition: border-color 0.12s, color 0.12s, opacity 0.12s;
  }

  .start-work-btn--active {
    cursor: pointer;
    opacity: 1;
  }

  .start-work-btn--active:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
```

- [ ] **Step 2: Update TicketsPanel to pass onStartWork through**

In `frontend/src/components/TicketsPanel.svelte`, add the `onStartWork` prop:

```typescript
  import type { GitHubIssue } from '../lib/types.js';

  let { onStartWork }: { onStartWork?: (issue: GitHubIssue) => void } = $props();
```

Pass it through to TicketCard:

```svelte
  <TicketCard {issue} branchLinks={getBranchLinksForIssue(issue.number)} {onStartWork} />
```

- [ ] **Step 3: Update OrgDashboard to manage StartWorkModal state**

In `frontend/src/components/OrgDashboard.svelte`, add imports and state:

```typescript
  import type { GitHubIssue } from '../lib/types.js';
  import StartWorkModal from './StartWorkModal.svelte';

  let { onOpenWorkspace, onOpenSession }: {
    onOpenWorkspace: (path: string) => void;
    onOpenSession?: (sessionId: string) => void;
  } = $props();

  let startWorkIssue = $state<GitHubIssue | null>(null);
```

Pass `onStartWork` to TicketsPanel:

```svelte
  {:else if activeTab === 'tickets'}
    <TicketsPanel onStartWork={(issue) => { startWorkIssue = issue; }} />
```

Add the modal at the bottom of the template (before closing `</div>`):

```svelte
  {#if startWorkIssue}
    <StartWorkModal
      issue={startWorkIssue}
      open={true}
      onClose={() => { startWorkIssue = null; }}
      onSessionCreated={(id) => { startWorkIssue = null; onOpenSession?.(id); }}
    />
  {/if}
```

- [ ] **Step 4: Wire checkPrTransitions in org-dashboard.ts with real branch links**

In `server/org-dashboard.ts`, add a `getBranchLinks` callback to deps so the router can fetch current branch links when checking transitions:

```typescript
import type { Config, PullRequest, PullRequestsResponse, BranchLink } from './types.js';

export interface OrgDashboardDeps {
  configPath: string;
  execAsync?: typeof execFileAsync;
  checkPrTransitions?: (
    prs: Array<{ number: number; headRefName: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; repoPath?: string }>,
    branchLinks: Record<string, BranchLink[]>,
  ) => Promise<void>;
  getBranchLinks?: () => Promise<Record<string, BranchLink[]>>;
}
```

At the end of the GET /prs handler, after `cache = { prs, fetchedAt: now }` and before the final `res.json`, add:

```typescript
    // Fire ticket transitions check (best-effort, don't block response)
    if (deps.checkPrTransitions && deps.getBranchLinks) {
      deps.getBranchLinks()
        .then((links) => deps.checkPrTransitions!(prs, links))
        .catch(() => {});
    }
```

- [ ] **Step 5: Wire transitions in server/index.ts with getBranchLinks**

In `server/index.ts`, create a `getBranchLinks` helper that calls the branch-linker endpoint internally. The branch-linker module already exposes a router with GET /links. Rather than HTTP-calling our own server, extract the link-building logic:

```typescript
  // Create a function to fetch current branch links for transition checks
  async function getCurrentBranchLinks(): Promise<Record<string, import('./types.js').BranchLink[]>> {
    try {
      const res = await fetch(`http://127.0.0.1:${config.port}/branch-linker/links`);
      if (!res.ok) return {};
      return await res.json() as Record<string, import('./types.js').BranchLink[]>;
    } catch {
      return {};
    }
  }
```

> **Note:** Self-calling the HTTP endpoint is the simplest wiring approach since the branch-linker logic lives behind its router. An alternative is to refactor `createBranchLinkerRouter` to export the link-building function directly — but that's a refactor beyond Phase 3 scope.

Update the org-dashboard router creation in index.ts:

```typescript
  app.use('/org-dashboard', requireAuth, createOrgDashboardRouter({
    configPath: CONFIG_PATH,
    checkPrTransitions,
    getBranchLinks: getCurrentBranchLinks,
  }));
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/TicketCard.svelte frontend/src/components/TicketsPanel.svelte frontend/src/components/OrgDashboard.svelte frontend/src/components/StartWorkModal.svelte server/org-dashboard.ts server/index.ts
git commit -m "feat: wire Start Work flow from TicketCard through modal to session creation with transitions"
```

---

### Task 7: Tests for full integration

**Files:**
- Modify: `test/ticket-transitions.test.ts` (already created in Task 2)

- [ ] **Step 1: Add test for prompt template substitution**

The prompt template logic lives in server/index.ts POST /sessions handler. Add a focused unit test or verify via build + existing test suite that the template substitution works correctly by examining the code path.

Since the POST /sessions handler is tested via integration tests that require PTY spawning (not feasible in unit tests), verify correctness through build + manual testing.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass (including the new ticket-transitions tests from Task 2)

- [ ] **Step 3: Verify build end-to-end**

Run: `npm run build && npm test`
Expected: 0 TypeScript errors, all tests pass

- [ ] **Step 4: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "test: verify full integration of start-work flow and ticket transitions"
```

---

## Outcomes & Retrospective

**What worked:**
- Plan review caught 3 critical runtime bugs before implementation (createWorktree flow, loopback auth, settings lookup key)
- Parallel agent dispatching for tasks 2+3 and 4+5+6 cut wall-clock time significantly
- Svelte autofixer caught $derived/$state mismatch and missing {#each} keys
- TDD approach: tests existed before implementation, caught issues early

**What didn't:**
- Loopback HTTP approach for internal function calls — a clear anti-pattern; should extract functions directly
- `exactOptionalPropertyTypes` caused multiple rounds of type fixes — need to account for it in plans

**Learnings to codify:**
- When one module needs to call another's logic internally, export the function directly — never self-call via HTTP (auth, latency, failure modes)
- Svelte 5 `$derived` is read-only; use `$state` for values that need `bind:value`
- Always use `string | undefined` (not just `string`) for optional props when `exactOptionalPropertyTypes: true`
- Iterate over `[...array]` when callbacks may self-remove during iteration
