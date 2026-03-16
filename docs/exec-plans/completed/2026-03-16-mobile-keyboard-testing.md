# Mobile Keyboard Testing Implementation Plan

> **Status**: Complete | **Created**: 2026-03-16 | **Last Updated**: 2026-03-16
> **Design Doc**: `docs/design-docs/2026-03-16-mobile-keyboard-testing-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-16 | Design | Pipeline module in `server/` not `frontend/src/lib/` | tsconfig.test.json already includes `server/**/*.ts`; avoids build system changes |
| 2026-03-16 | Design | Fixture-based testing over browser E2E | Agents need fast feedback loops; unit tests run in ms vs seconds for browser |
| 2026-03-16 | Design | JSON fixtures over inline test data | Agents can add fixtures without understanding pipeline internals |
| 2026-03-16 | Plan | Add `../server/mobile-input-pipeline.ts` to frontend tsconfig include | Required for `svelte-check` to resolve cross-boundary import from MobileInput.svelte |

## Progress

- [x] Task 1: Create pipeline module with types and utilities _(completed 2026-03-16)_
- [x] Task 2: Implement processIntent and handler functions _(completed 2026-03-16)_
- [x] Task 3: Create starter event fixtures _(completed 2026-03-16)_
- [x] Task 4: Write fixture-based tests _(completed 2026-03-16)_
- [x] Task 5: Refactor MobileInput.svelte to use pipeline module _(completed 2026-03-16)_
- [x] Task 6: Update harness documentation _(completed 2026-03-16)_

## Surprises & Discoveries

_No surprises — all tasks completed as specified._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Create pipeline module with types and utilities

**Files:**
- Create: `server/mobile-input-pipeline.ts`

- [ ] **Step 1: Create pipeline module with interfaces and utility functions**

Create `server/mobile-input-pipeline.ts` with the public API types and two utility functions extracted from `MobileInput.svelte`:

```ts
// server/mobile-input-pipeline.ts

export interface CapturedIntent {
  type: string;
  data: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
  valueBefore: string;
  cursorBefore: number;
}

export interface PipelineResult {
  /** Bytes to send to PTY (backspaces + replacement text) */
  payload: string;
  /** If set, caller must update inputEl.value and call ensureCursorAtEnd() */
  newInputValue?: string;
}

export function codepointCount(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    count++;
    if (str.charCodeAt(i) >= 0xd800 && str.charCodeAt(i) <= 0xdbff) i++;
  }
  return count;
}

