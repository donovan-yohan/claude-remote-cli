# Fix: --continue Flag PTY Replacement Bug

> **Status**: Active | **Created**: 2026-03-11 | **Last Updated**: 2026-03-11
> **Bug Analysis**: `docs/bug-analyses/2026-03-11-continue-flag-no-previous-session-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-11 | Design | Use PTY replacement callback on Session object | Minimal surface area — one new field on Session, one callback in ws.ts. No EventEmitter overhead. Keeps module boundaries clean (sessions.ts doesn't import ws.ts). |
| 2026-03-11 | Design | Suppress old PTY onExit close during retry | The WebSocket should stay open while the session retries; closing it forces a full reconnect |
| 2026-03-11 | Design | Generate unique tmux session name on retry | Avoids name collision if old tmux session hasn't cleaned up yet |

## Progress

- [x] Task 1: Add `onPtyReplaced` callback to Session type and implement in sessions.ts
- [x] Task 2: Make ws.ts resilient to PTY replacement
- [x] Task 3: Fix tmux session name collision on retry
- [x] Task 4: Add tests for PTY retry, WebSocket reattachment, and tmux retry
- [x] Task 5: Verify build and all tests pass (146/146 pass)

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Add `onPtyReplaced` callback to Session type and implement in sessions.ts

**Goal:** When the retry mechanism replaces `session.pty`, notify any listener (ws.ts) so it can reattach handlers.

**Files:** `server/types.ts`, `server/sessions.ts`

**Steps:**

1. In `server/types.ts`, add to the `Session` interface:
   ```typescript
   onPtyReplaced?: ((newPty: IPty) => void) | undefined;
   ```

2. In `server/sessions.ts`, in the `onExit` retry block (around line 202), after `session.pty = retryPty;` and before `attachHandlers(retryPty, false);`, call the callback:
   ```typescript
   session.pty = retryPty;
   session.onPtyReplaced?.(retryPty);
   attachHandlers(retryPty, false);
   ```

**Verify:** `npm run build` compiles without errors.

---

### Task 2: Make ws.ts resilient to PTY replacement

**Goal:** When the PTY is replaced during a `--continue` retry, the WebSocket connection should reattach its data/exit handlers to the new PTY instead of closing.

**Files:** `server/ws.ts`

**Steps:**

1. Refactor the WebSocket `connection` handler to extract handler attachment into a reusable function. Replace the current pattern of capturing `session.pty` once with a function that can be called again:

   ```typescript
   wss.on('connection', (ws: WebSocket, _request: http.IncomingMessage) => {
     const session = sessionMap.get(ws);
     if (!session) return;

     let dataDisposable: { dispose(): void } | null = null;
     let exitDisposable: { dispose(): void } | null = null;

     function attachToPty(ptyProcess: IPty): void {
       // Dispose previous handlers
       dataDisposable?.dispose();
       exitDisposable?.dispose();

       // Replay scrollback
       for (const chunk of session.scrollback) {
         if (ws.readyState === ws.OPEN) ws.send(chunk);
       }

       dataDisposable = ptyProcess.onData((data) => {
         if (ws.readyState === ws.OPEN) ws.send(data);
       });

       exitDisposable = ptyProcess.onExit(() => {
         if (ws.readyState === ws.OPEN) ws.close(1000);
       });
     }

     attachToPty(session.pty);

     session.onPtyReplaced = (newPty) => attachToPty(newPty);

     ws.on('message', (msg) => {
       const str = msg.toString();
       try {
         const parsed = JSON.parse(str);
         if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
           sessions.resize(session.id, parsed.cols, parsed.rows);
           return;
         }
       } catch (_) {}
       // Use session.pty dynamically so writes go to current PTY
       session.pty.write(str);
     });

     ws.on('close', () => {
       dataDisposable?.dispose();
       exitDisposable?.dispose();
       session.onPtyReplaced = undefined;
     });
   });
   ```

   Key changes:
   - `attachToPty()` function disposes old handlers and attaches new ones
   - `session.onPtyReplaced` callback triggers reattachment
   - `ws.on('message')` uses `session.pty.write()` (dynamic) instead of captured `ptyProcess.write()`
   - Initial scrollback replay is in `attachToPty()` so it also works on retry (scrollback is cleared in sessions.ts before retry)
   - Cleanup on `ws.close` disposes handlers and clears callback

**Verify:** `npm run build` compiles without errors.

---

### Task 3: Fix tmux session name collision on retry

**Goal:** When retrying with tmux, generate a unique session name to avoid collision with the old tmux session that may still be cleaning up.

**Files:** `server/sessions.ts`

**Steps:**

1. In the retry block (around line 190), when `useTmux && tmuxSessionName`, generate a new tmux session name with a `-retry` suffix:
   ```typescript
   if (useTmux && tmuxSessionName) {
     const retryTmuxName = tmuxSessionName + '-retry';
     session.tmuxSessionName = retryTmuxName;
     const tmux = resolveTmuxSpawn(resolvedCommand, retryArgs, retryTmuxName);
     retryCommand = tmux.command;
     retrySpawnArgs = tmux.args;
   }
   ```

**Verify:** `npm run build` compiles without errors.

---

### Task 4: Add tests for PTY retry, WebSocket reattachment, and tmux retry

**Goal:** Verify the retry mechanism and `onPtyReplaced` callback work correctly.

**Files:** `test/sessions.test.ts`

**Steps:**

1. Add a test that verifies `onPtyReplaced` is called when a session with `--continue`-like args retries:
   ```typescript
   it('calls onPtyReplaced when continue-arg process fails quickly', (_, done) => {
     const AGENT_CONTINUE_ARGS = sessions.AGENT_CONTINUE_ARGS;
     const result = sessions.create({
       repoName: 'test-repo',
       repoPath: '/tmp',
       command: '/bin/false',  // exits immediately with code 1
       args: [...AGENT_CONTINUE_ARGS.claude],
     });
     createdIds.push(result.id);

     const session = sessions.get(result.id);
     assert.ok(session);

     session.onPtyReplaced = (newPty) => {
       assert.ok(newPty, 'should receive new PTY');
       assert.notStrictEqual(newPty, result, 'should be a different PTY');
       done();
     };
   });
   ```

2. Add a test that verifies the session still exists after retry (not deleted):
   ```typescript
   it('session survives after continue-arg retry', (_, done) => {
     const result = sessions.create({
       repoName: 'test-repo',
       repoPath: '/tmp',
       command: '/bin/false',
       args: [...sessions.AGENT_CONTINUE_ARGS.claude],
     });
     createdIds.push(result.id);

     const session = sessions.get(result.id);
     assert.ok(session);

     session.onPtyReplaced = () => {
       // After replacement, session should still be in registry
       const stillExists = sessions.get(result.id);
       assert.ok(stillExists, 'session should still exist after retry');
       done();
     };
   });
   ```

**Verify:** `npm test` passes all tests.

---

### Task 5: Verify build and all tests pass

**Steps:**

1. Run `npm run build` — must succeed
2. Run `npm test` — all tests must pass
3. Verify no TypeScript errors

---

## Outcomes & Retrospective

**What worked:**
- Parallel dispatch of implementation tasks across independent files was efficient
- Plan reviewer caught missing tmux task before implementation began
- Multi-agent review caught significant issues (multi-subscriber, unhandled spawn throw)

**What didn't:**
- Initial design used single-slot callback; review correctly identified multi-connection bug

**Learnings to codify:**
- When adding callbacks to shared objects (sessions), always consider multi-subscriber from the start
- PTY spawn in event handlers (onExit) needs try-catch since exceptions crash the event loop

**Learnings to codify:**
-
