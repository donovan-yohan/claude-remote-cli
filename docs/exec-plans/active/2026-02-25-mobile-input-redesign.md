# Mobile Input Redesign Implementation Plan

> **Status**: Active | **Created**: 2026-02-25 | **Last Updated**: 2026-02-25 (Tasks 1-5 complete)
> **Design Doc**: `docs/design-docs/2026-02-25-mobile-input-redesign-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-25 | Design | Event-intent pipeline over value-diffing | Value-diffing is fundamentally fragile — Gboard mutates DOM unpredictably, causing catastrophic diffs |
| 2026-02-25 | Design | Aggressive buffer trimming (20 char cap) | Bounds fallback diff damage; Gboard only needs current word for autocorrect |
| 2026-02-25 | Design | Remove cursor-at-end forcing | Was causing slide-to-delete to select everything and autocorrect to operate at wrong positions |
| 2026-02-25 | Design | Rich debug telemetry with gap-finder signals | FALLBACK_DIFF and WARN prefixes make it easy to identify unhandled event types on-device |

## Progress

- [x] Task 1: Replace event-handling core with intent capture _(completed 2026-02-25)_
- [x] Task 2: Implement intent handlers (insert, delete, replacement, paste, fallback) _(completed 2026-02-25)_
- [x] Task 3: Add buffer management (syncBuffer + 2s idle timer) _(completed 2026-02-25)_
- [x] Task 4: Update composition and keydown handlers for new architecture _(completed 2026-02-25)_
- [x] Task 5: Build, type-check, and verify _(completed 2026-02-25)_
- [ ] Task 6: On-device manual testing

## Surprises & Discoveries

| Date | What | Impact | Resolution |
|------|------|--------|------------|
| 2026-02-25 | `getTargetRanges()[0]` needs explicit `StaticRange` cast for svelte-check | Type narrowing didn't work with optional chaining | Used `as StaticRange` cast with explicit null checks |
| 2026-02-25 | Gboard loses cursor position on single-word autocorrect even with `clip-path: inset(50%)` | `getTargetRanges()` returns empty and cursor is at 0,0 — data prepended at position 0 instead of replacing word | Added BAD_AUTOCORRECT detection in `handleInsert`: reverts when `currentValue === data + valueBefore` |
| 2026-02-25 | xterm.js canvas blocks native text selection in long-press mode | `user-select: text` on `.xterm-screen` alone insufficient — canvas sits on top | Set `pointer-events: none` on all canvas elements during selection mode + programmatic `selectNodeContents` on `.xterm-rows` |

## Plan Drift

| Date | What planned | What happened | Impact |
|------|-------------|---------------|--------|
| 2026-02-25 | Event-intent pipeline would fix autocorrect via `getTargetRanges()` | Gboard returns empty `getTargetRanges()` for single-word autocorrect, sends garbled data at cursor 0 | Added defensive BAD_AUTOCORRECT revert in `handleInsert` — autocorrect silently suppressed when cursor tracking fails |

---

# Mobile Input Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace MobileInput's value-diffing architecture with an event-intent pipeline that translates each InputEvent into terminal commands, fixing autocorrect, slide-to-delete, and buffer accumulation bugs.

**Architecture:** Each `beforeinput` event captures the user's intent (inputType, data, targetRanges). The `input` handler classifies that intent and translates it directly to terminal commands (characters, backspaces). The input buffer is kept short (max 20 chars) for Gboard's autocorrect suggestions but is never used as the source of truth for diffing.

**Tech Stack:** Svelte 5 (runes), TypeScript, InputEvent API (`inputType`, `getTargetRanges()`)

---

### Task 1: Replace event-handling core with intent capture

**Files:**
- Modify: `frontend/src/components/MobileInput.svelte`

**Step 1: Replace old state variables with intent capture state**

Remove these old variables:
```ts
let lastInputValue = '';
let beforeInputSnapshot: string | null = null;
```

Add the new intent capture type and state:
```ts
interface CapturedIntent {
  type: string;
  data: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
  valueBefore: string;
}

