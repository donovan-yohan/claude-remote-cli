# Mobile Input Redesign — Event-Intent Architecture

**Date:** 2026-02-25
**Status:** Approved

## Problem

The current `MobileInput` uses a **value-diffing architecture**: a hidden `<input>` accumulates text, and on each `input` event we diff the old value against the new value, translating the difference into backspace + character sequences for the PTY. This has caused a series of bugs across 5+ commits:

1. **Autocorrect sends massive diffs** — Gboard's autocorrect mutates the DOM in bizarre ways (prepending, rearranging), causing 97+ backspace sequences that wipe the terminal
2. **Gboard silent DOM mutation** — Gboard changes `inputEl.value` before firing `beforeinput`, making `lastInputValue` stale
3. **Cursor-at-end vs autocorrect conflict** — forcing cursor to end prevents the prepend bug but confuses autocorrect about where to operate
4. **Slide-to-delete destroys everything** — the accumulated buffer means any selection-based delete produces a massive diff
5. **Buffer grows indefinitely** — 5-second clear timer never fires during active typing

The fundamental flaw: the input field's accumulated value is the source of truth, but Gboard treats that value as its own playground and mutates it unpredictably.

## Solution

Replace value-diffing with an **event-intent pipeline**. Each `InputEvent` is treated as a command to replay, not a state change to diff.

## Architecture

### Event Pipeline

```
beforeinput → capture intent (inputType, data, targetRanges, valueBefore)
    ↓
input → classify intent → translate to terminal command(s)
    ↓
scheduleSend → batch (10ms) → flush to PTY via WebSocket
```

### Event Classification

| `inputType` | Meaning | Terminal Action |
|---|---|---|
| `insertText` (collapsed range) | Normal character | Send `data` directly |
| `insertText` (non-collapsed range) | Autocorrect | Backspace over range, send replacement |
| `insertReplacementText` | Explicit replacement | Backspace over range, send replacement |
| `deleteContentBackward` | Backspace | Send N × `\x7f` from range size |
| `deleteWordBackward` | Slide-to-delete word | Send N × `\x7f` from range size |
| `deleteSoftLineBackward` | Slide-to-delete line | Send N × `\x7f` from range size |
| `deleteBySoftwareKeyboard` | Keyboard-initiated delete | Send N × `\x7f` from range size |
| `insertFromPaste` | Paste | Diff valueBefore vs current, send pasted text |
| (anything else) | Unknown | Fallback diff (bounded by short buffer) |

### Intent Capture (beforeinput)

```ts
function onBeforeInput(e: InputEvent) {
  const ranges = e.getTargetRanges();
  capturedIntent = {
    type: e.inputType,
    data: e.data,
    rangeStart: ranges[0]?.startOffset ?? null,
    rangeEnd: ranges[0]?.endOffset ?? null,
    valueBefore: inputEl.value,
  };
}
```

### Intent Processing (input)

```ts
function onInput(e: InputEvent) {
  const intent = capturedIntent;
  capturedIntent = null;

  switch (intent.type) {
    case 'insertText':
      handleInsert(intent);
      break;
    case 'deleteContentBackward':
    case 'deleteWordBackward':
    case 'deleteSoftLineBackward':
    case 'deleteBySoftwareKeyboard':
      handleDelete(intent);
      break;
    case 'insertReplacementText':
      handleReplacement(intent);
      break;
    case 'insertFromPaste':
      handlePaste(intent);
      break;
    default:
      handleFallbackDiff(intent);
  }

  syncBuffer();
}
```

### Handler Details

**`handleInsert(intent)`**: If `rangeStart === rangeEnd` (collapsed), send `intent.data` directly. If non-collapsed (autocorrect), calculate `rangeEnd - rangeStart` backspaces, then send `intent.data`.

**`handleDelete(intent)`**: If `rangeStart` and `rangeEnd` are available, send `rangeEnd - rangeStart` backspaces. If ranges unavailable, diff `intent.valueBefore` vs `inputEl.value` to count deleted characters. Log `WARN` for missing ranges.

**`handleReplacement(intent)`**: Same as non-collapsed insert — `rangeEnd - rangeStart` backspaces + `intent.data`.

**`handlePaste(intent)`**: No `data` available on paste events. Diff `intent.valueBefore` vs `inputEl.value` to extract pasted text. Send directly (no backspaces — paste appends at cursor).

**`handleFallbackDiff(intent)`**: For unrecognized `inputType`, diff `intent.valueBefore` vs `inputEl.value`. Log with `FALLBACK_DIFF` prefix. Buffer is short, so damage is bounded.

## Buffer Management

The buffer exists for Gboard's autocorrect suggestions. We keep it short:

**Trim on length:** After each input event, if the buffer exceeds 20 characters, trim to just the last word (content after the last space). This preserves autocorrect for the current word.

```ts
function syncBuffer() {
  const val = inputEl.value;
  if (val.length > 20) {
    const lastSpace = val.lastIndexOf(' ');
    if (lastSpace >= 0) {
      const trimmed = val.slice(lastSpace + 1);
      inputEl.value = trimmed;
      inputEl.selectionStart = inputEl.selectionEnd = trimmed.length;
    }
  }
}
```

**Idle clear:** 2-second timer (reduced from 5s) clears the buffer entirely on inactivity.

**No cursor-at-end forcing.** The previous `inputEl.selectionStart = inputEl.selectionEnd = currentValue.length` after every input is removed. This was causing slide-to-delete to select everything and autocorrect to operate at wrong positions. Gboard controls cursor position naturally. The Android prepend bug was already mitigated by moving the input on-screen (position fixed, clip-path).

## Debug Telemetry

Every event logs full context to the debug panel:

```
[1234.5] BEFORE type="insertText" data="world" range=[5,10] val="hello wrold" cursor=10,10
[1234.8] INPUT type="insertText" val="hello world"
[1234.8] → AUTOCORRECT: range=[5,10] replaced "wrold" with "world" → del=5 add="world"
[1235.0] FLUSH: "⌫⌫⌫⌫⌫world" (10 bytes)
```

Key signals for identifying gaps:
- **`FALLBACK_DIFF`** — unhandled `inputType`, needs a dedicated handler
- **`WARN`** — `getTargetRanges()` returned empty for an event type we expected ranges from
- **`SYNC_TRIM`** — buffer was trimmed (track if trimming causes issues)

## What Stays the Same

- **Toolbar buttons** — bypass MobileInput, call `sendPtyData()` directly
- **Keydown handler** — Enter, Escape, Tab, arrows still handled in `onKeydown`
- **Composition** — `isComposing` flag skips the event-intent pipeline; `compositionend` diffs final text
- **10ms send batching** — `scheduleSend` / `flushSendBuffer` unchanged
- **Hidden input positioning** — fixed, top:0, left:0, clip-path (on-screen for Gboard tracking)
- **`type="search"`** — suppresses Chrome autofill strip
- **Debug panel toggle** — devtools setting, dbg button (panel now fullscreen)

## Files Modified

- `frontend/src/components/MobileInput.svelte` — full rewrite of event handling, buffer management, debug logging
