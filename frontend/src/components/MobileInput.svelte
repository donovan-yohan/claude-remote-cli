<script lang="ts">
  import { onMount } from 'svelte';
  import { isMobileDevice } from '../lib/utils.js';
  import { sendPtyData, isPtyConnected } from '../lib/ws.js';

  let inputEl: HTMLInputElement;
  let formEl: HTMLFormElement;

  interface CapturedIntent {
    type: string;
    data: string | null;
    rangeStart: number | null;
    rangeEnd: number | null;
    valueBefore: string;
  }

  let capturedIntent: CapturedIntent | null = null;
  let isComposing = false;
  let sendBuffer = '';
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  const SEND_DELAY = 10; // ms — batches autocorrect pairs

  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Debug panel ──────────────────────────────────────────────────────────────
  let debugVisible = $state(false);
  let debugLines: string[] = $state([]);
  let devtoolsEnabled = $state(false);

  onMount(() => {
    devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';

    // Set a non-standard autocomplete value to suppress Chrome/Gboard's
    // "Passwords, cards, and addresses" autofill strip. Chrome ignores
    // autocomplete="off" but skips autofill for unrecognized values.
    // Done at runtime to bypass Svelte's type checker.
    if (inputEl) inputEl.setAttribute('autocomplete', 'new-terminal-input');

    // Listen for devtools toggle from settings
    const onDevtoolsChanged = () => {
      devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
      if (!devtoolsEnabled) debugVisible = false;
    };
    window.addEventListener('devtools-changed', onDevtoolsChanged);

    return () => {
      window.removeEventListener('devtools-changed', onDevtoolsChanged);
    };
  });

  function dbg(msg: string) {
    const t = performance.now().toFixed(1);
    debugLines = [...debugLines.slice(-199), '[' + t + '] ' + msg];
  }

  // ── Exposed methods ──────────────────────────────────────────────────────────

  export function getInputEl(): HTMLInputElement | null {
    return inputEl ?? null;
  }

  export function focus() {
    inputEl?.focus();
  }

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

  export function clearInput() {
    if (inputEl) {
      inputEl.value = '';
      inputEl.setSelectionRange(0, 0);
    }
  }

  // ── Batched send ─────────────────────────────────────────────────────────────

  function scheduleSend(data: string) {
    sendBuffer += data;
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = setTimeout(flushSendBuffer, SEND_DELAY);
  }

  function flushSendBuffer() {
    sendTimer = null;
    if (sendBuffer && isPtyConnected()) {
      dbg('FLUSH: "' + sendBuffer.replace(/\x7f/g, '\u232b') + '" (' + sendBuffer.length + ' bytes)');
      sendPtyData(sendBuffer);
    }
    sendBuffer = '';
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  function codepointCount(str: string): number {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      count++;
      if (str.charCodeAt(i) >= 0xd800 && str.charCodeAt(i) <= 0xdbff) i++;
    }
    return count;
  }

  function commonPrefixLength(a: string, b: string): number {
    let len = 0;
    while (len < a.length && len < b.length && a[len] === b[len]) len++;
    return len;
  }

  // ── Intent handlers ───────────────────────────────────────────────────────────

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

  function handlePaste(intent: CapturedIntent, currentValue: string) {
    // Paste events don't provide data — diff to extract pasted text
    const commonLen = commonPrefixLength(intent.valueBefore, currentValue);
    const pasted = currentValue.slice(commonLen);
    dbg('  → PASTE: "' + pasted.slice(0, 50) + (pasted.length > 50 ? '...' : '') + '" (' + pasted.length + ' chars)');
    if (pasted) scheduleSend(pasted);
  }

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

  // ── Buffer management ─────────────────────────────────────────────────────────

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

  // ── Event handlers ───────────────────────────────────────────────────────────

  function onCompositionStart(e: CompositionEvent) {
    dbg('COMP_START data="' + e.data + '" val="' + inputEl.value + '"');
    isComposing = true;
  }

  function onCompositionUpdate(e: CompositionEvent) {
    dbg('COMP_UPDATE data="' + e.data + '" val="' + inputEl.value + '"');
  }

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

  function onBlur() {
    if (isComposing) {
      isComposing = false;
    }
  }

  // Reset state when session changes
  export function onSessionChange() {
    isComposing = false;
  }

  function onBeforeInput(e: InputEvent) {
    const ranges = e.getTargetRanges();
    const firstRange: StaticRange | null = ranges.length > 0 ? (ranges[0] as StaticRange) : null;
    const rangeInfo = firstRange !== null
      ? 'range=[' + firstRange.startOffset + ',' + firstRange.endOffset + ']'
      : 'range=none';

    capturedIntent = {
      type: e.inputType,
      data: e.data,
      rangeStart: firstRange !== null ? firstRange.startOffset : null,
      rangeEnd: firstRange !== null ? firstRange.endOffset : null,
      valueBefore: inputEl.value,
    };

    dbg('BEFORE type="' + e.inputType + '" data="' + (e.data ?? '') + '" ' + rangeInfo + ' val="' + inputEl.value + '" cursor=' + inputEl.selectionStart + ',' + inputEl.selectionEnd);
  }

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

  function onKeydown(e: KeyboardEvent) {
    dbg('KEYDOWN key="' + e.key + '" shift=' + e.shiftKey + ' composing=' + isComposing + ' val="' + inputEl.value + '"');
    if (!isPtyConnected()) return;

    let handled = true;

    switch (e.key) {
      case 'Enter':
        flushComposedText();
        if (e.shiftKey) {
          sendPtyData('\x1b[13;2u'); // kitty protocol: Shift+Enter (newline)
        } else {
          sendPtyData('\r');
        }
        inputEl.value = '';
        break;
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
      case 'Escape':
        sendPtyData('\x1b');
        inputEl.value = '';
        break;
      case 'Tab':
        sendPtyData('\t');
        break;
      case 'ArrowUp':
        sendPtyData('\x1b[A');
        break;
      case 'ArrowDown':
        sendPtyData('\x1b[B');
        break;
      default:
        handled = false;
    }

    if (handled) e.preventDefault();
  }

  function onFormSubmit(e: SubmitEvent) {
    e.preventDefault();
    dbg('FORM_SUBMIT composing=' + isComposing + ' val="' + inputEl.value + '"');
    if (!isPtyConnected()) return;
    flushComposedText();
    sendPtyData('\r');
    inputEl.value = '';
  }

  function onDebugToggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    debugVisible = !debugVisible;
  }
