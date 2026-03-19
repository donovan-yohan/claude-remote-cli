# Bug Analysis: Branch Rename PTY Injection Is Fundamentally Broken

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: server/ws.ts (lines 174-196), branch rename interception architecture, idle detection system

## Symptoms
- First Enter on new mountain-named worktrees corrupts user input (duplicated or truncated text)
- In tmux sessions, the injected rename prompt doesn't appear until the user presses Enter again
- The `clearLine` approach (`\r` + spaces + `\r`) fails against Claude Code's Ink/React TUI
- User's first interaction is garbled 100% of the time on mountain-named worktrees
- **Related**: Status indicator oscillation (idle timer can't distinguish "agent processing" from "waiting for input")

## Reproduction Steps
1. Open web interface, click "New Worktree" on any workspace
2. Wait for Claude Code TUI to load
3. Type a message and press Enter
4. Observe: text is duplicated, truncated, or rename prompt appears only after a second Enter

## Root Cause

**The PTY injection approach is architecturally unsound.** The current code (`ws.ts:174-196`) tries to:
1. Buffer user keystrokes while simultaneously echoing them to the PTY (line 180)
2. On Enter, "clear" the echoed text with `\r` + spaces + `\r` (line 188-189)
3. Replay the rename prompt + buffered text as a single write (line 191)

This fails for three independent reasons:

### Reason 1: Claude Code is NOT readline
Claude Code uses a React/Ink custom input component. Neither `\x15` (Ctrl+U, original approach) nor `\r` + space-padding (current approach) reliably clears its input buffer. The TUI maintains its own internal state that doesn't respond to terminal control sequences the way a readline-based shell would.

### Reason 2: tmux adds input buffering indirection
In tmux mode, `pty.write()` writes to the node-pty master fd, which feeds into the tmux client process. tmux has its own input processing layer — it may buffer, reorder, or batch inputs differently than direct PTY writes. The two-phase write (clear + replay) can be split across tmux's input processing, causing the rename prompt to appear only after the *next* user interaction.

### Reason 3: Echo-then-clear is a race condition
Characters are echoed to the PTY one at a time (line 180), but the "clear" happens all at once (line 188). If the TUI has already processed and rendered those characters differently than a simple character grid, the space-overwrite is insufficient or destructive.

### Related Root Cause: Idle Detection Has No Semantic Understanding
The current idle system (`pty-handler.ts:155-167`) uses a dumb 5-second timer on ANY PTY output. It cannot distinguish between:
- Agent actively processing (streaming output)
- Agent waiting for user input (the `>` prompt)
- Agent showing a permission prompt
- tmux status bar refresh (noise)

This causes the status oscillation bug (see `2026-03-13-status-indicator-oscillation-bug-analysis.md`) and blocks reliable push notifications.

Both problems stem from the same gap: **no semantic parsing of terminal output**.

## Evidence
- `ws.ts:180`: `ptySession.pty.write(str)` — echoes every keystroke to PTY during buffering
- `ws.ts:188-189`: `clearLine` uses `\r` + spaces — assumes cursor-addressable line clearing
- `ws.ts:191`: Single write of `renamePrompt + beforeEnter + afterEnter` — second batch of the same characters
- `pty-handler.ts:176-179`: `proc.onData()` captures ALL output in `scrollback[]` for both tmux and non-tmux
- `pty-handler.ts:97-100`: tmux mode wraps the inner command in `tmux new-session` — PTY writes go to tmux's stdin
- `pty-handler.ts:155-167`: `resetIdleTimer()` fires on every `onData` — no output classification
- `types.ts:4`: `AgentType = 'claude' | 'codex'` — agent type already on every session
- Prior analysis (`2026-03-19-first-enter-duplicate-content-bug-analysis.md`) confirmed duplication/truncation symptoms

## Impact Assessment
- **All new mountain-named worktree sessions** are affected (the primary creation flow)
- User's very first interaction with Claude is broken — terrible first impression
- tmux variant is worse: rename prompt is invisible until second Enter, causing confusion
- No workaround exists for users — they must deal with garbled first message every time
- Status indicator oscillation makes it impossible to know which sessions actually need attention
- Push notification system cannot be reliable without semantic state detection

## Recommended Fix Direction

**Remove PTY injection entirely.** Replace with a vendor-extensible terminal output parser that enables both sideband branch renaming and semantic agent state detection.

### Key Insight: Scrollback Buffer Already Captures Terminal Output

`pty-handler.ts` already stores all PTY output in `session.scrollback[]` via `proc.onData()`. This works identically for both tmux and non-tmux modes because node-pty captures the output from the PTY master fd regardless of what's running inside.

For tmux specifically, there's also `tmux capture-pane -p -t <session>` which dumps the visible pane content as clean text (no escape sequences).

### Proposed Architecture: Vendor-Extensible Terminal Output Parser

Different agents (Claude Code, Codex) have completely different TUI patterns. The parser must be implemented per-vendor so each agent type can define its own output signatures.

#### Parser Interface

```typescript
// server/output-parser.ts

/** Semantic states an agent can be in, derived from terminal output */
type AgentState = 'initializing' | 'waiting-for-input' | 'processing' | 'permission-prompt' | 'error' | 'idle';

/** Result of parsing a chunk of terminal output */
interface ParseResult {
  state: AgentState;
  /** The user's first message text, if detected */
  firstMessage?: string;
  /** Whether the agent has shown its initial ready prompt */
  ready?: boolean;
}

/** Per-vendor parser — each agent type implements this */
interface OutputParser {
  /** Called on each new PTY output chunk. Can examine recent scrollback for context. */
  onData(chunk: string, recentScrollback: string[]): ParseResult | null;
  /** Reset internal state (e.g., on session restart) */
  reset(): void;
}

/** Registry keyed by AgentType */
const parsers: Record<AgentType, () => OutputParser> = {
  claude: () => new ClaudeOutputParser(),
  codex: () => new CodexOutputParser(),  // stub for now
};
```

#### Claude-Specific Implementation (first vendor)

Claude Code's Ink/React TUI has distinctive output patterns:

| State | Terminal output signal |
|-------|----------------------|
| **Initializing** | Loading/startup text before first prompt |
| **Waiting for input** | The `>` prompt rendered by Ink — cursor positioned after it |
| **Processing** | Streaming text, tool call blocks, thinking indicators |
| **Permission prompt** | "Allow" / "Deny" prompt patterns |
| **Error** | Error message patterns, stack traces |

The Claude parser would:
1. Strip ANSI escape sequences from chunks
2. Match against known patterns (regex or string matching on clean text)
3. Track state transitions (e.g., `processing` → `waiting-for-input` = "task complete, needs attention")

#### Codex Stub

Codex has a different TUI (not Ink-based). Its parser would be a minimal stub initially:
```typescript
class CodexOutputParser implements OutputParser {
  onData(): ParseResult | null { return null; } // no-op, falls back to timer
  reset(): void {}
}
```

When Codex-specific patterns are identified later, the stub gets replaced without touching any shared code.

### How This Fixes Both Problems

#### 1. Branch Rename (sideband, no PTY injection)

```
User types first message → Enter
    ↓
ws.ts: if (needsBranchRename) {
    // Capture the message text but DON'T modify PTY stream
    const firstMessage = buffered + str;
    ptySession.pty.write(str);  // pass through unmodified
    ptySession.needsBranchRename = false;

    // Sideband: spawn headless claude to generate branch name
    spawnBranchRename(ptySession, firstMessage, configPath);
    return;
}
    ↓
spawnBranchRename():
    execFile('claude', ['-p', '--model', 'haiku',
        `Output ONLY a kebab-case branch name for: ${message}`],
        { cwd: session.cwd })
    → parse stdout → git branch -m <name>
    → startBranchWatcher() picks up the change
    → broadcastEvent('session-renamed', ...)
```

#### 2. Agent State Detection (replaces dumb idle timer)

```
proc.onData((data) => {
    // Existing: scrollback, lastActivity, meta flush
    ...

    // NEW: semantic state detection via vendor parser
    const result = session.outputParser.onData(data, session.scrollback.slice(-20));
    if (result && result.state !== session.agentState) {
        session.agentState = result.state;
        broadcastEvent('session-state-changed', {
            sessionId: session.id,
            state: result.state,
        });
    }
});
```

The frontend replaces `session-idle-changed` with `session-state-changed`, and the push notification system fires on `waiting-for-input` instead of the unreliable `idle` signal.

### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| `claude -p` sideband rename | AI-quality names, works offline from PTY | Extra process spawn, ~2-3s latency, haiku cost |
| Per-vendor output parser | Accurate state, extensible, fixes oscillation bug | Patterns may change across Claude Code versions |
| Timer fallback for unknown agents | No breakage for new agent types | Less accurate than semantic parsing |

### Reading Terminal Output (for both tmux and non-tmux)

- **Non-tmux**: `session.scrollback.join('')` — already available, contains all raw PTY output (with ANSI escape sequences)
- **tmux**: `tmux capture-pane -t <session-name> -p` — returns clean visible text without escapes. Can also use `tmux capture-pane -t <session-name> -p -S -` for full scrollback history.
- **Both**: The scrollback buffer in `pty-handler.ts` works for both modes since node-pty captures output from the PTY master fd regardless.
- Could add a `/sessions/:id/output` REST endpoint that returns the scrollback buffer, useful for diagnostics.

### File Structure

```
server/
  output-parsers/
    index.ts          # OutputParser interface, AgentState type, parser registry
    claude-parser.ts  # Claude Code TUI pattern matching
    codex-parser.ts   # Stub — returns null, falls back to timer
  pty-handler.ts      # Instantiates parser from registry based on session.agent
  ws.ts               # Emits session-state-changed instead of session-idle-changed
```
