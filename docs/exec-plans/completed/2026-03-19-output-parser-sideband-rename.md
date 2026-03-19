# Plan: Vendor-Extensible Output Parser + Sideband Branch Rename

> **Status**: Active | **Created**: 2026-03-19
> **Source**: `docs/bug-analyses/2026-03-19-branch-rename-pty-injection-bug-analysis.md`
> **Supersedes**: `2026-03-19-branch-lifecycle-fix.md` (branch rename portion), `2026-03-19-first-enter-duplicate-content.md`

## Goal

Replace the broken PTY injection branch rename with a sideband approach powered by a vendor-extensible terminal output parser. The parser also replaces the dumb 5-second idle timer with semantic agent state detection.

## Progress

- [x] Task 1: Create output parser interface and types (`server/output-parsers/index.ts`)
- [x] Task 2: Implement Claude output parser (`server/output-parsers/claude-parser.ts`)
- [x] Task 3: Create Codex stub parser (`server/output-parsers/codex-parser.ts`)
- [x] Task 4: Integrate parser into pty-handler (`server/pty-handler.ts`)
- [x] Task 5: Add `AgentState` to session types and API responses (`server/types.ts`)
- [x] Task 6: Replace idle timer with parser-driven state events (`server/ws.ts`, `server/pty-handler.ts`)
- [x] Task 7: Implement sideband branch rename (`server/ws.ts`)
- [x] Task 8: Add output parser tests (`test/output-parser.test.ts`)
- [x] Task 9: Update frontend to use `session-state-changed` events
- [x] Task 10: Update docs (ARCHITECTURE.md, DESIGN.md, FRONTEND.md)

---

### Task 1: Create output parser interface and types

**File:** `server/output-parsers/index.ts`

Create the parser interface, `AgentState` type, and parser registry.

```typescript
import type { AgentType } from '../types.js';

/** Semantic states an agent can be in, derived from terminal output */
export type AgentState = 'initializing' | 'waiting-for-input' | 'processing' | 'permission-prompt' | 'error' | 'idle';

/** Result of parsing a chunk of terminal output */
export interface ParseResult {
  state: AgentState;
  /** The user's first message text, if detected during buffering */
  firstMessage?: string;
}

/** Per-vendor parser — each agent type implements this */
export interface OutputParser {
  /** Called on each new PTY output chunk. Can examine recent scrollback for context. */
  onData(chunk: string, recentScrollback: string[]): ParseResult | null;
  /** Reset internal state (e.g., on session restart) */
  reset(): void;
}

// Import concrete parsers
import { ClaudeOutputParser } from './claude-parser.js';
import { CodexOutputParser } from './codex-parser.js';

/** Registry: factory per agent type */
export const outputParsers: Record<AgentType, () => OutputParser> = {
  claude: () => new ClaudeOutputParser(),
  codex: () => new CodexOutputParser(),
};
```

**Architecture constraint:** This module confines its logic — no imports from other server modules except `types.ts`.

### Task 2: Implement Claude output parser

**File:** `server/output-parsers/claude-parser.ts`

Claude Code uses React/Ink for its TUI. Key patterns to detect:

- **Waiting for input**: The `>` prompt character rendered by Ink after a turn completes. Also the initial "How can I help?" prompt on startup.
- **Processing**: Streaming output, tool call indicators (lines with `⏺`, `●`, or tool names), thinking dots.
- **Permission prompt**: "Allow" / "Deny" patterns, tool permission requests.
- **Error**: Error messages, "Error:" prefix patterns.
- **Initializing**: Early output before the first prompt appears.

Implementation approach:
1. Strip ANSI escape sequences from each chunk using a regex.
2. Match cleaned text against known patterns.
3. Use a simple state machine: track current state, only emit transitions.
4. The `idle` state is NOT derived here — it remains timer-based as a fallback. The parser emits the semantic states above; `idle` means "no output AND no semantic state for N seconds."