</script>

{#if isMobileDevice}
  <form
    bind:this={formEl}
    class="mobile-input-form"
    action="javascript:void(0)"
    onsubmit={onFormSubmit}
  >
    <input
      bind:this={inputEl}
      type="search"
      class="mobile-input"
      dir="ltr"
      autocomplete="off"
      autocorrect="on"
      autocapitalize="sentences"
      spellcheck={true}
      enterkeyhint="send"
      aria-label="Terminal input"
      oncompositionstart={onCompositionStart}
      oncompositionupdate={onCompositionUpdate}
      oncompositionend={onCompositionEnd}
      onblur={onBlur}
      onbeforeinput={onBeforeInput}
      oninput={onInput}
      onkeydown={onKeydown}
    />
  </form>

  {#if devtoolsEnabled}
    <button
      class="debug-toggle"
      style:opacity={debugVisible ? '1' : '0.5'}
      onclick={onDebugToggle}
    >
      dbg
    </button>
  {/if}

  {#if debugVisible}
    <div class="debug-panel">
      {#each debugLines as line (line)}
        <div>{line}</div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .mobile-input-form {
    /* Hidden visually but kept in-viewport so Android IME tracks cursor.
       Off-screen positioning (left:-9999px) causes Gboard to lose cursor
       tracking, making characters prepend at position 0 instead of append. */
    position: fixed;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: 0;
    overflow: hidden;
    clip-path: inset(50%);
    opacity: 0;
    pointer-events: none;
  }

  .mobile-input {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: transparent;
    caret-color: transparent;
    font-size: 16px; /* Prevents zoom on iOS */
  }

  /* Hide the clear (X) button that type="search" renders */
  .mobile-input::-webkit-search-cancel-button,
  .mobile-input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
  }

  .debug-toggle {
    position: fixed;
    bottom: 60px;
    right: 8px;
    z-index: 10000;
    background: #333;
    color: #0f0;
    border: 1px solid #0f0;
    border-radius: 6px;
    font: 12px monospace;
    padding: 6px 10px;
    min-width: 44px;
    min-height: 44px;
    touch-action: manipulation;
  }

  .debug-panel {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow-y: scroll;
    -webkit-overflow-scrolling: touch;
    background: rgba(0, 0, 0, 0.92);
    color: #0f0;
    font: 11px/1.4 monospace;
    padding: 6px 6px 6px 40px;
    z-index: 9999;
    white-space: pre-wrap;
    word-break: break-all;
    overscroll-behavior: contain;
  }
</style>
