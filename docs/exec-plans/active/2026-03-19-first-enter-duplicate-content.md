# Fix: First Enter Duplicates Terminal Content

> **Status**: Active | **Created**: 2026-03-19 | **Last Updated**: 2026-03-19
> **Bug Analysis**: `docs/bug-analyses/2026-03-19-first-enter-duplicate-content-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-19 | Design | Fix all three hypothesized causes defensively | Each fix is small, independent, and correct regardless of which hypothesis is the true root cause |
| 2026-03-19 | Design | No frontend tests (no test infra exists) | Project has server-side tests only; frontend changes verified by build + manual QA |

## Progress

- [x] Task 1: Track pending WebSocket to prevent double connections
- [x] Task 2: Use term.reset() for clean session switching
- [x] Task 3: Pass terminal dimensions through session creation API

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Track pending WebSocket to prevent double connections

**Goal:** If `connectPtySocket` is called while a previous WebSocket is still in `CONNECTING` state, the old socket is NOT closed (because `ptyWs` is null until `onopen`). This results in two WebSocket connections to the same session, both replaying scrollback — causing duplicate content. Fix by tracking the socket immediately on creation.

**Files:**
- Modify: `frontend/src/lib/ws.ts:14,40-75`

- [ ] **Step 1: Add `pendingPtySocket` variable and close logic**

In `frontend/src/lib/ws.ts`, add a `pendingPtySocket` tracking variable alongside `ptyWs`, and update `connectPtySocket` to close any pending socket before creating a new one:

```typescript
// Line 14: after `let ptyWs: WebSocket | null = null;`
let pendingPtySocket: WebSocket | null = null;
```

Replace the `connectPtySocket` function (lines 40-75) with:

```typescript
export function connectPtySocket(
  sessionId: string,
  term: Terminal,
  onResize: () => void,
  onSessionEnd: () => void,
): void {
  if (ptyReconnectTimer) { clearTimeout(ptyReconnectTimer); ptyReconnectTimer = null; }
  ptyReconnectAttempt = 0;

  // Close any socket still in CONNECTING state from a previous call
  if (pendingPtySocket) {
    pendingPtySocket.onopen = null;
    pendingPtySocket.onmessage = null;
    pendingPtySocket.onclose = null;
    pendingPtySocket.onerror = null;
    pendingPtySocket.close();
    pendingPtySocket = null;
  }

  if (ptyWs) { ptyWs.onclose = null; ptyWs.close(); ptyWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  const socket = new WebSocket(url);
  pendingPtySocket = socket;

  socket.onopen = () => {
    pendingPtySocket = null;
    ptyWs = socket;
    ptyReconnectAttempt = 0;
    onResize();
  };

  socket.onmessage = (event) => { term.write(event.data as string); };

  socket.onclose = (event) => {
    // If this socket was superseded, ignore its close event
    if (pendingPtySocket !== socket && ptyWs !== socket) return;
    if (event.code === 1000) {
      term.write('\r\n[Session ended]\r\n');
      ptyWs = null;
      onSessionEnd();
      return;
    }
    ptyWs = null;
    if (ptyReconnectAttempt === 0) term.write('\r\n[Reconnecting...]\r\n');
    scheduleReconnect(sessionId, term, onResize, onSessionEnd);
  };

  socket.onerror = () => {};
}
```

- [ ] **Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/ws.ts
git commit -m "fix: track pending WebSocket to prevent double connections on session switch"
```

---

### Task 2: Use term.reset() for clean session switching

**Goal:** `term.clear()` only clears the normal buffer. If a previous session left the terminal in alternate buffer mode (tmux), residual state leaks into the next session. `term.reset()` resets ALL terminal state — both buffers, all modes — ensuring a clean slate.

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:220`

- [ ] **Step 1: Replace term.clear() with term.reset()**

In `frontend/src/components/Terminal.svelte`, line 220, change:

```typescript
      term.clear();
```

to:

```typescript
      term.reset();
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "fix: use term.reset() instead of clear() to prevent state leaks between sessions"
```

---

### Task 3: Pass terminal dimensions through session creation API

**Goal:** PTY is created at 80x24 (server defaults). Browser terminal has different dimensions. On WebSocket connect, `sendPtyResize()` causes the running app to re-render, producing duplicate output. By passing the actual terminal dimensions when creating the session, the PTY starts at the correct size — no resize needed, no re-render.

**Files:**
- Modify: `frontend/src/lib/api.ts:66-86` — add `cols`/`rows` to `createSession` and `createRepoSession`
- Modify: `frontend/src/components/dialogs/NewSessionDialog.svelte` — pass dimensions from Terminal ref
- Modify: `server/index.ts:700-710,864,927` — extract and forward `cols`/`rows`

- [ ] **Step 1: Add cols/rows to frontend API functions**

In `frontend/src/lib/api.ts`, update the `createSession` function signature (line 66) to accept optional `cols`/`rows`:

```typescript
export async function createSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  worktreePath?: string | undefined;
  branchName?: string | undefined;
  claudeArgs?: string[] | undefined;
  yolo?: boolean | undefined;
  agent?: string | undefined;
  useTmux?: boolean | undefined;
  cols?: number | undefined;
  rows?: number | undefined;
}): Promise<SessionSummary> {
```

Do the same for `createRepoSession` (line 88):

```typescript
export async function createRepoSession(body: {
  repoPath: string;
  repoName?: string | undefined;
  continue?: boolean | undefined;
  claudeArgs?: string[] | undefined;
  yolo?: boolean | undefined;
  agent?: string | undefined;
  useTmux?: boolean | undefined;
  cols?: number | undefined;
  rows?: number | undefined;
}): Promise<SessionSummary> {
```

- [ ] **Step 2: Pass dimensions from NewSessionDialog**

In `frontend/src/components/dialogs/NewSessionDialog.svelte`, the dialog doesn't have access to the terminal's dimensions directly. Instead, use a reasonable default based on the window size. Add before the `createSession` call (around line 215):

```typescript
        // Estimate terminal dimensions from window size
        const estimatedCols = Math.max(80, Math.floor((window.innerWidth - 60) / 8));
        const estimatedRows = Math.max(24, Math.floor((window.innerHeight - 120) / 17));
```

Then pass `cols: estimatedCols, rows: estimatedRows` to both `createSession` and `createRepoSession` calls in the dialog.

- [ ] **Step 3: Extract cols/rows on server POST /sessions**

In `server/index.ts`, update the `POST /sessions` handler (line 701) to extract `cols` and `rows`:

```typescript
    const { repoPath, repoName, worktreePath, branchName, claudeArgs, yolo, agent, useTmux, cols, rows } = req.body as {
      repoPath?: string;
      repoName?: string;
      worktreePath?: string;
      branchName?: string;
      claudeArgs?: string[];
      yolo?: boolean;
      agent?: AgentType;
      useTmux?: boolean;
      cols?: number;
      rows?: number;
    };
```

Then pass `cols` and `rows` to ALL `sessions.create()` calls within this handler. There are multiple call sites — search for `sessions.create({` within the handler and add `cols, rows,` to each.

- [ ] **Step 4: Do the same for POST /sessions/repo**

In `server/index.ts`, update the `POST /sessions/repo` handler (line 893) similarly:

```typescript
    const { repoPath, repoName, continue: continueSession, claudeArgs, yolo, agent, useTmux, cols, rows } = req.body as {
      ...
      cols?: number;
      rows?: number;
    };
```

And pass `cols, rows` to the `sessions.create()` call at line 927.

- [ ] **Step 5: Build and test**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/dialogs/NewSessionDialog.svelte server/index.ts
git commit -m "fix: pass terminal dimensions to session creation API to avoid resize re-render"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Defensive multi-hypothesis fix approach — each fix is small, independent, correct regardless of root cause
- TypeScript strict mode caught the `undefined` passing issue early via `exactOptionalPropertyTypes`

**What didn't:**
- Could not conclusively confirm root cause through code analysis alone — all three hypotheses remain plausible
- Dimension estimation in NewSessionDialog uses magic numbers rather than actual terminal measurements

**Learnings to codify:**
- WebSocket module-level state (`ptyWs`) must track sockets in CONNECTING state, not just OPEN — otherwise rapid reconnection creates orphaned connections
- `term.reset()` is safer than `term.clear()` when switching sessions — it clears alternate buffer state that `clear()` leaves behind
