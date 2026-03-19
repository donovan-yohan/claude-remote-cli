# Bug Analysis: SDK Chat UI Still Active Despite PTY-Only Pivot

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: Full stack — server/sdk-handler.ts, server/sessions.ts, server/ws.ts, server/types.ts, server/index.ts, frontend/src/components/{SessionView,ChatView,ChatInput,QuickReplies,PermissionCard,CostDisplay}.svelte, frontend/src/components/cards/*.svelte, frontend/src/lib/state/sdk.svelte.ts, frontend/src/App.svelte

## Symptoms
- Sessions sometimes render a chat UI with "Send a message to start a conversation" instead of the terminal/PTY view
- Chat tab bar, send button, and message input are visible instead of xterm.js terminal
- Confirmed via screenshot: the `extend-api` workspace session shows the chat UI

## Reproduction Steps
1. Start the server with `@anthropic-ai/claude-agent-sdk` importable
2. Create a session with agent `claude` and no custom command
3. `server/sessions.ts:102` tries SDK mode first — if `createSdkSession()` succeeds, the session gets `mode: 'sdk'`
4. Frontend `App.svelte:608` checks `activeSessionMode === 'sdk'` and renders `<SessionView mode="sdk">` instead of `<Terminal>`
5. The chat UI renders

## Root Cause
The dual-mode (SDK vs PTY) architecture was never removed after pivoting to purely claude-code session wrapping via PTY. The SDK path is still the **default** for `agent === 'claude'` sessions — PTY is only used as a fallback when SDK init fails.

The decision logic at `server/sessions.ts:101-124`:
```typescript
if (agent === 'claude' && !command) {
  const sdkResult = createSdkSession(...);
  if (!('fallback' in sdkResult)) {
    return { ...sdkResult.result }; // SDK mode wins
  }
  // Only falls through to PTY on SDK failure
}
```

## Evidence

### Frontend dead code (chat UI)
- `ChatView.svelte` (158 lines) — message list renderer
- `ChatInput.svelte` (139 lines) — text input + send button
- `SessionView.svelte` (333 lines) — SDK session container with tab bar
- `QuickReplies.svelte`, `PermissionCard.svelte`, `CostDisplay.svelte`
- 7 card components in `cards/`: UserMessage, AgentMessage, FileChangeCard, ToolCallCard, ReasoningPanel, ErrorCard, TurnCompletedCard
- `frontend/src/lib/state/sdk.svelte.ts` — SDK state management
- `App.svelte:608-616` — conditional routing between SessionView and Terminal

### Server dead code (SDK handler)
- `server/sdk-handler.ts` (665 lines) — full Claude Agent SDK integration
- `server/sessions.ts:101-124` — SDK-first dispatch logic
- `server/types.ts:74` — `SdkSession` type definition
- `server/ws.ts:139,228` — SDK-specific WebSocket handlers
- `server/index.ts:832,858` — SDK-gated API routes

### Frontend WS code
- `frontend/src/lib/ws.ts` — `sendSdkMessage`, `sendPermissionResponse`, `sendOpenCompanion`, `connectSdkSocket` functions
- `frontend/src/lib/types.ts` — `SdkEvent` and related types

## Impact Assessment
- **User-facing**: Sessions randomly render chat UI instead of terminal depending on whether the SDK package is available
- **Code bloat**: ~1500+ lines of dead code across frontend and server
- **Dependency**: `@anthropic-ai/claude-agent-sdk` is imported but should not be needed
- **Confusion**: New contributors see two parallel session architectures

## Recommended Fix Direction
1. Remove `server/sdk-handler.ts` entirely
2. Remove SDK dispatch logic from `server/sessions.ts:101-124` — always use PTY path
3. Remove `SdkSession` type from `server/types.ts`
4. Remove SDK WebSocket handlers from `server/ws.ts`
5. Remove SDK API routes from `server/index.ts`
6. Remove `SessionView.svelte`, `ChatView.svelte`, `ChatInput.svelte`, `QuickReplies.svelte`, `PermissionCard.svelte`, `CostDisplay.svelte`
7. Remove all card components in `frontend/src/components/cards/`
8. Remove `frontend/src/lib/state/sdk.svelte.ts`
9. Remove SDK-related types and WS functions from `frontend/src/lib/types.ts` and `frontend/src/lib/ws.ts`
10. Simplify `App.svelte` to always render `<Terminal>` (remove the SDK conditional)
11. Remove `@anthropic-ai/claude-agent-sdk` dependency from `package.json` if no longer needed elsewhere
