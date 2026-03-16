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
