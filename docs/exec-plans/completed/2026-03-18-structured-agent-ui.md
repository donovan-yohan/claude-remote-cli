# Structured Agent UI

> **Status**: Active | **Created**: 2026-03-18 | **Last Updated**: 2026-03-18 (review fixes complete)
> **Design Doc**: `docs/design-docs/2026-03-18-structured-agent-ui-design.md`
> **For Claude:** Use /harness:orchestrate or /harness:batch to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-18 | Design | Full SDK library import (not CLI wrapper) | Gives canUseTool, interrupt(), setModel(), supportedCommands() |
| 2026-03-18 | Design | Dispatcher pattern: sessions.ts + sdk-handler.ts + pty-handler.ts | Single registry, clean separation of communication models |
| 2026-03-18 | Design | Single WS path with protocol negotiation | No duplicate setup, first msg declares mode |
| 2026-03-18 | Design | Both Chat+Terminal views mounted, CSS toggle | Instant tab switching, no state loss |
| 2026-03-18 | Design | Terminal tab = companion shell in CWD | Genuinely useful, low resource cost |
| 2026-03-18 | Design | Auto-fallback to PTY on SDK failure | Graceful degradation |
| 2026-03-18 | Eng | Discriminated union types (PtySession \| SdkSession) | Compile-time safety |
| 2026-03-18 | Eng | WebSocket backpressure on SDK event stream | Prevents OOM on slow mobile connections |
| 2026-03-18 | Eng | FIFO cap on events array (2000 events) | Matches scrollback pattern, prevents memory leak |
| 2026-03-18 | Eng | Full SDK session serialization via resume + event replay | Maintains update continuity |
| 2026-03-18 | Eng | Import SDK event types from package | DRY, compile-time safety |
| 2026-03-18 | Eng | Agent command records move to types.ts | Natural grouping with AgentType |
| 2026-03-18 | Eng | SDK idle sweep (30min timeout) | Prevents resource leak from abandoned sessions |
| 2026-03-18 | Design Review | User messages: full-width with --accent left border | Maximizes mobile readability |
| 2026-03-18 | Design Review | Permission cards: sticky above input, full-width buttons | Most urgent action gets most prominent position |
| 2026-03-18 | Design Review | Turn boundaries: user message accent border IS separator | Subtraction default |
| 2026-03-18 | Implementation | Batch execution: 2 parallel worktree agents (backend + frontend) | Backend and frontend modify disjoint file sets — max parallelism |
| 2026-03-18 | Implementation | skipLibCheck: true in tsconfig | SDK package peer dep types incompatible without it |
| 2026-03-18 | Implementation | SDK uses `query()` API with `SdkInputController` async iterator | Streaming input model for multi-turn conversations |

## Progress

- [x] Task 1: Type system foundation _(completed 2026-03-18)_
- [x] Task 2: Extract PTY handler _(completed 2026-03-18)_
- [x] Task 3: SDK handler implementation _(completed 2026-03-18)_
- [x] Task 4: Session dispatcher refactor _(completed 2026-03-18)_
- [x] Task 5: WebSocket protocol upgrade _(completed 2026-03-18)_
- [x] Task 6: Frontend SDK state management _(completed 2026-03-18)_
- [x] Task 7: ChatView and message cards _(completed 2026-03-18)_
- [x] Task 8: Chat input and quick replies _(completed 2026-03-18)_
- [x] Task 9: Permission approval UI _(completed 2026-03-18)_
- [x] Task 10: SessionView with tab switching _(completed 2026-03-18)_
- [x] Task 11: Push notification enrichment _(completed 2026-03-18)_
- [x] Task 12: Progress and cost tracking _(completed 2026-03-18)_
- [x] Task 13: Debug event log _(completed 2026-03-18)_
- [x] Task 14: SDK idle sweep _(completed 2026-03-18)_
- [ ] Task 15: Integration tests

## Surprises & Discoveries

