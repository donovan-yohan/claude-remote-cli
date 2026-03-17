# Mobile UX Fixes (Android Keyboard, Autocorrect, Debug Tools)

**Created:** 2026-03-17
**Status:** Draft

## Goal

Fix five diagnosed mobile UX issues with concrete root causes from device diagnostics.

## Approach

Each fix has a clear root cause and targeted solution — no guessing.

## Key Decisions

### 1. Android keyboard opens then immediately closes

**Root cause (from BLUR diagnostics):**
```
FOCUS_REQ inputEl=SET
BLUR activeElement=INPUT.mobile-input    ← blurred immediately
BLUR activeElement=BODY.                 ← repeated
```
After `touchend`, Android fires synthetic `mousedown`/`click` events on the terminal canvas. These cause the browser to defocus the hidden input.

**Fix:** Call `e.preventDefault()` on `touchend` in `onTerminalTouchEnd` after calling `focus()`. This suppresses synthetic mouse event generation.

### 2. Autocorrect sends suffix-only data (Gboard)

**Root cause (from debug logs):**
```
val="tsestin" cursor=0,0  data="esting "
→ PIPELINE: payload="⌫⌫⌫⌫⌫⌫⌫esting "   ← should be "testing "
```
Gboard sends suffix-only data ("esting " not "testing "). The review incorrectly removed the first-char check. Need to restore: when `data[0] !== lastWord[0]`, prepend the first char.

**Fix:** Restore the Gboard/suffix disambiguation in `handleInsert`:
- `data[0] === firstChar` → data is the full replacement (use as-is)
- `data[0] !== firstChar` → data is suffix (prepend firstChar)

### 3. Debug logs not copyable

**Problem:** No way to copy debug logs from the phone to share with developers.

**Fix:** Add a "Copy" button next to the "dbg" toggle that copies `debugLines.join('\n')` to clipboard.

### 4. Replace Ctrl+D with Ctrl+V (paste)

**Problem:** Ctrl+D (EOF/detach) is rarely useful on mobile. Ctrl+V (paste from phone clipboard into terminal) is much more valuable.

**Fix:** Change the `^D` toolbar button to `^V`. On tap, read from `navigator.clipboard.readText()` and send the text to the PTY via `sendPtyData()`. For images, use the existing image upload flow.

### 5. Buffer mirror overlays debug menu

**Problem:** The yellow `buf:` bar overlaps the debug panel.

**Fix:** Move the buffer mirror above the debug panel or integrate it as the first line of the debug panel.

## Affected Files

| File | Changes |
|---|---|
| `frontend/src/components/Terminal.svelte` | `e.preventDefault()` in touchend handler |
| `server/mobile-input-pipeline.ts` | Restore first-char disambiguation |
| `frontend/src/components/MobileInput.svelte` | Copy button, mirror positioning |
| `frontend/src/components/Toolbar.svelte` | Replace ^D with ^V paste |
| `test/mobile-input.test.ts` | Update cursor-0 tests for suffix case |
