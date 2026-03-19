# Bug Analysis: First Enter Key Duplicates Terminal Content

> **Status**: Investigating | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: Terminal.svelte, App.svelte, ws.ts (frontend)

## Symptoms
- On desktop, creating a new session and pressing Enter for the first time causes terminal output to duplicate below the existing content
- Sometimes previous content is removed instead
- Happens 100% of the time on every new session
- Did NOT happen in v2

## Reproduction Steps
1. Open the web interface on desktop
2. Create a new session (any type)
3. Wait for the terminal to load and show initial output
4. Press Enter
5. Observe: terminal content appears duplicated below

## Key Code Path
```
handleNewSessionCreated() [App.svelte]
  -> sessionState.activeSessionId = sessionId
  -> closeSidebar()
  -> terminalRef?.focusTerm()

$effect [Terminal.svelte:218-230]
  -> term.clear()
  -> connectPtySocket(sessionId, term, onResize, onSessionEnd)

connectPtySocket [ws.ts:40-75]
  -> new WebSocket(url)
  -> socket.onopen: ptyWs = socket; onResize()
  -> socket.onmessage: term.write(event.data)

Server [server/ws.ts:107-126]
  -> attachToPty(): replay scrollback, then attach onData handler
```

## v2 vs v3 Code Differences

Terminal.svelte changes are minimal (only `companionMode` prop added, defaults to `false`).

The structural difference is in **App.svelte**:

**v2**: Terminal rendered unconditionally
```svelte
<Terminal sessionId={sessionState.activeSessionId} ... />
```

**v3**: Terminal inside conditional block
```svelte
{#if activeSessionMode === 'sdk'}
  <SessionView ... />
{:else}
  <Terminal sessionId={sessionState.activeSessionId} ... />
{/if}
```

Where `activeSessionMode` is derived from the sessions list:
```typescript
let activeSessionMode = $derived<'sdk' | 'pty'>(
  sessionState.sessions.find(s => s.id === sessionState.activeSessionId)?.mode ?? 'pty'
);
```

## Hypotheses (Ranked)

### H1: Conditional rendering causes Terminal remount (Most Likely)

If `activeSessionMode` transiently changes during session creation, Terminal could unmount and remount. The remount creates a new xterm instance and fires `$effect` again, calling `connectPtySocket()`. If the previous WebSocket is still in `CONNECTING` state (`ptyWs` is null), the old connection is NOT closed, resulting in **two WebSocket connections** to the same session, both replaying scrollback.

**Evidence supporting**: v3-specific (new conditional), explains "duplicate content" and "every time".

**How this could happen**: During session creation, v3 tries SDK first (`createSdkSession`). If SDK succeeds synchronously but the session briefly appears as `mode: 'sdk'` in the sessions list before a state change, `activeSessionMode` could flicker. Alternatively, `refreshAll()` from the event socket could momentarily produce a different value.

### H2: PTY dimension mismatch + resize re-render

PTY created at 80x24 (server/pty-handler.ts defaults). Browser terminal has different dimensions (e.g., 120x35). On WebSocket connect, `sendPtyResize()` triggers resize. The running app (Claude CLI, shell, tmux) handles SIGWINCH and re-renders. Re-rendered output arrives after scrollback replay and appends below existing content.

**Evidence supporting**: Explains "duplicate content below" and "every time" (dimensions always mismatch).

**Evidence against**: Should also happen in v2 (same connectPtySocket code). Could explain if Claude CLI defers SIGWINCH re-render until first input (explaining "first Enter" trigger).

### H3: Double $effect execution

Svelte 5 `$effect` fires twice due to reactive dependency changes from `refreshAll()` triggered by the event socket (`worktrees-changed` broadcast). Two calls to `connectPtySocket()` create two WebSocket connections.

**Evidence supporting**: `refreshAll()` is triggered asynchronously via event socket when a session is created.

**Evidence against**: Terminal's `$effect` dependencies (`sessionId`, `term`, `companionMode`) should not change from `refreshAll()` updating `sessions`.

## Diagnostic Plan

Add temporary logging to narrow down the root cause:

### 1. Track $effect execution count
```typescript
// Terminal.svelte
let effectRunCount = 0;
$effect(() => {
  if (sessionId && term && !companionMode) {
    effectRunCount++;
    console.log(`[Terminal] $effect run #${effectRunCount}, sessionId=${sessionId}`);
    term.clear();
    connectPtySocket(sessionId, term, ...);
  }
});
```

### 2. Track WebSocket connections
```typescript
// ws.ts connectPtySocket
let connectCount = 0;
export function connectPtySocket(...) {
  connectCount++;
  const callId = connectCount;
  console.log(`[ws] connectPtySocket #${callId}, ptyWs=${ptyWs ? 'SET' : 'NULL'}`);
  // ... existing code ...
  socket.onopen = () => {
    console.log(`[ws] socket.onopen #${callId}`);
    ptyWs = socket;
    // ...
  };
  socket.onmessage = (event) => {
    console.log(`[ws] onmessage #${callId}, len=${(event.data as string).length}`);
    term.write(event.data as string);
  };
}
```

### 3. Track activeSessionMode changes
```typescript
// App.svelte
$effect(() => {
  console.log(`[App] activeSessionMode=${activeSessionMode}, activeSessionId=${sessionState.activeSessionId}`);
});
```

### 4. Track Terminal mount/unmount
```typescript
// Terminal.svelte onMount
console.log('[Terminal] mounted');
return () => {
  console.log('[Terminal] unmounting');
  // ... existing cleanup
};
```

## Impact Assessment
- All desktop users affected when creating new sessions
- First interaction with new session shows broken/duplicate output
- User must manually clear terminal or create new session to recover

## Recommended Fix Direction

**If H1 confirmed**: Ensure `connectPtySocket` properly closes WebSockets in `CONNECTING` state (not just `OPEN`). Track the socket reference regardless of readyState:
```typescript
// Store socket immediately, not just on open
let pendingSocket: WebSocket | null = null;
export function connectPtySocket(...) {
  if (pendingSocket) { pendingSocket.close(); pendingSocket = null; }
  if (ptyWs) { ptyWs.onclose = null; ptyWs.close(); ptyWs = null; }
  const socket = new WebSocket(url);
  pendingSocket = socket;
  socket.onopen = () => {
    pendingSocket = null;
    ptyWs = socket;
    // ...
  };
}
```

**If H2 confirmed**: Pass terminal dimensions to the `createSession` API so PTY starts with correct dimensions:
```typescript
// api.ts createSession - add cols/rows
// server/index.ts POST /sessions - pass to sessions.create
// server/pty-handler.ts - use client dimensions instead of 80x24
```

**If H3 confirmed**: Add Svelte 5 effect cleanup or debounce the connection.