let capturedIntent: CapturedIntent | null = null;
```

Keep `isComposing`, `sendBuffer`, `sendTimer`, `SEND_DELAY`, `clearTimer` unchanged.

**Step 2: Rewrite `onBeforeInput` to capture intent**

Replace the current `onBeforeInput` with:
```ts
function onBeforeInput(e: InputEvent) {
  const ranges = e.getTargetRanges();
  const rangeInfo = ranges.length > 0
    ? 'range=[' + ranges[0].startOffset + ',' + ranges[0].endOffset + ']'
    : 'range=none';

  capturedIntent = {
    type: e.inputType,
    data: e.data,
    rangeStart: ranges[0]?.startOffset ?? null,
    rangeEnd: ranges[0]?.endOffset ?? null,
    valueBefore: inputEl.value,
  };

  dbg('BEFORE type="' + e.inputType + '" data="' + (e.data ?? '') + '" ' + rangeInfo + ' val="' + inputEl.value + '" cursor=' + inputEl.selectionStart + ',' + inputEl.selectionEnd);
}
```

**Step 3: Rewrite `onInput` as intent dispatcher**

Replace the current `onInput` with:
```ts
function onInput(e: Event) {
  const ie = e as InputEvent;
  const intent = capturedIntent;
  capturedIntent = null;
  const currentValue = inputEl.value;

  dbg('INPUT type="' + ie.inputType + '" val="' + currentValue + '"');

  // Reset auto-clear timer (2s idle clears buffer)
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    dbg('TIMER_CLEAR val="' + inputEl.value + '"');
    inputEl.value = '';
  }, 2000);

  if (!isPtyConnected()) return;
  if (isComposing) {
    dbg('  skipped (composing)');
    return;
  }

  if (!intent) {
    dbg('  WARN: no captured intent, using fallback diff');
    handleFallbackDiff({ type: ie.inputType, data: ie.data, rangeStart: null, rangeEnd: null, valueBefore: '' }, currentValue);
    syncBuffer();
    return;
  }

  switch (intent.type) {
    case 'insertText':
      handleInsert(intent, currentValue);
      break;
    case 'deleteContentBackward':
    case 'deleteContentForward':
    case 'deleteWordBackward':
    case 'deleteWordForward':
    case 'deleteSoftLineBackward':
    case 'deleteSoftLineForward':
    case 'deleteBySoftwareKeyboard':
      handleDelete(intent, currentValue);
      break;
    case 'insertReplacementText':
      handleReplacement(intent, currentValue);
      break;
    case 'insertFromPaste':
    case 'insertFromDrop':
      handlePaste(intent, currentValue);
      break;
    default:
      handleFallbackDiff(intent, currentValue);
  }

  syncBuffer();
}
```

**Step 4: Remove old `sendInputDiff`, `commonPrefixLength` functions**

Delete the `sendInputDiff`, `commonPrefixLength`, and `codepointCount` functions entirely. They are replaced by the intent handlers in Task 2.

**Step 5: Verify build compiles**

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-remote-cli/.worktrees/fix-pr-worktrees && npm run check:svelte`

Expected: Will fail because `handleInsert`, `handleDelete`, etc. are not yet defined. That's fine — they come in Task 2.

---

### Task 2: Implement intent handlers

**Files:**
- Modify: `frontend/src/components/MobileInput.svelte`

**Step 1: Add `codepointCount` utility (kept from old code)**

```ts
function codepointCount(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    count++;
    if (str.charCodeAt(i) >= 0xd800 && str.charCodeAt(i) <= 0xdbff) i++;
  }
  return count;
}
```

**Step 2: Add `commonPrefixLength` utility (kept for fallback diff)**

```ts
function commonPrefixLength(a: string, b: string): number {
  let len = 0;
  while (len < a.length && len < b.length && a[len] === b[len]) len++;
  return len;
}
```

**Step 3: Implement `handleInsert`**