```typescript
import type { OutputParser, ParseResult, AgentState } from './index.js';

// Strip ANSI escape sequences
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]/g;

export class ClaudeOutputParser implements OutputParser {
  private currentState: AgentState = 'initializing';
  private hasSeenFirstPrompt = false;

  onData(chunk: string, recentScrollback: string[]): ParseResult | null {
    const clean = chunk.replace(ANSI_RE, '');
    if (!clean.trim()) return null; // pure escape sequences, ignore

    const newState = this.classify(clean, recentScrollback);
    if (newState && newState !== this.currentState) {
      this.currentState = newState;
      return { state: newState };
    }
    return null; // no state change
  }

  reset(): void {
    this.currentState = 'initializing';
    this.hasSeenFirstPrompt = false;
  }

  private classify(clean: string, _recentScrollback: string[]): AgentState | null {
    // Permission prompt detection (highest priority)
    if (/\b(Allow|Deny|approve|reject)\b/i.test(clean) && /\b(tool|permission|access)\b/i.test(clean)) {
      return 'permission-prompt';
    }

    // Error detection
    if (/^Error:|ERROR:|✗|error:/m.test(clean)) {
      return 'error';
    }

    // Waiting for input: the > prompt or "How can I help" on fresh start
    // Claude Code shows ">" at start of line when waiting for user input
    if (/^>\s*$/m.test(clean) || /How can I help/i.test(clean)) {
      this.hasSeenFirstPrompt = true;
      return 'waiting-for-input';
    }

    // Processing: any substantive output after the first prompt
    if (this.hasSeenFirstPrompt && clean.trim().length > 0) {
      return 'processing';
    }

    // Before first prompt — still initializing
    if (!this.hasSeenFirstPrompt) {
      return 'initializing';
    }

    return null;
  }
}
```

**Important:** These patterns are a best-effort heuristic. Claude Code doesn't expose a machine-readable state API, so we pattern-match on rendered TUI output. The patterns should be tuned against real terminal captures.

### Task 3: Create Codex stub parser

**File:** `server/output-parsers/codex-parser.ts`

Minimal stub that returns null — falls back to timer-based idle detection.

```typescript
import type { OutputParser, ParseResult } from './index.js';

export class CodexOutputParser implements OutputParser {
  onData(_chunk: string, _recentScrollback: string[]): ParseResult | null {
    return null; // No-op: falls back to timer-based idle detection
  }

  reset(): void {
    // No state to reset
  }
}
```

### Task 4: Integrate parser into pty-handler

**File:** `server/pty-handler.ts`

Changes:
1. Import `outputParsers` registry and `OutputParser` type
2. In `createPtySession()`, instantiate the correct parser: `const parser = outputParsers[agent]();`
3. Store parser on the session object (add `outputParser` to `PtySession` interface in Task 5)
4. In `proc.onData()` callback, after scrollback push, call `parser.onData(data, scrollback.slice(-20))`
5. If parse result is non-null and state changed, invoke a new `stateChangeCallbacks` array (mirroring `idleChangeCallbacks` pattern)
6. Keep the idle timer as fallback — it should still work for terminal sessions and agents without parsers

### Task 5: Add `AgentState` to session types and API responses

**File:** `server/types.ts`

Changes:
1. Import `AgentState` and `OutputParser` from `./output-parsers/index.js`
2. Add to `BaseSession`: `agentState: AgentState;`
3. Add to `PtySession`: `outputParser: OutputParser;`
4. Add to `SessionSummary`: `agentState: AgentState;`
5. Default `agentState` to `'initializing'` in `pty-handler.ts`

### Task 6: Replace idle signal with parser-driven state events

**Files:** `server/ws.ts`, `server/pty-handler.ts`, `server/sessions.ts`

Changes in `pty-handler.ts`:
1. Add `stateChangeCallbacks: Array<(sessionId: string, state: AgentState) => void>` alongside `idleChangeCallbacks`
2. Add `onStateChange(cb)` export
3. In `onData`, when parser returns a state change, update `session.agentState` and fire callbacks
4. Keep idle timer — but add a condition: if the parser has detected `waiting-for-input`, don't reset idle timer on subsequent parser noise (this fixes the oscillation bug)

Changes in `ws.ts`:
1. Wire `sessions.onStateChange()` to broadcast `session-state-changed` events with `{ sessionId, state }`
2. Keep `session-idle-changed` for backward compat — `idle` is still useful as a "no output" signal
3. Remove the branch rename PTY injection block (lines 174-196)

Changes in `sessions.ts`:
1. Thread `stateChangeCallbacks` through to `createPtySession()`
2. Add `onStateChange()` registration function
3. Include `agentState` in session summaries

### Task 7: Implement sideband branch rename

**File:** `server/ws.ts`

Replace the current injection block (lines 174-196) with:

```typescript
// Branch rename: capture first message, pass through unmodified, rename out-of-band
if (ptySession.needsBranchRename) {
  if (!(ptySession as any)._renameBuffer) (ptySession as any)._renameBuffer = '';
  const enterIndex = str.indexOf('\r');
  if (enterIndex === -1) {
    (ptySession as any)._renameBuffer += str;
    ptySession.pty.write(str); // pass through to PTY normally
    return;
  }
  // Enter detected — pass through unmodified, capture for sideband rename
  const buffered: string = (ptySession as any)._renameBuffer;
  const firstMessage = buffered + str.slice(0, enterIndex);
  ptySession.pty.write(str); // pass through the Enter and everything after
  ptySession.needsBranchRename = false;
  delete (ptySession as any)._renameBuffer;

  // Sideband rename via headless claude
  spawnBranchRename(ptySession, firstMessage, configPath, broadcastEvent);
  return;
}
```