| Date | What | Impact | Action |
|------|------|--------|--------|
| 2026-03-18 | SDK package is `@anthropic-ai/claude-agent-sdk` not `claude-code-sdk` as plan specified | API surface differs — uses `query()` not direct process spawn | Adapted SDK handler to use actual package API |
| 2026-03-18 | `exactOptionalPropertyTypes` in tsconfig requires explicit `undefined` in type unions | Minor type annotation adjustments needed | Fixed in SDK handler and sessions dispatcher |

## Plan Drift

| Task | Planned | Actual | Why |
|------|---------|--------|-----|
| Task 3 | `@anthropic-ai/claude-code-sdk` | `@anthropic-ai/claude-agent-sdk` | Package name was wrong in plan; used installed package |
| Task 15 | Full integration tests | Deferred to next step | All 14 implementation tasks done; tests as separate pass |

---

## Tasks

### Task 1: Type System Foundation

**Goal:** Establish the discriminated union type system and move shared constants to types.ts.

**Files:** `server/types.ts`

**Steps:**
1. Add `SessionMode = 'sdk' | 'pty'` type
2. Define `SdkEvent` types (import from `@anthropic-ai/claude-code-sdk` or define interface matching SDK output)
3. Split `Session` into discriminated union:
   ```typescript
   interface BaseSession {
     id: string; type: SessionType; agent: AgentType; mode: SessionMode;
     root: string; repoName: string; repoPath: string;
     worktreeName: string; branchName: string; displayName: string;
     createdAt: string; lastActivity: string; idle: boolean;
     cwd: string; customCommand: string | null; status: SessionStatus;
   }
   interface PtySession extends BaseSession {
     mode: 'pty'; pty: IPty; scrollback: string[];
     useTmux: boolean; tmuxSessionName: string;
     onPtyReplacedCallbacks: Array<(newPty: IPty) => void>;
     restored: boolean;
   }
   interface SdkSession extends BaseSession {
     mode: 'sdk'; events: SdkEvent[]; sdkSessionId: string | null;
     permissionQueue: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>;
     companionPty?: IPty; companionScrollback?: string[];
     tokenUsage: { input: number; output: number };
     estimatedCost: number;
   }
   type Session = PtySession | SdkSession;
   ```
4. Move `AGENT_COMMANDS`, `AGENT_CONTINUE_ARGS`, `AGENT_YOLO_ARGS` from sessions.ts to types.ts
5. Add new CSS tokens to `frontend/src/app.css` (--card-bg, --success, --error, --warning, --info, --diff-add, --diff-remove, --code-font, --radius-sm, --radius-md, --spacing-xs/sm/md/lg)
6. Install `@anthropic-ai/claude-code-sdk` as dependency

**Acceptance criteria:**
- `npm run check` passes with new types
- All existing code compiles (may need minor type narrowing updates)
- CSS tokens added to app.css

**Test:** `npm run check` (type checking only — no runtime changes yet)

---

### Task 2: Extract PTY Handler

**Goal:** Extract all PTY-specific logic from sessions.ts into pty-handler.ts without changing behavior.

**Files:** `server/pty-handler.ts` (new), `server/sessions.ts` (refactor)

**Steps:**
1. Create `server/pty-handler.ts` with:
   - `createPtySession(params)` — extracted from sessions.ts `create()` (lines 118-296)
   - `resolveTmuxSpawn()` — moved from sessions.ts
   - `generateTmuxSessionName()` — moved from sessions.ts
   - `attachHandlers()` — extracted from sessions.ts
   - PTY scrollback buffer management
   - Idle timer management
   - Metadata flush logic
   - `--continue` retry logic
2. Update sessions.ts to import from pty-handler.ts
3. Sessions.ts keeps: Map registry, create() dispatcher, get(), list(), kill(), resize(), write(), onIdleChange(), findRepoSession(), serializeAll(), restoreFromDisk()
4. Verify all exports from sessions.ts still work (index.ts imports)

**Acceptance criteria:**
- `npm test` passes — zero behavior change
- `npm run build` succeeds
- All 12 existing test files pass
- PTY sessions work identically (manual verification)

**Test:** Run full test suite: `npm test`

