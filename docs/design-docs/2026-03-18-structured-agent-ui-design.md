# Structured Agent UI Design

CEO plan review for transforming claude-remote-cli from a remote terminal into a structured agent interface, inspired by how Conductor works under the hood.

**Date:** 2026-03-18 | **Mode:** SCOPE EXPANSION | **Branch:** donovan-yohan/explore-conductor-app

## Vision

### 10x Check
The current product is "remote terminal access." The 10x version is a purpose-built agent cockpit that makes working with Claude from your phone better than sitting at your laptop terminal. Structured events rendered as rich UI cards, one-tap permission approval, context-aware push notifications, and a chat-style input that eliminates the entire class of mobile keyboard bugs.

### Platonic Ideal
Opening claude-remote-cli on your phone while walking to get coffee: a clean message thread, tappable diff cards, Approve/Deny buttons for permissions, progress indicators, and a send button. No terminal. No escape sequences. No tiny font. Just a conversation with an agent running on your dev machine. With a Terminal tab always available as the escape hatch.

## Accepted Scope

1. **Claude Agent SDK Integration** (L) — Import `@anthropic-ai/claude-code-sdk` as a library. Spawn Claude as a child process with structured JSON communication. SDK sessions as primary mode, raw PTY as fallback for non-Claude sessions and when SDK init fails.

2. **Rich Message Rendering** (L) — Chat-like message thread showing: agent text as markdown, file changes as diff cards (filename + ±lines), tool calls as labeled cards, reasoning as collapsible panels, errors with clear styling, turn boundaries visually separated.

3. **Interactive Permission Approval** (M) — Permission requests rendered as cards with Approve/Deny buttons. One tap instead of finding 'y' on a phone. Maps to SDK's `canUseTool` callback. YOLO launch option preserved for sessions that skip permissions.

4. **Smart Push Notifications** (S) — Context-rich notifications using SDK events: "Claude wants to edit server/auth.ts", "4 files changed, all tests pass", "Claude hit an error". Existing `push.ts` infrastructure enhanced.

5. **Chat-style Input with Quick Replies** (M) — Multi-line text input with send button replaces MobileInput for SDK sessions. Suggested quick reply buttons (Yes, No, Continue, Show diff). Eliminates the entire class of mobile keyboard bugs.

6. **Terminal Fallback Tab** (S) — SDK sessions have Chat + Terminal tabs. Terminal tab lazy-spawns a shell in the session's CWD (not Claude's terminal — a companion shell for manual inspection). CSS display toggle for instant switching.

7. **Progress & Cost Tracking** (S) — Live display of tokens used and estimated cost per session. Progress indicator ("Running tests...") from SDK step events.

8. **Session Event Debug Log** (S) — Optional `--debug-log` flag writes all SDK events to `~/.config/claude-remote-cli/debug/<session-id>.jsonl`. Built from day 1 for development debugging.

## Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SDK integration approach | Full SDK library import | Gives canUseTool, interrupt(), setModel(), supportedCommands() |
| Session duality | Dispatcher pattern: sessions.ts registry + sdk-handler.ts + pty-handler.ts | Single session registry, clean separation of communication models |
| WebSocket protocol | Single path /ws/:id with protocol negotiation (first msg declares mode) | No duplicate WebSocket setup, clean branching |
| Frontend view architecture | Both Chat and Terminal views mounted, CSS toggle | Instant tab switching, no state loss |
| Terminal tab content (SDK) | Shell in session CWD, lazy-spawned | Genuinely useful companion shell, low resource cost |
| SDK failure handling | Auto-fallback to PTY mode with warning banner | Graceful degradation — broken SDK never makes the tool unusable |
| Message list performance | Virtualized list from day 1 | Mobile performance with long sessions |
| SDK dependency | @anthropic-ai/claude-code-sdk as direct dep | Official, maintained by Anthropic, full API surface |

## System Architecture

```
Browser (Svelte 5 SPA)
├── SessionView.svelte (tab toggle: Chat | Terminal)
│   ├── ChatView.svelte (SDK events → message cards)
│   └── TerminalView.svelte (xterm.js, shell or PTY)
├── WebSocket Client (/ws/:id, protocol negotiation)
└── Push notification handler (enriched content)

Server (Express + Node.js)
├── ws.ts (protocol negotiation → JSON or binary frames)
├── sessions.ts (registry + dispatcher)
│   ├── sdk-handler.ts (Claude SDK child process, event stream, canUseTool)
│   └── pty-handler.ts (node-pty, scrollback, tmux — extracted from current sessions.ts)
├── push.ts (SDK event → rich notification content)
└── [auth, config, watcher, git, clipboard, service — unchanged]
```

## Deferred (Phase 2+)

| Item | Priority | Effort | Depends on |
|------|----------|--------|------------|
| Custom MCP tools (AskUserQuestion, GetDiff) | P1 | L | This plan |
| Dark/light theme | P2 | S | This plan |
| Offline message queue | P3 | S | Chat input |
| Multi-agent orchestration | P3 | XL | SDK + MCP tools |
| Workspace checkpointing | P3 | L | SDK integration |

## Design Specifications (from /plan-design-review)

### Design Tokens (extending app.css)

```css
:root {
  /* New — Chat UI */
  --card-bg: #252525;          /* Card layering on --surface */
  --success: #4caf50;          /* Approve, tests pass, file added */
  --error: #e57373;            /* Deny, errors, failed */
  --warning: #ffb74d;          /* Fallback banner, timeout */
  --info: #64b5f6;             /* Informational badges */
  --diff-add: #4caf50;         /* +lines in diff cards */
  --diff-remove: #e57373;      /* -lines in diff cards */
  --code-font: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  --radius-sm: 4px;            /* Cards, badges */
  --radius-md: 8px;            /* Input, panels */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
}
```