```ts
function handleInsert(intent: CapturedIntent, currentValue: string) {
  const { rangeStart, rangeEnd, data } = intent;

  if (rangeStart !== null && rangeEnd !== null && rangeStart !== rangeEnd) {
    // Non-collapsed range = autocorrect replacement
    const replaced = intent.valueBefore.slice(rangeStart, rangeEnd);
    const charsToDelete = codepointCount(replaced);
    dbg('  → AUTOCORRECT: range=[' + rangeStart + ',' + rangeEnd + '] replaced "' + replaced + '" with "' + (data ?? '') + '" → del=' + charsToDelete + ' add="' + (data ?? '') + '"');
    let payload = '';
    for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
    payload += data ?? '';
    if (payload) scheduleSend(payload);
  } else if (data) {
    // Collapsed range = normal character insertion
    dbg('  → INSERT: "' + data + '"');
    scheduleSend(data);
  } else {
    // No data and no range — fall back to diff
    dbg('  → INSERT_NO_DATA: falling back to diff');
    handleFallbackDiff(intent, currentValue);
  }
}
```

**Step 4: Implement `handleDelete`**

```ts
function handleDelete(intent: CapturedIntent, currentValue: string) {
  const { rangeStart, rangeEnd, valueBefore } = intent;

  if (rangeStart !== null && rangeEnd !== null) {
    const deleted = valueBefore.slice(rangeStart, rangeEnd);
    const charsToDelete = codepointCount(deleted);
    dbg('  → DELETE_RANGE: range=[' + rangeStart + ',' + rangeEnd + '] "' + deleted + '" → del=' + charsToDelete);
    let payload = '';
    for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
    if (payload) scheduleSend(payload);
  } else {
    // No range info — diff to figure out how many chars were deleted
    const deleted = valueBefore.length - currentValue.length;
    const charsToDelete = Math.max(1, deleted);
    dbg('  → WARN: no targetRanges for type="' + intent.type + '" — diffed del=' + charsToDelete);
    let payload = '';
    for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
    if (payload) scheduleSend(payload);
  }
}
```

**Step 5: Implement `handleReplacement`**

```ts
function handleReplacement(intent: CapturedIntent, currentValue: string) {
  const { rangeStart, rangeEnd, data, valueBefore } = intent;

  if (rangeStart !== null && rangeEnd !== null) {
    const replaced = valueBefore.slice(rangeStart, rangeEnd);
    const charsToDelete = codepointCount(replaced);
    dbg('  → REPLACEMENT: range=[' + rangeStart + ',' + rangeEnd + '] replaced "' + replaced + '" with "' + (data ?? '') + '" → del=' + charsToDelete + ' add="' + (data ?? '') + '"');
    let payload = '';
    for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
    payload += data ?? '';
    if (payload) scheduleSend(payload);
  } else {
    dbg('  → REPLACEMENT_NO_RANGE: falling back to diff');
    handleFallbackDiff(intent, currentValue);
  }
}
```

**Step 6: Implement `handlePaste`**

```ts
function handlePaste(intent: CapturedIntent, currentValue: string) {
  // Paste events don't provide data — diff to extract pasted text
  const commonLen = commonPrefixLength(intent.valueBefore, currentValue);
  const pasted = currentValue.slice(commonLen);
  dbg('  → PASTE: "' + pasted.slice(0, 50) + (pasted.length > 50 ? '...' : '') + '" (' + pasted.length + ' chars)');
  if (pasted) scheduleSend(pasted);
}
```

**Step 7: Implement `handleFallbackDiff`**

```ts
function handleFallbackDiff(intent: CapturedIntent, currentValue: string) {
  const valueBefore = intent.valueBefore || '';
  if (currentValue === valueBefore) {
    dbg('  → FALLBACK_DIFF: NO-OP (same)');
    return;
  }
  const commonLen = commonPrefixLength(valueBefore, currentValue);
  const deletedSlice = valueBefore.slice(commonLen);
  const charsToDelete = codepointCount(deletedSlice);
  const newChars = currentValue.slice(commonLen);

  dbg('  → FALLBACK_DIFF: type="' + intent.type + '" del=' + charsToDelete + ' "' + deletedSlice + '" add="' + newChars + '"');

  let payload = '';
  for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
  payload += newChars;
  if (payload) scheduleSend(payload);
}
```