---

### Task 3: SDK Handler Implementation

**Goal:** Create sdk-handler.ts that manages Claude SDK sessions with structured event streaming.

**Files:** `server/sdk-handler.ts` (new)

**Steps:**
1. Create `server/sdk-handler.ts` with:
   - `createSdkSession(params)` — uses `@anthropic-ai/claude-code-sdk` to spawn Claude
     - Sets up `canUseTool` callback that queues permission requests
     - Sets up event stream async iterator
     - Stores events array with FIFO cap (2000 events max, matching scrollback pattern)
     - On SDK init failure: returns `{ fallback: true }` signal for dispatcher
   - `sendMessage(sessionId, text)` — writes user message to SDK stdin
   - `handlePermission(sessionId, requestId, approved)` — resolves pending canUseTool promise
   - `getEventStream(sessionId)` — returns async iterator of SDK events for WebSocket relay
   - `interruptSession(sessionId)` — calls SDK interrupt()
   - `serializeSdkSession(session)` — persist sessionId + events for update restoration
   - `restoreSdkSession(serialized)` — resume with persisted sessionId + replay events
2. Implement event transform layer:
   - SDK `item/started` → map to typed events: `{ type: 'agent_message' | 'file_change' | 'tool_call' | 'reasoning' | 'error', ... }`
   - SDK `turn/started` → `{ type: 'turn_started' }`
   - SDK `turn/completed` → `{ type: 'turn_completed', usage: { input_tokens, output_tokens } }`
   - SDK `thread/started` → `{ type: 'session_started', sessionId }`
3. Implement debug event log:
   - If config has `debugLog: true`, write every SDK event as JSON line to `~/.config/claude-remote-cli/debug/<session-id>.jsonl`
4. Strip server-internal env vars from child process environment (VAPID keys, PIN hash path)

**Acceptance criteria:**
- SDK handler can spawn a Claude process and receive structured events
- Permission requests are queued and resolvable
- Events array is capped at 2000 with FIFO eviction
- Fallback signal returned on SDK init failure
- Debug log writes when enabled
- Types compile clean

**Test:** Unit tests for event transform layer, permission queue, FIFO cap, env var stripping

---

### Task 4: Session Dispatcher Refactor

**Goal:** Make sessions.ts a dispatcher that routes to sdk-handler or pty-handler based on session mode.

**Files:** `server/sessions.ts`, `server/index.ts`

**Steps:**
1. Update `create()` to dispatch:
   ```
   if (agent === 'claude' && !customCommand) {
     try { return await createSdkSession(params); }
     catch { return createPtySession(params); /* fallback */ }
   }
   return createPtySession(params);
   ```
