<script lang="ts">
  import { autocompletePath } from '../../lib/api.js';

  let {
    onWorkspaceAdded,
  }: {
    onWorkspaceAdded: (path: string) => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  let inputEl: HTMLInputElement | undefined;

  let pathValue = $state('');
  let suggestions = $state<string[]>([]);
  let focusedIndex = $state(-1);
  let loading = $state(false);
  let error = $state('');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  export function open() {
    pathValue = '';
    suggestions = [];
    focusedIndex = -1;
    error = '';
    loading = false;
    dialogEl.showModal();
    // Focus input after dialog opens
    setTimeout(() => inputEl?.focus(), 50);
  }

  export function close() {
    dialogEl.close();
  }

  async function fetchSuggestions(prefix: string) {
    if (!prefix || prefix.length < 2) {
      suggestions = [];
      return;
    }
    loading = true;
    try {
      suggestions = await autocompletePath(prefix);
      focusedIndex = -1;
    } catch {
      suggestions = [];
    } finally {
      loading = false;
    }
  }

  function handleInput() {
    error = '';
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(pathValue), 200);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (suggestions.length > 0) {
        suggestions = [];
        e.preventDefault();
        return;
      }
      close();
      return;
    }

    if (e.key === 'Tab') {
      // Always prevent Tab from leaving the input — this is a terminal-style input
      e.preventDefault();
      if (suggestions.length > 0) {
        // Tab completion — fill with first/focused suggestion
        const target = focusedIndex >= 0 ? suggestions[focusedIndex] : suggestions[0];
        if (target) {
          pathValue = target;
          suggestions = [];
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => fetchSuggestions(pathValue), 100);
        }
      } else if (pathValue.trim()) {
        // No suggestions visible — trigger fetch immediately
        if (debounceTimer) clearTimeout(debounceTimer);
        fetchSuggestions(pathValue);
      }
      return;
    }

    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, suggestions.length - 1);
      return;
    }

    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, -1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && suggestions[focusedIndex]) {
        // Select the focused suggestion
        pathValue = suggestions[focusedIndex] ?? pathValue;
        suggestions = [];
        focusedIndex = -1;
        // Re-fetch to drill deeper
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(pathValue), 100);
      } else {
        // Submit the current path
        handleSubmit();
      }
      return;
    }
  }

  function selectSuggestion(path: string) {
    pathValue = path;
    suggestions = [];
    focusedIndex = -1;
    inputEl?.focus();
    // Re-fetch to show subdirectories
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(pathValue), 100);
  }

  function handleSubmit() {
    const trimmed = pathValue.trim();
    if (!trimmed) {
      error = 'Path is required';
      return;
    }
    error = '';
    onWorkspaceAdded(trimmed);
    close();
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialogEl) close();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialogEl} onclick={onDialogClick} class="dialog">
  <div class="dialog-content">
    <div class="dialog-header">
      <h2 class="dialog-title">Add Workspace</h2>
      <button class="close-btn" aria-label="Close" onclick={close}>&#10005;</button>
    </div>

    <div class="dialog-body">
      <p class="dialog-desc">
        Enter the path to a folder on your machine. Git repos get PR tracking and branch management.
      </p>

      <div class="path-input-container">
        <span class="prompt-char">&gt;</span>
        <input
          bind:this={inputEl}
          type="text"
          class="path-input"
          placeholder="/path/to/project"
          bind:value={pathValue}
          oninput={handleInput}
          onkeydown={handleKeydown}
          autocomplete="off"
          spellcheck="false"
        />
        {#if loading}
          <span class="loading-indicator">...</span>
        {/if}
      </div>

      {#if suggestions.length > 0}
        <ul class="suggestions" role="listbox">
          {#each suggestions as suggestion, i (suggestion)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              class="suggestion-item"
              class:focused={i === focusedIndex}
              role="option"
              aria-selected={i === focusedIndex}
              onclick={() => selectSuggestion(suggestion)}
            >
              <span class="suggestion-icon">{suggestion.endsWith('/') ? '📁' : '📄'}</span>
              <span class="suggestion-path">{suggestion}</span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}

      <p class="hint">
        Tab to autocomplete · Enter to add · Escape to cancel
      </p>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={close}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSubmit}>Add Workspace</button>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0;
    width: min(520px, 95vw);
    max-height: 80vh;
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.7);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
    max-height: 80vh;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    font-family: var(--font-mono);
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .dialog-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dialog-desc {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin: 0;
    line-height: 1.5;
  }

  .path-input-container {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 10px 12px;
    transition: border-color 0.15s;
  }

  .path-input-container:focus-within {
    border-color: var(--accent);
  }

  .prompt-char {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--font-size-base);
    font-weight: 600;
    flex-shrink: 0;
  }

  .path-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-base);
    outline: none;
  }

  .path-input::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .loading-indicator {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .suggestions {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    max-height: 200px;
    overflow-y: auto;
  }

  .suggestion-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    transition: background 0.1s;
  }

  .suggestion-item:hover,
  .suggestion-item.focused {
    background: var(--surface-hover);
    color: var(--text);
  }

  .suggestion-icon {
    font-size: var(--font-size-xs);
    flex-shrink: 0;
  }

  .suggestion-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-msg {
    font-size: var(--font-size-xs);
    color: var(--status-error);
    font-family: var(--font-mono);
    margin: 0;
  }

  .hint {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin: 0;
    opacity: 0.6;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 0;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  .btn-ghost:hover {
    background: var(--border);
    color: var(--text);
  }
</style>