Add `spawnBranchRename()` function:

```typescript
async function spawnBranchRename(
  session: Session,
  firstMessage: string,
  cfgPath: string | undefined,
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  try {
    const prompt = `Output ONLY a short kebab-case git branch name (no explanation, no backticks, no prefix) that describes this task:\n\n${firstMessage.slice(0, 500)}`;
    const { stdout } = await execFileAsync('claude', ['-p', '--model', 'haiku', prompt], {
      cwd: session.cwd,
      timeout: 30000,
    });
    const branchName = stdout.trim().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    if (!branchName) return;

    // Apply user's branch prefix if configured
    const prefix = session.branchRenamePrompt ? '' : ''; // future: parse from workspace settings
    const fullName = prefix ? `${prefix}/${branchName}` : branchName;

    await execFileAsync('git', ['branch', '-m', fullName], { cwd: session.cwd });

    // Update session state
    session.branchName = fullName;
    session.displayName = fullName.split('/').pop() || fullName;
    broadcastEvent('session-renamed', {
      sessionId: session.id,
      branchName: fullName,
      displayName: session.displayName,
    });

    if (cfgPath) {
      writeMeta(cfgPath, {
        worktreePath: session.repoPath,
        displayName: session.displayName,
        lastActivity: new Date().toISOString(),
        branchName: fullName,
      });
    }
  } catch {
    // Sideband rename is best-effort — don't fail the session
    // Fall back to branch watcher if claude CLI isn't available
    if (cfgPath) startBranchWatcher(session, broadcastEvent, cfgPath);
  }
}
```

**Key change from current approach:** User's keystrokes pass through to the PTY unmodified. No echo-then-clear, no rename prompt injection. The rename happens entirely out-of-band.

### Task 8: Add output parser tests

**File:** `test/output-parser.test.ts`

Test the Claude parser with real-world-like terminal output snippets:

1. **Initialization → waiting-for-input**: Feed startup text, then the `>` prompt
2. **Waiting-for-input → processing**: Feed output after user sends a message
3. **Processing → waiting-for-input**: Feed the `>` prompt after task completion
4. **Permission prompt detection**: Feed tool permission request text
5. **Error detection**: Feed error message text
6. **Pure ANSI escapes ignored**: Feed escape-only chunks, verify no state change
7. **Codex stub returns null**: Verify CodexOutputParser.onData always returns null
8. **Parser registry**: Verify `outputParsers['claude']()` returns ClaudeOutputParser, `outputParsers['codex']()` returns CodexOutputParser

### Task 9: Update frontend to use `session-state-changed` events

**Files:** `frontend/src/App.svelte`, `frontend/src/lib/state/sessions.svelte.ts`, `frontend/src/lib/types.ts`

Changes:
1. Add `AgentState` type to `frontend/src/lib/types.ts` (mirror of server type)
2. Add `agentState` field to frontend session type
3. In `App.svelte` event handler, handle `session-state-changed` messages: update session's `agentState` in state
4. Refine attention logic: only set attention when `agentState === 'waiting-for-input'` (not on generic idle), which fixes the oscillation bug
5. Keep `session-idle-changed` handler for sessions that don't have parser support (terminal sessions, codex stub)
6. Sidebar status dots updated:
   - Green: `processing`
   - Blue/idle: `idle` (no output, timer-based)
   - Amber glow: `waiting-for-input` (real attention needed)
   - Gray: `initializing` or inactive
   - Yellow pulse: `permission-prompt` (needs immediate user action)

### Task 10: Update docs

**Files:** `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/FRONTEND.md`

Architecture:
- Add `output-parsers/` to the server module table (3 files: index.ts, claude-parser.ts, codex-parser.ts)
- Update data flow diagram to show parser in the PTY output path
- Note the vendor-extensible pattern in architecture invariants

Design:
- Update "Branch auto-rename" section: sideband `claude -p` approach replaces PTY injection
- Update "Idle Detection" section: parser-driven `AgentState` replaces raw idle timer for supported agents
- Add "Output Parser" section documenting the vendor registry pattern

Frontend:
- Update attention state docs: `waiting-for-input` replaces `idle` as the attention trigger
- Update sidebar status dots documentation
- Add `agentState` to state management docs

## Dependencies

- `claude` CLI must be on PATH for sideband rename (graceful fallback to branch watcher if not)
- No new npm dependencies required
- Node.js >= 24.0.0 (existing requirement)

## Risks

- Claude Code TUI patterns may change across versions — parser needs maintenance
- `claude -p --model haiku` adds ~2-3s latency and a small API cost per new worktree
- ANSI stripping regex may miss edge cases — use conservative matching
