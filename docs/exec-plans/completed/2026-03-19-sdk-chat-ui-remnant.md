# SDK Chat UI Remnant Removal

> **Status**: Completed | **Created**: 2026-03-19 | **Last Updated**: 2026-03-19
> **Bug Analysis**: `docs/bug-analyses/2026-03-19-sdk-chat-ui-remnant-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-19 | Design | Remove all SDK code paths — PTY-only architecture | SDK was never fully removed after pivot; causes sessions to randomly render chat UI |
| 2026-03-19 | Plan | Merge types/handler/consumer removal into single server commit | Reviewer flagged broken build between separate commits; green-at-every-commit |
| 2026-03-19 | Plan | Delete 13 SDK-only frontend component files | All are SDK-only; no PTY code shares these components |
| 2026-03-19 | Plan | 4 tasks, ordered by dependency | All server SDK removal, frontend components, App.svelte + package.json, verify |

## Progress

- [x] Task 1: Remove all server-side SDK code (types, handler, sessions, ws, index)
- [x] Task 2: Remove frontend SDK components, state, and WS functions
- [x] Task 3: Simplify App.svelte and clean package.json
- [x] Task 4: Build, test, and verify

## Surprises & Discoveries

- `server/push.ts` also imported `SdkEvent` and had an `enrichNotification()` function — not listed in the bug analysis but caught by the build step
- CSS tokens in `app.css` were only used by deleted SDK components — cleaned up as well

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Remove all server-side SDK code

**Goal:** Delete sdk-handler.ts, remove SDK types, and clean all SDK references from server modules — in one atomic commit.

**Files:**
- Delete: `server/sdk-handler.ts` (673 lines)
- Modify: `server/types.ts`
- Modify: `server/sessions.ts`
- Modify: `server/ws.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Delete `server/sdk-handler.ts`**

Remove the entire file (673 lines of SDK infrastructure).

- [ ] **Step 2: Simplify `server/types.ts`**

- Line 6: Change `SessionMode = 'sdk' | 'pty'` → `SessionMode = 'pty'`
- Lines 8-23: Delete `SdkEventType` and `SdkEvent` types entirely
- Lines 73-79: Delete `SdkSession` interface entirely
- Line 81: Change `type Session = PtySession | SdkSession` → `type Session = PtySession`

- [ ] **Step 3: Clean `server/sessions.ts`**

Remove:
- Import of SDK handler functions (line 10-11)
- `PendingSessionsFile.sdkSessions` field (lines 37-38)
- SDK sweep constants (lines 40-43)
- SDK dispatch in `create()` (lines 101-124)
- SDK kill in `kill()` (lines 210-212)
- SDK resize comment (line 233)
- SDK write path in `write()` (lines 243-245)
- `handlePermission()` function (lines 248-250)
- SDK serialization in `serializeAll()` (lines 265-292)
- SDK restoration in `restoreFromDisk()` (lines 397-407)
- `startSdkIdleSweep()` and `stopSdkIdleSweep()` functions (lines 425-460)
- Remove from exports: `startSdkIdleSweep`, `stopSdkIdleSweep`

- [ ] **Step 4: Clean `server/ws.ts`**

Remove:
- SDK imports (SdkSession type, SDK handler functions)
- SDK branch rename instruction constant
- `handleSdkConnection()` function entirely
- SDK mode check in WebSocket connection handler

- [ ] **Step 5: Clean `server/index.ts`**

Remove:
- SDK debug log setup (lines 146-150)
- `/sessions/:id/message` POST endpoint (lines 819-843)
- `/sessions/:id/permission` POST endpoint (lines 845-869)
- `startSdkIdleSweep()` call at startup
- `stopSdkIdleSweep()` call in gracefulShutdown

- [ ] **Step 6: Commit**

```bash
git add -u server/
git commit -m "refactor: remove all server-side SDK code (handler, types, dispatch, WS, routes)"
```

---

### Task 2: Remove frontend SDK components, state, and WS functions

**Goal:** Delete all SDK-only frontend components and clean up shared modules.

**Files:**
- Delete: `frontend/src/components/SessionView.svelte`
- Delete: `frontend/src/components/ChatView.svelte`
- Delete: `frontend/src/components/ChatInput.svelte`
- Delete: `frontend/src/components/QuickReplies.svelte`
- Delete: `frontend/src/components/PermissionCard.svelte`
- Delete: `frontend/src/components/CostDisplay.svelte`
- Delete: `frontend/src/components/cards/` (entire directory — 7 files)
- Delete: `frontend/src/lib/state/sdk.svelte.ts`
- Modify: `frontend/src/lib/types.ts` — remove SDK types
- Modify: `frontend/src/lib/ws.ts` — remove SDK WebSocket functions