2. Update `kill()` to handle both modes (SDK: interrupt + kill child; PTY: SIGTERM + tmux kill)
3. Update `resize()` to only work for PTY sessions (SDK sessions don't have a resizable terminal)
4. Update `write()` to route: PTY → pty.write; SDK → sendMessage
5. Update `list()` to include `mode` field in SessionSummary
6. Update `serializeAll()` to handle both session types
7. Update `restoreFromDisk()` to restore SDK sessions via resume
8. Add `handlePermission(sessionId, requestId, approved)` passthrough to sdk-handler
9. Add idle sweep: `setInterval` every 60s, terminate SDK sessions idle >30min
10. Update REST routes in index.ts:
    - `POST /sessions/:id/message` — new route for SDK message sending
    - `POST /sessions/:id/permission` — new route for permission approval
    - `GET /sessions` response includes `mode` field

**Acceptance criteria:**
- Claude sessions create as SDK mode by default
- Codex/terminal sessions create as PTY mode
- SDK failure falls back to PTY with warning
- All session lifecycle operations work for both modes
- New REST routes respond correctly
- Idle sweep terminates abandoned SDK sessions

**Test:** Unit tests for dispatcher routing, fallback logic, idle sweep timer

---

### Task 5: WebSocket Protocol Upgrade

**Goal:** Add protocol negotiation to ws.ts so SDK sessions use JSON frames and PTY sessions use binary.

**Files:** `server/ws.ts`

**Steps:**
1. On WebSocket connection for `/ws/:sessionId`:
   - Look up session mode
   - If `mode === 'sdk'`: send first message `{ type: 'session_info', mode: 'sdk', sessionId }`, then enter JSON relay mode
   - If `mode === 'pty'`: send raw scrollback replay (existing behavior)
2. SDK JSON relay mode:
   - **Server→Client:** Forward SDK events as JSON frames (from sdk-handler event stream)
   - **Client→Server:** Parse JSON messages: `{ type: 'message', text }` → sendMessage; `{ type: 'permission', requestId, approved }` → handlePermission; `{ type: 'resize', cols, rows }` → resize companion shell
   - Implement backpressure: check `ws.bufferedAmount` before sending; if > 1MB, pause consuming SDK event iterator; resume when buffer drains below 512KB
3. PTY relay mode: unchanged (existing behavior)
4. SDK event replay on reconnect: send stored events array to client on new connection
5. Companion shell relay: if SDK session has a companion PTY (Terminal tab), relay its I/O alongside SDK events using `{ type: 'terminal_data', data }` / `{ type: 'terminal_exit' }` frames

**Acceptance criteria:**
- SDK sessions receive JSON events over WebSocket
- PTY sessions work identically to before
- Backpressure pauses SDK stream when client is slow
- Reconnecting clients receive event replay
- Companion shell data flows through the same WebSocket

**Test:** Unit tests for protocol negotiation, backpressure triggering, event replay

---

### Task 6: Frontend SDK State Management

**Goal:** Create Svelte state modules for SDK session data (events, permissions, cost).

**Files:** `frontend/src/lib/state/sdk.svelte.ts` (new), `frontend/src/lib/ws.ts` (update), `frontend/src/lib/types.ts` (update)

**Steps:**
1. Add SDK event types to `frontend/src/lib/types.ts`:
   - `SdkEvent` (discriminated union: agent_message, file_change, tool_call, reasoning, error, turn_started, turn_completed)
   - `PermissionRequest` (id, toolName, input, status: 'pending' | 'approved' | 'denied' | 'timed_out')
   - `SessionInfo` (mode, sessionId)
   - `TokenUsage` (input, output, estimatedCost)
2. Create `frontend/src/lib/state/sdk.svelte.ts`:
   - `$state` array of `SdkEvent` per session
   - `$state` active permission request (pending, or null)
   - `$state` token usage and cost
   - `$state` isStreaming flag (true during turn)
   - `$derived` quick reply suggestions (based on last event type)
   - Mutation functions: `appendEvent()`, `setPermission()`, `resolvePermission()`, `updateUsage()`
3. Update `frontend/src/lib/ws.ts`:
   - Handle protocol negotiation: read first message, branch on mode
   - SDK mode: parse JSON frames, route to sdk state mutations
   - PTY mode: unchanged
   - Add methods: `sendSdkMessage(text)`, `sendPermissionResponse(requestId, approved)`

**Acceptance criteria:**
- SDK state is reactive and updates on WebSocket events
- Permission state transitions correctly
- Quick reply suggestions derive from context
- WebSocket client handles both modes
- Type-safe throughout

**Test:** `npm run check` (type checking). Manual verification with SDK session.

---

### Task 7: ChatView and Message Cards

**Goal:** Build the main chat UI: virtualized message list with card components for each event type.

**Files:** `frontend/src/components/ChatView.svelte` (new), `frontend/src/components/cards/` (new directory with card components)

**Steps:**
1. Create `ChatView.svelte`:
   - Virtualized message list (dynamic height items)
   - Auto-scroll to bottom on new events
   - Empty state: "Send a message to start a conversation" + blinking cursor in input
   - Working indicator: pulsing `●` dot + "Claude is working..." in --text-muted
   - Streaming text renders word-by-word with terminal cursor blink
2. Create card components in `frontend/src/components/cards/`:
   - `UserMessage.svelte` — full-width, --accent left border, user's text
   - `AgentMessage.svelte` — full-width, markdown rendered (use a simple markdown-to-html utility, not a heavy library), code blocks with --code-font
   - `FileChangeCard.svelte` — --card-bg background, monospace filename (fade-mask), green +N / red -N, file icon
   - `ToolCallCard.svelte` — tool name in monospace, status badge, collapsible result
   - `ReasoningPanel.svelte` — collapsed "Thinking..." with animated dots; expanded: --text-muted monospace in --card-bg
   - `ErrorCard.svelte` — --error left border, message text, "Retry" button, dismissible ×
   - `TurnCompletedCard.svelte` — subtle separator showing token usage if available
3. All cards use design tokens from app.css (--card-bg, --radius-sm, --spacing-sm, etc.)
4. Mobile-first: 8px horizontal padding, 4px vertical gap between cards

**Acceptance criteria:**
- All 7 event types render correctly
- Virtualized list scrolls smoothly on mobile
- Auto-scroll works for new messages
- Empty state and working indicator display correctly
- All cards use design tokens consistently
- Markdown renders in agent messages (code blocks, bold, links)

**Test:** Visual verification. `npm run check` for types.

---

### Task 8: Chat Input and Quick Replies

**Goal:** Build the chat input with send button and context-aware quick reply buttons.

**Files:** `frontend/src/components/ChatInput.svelte` (new), `frontend/src/components/QuickReplies.svelte` (new)

**Steps:**
1. Create `ChatInput.svelte`:
   - Multi-line textarea with --surface background
   - Send button (--accent arrow icon), 44px touch target
   - Enter sends, Shift+Enter for newline
   - Disabled during agent turn (send button shows "..." icon)
   - Disabled when input is empty (button grayed out)
   - `aria-label="Send message"` on button
   - Fixed to bottom of viewport
2. Create `QuickReplies.svelte`:
   - Horizontal row of monospace buttons (--border outlined)
   - Buttons: contextual based on last event (e.g., after permission: nothing; after turn complete: "Continue", "Show diff"; after error: "Retry")
   - Horizontal scroll if >3 buttons
   - `role="group"` + `aria-label="Quick replies"`
   - 36px button height, --spacing-sm gap
   - Hidden when no suggestions
3. Quick reply tap sends the message text (same as typing + send)

**Acceptance criteria:**
- Input works on desktop (Enter/Shift+Enter) and mobile (send button)
- Send button state matches design spec (disabled/enabled/busy)
- Quick replies appear contextually
- Keyboard dismisses on send (mobile)
- Accessible: screen reader, keyboard nav

**Test:** `npm run check`. Manual mobile verification.

---

### Task 9: Permission Approval UI

**Goal:** Build the sticky permission approval card that floats above input.

**Files:** `frontend/src/components/PermissionCard.svelte` (new)

**Steps:**
1. Create `PermissionCard.svelte`:
   - Sticky position above ChatInput (not in the virtualized list)
   - --accent left border
   - Tool name in monospace: "Edit: server/auth.ts" or "Run: npm test"
   - Full-width Approve button (--success background, white text), 48px height
   - Full-width Deny button (--error outlined), 48px height
   - Buttons side by side on desktop, stacked on mobile (if too wide)
   - After approval: badge replaces buttons ("Approved ✓" in --success, or "Denied ✗" in --error), card fades to inline in message list
   - On timeout: card grays out, "Timed out" in --text-muted
   - `aria-label="Approve: {tool description}"` on approve button
2. Wire to SDK state: reads `activePermission` from sdk.svelte.ts
3. On tap: calls `sendPermissionResponse(requestId, true/false)` via WebSocket

**Acceptance criteria:**
- Permission card appears when SDK emits a canUseTool request
- Approve/Deny sends response via WebSocket
- Card transitions to resolved state after response
- Sticky positioning works on mobile (above input, below quick replies)
- Accessible: tab-focusable buttons with descriptive labels

**Test:** `npm run check`. Manual verification of sticky positioning.

---

### Task 10: SessionView with Tab Switching

**Goal:** Create the container component that switches between Chat and Terminal views.

**Files:** `frontend/src/components/SessionView.svelte` (new), `frontend/src/components/Terminal.svelte` (update), `frontend/src/components/App.svelte` (update)

**Steps:**
1. Create `SessionView.svelte`:
   - Tab bar: segmented control [Chat] [Terminal] for SDK sessions
   - No tab bar for PTY sessions (Terminal only)
   - Both ChatView and TerminalView are always mounted (CSS `display: none` toggle)
   - Tab state: `$state` activeTab = 'chat' | 'terminal'
   - `role="tablist"` + `role="tab"` + `aria-selected` on tabs
   - 44px touch targets for tabs
   - SDK fallback banner: yellow --warning banner "Running in terminal mode. Reason: {error}" when SDK fell back to PTY
2. Update Terminal.svelte:
   - Accept optional `companionMode` prop for SDK sessions
   - In companion mode: connect to companion shell data stream (not the main session PTY)
   - Lazy-spawn shell on first Terminal tab open (send `{ type: 'open_companion' }` via WebSocket)
   - Loading state: "Starting shell in {cwd}..." centered spinner
   - Error state: "Shell failed to start" + retry button
3. Update App.svelte:
   - Replace direct Terminal.svelte usage with SessionView.svelte
   - Pass session mode to SessionView

**Acceptance criteria:**
- SDK sessions show Chat tab by default with Terminal tab available
- PTY sessions show Terminal only (no tabs)
- Tab switching is instant (no flash, no re-render)
- Companion shell spawns on first Terminal tab open
- Fallback banner shows when SDK failed
- Accessible tab navigation

**Test:** `npm run check`. Manual verification of tab switching.

---

### Task 11: Push Notification Enrichment

**Goal:** Enhance push notifications with context from SDK events.

**Files:** `server/push.ts`

**Steps:**
1. Add `enrichNotification(event: SdkEvent)` function:
   - `tool_call` (canUseTool) → "Claude wants to {action} {target}" (e.g., "Claude wants to edit server/auth.ts")
   - `turn_completed` → "Claude finished: {N} files changed" (count file_change events in the turn)
   - `error` → "Claude hit an error: {brief message}"
   - Default/fallback → "Claude is waiting for your input"
2. Call `enrichNotification()` when SDK session goes idle
3. Truncate notification body to <4KB for Web Push payload limits
4. Handle missing event fields gracefully (fall back to generic message)

**Acceptance criteria:**
- SDK session push notifications include context about what happened
- Payload stays under 4KB
- Missing fields produce generic fallback, not crash
- PTY session notifications unchanged

**Test:** Unit test for `enrichNotification()` with various event types + edge cases (missing fields, oversized payload)

---

### Task 12: Progress and Cost Tracking

**Goal:** Display token usage and estimated cost in the chat view.

**Files:** `frontend/src/components/CostDisplay.svelte` (new)

**Steps:**
1. Create `CostDisplay.svelte`:
   - Compact display: "12.4k tokens · $0.03"
   - Positioned at bottom of message thread (after last message, before input)
   - Uses --text-muted, small font
   - Shows "—" when no usage data
   - Updates on each turn_completed event
2. Cost calculation: use published model pricing (Claude Sonnet: ~$3/$15 per 1M input/output tokens; Opus: ~$15/$75)
   - Store pricing as constants in a `pricing.ts` utility
   - Calculate from cumulative input_tokens + output_tokens
3. Format: "12.4k" for thousands, "1.2M" for millions

**Acceptance criteria:**
- Token count and cost display after each turn
- Shows "—" when no data
- Updates reactively
- Formatting is correct (k, M suffixes)
- Non-alarming visual style (muted, small)

**Test:** Unit test for cost calculation and number formatting

---

### Task 13: Debug Event Log

**Goal:** Optional flag to write all SDK events to disk for debugging.

**Files:** `server/sdk-handler.ts` (update), `server/config.ts` (update), `bin/claude-remote-cli.ts` (update)

**Steps:**
1. Add `--debug-log` CLI flag to bin/claude-remote-cli.ts
2. Add `debugLog: boolean` to Config interface in types.ts
3. In sdk-handler.ts, when `debugLog` is enabled:
   - Create `~/.config/claude-remote-cli/debug/` directory
   - For each SDK event, append JSON line to `debug/<session-id>.jsonl`
   - Include timestamp with each line
4. Auto-rotate: if file exceeds 10MB, rename to `.jsonl.1` and start fresh
5. Clean up debug files older than 7 days on startup

**Acceptance criteria:**
- `--debug-log` flag creates debug directory and writes events
- Each line is valid JSON with timestamp
- Files rotate at 10MB
- Old files cleaned up on startup
- No performance impact when disabled (no-op)

**Test:** Unit test for log rotation logic

---

### Task 14: SDK Idle Sweep

**Goal:** Terminate SDK sessions that have been idle for >30 minutes.

**Files:** `server/sessions.ts` (update)

**Steps:**
1. Add `setInterval` in sessions.ts (60-second tick)
2. On each tick: iterate sessions, find SDK sessions where `Date.now() - lastActivity > 30min`
3. For matching sessions: call `interruptSession()` then remove from registry
4. Log swept sessions: `console.log('[idle-sweep] Terminated SDK session ${id} (idle for ${minutes}min)')`
5. Also enforce max 5 idle SDK sessions (LRU eviction) matching Conductor's pattern

**Acceptance criteria:**
- SDK sessions idle >30min are terminated
- No more than 5 idle SDK sessions at once
- PTY sessions are NOT swept (they're lighter)
- Sweep logging for debugging
- Timer cleans up on server shutdown

**Test:** Unit test with mock sessions and time manipulation

---

### Task 15: Integration Tests

**Goal:** Verify end-to-end flows work correctly.

**Files:** `test/sdk-handler.test.ts` (new), `test/sdk-ws.test.ts` (new), `test/sessions-dispatcher.test.ts` (new)

**Steps:**
1. `test/sdk-handler.test.ts`:
   - Event transform for each SDK event type
   - Permission queue: add, resolve, timeout
   - Events FIFO cap
   - Env var stripping
   - Debug log writing (if enabled)
2. `test/sdk-ws.test.ts`:
   - Protocol negotiation (SDK mode first message)
   - JSON frame relay
   - Event replay on reconnect
   - Backpressure trigger and resume
3. `test/sessions-dispatcher.test.ts`:
   - Claude → SDK mode routing
   - Codex → PTY mode routing
   - SDK failure → PTY fallback
   - Session list includes mode field
   - Idle sweep selects only SDK sessions
4. Update existing tests if the refactoring breaks any imports

**Acceptance criteria:**
- All new tests pass: `npm test`
- All existing tests still pass
- `npm run build` succeeds
- `npm run check` passes

**Test:** `npm test` — full suite

---

## Outcomes & Retrospective

**What worked:**
- Parallel batch execution (2 agents: backend + frontend) — disjoint file sets enabled full parallelism
- Discriminated union types caught integration issues at compile time
- Design doc and review findings provided clear acceptance criteria
- Atomic fix commits made review easy and git bisect-friendly

**What didn't:**
- Several integration mismatches between frontend and backend (permission enum, WS event envelope, reconnect counter sharing, global SDK state) — caught by review, not types
- Companion shell Terminal tab is a stub (TODO) — `open_companion` message unhandled server-side
- AgentMessage markdown renderer is basic regex (finding #15 deferred — needs a sanitized markdown library)
- Task 15 (integration tests) not yet written

**Learnings to codify:**
- When two agents implement a protocol (WS JSON frames), define the exact frame schemas in a shared types file BEFORE implementation — prevents envelope/unwrap mismatches
- Per-session state must be keyed by sessionId from day 1 — global singletons for things like `activePermission` break when switching sessions
- `$derived(() => ...)` is NOT the same as `$derived.by(() => ...)` in Svelte 5 — the former returns a function, the latter returns the computed value
