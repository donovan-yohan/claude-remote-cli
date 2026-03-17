# Bug Analysis: Touch scrolling doesn't work in non-tmux Claude Code sessions

> **Status**: Confirmed | **Date**: 2026-03-17
> **Severity**: High
> **Affected Area**: `frontend/src/components/Terminal.svelte` — touch scroll handler

## Symptoms
- Cannot scroll up to see previous conversation in Claude Code sessions running without tmux
- Swiping up/down on the terminal does nothing visible

## Reproduction Steps
1. Create a repo session WITHOUT tmux enabled
2. Have a conversation with Claude Code that fills more than one screen
3. Try to swipe up to see earlier output
4. Nothing happens — the conversation doesn't scroll

## Root Cause
The touch scroll handler (`onDocumentTouchMove`) has three branches:

1. **Alternate screen + mouse tracking ON** → sends SGR mouse wheel sequences ✅ works
2. **Alternate screen + mouse tracking OFF** → sends arrow keys ❌ broken
3. **Normal screen** → `term.scrollToLine()` ✅ works

Claude Code is a TUI that uses the alternate screen buffer. When NOT wrapped in tmux, mouse tracking may not be active (depends on whether Claude Code's Ink framework has sent the mouse enable escape sequence). The code falls to branch 2, which sends Up/Down arrow keys — these navigate Claude Code's input field, they don't scroll the conversation.

**The arrow key fallback (branch 2) is wrong for TUI apps.** TUI apps that use the alternate screen expect mouse wheel events for scrolling, not arrow keys. Arrow keys are only appropriate for simple pagers like `less` or `man`.

## Evidence
- `Terminal.svelte` lines 464-477: branch 2 sends `\x1b[A` / `\x1b[B` (arrow keys)
- Lines 444-463: branch 1 sends `\x1b[<64;col;rowM` / `\x1b[<65;col;rowM` (SGR mouse wheel)
- Claude Code uses alternate screen but may not enable mouse tracking
- Arrow keys in Claude Code navigate the input, not the conversation

## Impact Assessment
- All non-tmux Claude Code sessions on mobile are affected
- Users cannot review previous conversation output
- Workaround: enable tmux in settings (tmux sessions have mouse tracking)

## Recommended Fix Direction
Change branch 2 to also send SGR mouse wheel sequences instead of arrow keys. The alternate screen without mouse tracking case should still try wheel events — if the app doesn't handle them, they're harmless. Arrow keys are never the right scroll mechanism for TUI apps.

Alternatively, merge branches 1 and 2: any alternate screen session should send wheel events regardless of mouse tracking state.
