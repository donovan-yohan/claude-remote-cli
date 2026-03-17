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
      // Only delete and replace the LAST word (the one being autocorrected),
      // not the entire buffer. Previous words were already sent correctly.
      const lastSpaceIdx = intent.valueBefore.lastIndexOf(' ');
      const lastWord = lastSpaceIdx >= 0 ? intent.valueBefore.slice(lastSpaceIdx + 1) : intent.valueBefore;
      const prefix = lastSpaceIdx >= 0 ? intent.valueBefore.slice(0, lastSpaceIdx + 1) : '';
      const charsToDelete = codepointCount(lastWord);
      // Determine replacement text:
      // - If data starts with the same char as the last word, it's the full replacement (Gboard)
      // - Otherwise, the first char was kept and data is the suffix (iOS)
      const firstChar = lastWord.charAt(0);
      const replacement = data.charAt(0) === firstChar ? data : firstChar + data;
      const payload = makeBackspaces(charsToDelete) + replacement;
      return { payload, newInputValue: prefix + replacement };
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