**Step 8: Verify build compiles**

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-remote-cli/.worktrees/fix-pr-worktrees && npm run check:svelte`

Expected: May still fail if `syncBuffer` is not defined. Defined in Task 3.

---

### Task 3: Add buffer management

**Files:**
- Modify: `frontend/src/components/MobileInput.svelte`

**Step 1: Implement `syncBuffer`**

Add after the intent handlers:
```ts
function syncBuffer() {
  const val = inputEl.value;
  if (val.length > 20) {
    const lastSpace = val.lastIndexOf(' ');
    if (lastSpace >= 0) {
      const trimmed = val.slice(lastSpace + 1);
      dbg('SYNC_TRIM: "' + val.slice(0, 30) + (val.length > 30 ? '...' : '') + '" → "' + trimmed + '"');
      inputEl.value = trimmed;
      inputEl.selectionStart = inputEl.selectionEnd = trimmed.length;
    }
  }
}
```

**Step 2: Update `clearInput` export**

Replace the current `clearInput`:
```ts
export function clearInput() {
  if (inputEl) {
    inputEl.value = '';
    inputEl.setSelectionRange(0, 0);
  }
}
```

(Remove `lastInputValue = ''` — that variable no longer exists.)

**Step 3: Update `flushComposedText` export**

Replace the current `flushComposedText`:
```ts
export function flushComposedText() {
  if (isComposing && isPtyConnected()) {
    // Flush any in-progress composition by diffing against empty
    // (composition text hasn't been sent yet)
    const currentValue = inputEl.value;
    if (currentValue) {
      dbg('FLUSH_COMPOSED: "' + currentValue + '"');
      scheduleSend(currentValue);
    }
  }
  isComposing = false;
  flushSendBuffer();
}
```

**Step 4: Update `onSessionChange` export**

Replace:
```ts
export function onSessionChange() {
  isComposing = false;
}
```

(Remove `lastInputValue = ''` — that variable no longer exists.)

**Step 5: Verify build compiles**

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-remote-cli/.worktrees/fix-pr-worktrees && npm run check:svelte`

Expected: Should pass now (all functions defined). If not, fix type errors.

---

### Task 4: Update composition and keydown handlers

**Files:**
- Modify: `frontend/src/components/MobileInput.svelte`

**Step 1: Update `onCompositionEnd` — remove cursor-at-end forcing**

Replace the current `onCompositionEnd`:
```ts
function onCompositionEnd(e: CompositionEvent) {
  dbg('COMP_END data="' + e.data + '" val="' + inputEl.value + '"');
  isComposing = false;
  if (isPtyConnected()) {
    // Send the composed text directly
    if (e.data) {
      dbg('  → COMP_SEND: "' + e.data + '"');
      scheduleSend(e.data);
    }
  }
}
```

**Step 2: Update `onKeydown` — remove empty-buffer backspace hack**

Replace the Backspace case:
```ts
case 'Backspace':
  if (inputEl.value.length === 0) {
    sendPtyData('\x7f');
  }
  handled = false; // let input event handle diff
  break;
```

With:
```ts
case 'Backspace':
  // Let the input event pipeline handle all backspaces.
  // If the buffer is empty, beforeinput still fires with
  // deleteContentBackward and we handle it there.
  // Only send directly if buffer is empty AND no beforeinput will fire.
  if (inputEl.value.length === 0) {
    sendPtyData('\x7f');
  }
  handled = false;
  break;
```

