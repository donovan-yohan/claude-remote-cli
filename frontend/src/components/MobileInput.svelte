<script lang="ts">
  import { onMount } from 'svelte';
  import { isMobileDevice } from '../lib/utils.js';
  import { sendPtyData, isPtyConnected } from '../lib/ws.js';

  let {
    onTerminalTouchFocus,
  }: {
    // Called when mobile input receives focus (to re-focus the hidden input from outside)
    onTerminalTouchFocus?: () => void;
  } = $props();

  let inputEl: HTMLInputElement;
  let formEl: HTMLFormElement;

  let lastInputValue = '';
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

    // Listen for devtools toggle from settings
    window.addEventListener('devtools-changed', () => {
      devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
      if (!devtoolsEnabled) debugVisible = false;
    });
  });

  function dbg(msg: string) {
    const t = performance.now().toFixed(1);
    debugLines = [...debugLines.slice(-199), '[' + t + '] ' + msg];
  }

  // ── Exposed methods ──────────────────────────────────────────────────────────

  export function focus() {
    inputEl?.focus();
  }

  export function flushComposedText() {
    isComposing = false;
    if (isPtyConnected()) {
      const currentValue = inputEl.value;
      sendInputDiff(currentValue);
      lastInputValue = currentValue;
    }
    flushSendBuffer();
  }

  export function clearInput() {
    if (inputEl) inputEl.value = '';
    lastInputValue = '';
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

  // ── Input diff ───────────────────────────────────────────────────────────────

  function commonPrefixLength(a: string, b: string): number {
    let len = 0;
    while (len < a.length && len < b.length && a[len] === b[len]) len++;
    return len;
  }

  function codepointCount(str: string): number {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      count++;
      if (str.charCodeAt(i) >= 0xd800 && str.charCodeAt(i) <= 0xdbff) i++;
    }
    return count;
  }

  function sendInputDiff(currentValue: string) {
    if (currentValue === lastInputValue) {
      dbg('sendInputDiff: NO-OP (same)');
      return;
    }
    const commonLen = commonPrefixLength(lastInputValue, currentValue);
    const deletedSlice = lastInputValue.slice(commonLen);
    const charsToDelete = codepointCount(deletedSlice);
    const newChars = currentValue.slice(commonLen);

    dbg('sendInputDiff: del=' + charsToDelete + ' "' + deletedSlice + '" add="' + newChars + '"');

    let payload = '';
    for (let i = 0; i < charsToDelete; i++) payload += '\x7f';
    payload += newChars;
    if (payload) scheduleSend(payload);
  }

  // ── Event handlers ───────────────────────────────────────────────────────────

  function onCompositionStart(e: CompositionEvent) {
    dbg('COMP_START data="' + e.data + '" val="' + inputEl.value + '" last="' + lastInputValue + '"');
    isComposing = true;
  }

  function onCompositionUpdate(e: CompositionEvent) {
    dbg('COMP_UPDATE data="' + e.data + '" val="' + inputEl.value + '"');
  }

  function onCompositionEnd(e: CompositionEvent) {
    dbg('COMP_END data="' + e.data + '" val="' + inputEl.value + '" last="' + lastInputValue + '"');
    isComposing = false;
    if (isPtyConnected()) {
      const currentValue = inputEl.value;
      sendInputDiff(currentValue);
      lastInputValue = currentValue;
    }
  }

  function onBlur() {
    if (isComposing) {
      isComposing = false;
      lastInputValue = inputEl.value;
    }
  }

  // Reset state when session changes
  export function onSessionChange() {
    isComposing = false;
    lastInputValue = '';
  }

  function onBeforeInput(e: InputEvent) {
    dbg('BEFORE_INPUT type="' + e.inputType + '" data="' + (e.data ?? '') + '" composing=' + isComposing);
  }

  function onInput(e: Event) {
    const ie = e as InputEvent;
    dbg('INPUT type="' + ie.inputType + '" composing=' + isComposing + ' val="' + inputEl.value + '" last="' + lastInputValue + '"');

    // Reset auto-clear timer
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      dbg('TIMER_CLEAR val="' + inputEl.value + '"');
      inputEl.value = '';
      lastInputValue = '';
    }, 5000);

    if (!isPtyConnected()) return;
    if (isComposing) {
      dbg('  INPUT: skipped (composing)');
      return;
    }

    const currentValue = inputEl.value;
    sendInputDiff(currentValue);
    lastInputValue = currentValue;
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
        lastInputValue = '';
        break;
      case 'Backspace':
        if (inputEl.value.length === 0) {
          sendPtyData('\x7f');
        }
        handled = false; // let input event handle diff
        break;
      case 'Escape':
        sendPtyData('\x1b');
        inputEl.value = '';
        lastInputValue = '';
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
    lastInputValue = '';
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
      type="text"
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
    /* Hidden visually but accessible; keyboard opens on focus */
    position: fixed;
    left: -9999px;
    top: 0;
    width: 1px;
    height: 1px;
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
    height: 30vh;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.92);
    color: #0f0;
    font: 11px/1.4 monospace;
    padding: 6px 6px 6px 40px;
    z-index: 9999;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
