<script lang="ts">
  import { sendPtyData } from '../lib/ws.js';

  let visible = $state(false);
  let text = $state('');
  let showInsert = $state(false);
  let pendingImagePath = $state<string | null>(null);

  let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  export function show(toastText: string, withInsert: boolean, imagePath?: string): void {
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
    text = toastText;
    showInsert = withInsert;
    pendingImagePath = imagePath ?? null;
    visible = true;
  }

  export function hide(): void {
    visible = false;
    pendingImagePath = null;
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
  }

  export function autoDismiss(ms: number): void {
    if (autoDismissTimer) clearTimeout(autoDismissTimer);
    autoDismissTimer = setTimeout(() => {
      if (!pendingImagePath) {
        hide();
      }
    }, ms);
  }

  function handleInsert() {
    if (pendingImagePath) {
      sendPtyData(pendingImagePath);
    }
    hide();
  }

  function handleDismiss() {
    hide();
  }
</script>

{#if visible}
  <div class="image-toast">
    <div class="image-toast-content">
      <span class="image-toast-text">{text}</span>
      <div class="image-toast-actions">
        {#if showInsert}
          <button class="image-toast-insert" onclick={handleInsert}>Insert</button>
        {/if}
        <button class="image-toast-dismiss" onclick={handleDismiss} aria-label="Dismiss">
          &times;
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .image-toast {
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 14px;
    color: var(--text);
    font-size: 13px;
    max-width: 90vw;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .image-toast-content {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .image-toast-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60vw;
  }

  .image-toast-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-shrink: 0;
  }

  .image-toast-insert {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .image-toast-insert:active {
    opacity: 0.8;
  }

  .image-toast-dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
  }

  .image-toast-dismiss:hover {
    color: var(--text);
  }
</style>
