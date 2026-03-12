# Bug Analysis: Mobile Autocorrect Failure & Terminal Text Selection

> **Status**: Confirmed | **Date**: 2026-03-12
> **Severity**: High
> **Affected Area**: `frontend/src/components/MobileInput.svelte`, `frontend/src/components/Terminal.svelte`

## Symptoms

1. **Autocorrect**: Mobile keyboard autocorrect triggers `BAD_AUTOCORRECT` detection and reverts, losing the correction entirely. Debug log shows cursor stuck at position 0 causing the keyboard to prepend corrected text instead of replacing.
2. **Text selection**: Long-press selection selects the entire terminal output rather than allowing word/line-level selection at the touch point.

## Reproduction Steps

### Autocorrect
1. Open claude-remote-cli on a mobile device (iOS Safari or Android Chrome)
2. Tap terminal to focus the hidden MobileInput
3. Type a word character by character (e.g. "handling")
4. Wait for or tap an autocorrect suggestion
5. Observe: autocorrect fires `insertText` with multi-char data at cursor position 0, detected as `BAD_AUTOCORRECT`, input reverted — correction lost

### Text Selection
1. Open claude-remote-cli on a mobile device
2. Long-press (500ms) on terminal output text
3. Observe: all visible terminal text is selected instead of allowing word-level selection at the press point

## Root Cause

### Issue 1: Autocorrect — Cursor-0 Desync in Hidden Input Proxy

The mobile input architecture uses a hidden `<input>` element (`clip-path: inset(50%)`) as a proxy for terminal input. This proxy is desynchronized from the actual terminal line content:

- The hidden input buffer is trimmed at 20 chars (`syncBuffer()` at `MobileInput.svelte:242-253`)
- `ensureCursorAtEnd()` attempts to fix cursor drift, but iOS Safari periodically loses cursor tracking on clipped/hidden inputs
- When the cursor resets to 0, autocorrect fires `insertText` with multi-char data at position 0
- The `BAD_AUTOCORRECT` detection (`MobileInput.svelte:143-151`) catches this (data.length > 1, cursorBefore === 0, result is data + valueBefore) and reverts
- **The revert is correct** (prevents garbage from being sent to the terminal), but the autocorrect suggestion is permanently lost

**Fundamental problem**: The hidden input proxy model cannot give the mobile keyboard accurate context about what text exists on the terminal line, so autocorrect operates on stale/wrong state. The keyboard's "cursor position 0" belief is an iOS Safari bug with clipped inputs, but any workaround within the current architecture is fragile.

### Issue 2: Text Selection — Intentional Select-All in enterSelectionMode()

In `Terminal.svelte:313-321`, `enterSelectionMode()` intentionally selects all text in `.xterm-rows`:

```ts
const range = document.createRange();
range.selectNodeContents(rows);  // Selects ALL text
const sel = window.getSelection();
sel?.removeAllRanges();
sel?.addRange(range);
```

This was designed to give the user immediate selection handles, but:
- Mobile browsers struggle with adjusting selection handles on xterm.js's complex DOM (spans per character/style run)
- Users expect long-press to start a word-level selection at the touch point
- The select-all behavior forces users to manually narrow a massive selection, which is difficult on mobile

## Evidence

- Screenshot shows debug log with `BAD_AUTOCORRECT: data prepended at pos 0, reverting` after typing "handling" character by character
- `MobileInput.svelte:143-151` — BAD_AUTOCORRECT detection path
- `MobileInput.svelte:231-238` — ensureCursorAtEnd() cursor fix that fails intermittently on iOS
- `Terminal.svelte:313-321` — selectNodeContents(rows) selecting all visible text
- `Terminal.svelte:295-322` — enterSelectionMode() enabling userSelect on xterm-screen

## Impact Assessment

- **Autocorrect**: Every mobile user who relies on autocorrect (most mobile users) will find typing frustrating. Corrections are silently dropped.
- **Text selection**: Users cannot copy specific text from terminal output on mobile. Only all-or-nothing selection works, and narrowing handles is unreliable.
- Both issues significantly degrade the mobile experience, which is the primary use case for a remote CLI tool.

## Recommended Fix Direction

### Approach: Leverage tmux for Both Issues

Since sessions now run inside tmux, both issues can be addressed by leveraging tmux's native capabilities instead of fighting browser input/selection APIs.

#### Autocorrect Fix — tmux send-keys Backend API

**Concept**: Instead of translating individual keystrokes and autocorrect replacements into backspace + char sequences through `pty.write()`, send text via `tmux send-keys -l` through a new backend API endpoint.

1. **New backend endpoint**: `POST /api/sessions/:id/send-keys` that calls `execFile('tmux', ['send-keys', '-t', tmuxSessionName, '-l', text])`
2. **Frontend MobileInput change**: When autocorrect fires a replacement (`insertReplacementText` or `insertText` with range), instead of computing backspaces + new chars:
   - Clear the current input word on the terminal line using `send-keys` with appropriate backspaces
   - Send the corrected word via `send-keys -l`
3. **Alternative simpler approach**: On autocorrect detection, instead of reverting, extract what the keyboard intended and send the correction. The `handleInsert` already handles the range-based case; the `BAD_AUTOCORRECT` case at cursor 0 could try to diff the intended correction against the known input buffer and apply it.
4. **Simplest fix**: Accept that cursor-0 autocorrect is a browser bug and instead of reverting, try to recover by: (a) detecting the original word from `valueBefore`, (b) detecting the corrected word from `data`, (c) sending backspaces for the original + the corrected text.

#### Text Selection Fix — tmux copy-mode

**Concept**: Instead of enabling browser-native text selection on xterm.js DOM, enter tmux's copy-mode which provides cursor-based text selection designed for terminals.

1. **On long-press**: Send `tmux copy-mode` via the send-keys API instead of calling `enterSelectionMode()`
2. **tmux copy-mode provides**: cursor movement, word/line selection, visual block mode — all rendered natively in the terminal
3. **Copy integration**: tmux's `set-clipboard on` and OSC 52 passthrough are already configured (`sessions.ts:63-64`), so selected text automatically copies to the browser clipboard
4. **Toolbar integration**: Add copy-mode navigation buttons to the mobile toolbar (select word, select line, page up/down, copy) that send the corresponding tmux copy-mode keybindings
5. **Fallback**: Keep the existing browser-native selection as a fallback for non-tmux sessions

### Trade-offs

- **tmux dependency**: These fixes only work for tmux sessions. Non-tmux terminal sessions would still use the current approach.
- **tmux send-keys latency**: `send-keys` goes through `execFile()` which adds ~5-10ms per call vs direct `pty.write()`. Could batch or use a tmux control-mode socket for lower latency.
- **copy-mode UX**: tmux copy-mode has its own keybindings that mobile users need to learn. The toolbar can abstract most of this away.