export function commonPrefixLength(a: string, b: string): number {
  let len = 0;
  while (len < a.length && len < b.length && a[len] === b[len]) len++;
  return len;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: No errors (the file is included via `server/**/*.ts`)

- [ ] **Step 3: Commit**

```bash
git add server/mobile-input-pipeline.ts
git commit -m "feat: add mobile input pipeline module with types and utilities"
```

---

### Task 2: Implement processIntent and handler functions

**Files:**
- Modify: `server/mobile-input-pipeline.ts`

- [ ] **Step 1: Add handler functions and processIntent**

Append to `server/mobile-input-pipeline.ts`. These are extracted from `MobileInput.svelte` lines 124-229, rewritten as pure functions returning `PipelineResult` instead of calling `scheduleSend()`:

```ts
const DEL = '\x7f';

function makeBackspaces(count: number): string {
  let s = '';
  for (let i = 0; i < count; i++) s += DEL;
  return s;
}

function handleInsert(intent: CapturedIntent, currentValue: string): PipelineResult {
  const { rangeStart, rangeEnd, data } = intent;

  if (rangeStart !== null && rangeEnd !== null && rangeStart !== rangeEnd) {
    // Non-collapsed range = autocorrect replacement
    const replaced = intent.valueBefore.slice(rangeStart, rangeEnd);
    const charsToDelete = codepointCount(replaced);
    const payload = makeBackspaces(charsToDelete) + (data ?? '');
    return { payload };
  }

  if (data) {
    // Detect bad cursor-0 autocorrect: keyboard lost cursor position
    // and prepended data at position 0 instead of replacing a word.
    if (data.length > 1 && intent.cursorBefore === 0 &&
        intent.valueBefore.length > 0 &&
        currentValue === data + intent.valueBefore) {
      const charsToDelete = codepointCount(intent.valueBefore);
      const payload = makeBackspaces(charsToDelete) + data;
      return { payload, newInputValue: data };
    }
    // Collapsed range = normal character insertion
    return { payload: data };
  }

  // No data and no range — fall back to diff
  return handleFallbackDiff(intent, currentValue);
}

function handleDelete(intent: CapturedIntent, currentValue: string): PipelineResult {
  const { rangeStart, rangeEnd, valueBefore } = intent;

  if (rangeStart !== null && rangeEnd !== null) {
    const deleted = valueBefore.slice(rangeStart, rangeEnd);
    const charsToDelete = codepointCount(deleted);
    return { payload: makeBackspaces(charsToDelete) };
  }

  // No range info — diff to figure out how many chars were deleted
  const deleted = valueBefore.length - currentValue.length;
  const charsToDelete = Math.max(1, deleted);
  return { payload: makeBackspaces(charsToDelete) };
}

function handleReplacement(intent: CapturedIntent, currentValue: string): PipelineResult {
  const { rangeStart, rangeEnd, data, valueBefore } = intent;

  if (rangeStart !== null && rangeEnd !== null) {
    const replaced = valueBefore.slice(rangeStart, rangeEnd);
    const charsToDelete = codepointCount(replaced);
    const payload = makeBackspaces(charsToDelete) + (data ?? '');
    return { payload };
  }

  return handleFallbackDiff(intent, currentValue);
}

function handlePaste(intent: CapturedIntent, currentValue: string): PipelineResult {
  const commonLen = commonPrefixLength(intent.valueBefore, currentValue);
  const pasted = currentValue.slice(commonLen);
  return { payload: pasted };
}

function handleFallbackDiff(intent: CapturedIntent, currentValue: string): PipelineResult {
  const valueBefore = intent.valueBefore || '';
  if (currentValue === valueBefore) {
    return { payload: '' };
  }
  const commonLen = commonPrefixLength(valueBefore, currentValue);
  const deletedSlice = valueBefore.slice(commonLen);
  const charsToDelete = codepointCount(deletedSlice);
  const newChars = currentValue.slice(commonLen);
  const payload = makeBackspaces(charsToDelete) + newChars;
  return { payload };
}

export function processIntent(intent: CapturedIntent, currentValue: string): PipelineResult {
  switch (intent.type) {
    case 'insertText':
      return handleInsert(intent, currentValue);
    case 'deleteContentBackward':
    case 'deleteContentForward':
    case 'deleteWordBackward':
    case 'deleteWordForward':
    case 'deleteSoftLineBackward':
    case 'deleteSoftLineForward':
    case 'deleteBySoftwareKeyboard':
      return handleDelete(intent, currentValue);
    case 'insertReplacementText':
      return handleReplacement(intent, currentValue);
    case 'insertFromPaste':
    case 'insertFromDrop':
      return handlePaste(intent, currentValue);
    default:
      return handleFallbackDiff(intent, currentValue);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/mobile-input-pipeline.ts
git commit -m "feat: implement processIntent with all handler functions"
```

---

### Task 3: Create starter event fixtures

**Files:**
- Create: `test/fixtures/mobile-input/gboard-autocorrect-range.json`
- Create: `test/fixtures/mobile-input/gboard-autocorrect-cursor0.json`
- Create: `test/fixtures/mobile-input/gboard-autocorrect-multi-word.json`
- Create: `test/fixtures/mobile-input/gboard-delete-word-swipe.json`
- Create: `test/fixtures/mobile-input/gboard-delete-no-range.json`
- Create: `test/fixtures/mobile-input/ios-replacement-text.json`
- Create: `test/fixtures/mobile-input/paste-event.json`
- Create: `test/fixtures/mobile-input/normal-typing.json`
- Create: `test/fixtures/mobile-input/fallback-unknown-type.json`

- [ ] **Step 1: Create fixture directory**

```bash
mkdir -p test/fixtures/mobile-input
```

- [ ] **Step 2: Create Gboard autocorrect with range fixture**

`test/fixtures/mobile-input/gboard-autocorrect-range.json` — The most common Gboard autocorrect: `insertText` with a non-collapsed range replacing the misspelled word. Buffer contains only the misspelled word.

```json
{
  "name": "gboard-autocorrect-range",
  "description": "Gboard replaces 'teh' with 'the' via insertText with non-collapsed range",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "insertText",
      "data": "the",
      "rangeStart": 0,
      "rangeEnd": 3,
      "valueBefore": "teh",
      "cursorBefore": 3,
      "valueAfter": "the"
    }
  ],
  "expectedPayload": "\u007f\u007f\u007fthe"
}
```

- [ ] **Step 3: Create Gboard autocorrect cursor-0 recovery fixture**

`test/fixtures/mobile-input/gboard-autocorrect-cursor0.json` — Gboard loses cursor position and prepends data at position 0 instead of replacing.

```json
{
  "name": "gboard-autocorrect-cursor0",
  "description": "Gboard prepends autocorrect at position 0 due to lost cursor tracking",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "insertText",
      "data": "the",
      "rangeStart": null,
      "rangeEnd": null,
      "valueBefore": "teh",
      "cursorBefore": 0,
      "valueAfter": "theteh"
    }
  ],
  "expectedPayload": "\u007f\u007f\u007fthe"
}
```

- [ ] **Step 4: Create multi-word autocorrect fixture**

`test/fixtures/mobile-input/gboard-autocorrect-multi-word.json` — Buffer has multiple words ("hello teh"), autocorrect should only replace the last word. This is the critical bug-catching fixture.

```json
{
  "name": "gboard-autocorrect-multi-word",
  "description": "Autocorrect in multi-word buffer must only delete target word, not preceding words",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "insertText",
      "data": "the",
      "rangeStart": 6,
      "rangeEnd": 9,
      "valueBefore": "hello teh",
      "cursorBefore": 9,
      "valueAfter": "hello the"
    }
  ],
  "expectedPayload": "\u007f\u007f\u007fthe"
}
```

- [ ] **Step 5: Create delete fixtures**

`test/fixtures/mobile-input/gboard-delete-word-swipe.json`:

```json
{
  "name": "gboard-delete-word-swipe",
  "description": "Gboard slide-to-delete removes a word via deleteWordBackward with range",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "deleteWordBackward",
      "data": null,
      "rangeStart": 6,
      "rangeEnd": 11,
      "valueBefore": "hello world",
      "cursorBefore": 11,
      "valueAfter": "hello "
    }
  ],
  "expectedPayload": "\u007f\u007f\u007f\u007f\u007f"
}
```

`test/fixtures/mobile-input/gboard-delete-no-range.json`:

```json
{
  "name": "gboard-delete-no-range",
  "description": "deleteContentBackward without getTargetRanges — falls back to diff",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "deleteContentBackward",
      "data": null,
      "rangeStart": null,
      "rangeEnd": null,
      "valueBefore": "hello",
      "cursorBefore": 5,
      "valueAfter": "hell"
    }
  ],
  "expectedPayload": "\u007f"
}
```

- [ ] **Step 6: Create iOS, paste, normal, and fallback fixtures**

`test/fixtures/mobile-input/ios-replacement-text.json`:

```json
{
  "name": "ios-replacement-text",
  "description": "iOS Safari autocorrect via insertReplacementText with range",
  "device": "ios-safari-default",
  "events": [
    {
      "inputType": "insertReplacementText",
      "data": "the",
      "rangeStart": 0,
      "rangeEnd": 3,
      "valueBefore": "teh",
      "cursorBefore": 3,
      "valueAfter": "the"
    }
  ],
  "expectedPayload": "\u007f\u007f\u007fthe"
}
```

`test/fixtures/mobile-input/paste-event.json`:

```json
{
  "name": "paste-event",
  "description": "Paste via insertFromPaste — no data field, diff-based extraction",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "insertFromPaste",
      "data": null,
      "rangeStart": null,
      "rangeEnd": null,
      "valueBefore": "hello",
      "cursorBefore": 5,
      "valueAfter": "hello world"
    }
  ],
  "expectedPayload": " world"
}
```

`test/fixtures/mobile-input/normal-typing.json`:

```json
{
  "name": "normal-typing",
  "description": "Basic character insertion with collapsed range",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "insertText",
      "data": "a",
      "rangeStart": 5,
      "rangeEnd": 5,
      "valueBefore": "hello",
      "cursorBefore": 5,
      "valueAfter": "helloa"
    }
  ],
  "expectedPayload": "a"
}
```

`test/fixtures/mobile-input/fallback-unknown-type.json`:

```json
{
  "name": "fallback-unknown-type",
  "description": "Unrecognized inputType falls back to diff-based processing",
  "device": "android-chrome-gboard",
  "events": [
    {
      "inputType": "insertFromYank",
      "data": null,
      "rangeStart": null,
      "rangeEnd": null,
      "valueBefore": "hllo",
      "cursorBefore": 1,
      "valueAfter": "hello"
    }
  ],
  "expectedPayload": "\u007f\u007f\u007fello"
}
```

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/mobile-input/
git commit -m "feat: add starter event fixtures for mobile input pipeline tests"
```

---

### Task 4: Write fixture-based tests

**Files:**
- Create: `test/mobile-input.test.ts`

- [ ] **Step 1: Write the test file with fixture replay and invariant assertions**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIntent } from '../server/mobile-input-pipeline.js';
import type { CapturedIntent } from '../server/mobile-input-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'test', 'fixtures', 'mobile-input');

interface EventStep {
  inputType: string;
  data: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
  valueBefore: string;
  cursorBefore: number;
  valueAfter: string;
}

interface EventFixture {
  name: string;
  description: string;
  device: string;
  events: EventStep[];
  expectedPayload: string;
}

function loadFixture(filename: string): EventFixture {
  const raw = readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
  return JSON.parse(raw) as EventFixture;
}

function replayFixture(fixture: EventFixture): string {
  let totalPayload = '';
  for (const step of fixture.events) {
    const intent: CapturedIntent = {
      type: step.inputType,
      data: step.data,
      rangeStart: step.rangeStart,
      rangeEnd: step.rangeEnd,
      valueBefore: step.valueBefore,
      cursorBefore: step.cursorBefore,
    };
    const result = processIntent(intent, step.valueAfter);
    totalPayload += result.payload;
  }
  return totalPayload;
}

function assertReplacementNotLost(payload: string, expectedReplacement: string, fixtureName: string) {
  assert.ok(
    payload.includes(expectedReplacement),
    `[${fixtureName}] Payload contains only backspaces — replacement text "${expectedReplacement}" was lost. Got: ${JSON.stringify(payload)}`
  );
}

// ── Fixture replay tests ─────────────────────────────────────────────

describe('mobile-input-pipeline: fixture replay', () => {
  const fixtureFiles = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));

  for (const file of fixtureFiles) {
    const fixture = loadFixture(file);
    it(`${fixture.name}: ${fixture.description}`, () => {
      const actualPayload = replayFixture(fixture);
      assert.strictEqual(
        actualPayload,
        fixture.expectedPayload,
        `Payload mismatch for fixture "${fixture.name}". ` +
        `Expected: ${JSON.stringify(fixture.expectedPayload)}, ` +
        `Got: ${JSON.stringify(actualPayload)}`
      );
    });
  }
});

// ── Autocorrect invariant tests ──────────────────────────────────────

describe('mobile-input-pipeline: autocorrect always includes replacement text', () => {
  it('Gboard range replacement includes replacement text', () => {
    const fixture = loadFixture('gboard-autocorrect-range.json');
    const payload = replayFixture(fixture);
    assertReplacementNotLost(payload, 'the', fixture.name);
  });

  it('Gboard cursor-0 recovery includes replacement text', () => {
    const fixture = loadFixture('gboard-autocorrect-cursor0.json');
    const payload = replayFixture(fixture);
    assertReplacementNotLost(payload, 'the', fixture.name);
  });

  it('iOS insertReplacementText includes replacement text', () => {
    const fixture = loadFixture('ios-replacement-text.json');
    const payload = replayFixture(fixture);
    assertReplacementNotLost(payload, 'the', fixture.name);
  });

  it('multi-word buffer: only target word deleted, replacement inserted', () => {
    const fixture = loadFixture('gboard-autocorrect-multi-word.json');
    const payload = replayFixture(fixture);
    // Must contain "the" (the replacement)
    assertReplacementNotLost(payload, 'the', fixture.name);
    // Must NOT contain backspaces for "hello " (6 chars) — only for "teh" (3 chars)
    const backspaceCount = (payload.match(/\x7f/g) ?? []).length;
    assert.strictEqual(backspaceCount, 3,
      `Expected 3 backspaces (for "teh") but got ${backspaceCount} — ` +
      `pipeline is deleting more than the target word`
    );
  });
});

// ── processIntent unit tests ─────────────────────────────────────────

describe('mobile-input-pipeline: processIntent', () => {
  it('normal character insertion sends data directly', () => {
    const result = processIntent({
      type: 'insertText', data: 'a',
      rangeStart: 5, rangeEnd: 5,
      valueBefore: 'hello', cursorBefore: 5,
    }, 'helloa');
    assert.strictEqual(result.payload, 'a');
    assert.strictEqual(result.newInputValue, undefined);
  });

  it('autocorrect with range sends backspaces + replacement', () => {
    const result = processIntent({
      type: 'insertText', data: 'the',
      rangeStart: 0, rangeEnd: 3,
      valueBefore: 'teh', cursorBefore: 3,
    }, 'the');
    assert.strictEqual(result.payload, '\x7f\x7f\x7fthe');
  });

  it('cursor-0 recovery sets newInputValue', () => {
    const result = processIntent({
      type: 'insertText', data: 'the',
      rangeStart: null, rangeEnd: null,
      valueBefore: 'teh', cursorBefore: 0,
    }, 'theteh');
    assert.strictEqual(result.payload, '\x7f\x7f\x7fthe');
    assert.strictEqual(result.newInputValue, 'the');
  });

  it('deleteContentBackward with range', () => {
    const result = processIntent({
      type: 'deleteContentBackward', data: null,
      rangeStart: 4, rangeEnd: 5,
      valueBefore: 'hello', cursorBefore: 5,
    }, 'hell');
    assert.strictEqual(result.payload, '\x7f');
  });

  it('deleteWordBackward with range sends correct backspace count', () => {
    const result = processIntent({
      type: 'deleteWordBackward', data: null,
      rangeStart: 6, rangeEnd: 11,
      valueBefore: 'hello world', cursorBefore: 11,
    }, 'hello ');
    assert.strictEqual(result.payload, '\x7f\x7f\x7f\x7f\x7f');
  });

  it('deleteContentBackward without range falls back to diff', () => {
    const result = processIntent({
      type: 'deleteContentBackward', data: null,
      rangeStart: null, rangeEnd: null,
      valueBefore: 'hello', cursorBefore: 5,
    }, 'hell');
    assert.strictEqual(result.payload, '\x7f');
  });

  it('insertReplacementText sends backspaces + replacement', () => {
    const result = processIntent({
      type: 'insertReplacementText', data: 'the',
      rangeStart: 0, rangeEnd: 3,
      valueBefore: 'teh', cursorBefore: 3,
    }, 'the');
    assert.strictEqual(result.payload, '\x7f\x7f\x7fthe');
  });

  it('insertFromPaste uses diff to extract pasted text', () => {
    const result = processIntent({
      type: 'insertFromPaste', data: null,
      rangeStart: null, rangeEnd: null,
      valueBefore: 'hello', cursorBefore: 5,
    }, 'hello world');
    assert.strictEqual(result.payload, ' world');
  });

  it('unknown inputType falls back to diff', () => {
    const result = processIntent({
      type: 'insertFromYank', data: null,
      rangeStart: null, rangeEnd: null,
      valueBefore: 'hllo', cursorBefore: 1,
    }, 'hello');
    assert.strictEqual(result.payload, '\x7f\x7f\x7fello');
  });

  it('empty payload for no-op diff', () => {
    const result = processIntent({
      type: 'insertText', data: null,
      rangeStart: null, rangeEnd: null,
      valueBefore: 'hello', cursorBefore: 5,
    }, 'hello');
    assert.strictEqual(result.payload, '');
  });

  it('handles emoji codepoints correctly in autocorrect range', () => {
    const result = processIntent({
      type: 'insertText', data: 'smile',
      rangeStart: 0, rangeEnd: 2,
      valueBefore: '😊', cursorBefore: 2,
    }, 'smile');
    // '😊' is 1 codepoint (surrogate pair, 2 UTF-16 units) → 1 backspace
    assert.strictEqual(result.payload, '\x7fsmile');
  });
});
```

- [ ] **Step 2: Verify tests compile and run**

Run: `npx tsc -p tsconfig.test.json && node --test dist/test/mobile-input.test.js`
Expected: All tests pass (the pipeline module is a faithful extraction of the existing logic)

- [ ] **Step 3: Commit**

```bash
git add test/mobile-input.test.ts
git commit -m "feat: add fixture-based tests for mobile input pipeline"
```

---

### Task 5: Refactor MobileInput.svelte to use pipeline module

**Files:**
- Modify: `frontend/src/components/MobileInput.svelte`
- Modify: `frontend/tsconfig.json`

- [ ] **Step 1: Add pipeline module to frontend tsconfig include**

In `frontend/tsconfig.json`, add `"../server/mobile-input-pipeline.ts"` to the `include` array so `svelte-check` can resolve the import:

```json
"include": ["src/**/*.ts", "src/**/*.svelte", "vite.config.ts", "../server/mobile-input-pipeline.ts"]
```

- [ ] **Step 2: Refactor MobileInput.svelte**

Replace the inline pipeline logic with imports from the pipeline module. Changes:

1. Add import at the top of the `<script>` block:
```ts
import { processIntent, type CapturedIntent, type PipelineResult } from '../../../server/mobile-input-pipeline.js';
```

2. Remove these functions from MobileInput.svelte (they now live in the pipeline module):
   - `codepointCount`
   - `commonPrefixLength`
   - `handleInsert`
   - `handleDelete`
   - `handleReplacement`
   - `handlePaste`
   - `handleFallbackDiff`

3. Remove the `CapturedIntent` interface definition (imported from pipeline module instead).

4. Replace the `onInput` handler's switch/case block (lines 354-376) with a single call to `processIntent`, then handle the result:

```ts
// Replace the switch block in onInput with:
const result = processIntent(intent, currentValue);

if (result.payload) {
  scheduleSend(result.payload);
}

if (result.newInputValue !== undefined) {
  inputEl.value = result.newInputValue;
  ensureCursorAtEnd();
  syncBuffer();
  return;
}
```

5. Update the fallback path (line 349, when `!intent`) to use `processIntent`:

```ts
if (!intent) {
  dbg('  WARN: no captured intent, using fallback diff');
  const result = processIntent(
    { type: ie.inputType, data: ie.data, rangeStart: null, rangeEnd: null, valueBefore: '', cursorBefore: 0 },
    currentValue
  );
  if (result.payload) scheduleSend(result.payload);
  syncBuffer();
  return;
}
```

- [ ] **Step 3: Verify frontend builds and type-checks**

Run: `npm run build`
Expected: No errors from tsc or svelte-check. Vite bundles successfully.

- [ ] **Step 4: Verify all tests still pass**

Run: `npm test`
Expected: All tests pass (including the new mobile-input tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/tsconfig.json frontend/src/components/MobileInput.svelte
git commit -m "refactor: MobileInput uses extracted pipeline module"
```

---

### Task 6: Update harness documentation

**Files:**
- Modify: `docs/QUALITY.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/FRONTEND.md`
- Modify: `CLAUDE.md` (via revise-claude-md skill)

- [ ] **Step 1: Add Mobile Input Testing section to QUALITY.md**

Append before the "## See Also" section:

```markdown
## Mobile Input Testing

The mobile input event-intent pipeline is extracted into `server/mobile-input-pipeline.ts` and tested via JSON event fixtures.

**Test file:** `test/mobile-input.test.ts`
**Fixtures:** `test/fixtures/mobile-input/*.json`

**Workflow for mobile keyboard bug fixes:**
1. Create a fixture JSON in `test/fixtures/mobile-input/` reproducing the event sequence that triggers the bug
2. Run `npm test` — the new fixture should fail (TDD red)
3. Fix the pipeline logic in `server/mobile-input-pipeline.ts`
4. Run `npm test` — all fixtures should pass (TDD green)

**Fixture format:**
```json
{
  "name": "descriptive-name",
  "description": "What this tests",
  "device": "android-chrome-gboard",
  "events": [{
    "inputType": "insertText",
    "data": "the",
    "rangeStart": 0, "rangeEnd": 3,
    "valueBefore": "teh", "cursorBefore": 3,
    "valueAfter": "the"
  }],
  "expectedPayload": "\u007f\u007f\u007fthe"
}
```

**Critical invariant:** When an autocorrect event carries replacement text (`data` is non-null), the payload must always include that text — never only backspaces.
```

- [ ] **Step 2: Add Key Decision to DESIGN.md**

Add a new row to the Key Decisions table:

```markdown
| Fixture-based mobile input testing | Event-intent pipeline extracted to `server/mobile-input-pipeline.ts` for unit testing; JSON fixtures in `test/fixtures/mobile-input/` | Design doc |
```

- [ ] **Step 3: Update FRONTEND.md Mobile Touch & Input section**

Add a bullet to the Mobile Touch & Input section:

```markdown
- Event-intent pipeline logic extracted to `server/mobile-input-pipeline.ts` (pure functions, no DOM); tested via JSON fixtures in `test/fixtures/mobile-input/`. When fixing mobile keyboard bugs, add a fixture first (see `docs/QUALITY.md` Mobile Input Testing section)
```

- [ ] **Step 4: Update CLAUDE.md via revise-claude-md skill**

Use the `claude-md-management:revise-claude-md` skill to add a row to the Quick Reference table:

```markdown
| Mobile input tests | Add fixture to `test/fixtures/mobile-input/` before fixing mobile keyboard bugs |
```

- [ ] **Step 5: Commit**

```bash
git add docs/QUALITY.md docs/DESIGN.md docs/FRONTEND.md CLAUDE.md
git commit -m "docs: add mobile input testing workflow to harness documentation"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Clean pipeline extraction — zero logic changes needed, all 24 tests passed on first run
- Parallel task dispatch (1+3, then 4+5) cut wall-clock time significantly
- Fixture format is simple enough that agents can add test cases without pipeline knowledge

**What didn't:**
- Nothing — clean execution with 0 surprises and 0 drift

**Learnings to codify:**
- Pure function extraction from Svelte components into `server/` is a viable pattern for testability when the logic has no DOM dependencies
- Cross-boundary imports (`frontend/` → `server/`) work via Vite resolution but require adding the file to frontend tsconfig `include` for `svelte-check`
