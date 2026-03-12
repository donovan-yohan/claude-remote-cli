# Plan: Mobile Autocorrect Recovery & tmux Copy-Mode Selection

> **Status**: Active | **Created**: 2026-03-12
> **Source**: `docs/bug-analyses/2026-03-12-mobile-autocorrect-and-selection-bug-analysis.md`

## Goal

Fix two mobile UX issues:
1. Autocorrect corrections are silently lost due to cursor-0 desync in the hidden input proxy
2. Long-press text selection selects all terminal text instead of allowing specific selection

## Approach

- **Autocorrect**: Recover from BAD_AUTOCORRECT instead of reverting — treat as whole-word replacement (send backspaces + corrected text)
- **Text selection**: For tmux sessions, enter tmux copy-mode on long-press instead of browser-native selection. Add copy-mode toolbar buttons. Keep browser fallback for non-tmux sessions.

## Progress

- [x] Task 1: Add `useTmux` to frontend SessionSummary type and thread through components
- [x] Task 2: Fix BAD_AUTOCORRECT recovery in MobileInput.svelte
- [x] Task 3: Replace browser selection with tmux copy-mode for tmux sessions
- [x] Task 4: Add copy-mode toolbar buttons
- [x] Task 5: Build, type-check, and test

---

### Task 1: Add `useTmux` to frontend type and thread through components

**Files:** `frontend/src/lib/types.ts`, `frontend/src/App.svelte`, `frontend/src/components/Terminal.svelte`, `frontend/src/components/Toolbar.svelte`

**Changes:**
1. Add `useTmux?: boolean` to `SessionSummary` in `frontend/src/lib/types.ts`
2. In `App.svelte`, derive `activeSessionUseTmux` from `sessionState.sessions` and pass to Terminal and Toolbar as a prop
3. Add `useTmux` prop to Terminal.svelte and Toolbar.svelte

### Task 2: Fix BAD_AUTOCORRECT recovery in MobileInput.svelte

**File:** `frontend/src/components/MobileInput.svelte`

**Changes:**
In `handleInsert()`, replace the BAD_AUTOCORRECT revert with recovery logic:

```ts
// Instead of just reverting, treat as autocorrect replacement:
// 1. Send backspaces to delete existing word from terminal
// 2. Send the corrected text (data)
// 3. Reset input to corrected text
if (data.length > 1 && intent.cursorBefore === 0 &&
    intent.valueBefore.length > 0 &&
    currentValue === data + intent.valueBefore) {
  dbg('  → AUTOCORRECT_RECOVER: replacing "' + intent.valueBefore + '" with "' + data + '"');
  const charsToDelete = codepointCount(intent.valueBefore);
  let payload = '';
  for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
  payload += data;
  scheduleSend(payload);
  inputEl.value = data;
  ensureCursorAtEnd();
  return;
}
```

**Rationale:** When the keyboard prepends data at position 0 (cursor-0 bug), the data IS the autocorrect suggestion. The `valueBefore` is what's currently in the terminal input line. Sending backspaces for `valueBefore` + the new `data` correctly applies the autocorrect.

### Task 3: Replace browser selection with tmux copy-mode for tmux sessions

**File:** `frontend/src/components/Terminal.svelte`

**Changes:**
1. Accept `useTmux` prop
2. Track `inCopyMode` state
3. Modify `enterSelectionMode()`:
   - If `useTmux` is true: send `\x02[` (Ctrl-b + `[`) to enter tmux copy-mode, set `inCopyMode = true`
   - If `useTmux` is false: keep existing browser-native selection (current behavior)
4. Export `inCopyMode` and `exitCopyMode()` for Toolbar to use
5. `exitCopyMode()` sends `q` to quit copy-mode and resets state

### Task 4: Add copy-mode toolbar buttons

**Files:** `frontend/src/components/Toolbar.svelte`, `frontend/src/App.svelte`

**Changes:**
1. Add `useTmux` and `inCopyMode` props to Toolbar
2. When `inCopyMode` is true, show copy-mode buttons instead of normal buttons:
   - `Space` → Start/toggle selection (`\x20` sent to PTY)
   - `w` → Select word forward (`w` sent to PTY)
   - `b` → Word backward (`b` sent to PTY)
   - `h/j/k/l` → Cursor movement (sent to PTY)
   - `Enter` → Copy & exit copy-mode (`\r` sent to PTY — tmux copies selection and exits)
   - `q` → Cancel copy-mode (`q` sent to PTY)
3. When copy-mode button `Enter` or `q` is pressed, call `exitCopyMode()` on Terminal ref
4. Wire up props in App.svelte

### Task 5: Build, type-check, and test

**Commands:** `npm run build`, `npm test`

Verify:
- No TypeScript errors
- No svelte-check errors
- All unit tests pass
- Frontend builds successfully