- [ ] **Step 1: Delete SDK component files**

Delete all 13 component files:
- `frontend/src/components/SessionView.svelte`
- `frontend/src/components/ChatView.svelte`
- `frontend/src/components/ChatInput.svelte`
- `frontend/src/components/QuickReplies.svelte`
- `frontend/src/components/PermissionCard.svelte`
- `frontend/src/components/CostDisplay.svelte`
- `frontend/src/components/cards/AgentMessage.svelte`
- `frontend/src/components/cards/ErrorCard.svelte`
- `frontend/src/components/cards/FileChangeCard.svelte`
- `frontend/src/components/cards/ReasoningPanel.svelte`
- `frontend/src/components/cards/ToolCallCard.svelte`
- `frontend/src/components/cards/TurnCompletedCard.svelte`
- `frontend/src/components/cards/UserMessage.svelte`

- [ ] **Step 2: Delete `frontend/src/lib/state/sdk.svelte.ts`**

Remove the entire file (96 lines of SDK state management).

- [ ] **Step 3: Clean `frontend/src/lib/types.ts`**

Remove:
- `SdkEventType` type (lines 3-4)
- `SdkEvent` interface (lines 5-17)
- `PermissionRequest` interface (lines 19-24)
- `TokenUsage` interface (lines 32-36)
- Change `mode: 'sdk' | 'pty'` to `mode: 'pty'` in `SessionInfo` (line 30)
- Remove `mode?: 'sdk' | 'pty'` from `SessionSummary` or change to `mode?: 'pty'`

- [ ] **Step 4: Clean `frontend/src/lib/ws.ts`**

Remove:
- `SdkEvent` import
- SDK callback types: `SdkMessageCallback`, `SdkTerminalDataCallback`, `SdkTerminalExitCallback`, `SessionModeCallback`
- `sdkWs` and `sdkReconnectAttempt` variables
- `SdkSocketCallbacks` interface
- `connectSdkSocket()` function
- `scheduleSdkReconnect()` function
- `sendSdkMessage()` function
- `sendPermissionResponse()` function
- `sendOpenCompanion()` function
- `isSdkConnected()` function
- SDK mode detection in `connectSessionSocket()` — simplify to PTY-only

- [ ] **Step 5: Commit**

```bash
git add -u frontend/src/
git commit -m "refactor: remove all SDK frontend components, state, and WS functions"
```

---

### Task 3: Simplify App.svelte and clean package.json

**Goal:** Remove the SDK rendering conditional from App.svelte and the SDK package dependency.

**Files:**
- Modify: `frontend/src/App.svelte` — remove SDK conditional rendering
- Modify: `package.json` — remove `@anthropic-ai/claude-agent-sdk` dependency

- [ ] **Step 1: Simplify `App.svelte`**

Remove:
- `activeSessionMode` derived state (line 296)
- The `{#if activeSessionMode === 'sdk'}` / `<SessionView>` / `{:else}` wrapper (lines 608-616)
- Keep the `<Terminal>` block as the only renderer
- Remove any remaining `SessionView` import

- [ ] **Step 2: Clean `package.json`**

Remove the `@anthropic-ai/claude-agent-sdk` dependency from `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.svelte package.json
git commit -m "refactor: always render PTY terminal, remove SDK package dependency"
```

---

### Task 4: Build, test, and verify

**Goal:** Verify the removal compiles cleanly and all tests pass.

- [ ] **Step 1: Run `npm run build`**

Expected: Clean compilation with no errors. TypeScript should catch any remaining dangling SDK references.

- [ ] **Step 2: Run `npm test`**

Expected: All tests pass. No tests should have depended on SDK functionality since the project pivoted to PTY-only.

- [ ] **Step 3: Verify no remaining SDK references**

```bash
grep -r 'sdk' server/ frontend/src/ --include='*.ts' --include='*.svelte' -l
grep -r 'SdkSession\|SdkEvent\|sdk-handler\|createSdkSession' server/ frontend/src/ -l
```

Expected: No matches (or only false positives like "sdkSessionId" comments).

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A && git commit -m "fix: resolve any remaining SDK references"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Merging server tasks into single atomic commit avoided broken intermediate state
- Build step caught a missed reference in push.ts that wasn't in the bug analysis
- Review found 3 minor dead code items cleaned up in a follow-up commit

**What didn't:**
- Bug analysis missed server/push.ts and frontend/src/lib/pricing.ts as affected files

**Learnings to codify:**
- When removing a type from a discriminated union, grep for the type name across ALL server files, not just the ones listed in the analysis