### Visual Language

**Aesthetic:** Terminal-inspired developer tool with messaging interaction patterns.
Think "VS Code inline chat" not "iMessage." Dark, monospace for code, high contrast, dense.

- **User messages:** Full-width, `--accent` left border (coral). No right-aligned bubbles — wastes width on mobile.
- **Agent messages:** Full-width, no border. Markdown rendered with code highlighting.
- **Turn boundaries:** User message accent border IS the separator. No horizontal rules or extra spacing needed.
- **Streaming text:** Word-by-word, terminal cursor blink at end. No animation.
- **Working indicator:** Pulsing `●` dot (reusing status dot pattern) + "Claude is working..." in `--text-muted`.
- **Quick reply buttons:** Monospace, `--border` outlined, compact. NOT consumer pill buttons.
- **Chat input:** Dark `--surface` background, `--accent` send arrow. Enter sends, Shift+Enter for newline.

### Card Anatomy

**File change card:** `--card-bg` background, `--radius-sm`. One line: monospace filename (fade-mask if long) + green `+N` / red `-N` stats + file-type icon. No expand — just an indicator.

**Permission card (sticky):** Floats above input. `--accent` left border. Tool name in monospace (`Edit: server/auth.ts`). Full-width Approve (`--success` bg) and Deny (`--error` outlined) buttons, 48px height for mobile. After response: badge replaces buttons ("Approved ✓" or "Denied ✗"). On timeout: card grays out, "Timed out" in `--text-muted`.

**Reasoning panel:** Collapsed by default: "Thinking..." with animated dots. Expanded: `--text-muted` monospace text in `--card-bg` background. Toggle via tap/click on the panel header.

**Error card:** `--error` left border. Error message text. "Retry" button (re-sends last user message). Dismissible with `×`.

### Mobile Layout (Primary Viewport)

```
┌──────────────────────────┐
│ [←] Session Name     [⚙] │  44px touch targets
│ [Chat] [Terminal]         │  Segmented control tabs
│──────────────────────────│
│                           │
│  Message thread           │  Virtualized, full viewport
│  (auto-scroll to bottom)  │  height minus header+input
│                           │
│  ⚡ Permission [sticky]   │  Full-bleed, above input
│──────────────────────────│
│ [Yes] [No] [Continue]     │  Horizontal scroll if >3
│──────────────────────────│
│ Type a message...     [⬆] │  Fixed bottom
└──────────────────────────┘
```

Content hierarchy (mobile):
1. Latest message (auto-scroll, largest weight)
2. Actionable items (permission cards — sticky)
3. File changes (compact diff cards)
4. Metadata (tokens/cost — small, bottom of thread)
5. Quick replies (horizontal row above input)
6. Input (fixed bottom)

### Interaction States

| Feature | Loading | Empty | Error | Success | Streaming |
|---------|---------|-------|-------|---------|-----------|
| SDK init | Shimmer + "Starting..." | N/A | Yellow banner: fallback to terminal | Chat view loads | N/A |
| Chat (no msgs) | N/A | "Send a message to start" + blinking cursor | N/A | N/A | N/A |
| Agent message | Pulsing ● dot | N/A | Red-border error card + Retry | Rendered markdown | Word-by-word text |
| File change | N/A (instant) | N/A | "Failed to read" | Filename + ±stats | N/A |
| Permission | N/A | N/A | "Timed out" (grayed) | "Approved ✓" / "Denied ✗" | Timer countdown |
| Reasoning | N/A | N/A | N/A | Collapsible panel | "Thinking..." animated |
| Quick replies | N/A | Row hidden | N/A | Button row | N/A |
| Cost/progress | "—" | "—" | "—" | "12.4k · $0.03" | Number updates |
| Send button | N/A | Disabled (gray) | N/A | Enabled (accent) | Disabled ("...") |
| Terminal tab | "Starting shell..." spinner | Shell prompt | "Shell failed" + retry | Interactive | N/A |

### Accessibility

| Element | Keyboard | Screen Reader | Touch Target |
|---------|----------|--------------|--------------|
| Chat/Terminal tabs | Arrow keys | `role="tablist"` + `aria-selected` | 44x44px |
| Send button | Enter (Shift+Enter = newline) | `aria-label="Send message"` | 44x44px |
| Approve/Deny | Tab + Enter | `aria-label="Approve: Run npm test"` | Full-width, 48px |
| Quick replies | Tab through, Enter | `role="group"` + `aria-label` | 36px height |
| Message cards | Not focusable | `role="article"` | N/A |
| Reasoning toggle | Enter/Space | `aria-expanded` + `aria-controls` | 44px |

## Conductor Learnings Applied

Key insights from reverse-engineering the Conductor app (Tauri + Node.js sidecar):
- SDK communicates via `--output-format stream-json --input-format stream-json` over stdin/stdout
- Event types: `thread/started`, `turn/started`, `item/started` (agentMessage, fileChange, commandExecution, mcpToolCall, reasoning), `item/completed`, `turn/completed`
- `canUseTool` callback enables interactive permission approval
- `supportedCommands()` returns available slash commands during SDK init
- Session reuse: keep the SDK process alive, send new messages to stdin
- Idle sweep: terminate sessions after 30min inactive (we should do similar)
