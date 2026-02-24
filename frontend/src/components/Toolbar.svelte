<script lang="ts">
  import { isMobileDevice } from '../lib/utils.js';

  let {
    onSendKey,
    onFlushComposedText,
    onClearInput,
    onUploadImage,
    onRefocusMobileInput,
  }: {
    onSendKey: (key: string) => void;
    onFlushComposedText: () => void;
    onClearInput: () => void;
    onUploadImage: () => void;
    onRefocusMobileInput: () => void;
  } = $props();

  const buttons: Array<{
    label: string;
    key?: string;
    id?: string;
    extraClass?: string;
    html: string;
  }> = [
    { html: 'Tab', key: '\x09', label: 'Tab' },
    { html: '&#8679;Tab', key: '\x1b[Z', label: 'Shift+Tab' },
    { html: '&#8593;', key: '\x1b[A', label: 'Up arrow', extraClass: 'tb-arrow' },
    { html: 'Esc', key: '\x1b', label: 'Escape' },
    { html: '&#128247;', id: 'upload-image-btn', label: 'Upload image' },
    { html: '^D', key: '\x04', label: 'Ctrl+D' },
    { html: '^C', key: '\x03', label: 'Ctrl+C' },
    { html: '&#8592;', key: '\x1b[D', label: 'Left arrow', extraClass: 'tb-arrow' },
    { html: '&#8595;', key: '\x1b[B', label: 'Down arrow', extraClass: 'tb-arrow' },
    { html: '&#8594;', key: '\x1b[C', label: 'Right arrow', extraClass: 'tb-arrow' },
    { html: '&#8679;&#9166;', key: '\x1b[13;2u', label: 'Shift+Enter (newline)', extraClass: 'tb-newline' },
    { html: '&#9166;', key: '\x0d', label: 'Enter', extraClass: 'tb-enter' },
  ];

  function handleButton(btn: typeof buttons[number]) {
    if (btn.id === 'upload-image-btn') {
      onUploadImage();
      if (isMobileDevice) onRefocusMobileInput();
      return;
    }

    if (!btn.key) return;

    // Flush composed text before Enter/newline
    if (btn.key === '\r' || btn.key === '\x1b[13;2u') {
      onFlushComposedText();
    }

    onSendKey(btn.key);

    // Clear input after Enter/newline
    if (btn.key === '\r' || btn.key === '\x1b[13;2u') {
      onClearInput();
    }

    if (isMobileDevice) onRefocusMobileInput();
  }

  function onToolbarTouchStart(e: TouchEvent) {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    e.preventDefault();
    const match = buttons.find(
      (b) => b.id === btn.id || (b.key && btn.dataset['key'] === b.key),
    );
    if (match) handleButton(match);
  }

  function onToolbarClick(e: MouseEvent) {
    if (isMobileDevice) return; // already handled by touchstart
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const match = buttons.find(
      (b) => b.id === btn.id || (b.key && btn.dataset['key'] === b.key),
    );
    if (match) handleButton(match);
  }
</script>

{#if isMobileDevice}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="toolbar"
  role="toolbar"
  ontouchstart={onToolbarTouchStart}
  onclick={onToolbarClick}
>
  <div class="toolbar-grid">
    {#each buttons as btn (btn.label)}
      <button
        class="tb-btn {btn.extraClass ?? ''}"
        id={btn.id}
        data-key={btn.key}
        aria-label={btn.label}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html btn.html}
      </button>
    {/each}
  </div>
</div>
{/if}

<style>
  .toolbar {
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding: 4px;
    flex-shrink: 0;
  }

  .toolbar-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }

  .tb-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    padding: 8px 4px;
    cursor: pointer;
    touch-action: manipulation;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
  }

  .tb-btn:active {
    background: var(--border);
  }

  .tb-enter {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .tb-enter:active {
    opacity: 0.8;
  }
</style>