(This stays the same — when the buffer is empty, no `beforeinput` fires because there's nothing to delete, so the keydown handler sends the backspace directly.)

**Step 3: Update `onKeydown` Enter case — remove `lastInputValue`**

Replace:
```ts
case 'Enter':
  flushComposedText();
  if (e.shiftKey) {
    sendPtyData('\x1b[13;2u');
  } else {
    sendPtyData('\r');
  }
  inputEl.value = '';
  lastInputValue = '';
  break;
```

With:
```ts
case 'Enter':
  flushComposedText();
  if (e.shiftKey) {
    sendPtyData('\x1b[13;2u');
  } else {
    sendPtyData('\r');
  }
  inputEl.value = '';
  break;
```

**Step 4: Update `onKeydown` Escape case — remove `lastInputValue`**

Replace `lastInputValue = '';` removal in Escape case:
```ts
case 'Escape':
  sendPtyData('\x1b');
  inputEl.value = '';
  break;
```

**Step 5: Update `onFormSubmit` — remove `lastInputValue`**

Replace:
```ts
function onFormSubmit(e: SubmitEvent) {
  e.preventDefault();
  dbg('FORM_SUBMIT composing=' + isComposing + ' val="' + inputEl.value + '"');
  if (!isPtyConnected()) return;
  flushComposedText();
  sendPtyData('\r');
  inputEl.value = '';
  lastInputValue = '';
}
```

With:
```ts
function onFormSubmit(e: SubmitEvent) {
  e.preventDefault();
  dbg('FORM_SUBMIT composing=' + isComposing + ' val="' + inputEl.value + '"');
  if (!isPtyConnected()) return;
  flushComposedText();
  sendPtyData('\r');
  inputEl.value = '';
}
```

**Step 6: Update `onBlur` — remove `lastInputValue`**

Replace:
```ts
function onBlur() {
  if (isComposing) {
    isComposing = false;
    lastInputValue = inputEl.value;
  }
}
```

With:
```ts
function onBlur() {
  if (isComposing) {
    isComposing = false;
  }
}
```

---

### Task 5: Build, type-check, and verify

**Files:**
- Verify: `frontend/src/components/MobileInput.svelte`

**Step 1: Run svelte-check**

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-remote-cli/.worktrees/fix-pr-worktrees && npm run check:svelte`

Expected: PASS — no type errors.

**Step 2: Run full build**

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-remote-cli/.worktrees/fix-pr-worktrees && npm run build`

Expected: PASS — frontend compiles successfully.

**Step 3: Run full test suite**

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-remote-cli/.worktrees/fix-pr-worktrees && npm test`

Expected: PASS — all existing backend tests still pass (no backend changes).

**Step 4: Commit**

```bash
git add frontend/src/components/MobileInput.svelte
git commit -m "refactor: replace mobile input value-diffing with event-intent architecture

Rewrites MobileInput to use InputEvent.inputType and getTargetRanges()
instead of diffing accumulated buffer state. Fixes autocorrect sending
massive diffs, slide-to-delete destroying everything, and buffer growing
indefinitely. Debug panel now fullscreen with rich telemetry."
```

---

### Task 6: On-device manual testing

**No code changes — testing checklist for Android device with debug panel enabled.**

Enable devtools in Settings, tap `dbg` button to open debug panel.

**Test 1: Normal typing**
- Type "hello world" at a Claude prompt
- Debug panel should show: `→ INSERT: "h"`, `→ INSERT: "e"`, etc.
- Terminal should display "hello world" correctly

**Test 2: Autocorrect acceptance**
- Type a misspelled word (e.g., "wrold")
- Tap Gboard's autocorrect suggestion (e.g., "world")
- Debug panel should show: `→ AUTOCORRECT: range=[X,Y] replaced "wrold" with "world" → del=5 add="world"`
- Terminal should show the corrected word, NOT wipe the line

**Test 3: Backspace**
- Type "hello", press backspace
- Debug panel should show: `→ DELETE_RANGE: range=[4,5] "o" → del=1`
- Terminal should delete one character

**Test 4: Slide-to-delete**
- Type "hello world", use Gboard's slide-to-delete gesture
- Debug panel should show: `→ DELETE_RANGE:` with appropriate range
- Only the selected portion should be deleted, NOT everything

**Test 5: Paste**
- Copy text from another app, paste into terminal
- Debug panel should show: `→ PASTE: "..." (N chars)`
- Pasted text should appear in terminal

**Test 6: Buffer trimming**
- Type a long sentence (>20 chars) without pressing Enter
- Debug panel should show: `SYNC_TRIM:` entries keeping buffer short
- No massive diffs should occur

**Test 7: Idle clear**
- Type some text, wait 2 seconds
- Debug panel should show: `TIMER_CLEAR`
- Next character typed should work normally

**Test 8: Gap finder**
- Watch for `FALLBACK_DIFF` or `WARN` entries in the debug panel
- Document any `inputType` values that trigger fallback

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
