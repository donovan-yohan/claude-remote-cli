---
status: implemented
created: 2026-03-16
branch: master
supersedes:
implemented-by:
consulted-learnings: []
---

# Mobile Keyboard Testing — Fixture-Based Pipeline Validation

**Date:** 2026-03-16
**Status:** Approved

## Problem

Mobile virtual keyboard autocorrect is broken: when Gboard (Android Chrome) autocorrects a misspelled word (e.g., "teh" → "the"), the replacement text is lost — the PTY receives only backspaces, deleting the word without inserting the correction. Previous fix attempts have oscillated between "deletes everything" and "deletes the word but doesn't retype it."

Debugging has relied on manual testing with debug logs on real devices. There are no automated tests covering the mobile input event-intent pipeline, so agents fixing keyboard bugs have no way to validate their work programmatically.

## Goals

1. Make mobile keyboard behavior a first-class testable concern that agents can validate autonomously
2. Extract the event-intent pipeline into a pure, testable module
3. Provide a fixture format so agents can add test cases for new bugs without understanding the full pipeline
4. Integrate into the harness workflow so agents always run these tests before reporting work complete

## Non-Goals

- Simulating real OS-level autocorrect engines (not possible with any tooling)
- Full E2E browser tests (Playwright integration is a future layer, not part of this design)
- Changing how the pipeline works — this is about testability, not fixing the current bug

## Research Summary

No tooling can fully simulate OS-level autocorrect, predictive text, or swipe typing:

- **CDP** can replay event structures via `Input.imeSetComposition` / `Input.insertText`, but cannot trigger real autocorrect
- **Playwright** inherits CDP's limits — good for layout/touch, not for keyboard behavior
- **Appium / BrowserStack** use real devices but automation bypasses the keyboard layer
- **The gap is real:** there is no framework that can script "user types 'teh', verify autocorrect fires 'the'"

The viable approach: extract the pipeline logic and test it with synthetic event fixtures that match real device event sequences.

## Architecture

### Pipeline Extraction

Extract pure logic from `MobileInput.svelte` into `server/mobile-input-pipeline.ts`. This module lives under `server/` (not `frontend/`) because it is pure TypeScript with zero DOM or browser dependencies, and `tsconfig.test.json` includes `server/**/*.ts` — placing it here lets `test/mobile-input.test.ts` import it directly without build system changes. `MobileInput.svelte` imports the same module via a relative path (`../../server/mobile-input-pipeline.js`), which Vite resolves at build time.

**Moves to pipeline module:**
- `CapturedIntent` interface
- `codepointCount()`, `commonPrefixLength()` utility functions
- `handleInsert()`, `handleDelete()`, `handleReplacement()`, `handlePaste()`, `handleFallbackDiff()` — rewritten as pure functions returning `PipelineResult` (no DOM access)
- New `processIntent(intent, currentValue): PipelineResult` — wraps the switch/case dispatch

**Stays in `MobileInput.svelte`:**
- DOM interactions (`inputEl`, focus, blur, form submit)
- `beforeinput`/`input` event handlers (call into pipeline module)
- Buffer management (`syncBuffer`, `ensureCursorAtEnd`) — mutates `inputEl.value`
- Send batching (`scheduleSend`, `flushSendBuffer`) — calls `sendPtyData`
- Debug panel, composition handlers

**Post-pipeline coordination:** When `processIntent` returns a `PipelineResult` with `newInputValue` set (e.g., the cursor-0 recovery path), `MobileInput.svelte` must: (1) set `inputEl.value = result.newInputValue`, (2) call `ensureCursorAtEnd()`. The `isComposing` check lives in the caller (the `oninput` handler already gates on `isComposing` before calling `processIntent`), so the pipeline module does not need access to composition state.

**Key contract:**

```ts
interface CapturedIntent {
  type: string;
  data: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
  valueBefore: string;
  cursorBefore: number;
}

interface PipelineResult {
  payload: string;        // bytes to send to PTY (backspaces + text)
  newInputValue?: string; // if pipeline needs to override inputEl.value (caller must also call ensureCursorAtEnd)
}

function processIntent(intent: CapturedIntent, currentValue: string): PipelineResult;
```

### Event Fixture Format

JSON files describing complete keyboard interaction sequences:

```ts
interface EventFixture {
  name: string;              // "gboard-autocorrect-teh-to-the"
  description: string;       // "Gboard replaces 'teh' with 'the' at word boundary"
  device: string;            // "android-chrome-gboard" | "ios-safari-default"
  events: EventStep[];
  expectedPayload: string;   // bytes that should be sent to PTY
}

interface EventStep {
  inputType: string;         // "insertText", "insertReplacementText", etc.
  data: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
  valueBefore: string;
  cursorBefore: number;
  valueAfter: string;
}
```

**Storage:** `test/fixtures/mobile-input/` — JSON files, one per scenario or grouped by device/behavior.

**Replay algorithm:** For each fixture, iterate through `events` sequentially. For each step, call `processIntent()` using the step's intent fields and `valueAfter` as `currentValue`. Concatenate all `payload` results across steps. Assert the concatenated result matches `expectedPayload`. Most fixtures will have a single event step — multi-step fixtures are for sequences like "type several characters then autocorrect fires on space."

**Starter fixtures:**

