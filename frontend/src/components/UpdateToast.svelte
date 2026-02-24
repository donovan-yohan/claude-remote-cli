<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../lib/api.js';

  let visible = $state(false);
  let text = $state('');
  let buttonText = $state('Update Now');
  let buttonDisabled = $state(false);
  let showActions = $state(true);

  onMount(async () => {
    try {
      const data = await api.checkVersion();
      if (data.updateAvailable) {
        text = `Update available: v${data.current} \u2192 v${data.latest}`;
        buttonText = 'Update Now';
        buttonDisabled = false;
        showActions = true;
        visible = true;
      }
    } catch {
      // Silently ignore version check errors
    }
  });

  async function triggerUpdate() {
    buttonDisabled = true;
    buttonText = 'Updating\u2026';

    try {
      const result = await api.triggerUpdate();
      if (result.restarting) {
        text = 'Updated! Restarting server\u2026';
        showActions = false;
        setTimeout(() => {
          location.reload();
        }, 5000);
      } else {
        text = 'Updated! Please restart the server manually.';
        showActions = false;
      }
    } catch {
      text = 'Update failed. Please try again.';
      buttonDisabled = false;
      buttonText = 'Retry';
      showActions = true;
    }
  }

  function dismiss() {
    visible = false;
  }
</script>

{#if visible}
  <div class="update-toast">
    <div class="update-toast-content">
      <span class="update-toast-text">{text}</span>
      {#if showActions}
        <div class="update-toast-actions">
          <button
            class="update-toast-btn"
            onclick={triggerUpdate}
            disabled={buttonDisabled}
          >
            {buttonText}
          </button>
          <button class="update-toast-dismiss" onclick={dismiss} aria-label="Dismiss">
            &times;
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .update-toast {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 150;
    display: flex;
    justify-content: center;
    padding: 12px 12px calc(12px + env(safe-area-inset-bottom));
    pointer-events: none;
    animation: toast-slide-up 0.25s ease-out;
  }

  @keyframes toast-slide-up {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .update-toast-content {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 16px;
    max-width: 500px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
  }

  .update-toast-text {
    flex: 1;
    font-size: 0.85rem;
    color: var(--text);
  }

  .update-toast-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .update-toast-btn {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.8rem;
    border: none;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    white-space: nowrap;
  }

  .update-toast-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .update-toast-dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.2rem;
    padding: 4px 6px;
    cursor: pointer;
  }

  .update-toast-dismiss:hover {
    color: var(--text);
  }
</style>
