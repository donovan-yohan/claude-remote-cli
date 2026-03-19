<script lang="ts">
  let {
    disabled = false,
    onSend,
  }: {
    disabled?: boolean;
    onSend: (text: string) => void;
  } = $props();

  let text = $state('');
  let textareaEl: HTMLTextAreaElement | undefined;

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    text = '';
    // Reset textarea height
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput() {
    // Auto-resize textarea
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
    }
  }

  let canSend = $derived(!disabled && text.trim().length > 0);
</script>

<div class="chat-input-container">
  <textarea
    bind:this={textareaEl}
    bind:value={text}
    oninput={handleInput}
    onkeydown={handleKeydown}
    placeholder="Send a message..."
    rows="1"
    {disabled}
    class="chat-textarea"
  ></textarea>
  <button
    class="send-btn"
    class:disabled={!canSend}
    onclick={handleSend}
    disabled={!canSend}
    aria-label="Send message"
  >
    {#if disabled}
      <span class="send-dots">...</span>
    {:else}
      <svg class="send-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    {/if}
  </button>
</div>

<style>
  .chat-input-container {
    display: flex;
    align-items: flex-end;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--surface);
    border-top: 1px solid var(--border);
    position: sticky;
    bottom: 0;
  }

  .chat-textarea {
    flex: 1;
    background: var(--surface);
    border: none;
    color: var(--text);
    font-size: 0.95rem;
    font-family: inherit;
    resize: none;
    outline: none;
    padding: var(--spacing-sm);
    min-height: 36px;
    max-height: 120px;
    line-height: 1.4;
  }

  .chat-textarea::placeholder {
    color: var(--text-muted);
  }

  .chat-textarea:disabled {
    opacity: 0.5;
  }

  .send-btn {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s;
  }

  .send-btn.disabled {
    opacity: 0.4;
    cursor: default;
  }

  .send-btn:not(.disabled):hover {
    opacity: 0.9;
  }

  .send-dots {
    font-size: 1.1rem;
    letter-spacing: 1px;
  }

  .send-icon {
    display: block;
  }
</style>