| Fixture | Scenario | Key assertion |
|---------|----------|---------------|
| `gboard-autocorrect-range.json` | `insertText` with non-collapsed range replacing "teh" with "the" | Payload = 3 backspaces + "the" |
| `gboard-autocorrect-cursor0.json` | Data prepended at position 0 (recovery path) | Payload = backspaces over old value + replacement |
| `gboard-autocorrect-deletes-all.json` | Multi-word buffer "hello teh", autocorrect fires | Only "teh" deleted, not "hello "; replacement "the" present |
| `gboard-autocorrect-word-only-deleted.json` | Replacement text lost, only backspaces sent | Asserts replacement text IS present (tests the correct behavior, not the bug); will fail until the pipeline bug is fixed — this is intentional TDD |
| `gboard-delete-word-swipe.json` | `deleteWordBackward` with range | Correct backspace count |
| `gboard-delete-no-range.json` | `deleteContentBackward` without `getTargetRanges()` | Falls back to diff, correct count |
| `ios-replacement-text.json` | `insertReplacementText` with range | Payload = backspaces + replacement |
| `paste-event.json` | `insertFromPaste` (no data, diff-based) | Pasted text sent |
| `normal-typing.json` | Basic `insertText` with collapsed range | Data sent directly |
| `fallback-unknown-type.json` | Unrecognized `inputType` | Diff-based fallback |

### Test Structure

`test/mobile-input.test.ts` using `node:test` + `node:assert`:

```ts
describe('mobile-input-pipeline', () => {
  describe('processIntent', () => {
    // Per-fixture tests loaded from test/fixtures/mobile-input/
    test('normal character insertion');
    test('Gboard autocorrect via insertText with range');
    test('Gboard autocorrect cursor-0 recovery');
    test('iOS autocorrect via insertReplacementText');
    test('delete word with range');
    test('delete without range (fallback)');
    test('paste (diff-based)');
    test('unknown inputType (fallback diff)');
  });

  describe('autocorrect always includes replacement text', () => {
    // Critical invariant: payload must never be ONLY backspaces
    // when intent.data is non-null
    test('replacement text present after Gboard range replacement');
    test('replacement text present after cursor-0 recovery');
    test('replacement text present after insertReplacementText');
    test('multi-word buffer: only target word deleted, replacement inserted');
  });

  describe('fixture replay', () => {
    // Dynamically loads all .json fixtures and replays them
    // Agents can add new fixtures without touching test code
  });
});
```

**Critical invariant:**

```ts
function assertReplacementNotLost(payload: string, expectedReplacement: string) {
  assert.ok(
    payload.includes(expectedReplacement),
    `Payload contains only backspaces — replacement text "${expectedReplacement}" was lost`
  );
}
```

### Debug Panel Recording Mode

Addition to the existing debug panel for capturing real device events as fixture JSON:

- New "Record" toggle button (visible only when devtools enabled)
- Records each `beforeinput`/`input` pair as an `EventStep`
- "Save" button serializes recording to JSON, copies to clipboard or downloads
- User pastes into `test/fixtures/mobile-input/`, adds `expectedPayload`
- Small addition to `MobileInput.svelte` — recording array, flag, save function

**Priority:** Nice-to-have layer. Hand-crafted starter fixtures are sufficient for initial agent workflows.

### Harness Integration

Documentation updates so agents know to create/run these tests:

**`docs/QUALITY.md`** — New "Mobile Input Testing" section:
- Documents the fixture-based test pattern
- States the invariant: "When fixing mobile keyboard bugs, add a fixture to `test/fixtures/mobile-input/` reproducing the event sequence before writing the fix"

**`docs/DESIGN.md`** — New Key Decision row:
- "Fixture-based mobile input testing | Event-intent pipeline extracted for unit testing; real device events recorded as JSON fixtures | Design doc"

**`docs/FRONTEND.md`** — Update "Mobile Touch & Input" section:
- Reference the pipeline module and fixture test pattern

**`CLAUDE.md`** — Add to Quick Reference table (via `claude-md-management:revise-claude-md` skill):
- Mobile input changes require fixture tests; point to `test/fixtures/mobile-input/`

## Files Modified

| File | Change |
|------|--------|
| `server/mobile-input-pipeline.ts` | **New** — extracted pure pipeline logic (in `server/` for tsconfig.test.json access) |
| `frontend/src/components/MobileInput.svelte` | Refactor to import from pipeline module; handle `newInputValue` + `ensureCursorAtEnd()`; add recording mode |
| `test/mobile-input.test.ts` | **New** — fixture-based pipeline tests |
| `test/fixtures/mobile-input/*.json` | **New** — starter event fixtures |
| `docs/QUALITY.md` | Add Mobile Input Testing section |
| `docs/DESIGN.md` | Add Key Decision row |
| `docs/FRONTEND.md` | Update Mobile Touch & Input section |
| `CLAUDE.md` | Add mobile input test requirement to Quick Reference |

## Implementation Order

1. Extract pipeline module from `MobileInput.svelte`
2. Create fixture format types and starter fixtures
3. Write `test/mobile-input.test.ts` with fixture replay
4. Refactor `MobileInput.svelte` to use pipeline module
5. Update harness docs (QUALITY, DESIGN, FRONTEND, CLAUDE.md)
6. Add debug panel recording mode (can be deferred)
