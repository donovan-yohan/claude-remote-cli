<script lang="ts">
  import { fetchRoots, addRoot, removeRoot } from '../../lib/api.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';

  let dialogEl: HTMLDialogElement;

  let roots = $state<string[]>([]);
  let newRootPath = $state('');
  let devtoolsEnabled = $state(false);
  let error = $state('');

  async function loadRoots() {
    try {
      roots = await fetchRoots();
    } catch {
      roots = [];
    }
  }

  export async function open() {
    error = '';
    newRootPath = '';
    devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
    await loadRoots();
    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleAddRoot() {
    const path = newRootPath.trim();
    if (!path) return;
    error = '';
    try {
      roots = await addRoot(path);
      newRootPath = '';
      await refreshAll();
    } catch {
      error = 'Failed to add root directory.';
    }
  }

  async function handleRemoveRoot(path: string) {
    error = '';
    try {
      roots = await removeRoot(path);
      await refreshAll();
    } catch {
      error = 'Failed to remove root directory.';
    }
  }

  function onDevtoolsChange() {
    localStorage.setItem('devtools-enabled', devtoolsEnabled ? 'true' : 'false');
    window.dispatchEvent(new Event('devtools-changed'));
  }

  async function handleClose() {
    dialogEl.close();
    await refreshAll();
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      handleClose();
    }
  }

  function onAddKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleAddRoot();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  onclick={onDialogClick}
  class="dialog"
>
  <div class="dialog-content">
    <div class="dialog-header">
      <h2 class="dialog-title">Settings</h2>
      <button class="close-btn" aria-label="Close settings" onclick={handleClose}>&#10005;</button>
    </div>

    <div class="dialog-body">
      <!-- Root directories section -->
      <section class="settings-section">
        <h3 class="section-title">Root Directories</h3>
        <p class="section-desc">Directories scanned for git repositories.</p>

        {#if roots.length === 0}
          <p class="empty-msg">No root directories configured.</p>
        {:else}
          <ul class="roots-list">
            {#each roots as root (root)}
              <li class="root-item">
                <span class="root-path" title={root}>{root}</span>
                <button
                  class="remove-btn"
                  aria-label="Remove {root}"
                  onclick={() => handleRemoveRoot(root)}
                >&#10005;</button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="add-root-row">
          <input
            type="text"
            class="add-root-input"
            placeholder="/path/to/projects"
            bind:value={newRootPath}
            onkeydown={onAddKeydown}
            autocomplete="off"
          />
          <button class="btn btn-primary" onclick={handleAddRoot}>Add</button>
        </div>

        {#if error}
          <p class="error-msg">{error}</p>
        {/if}
      </section>

      <!-- Developer tools section -->
      <section class="settings-section">
        <h3 class="section-title">Developer Tools</h3>
        <div class="devtools-row">
          <input
            id="devtools-toggle"
            type="checkbox"
            class="dialog-checkbox"
            bind:checked={devtoolsEnabled}
            onchange={onDevtoolsChange}
          />
          <label for="devtools-toggle" class="devtools-label">Enable mobile debug panel</label>
        </div>
      </section>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={handleClose}>Close</button>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0;
    width: min(460px, 95vw);
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    overflow: hidden;
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
    font-size: 1.1rem;
    font-weight: 600;
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
    gap: 20px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .section-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin: 0;
  }

  .empty-msg {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
  }

  .roots-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .root-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
  }

  .root-path {
    font-size: 0.85rem;
    font-family: monospace;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 2px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
  }

  .remove-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .add-root-row {
    display: flex;
    gap: 8px;
  }

  .add-root-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    padding: 7px 10px;
  }

  .error-msg {
    font-size: 0.82rem;
    color: #e74c3c;
    margin: 0;
  }

  .devtools-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dialog-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .devtools-label {
    font-size: 0.9rem;
    cursor: pointer;
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
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
    flex-shrink: 0;
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
