# Plan: Mobile UX Fixes

> **Status**: Active | **Created**: 2026-03-17
> **Design**: `docs/design-docs/2026-03-17-mobile-ux-fixes-design.md`

## Progress

- [x] Task 1: Fix Android keyboard blur — add e.preventDefault() to touchend
- [x] Task 2: Restore autocorrect first-char disambiguation in pipeline
- [x] Task 3: Add copy button to debug panel
- [x] Task 4: Replace ^D toolbar button with ^V paste
- [x] Task 5: Fix buffer mirror overlay position
- [x] Task 6: Update tests for restored suffix case
- [x] Task 7: Remove temporary console.log diagnostics (done inline with Task 1)
- [x] Task 8: Build + test verification

---

### Task 1: Fix Android keyboard blur
**File:** `frontend/src/components/Terminal.svelte`
**Fix:** In `onTerminalTouchEnd`, after calling `mobileInputRef?.focus()`, call `e.preventDefault()` to suppress synthetic mouse events that blur the input.

### Task 2: Restore autocorrect first-char disambiguation
**File:** `server/mobile-input-pipeline.ts`
**Fix:** In the cursor-0 handler, restore the check: if `data[0] === firstChar`, data is the full replacement (use as-is); otherwise prepend firstChar (suffix mode).

### Task 3: Add copy button to debug panel
**File:** `frontend/src/components/MobileInput.svelte`
**Fix:** Add a "Copy" button next to "dbg" that copies `debugLines.join('\n')` to clipboard via `navigator.clipboard.writeText()`.

### Task 4: Replace ^D with ^V paste
**File:** `frontend/src/components/Toolbar.svelte`
**Fix:** Change the `^D` button to `^V`. On tap, read text from `navigator.clipboard.readText()` and send via `onSendKey()`. For images, trigger the existing image upload flow.

### Task 5: Fix buffer mirror overlay
**File:** `frontend/src/components/MobileInput.svelte`
**Fix:** Move the buffer mirror inside the debug panel as the first sticky line, instead of a separate fixed element.

### Task 6: Update tests
**File:** `test/mobile-input.test.ts`
**Fix:** Add test for suffix-only data case (data[0] !== firstChar). Update existing Gboard test to verify full-word case still works.

### Task 7: Remove console.log diagnostics
**File:** `frontend/src/components/Terminal.svelte`
**Fix:** Remove the temporary `console.log('[TAP]...')` statements from `onTerminalTouchEnd` — the dbg panel diagnostics (FOCUS_REQ, BLUR) are sufficient.

### Task 8: Build + test
Run `npm run build && npm test` to verify everything compiles and passes.
