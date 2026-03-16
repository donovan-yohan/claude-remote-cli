<script lang="ts">
  import { onMount } from 'svelte';
  import { isMobileDevice } from '../lib/utils.js';
  import { sendPtyData, isPtyConnected } from '../lib/ws.js';
  import { processIntent } from '../../../server/mobile-input-pipeline.js';
  import type { CapturedIntent } from '../../../server/mobile-input-pipeline.js';

  let inputEl: HTMLInputElement;
  let formEl: HTMLFormElement;

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

  // ── Cursor fix ───────────────────────────────────────────────────────────────
  // iOS Safari loses cursor tracking on hidden inputs (clip-path:inset),
  // leaving the cursor stuck at position 0. This causes characters to prepend
  // instead of append, and backspace at position 0 becomes a no-op.
  function ensureCursorAtEnd() {
    if (inputEl && !isComposing) {
      const len = inputEl.value.length;
      if (inputEl.selectionStart !== len || inputEl.selectionEnd !== len) {
        inputEl.setSelectionRange(len, len);
      }
    }
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
    // Safety net: if cursor is stuck at 0 despite ensureCursorAtEnd(),
    // delete events won't change the value (nothing before cursor to delete).
    // Send DEL directly so backspace still works.
    if (e.inputType.startsWith('delete') &&
        inputEl.selectionStart === 0 && inputEl.selectionEnd === 0 &&
        inputEl.value.length > 0) {
      dbg('CURSOR0_DEL type="' + e.inputType + '" val="' + inputEl.value + '" → sending DEL');
      scheduleSend('\x7f');
      e.preventDefault();
      capturedIntent = null;
      return;
    }

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
      cursorBefore: inputEl.selectionStart ?? 0,
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
      ensureCursorAtEnd();
    }, 2000);

    if (!isPtyConnected()) return;
    if (isComposing) {
      dbg('  skipped (composing)');
      return;
    }

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

    const result = processIntent(intent, currentValue);

    dbg('  → PIPELINE: payload="' + result.payload.replace(/\x7f/g, '\u232b') + '"' + (result.newInputValue !== undefined ? ' newVal="' + result.newInputValue + '"' : ''));

    if (result.payload) {
      scheduleSend(result.payload);
    }

    if (result.newInputValue !== undefined) {
      inputEl.value = result.newInputValue;
      ensureCursorAtEnd();
      syncBuffer();
      return;
    }

    syncBuffer();
    ensureCursorAtEnd();
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
