<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'fullscreen' | 'compact';
    width?: string;
    title: string;
    children: Snippet;
    'header-extra'?: Snippet;
    footer?: Snippet;
  }

  let {
    variant = 'compact',
    width = '460px',
    title,
    children,
    'header-extra': headerExtra,
    footer,
  }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

  export function open() {
    if (!dialogEl) return;
    dialogEl.showModal();
    // Focus first interactive element after the dialog opens
    requestAnimationFrame(() => {
      if (!dialogEl) return;
      const firstFocusable = dialogEl.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    });
  }

  export function close() {
    dialogEl?.close();
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      dialogEl?.close();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class="dialog-shell"
  class:dialog-shell--fullscreen={variant === 'fullscreen'}
  class:dialog-shell--compact={variant === 'compact'}
  style={variant === 'compact' ? `--dialog-width: ${width}` : undefined}
  onclick={onDialogClick}
  aria-modal="true"
  aria-label={title}
>
  <div class="dialog-shell__content">
    <header class="dialog-shell__header">
      <h2 class="dialog-shell__title">{title}</h2>
      {#if headerExtra}
        <div class="dialog-shell__header-extra">
          {@render headerExtra()}
        </div>
      {/if}
      <button
        class="dialog-shell__close"
        onclick={() => dialogEl?.close()}
        aria-label="Close"
        type="button"
      >✕</button>
    </header>

    <div class="dialog-shell__body">
      {@render children()}
    </div>

    {#if footer}
      <footer class="dialog-shell__footer">
        {@render footer()}
      </footer>
    {/if}
  </div>
</dialog>

<style>
  /* ── Backdrop ── */
  .dialog-shell::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }

  /* ── Base dialog ── */
  .dialog-shell {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 0;
    overflow: hidden;
  }

  /* ── Compact variant ── */
  .dialog-shell--compact {
    width: min(var(--dialog-width, 460px), 95vw);
    max-height: 90vh;
  }

  .dialog-shell--compact[open] {
    animation: dialog-fade-scale 150ms ease forwards;
  }

  @keyframes dialog-fade-scale {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* ── Fullscreen variant ── */
  .dialog-shell--fullscreen {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
  }

  @media (min-width: 1200px) {
    .dialog-shell--fullscreen {
      inset: 24px;
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
    }
  }

  .dialog-shell--fullscreen[open] {
    animation: dialog-slide-up 200ms ease forwards;
  }

  @keyframes dialog-slide-up {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ── Inner content layout ── */
  .dialog-shell__content {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .dialog-shell--compact .dialog-shell__content {
    max-height: 90vh;
  }

  /* ── Header ── */
  .dialog-shell__header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-shell__title {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0;
    flex-shrink: 0;
  }

  .dialog-shell__header-extra {
    flex: 1;
    min-width: 0;
  }

  .dialog-shell__close {
    background: none;
    border: none;
    border-radius: 0;
    color: var(--text-muted);
    font-size: 1rem;
    font-family: var(--font-mono);
    cursor: pointer;
    padding: 4px 6px;
    line-height: 1;
    flex-shrink: 0;
    margin-left: auto;
    transition: background 0.1s, color 0.1s;
  }

  .dialog-shell__close:hover {
    background: var(--border);
    color: var(--text);
  }

  /* ── Body ── */
  .dialog-shell__body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  .dialog-shell--fullscreen .dialog-shell__body {
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  /* ── Footer ── */
  .dialog-shell__footer {
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  /* ════════════════════════════════════════════════
     Shared utility classes — available to consumers
     via :global() or within this component
  ════════════════════════════════════════════════ */

  /* Button base */
  :global(.dialog-shell .btn) {
    padding: 7px 16px;
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    cursor: pointer;
    border: 1px solid var(--border);
    transition: background 0.1s, color 0.1s;
  }

  :global(.dialog-shell .btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Primary — outline accent */
  :global(.dialog-shell .btn-primary) {
    border-color: var(--accent);
    color: var(--accent);
    background: transparent;
  }

  :global(.dialog-shell .btn-primary:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  /* Ghost */
  :global(.dialog-shell .btn-ghost) {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  :global(.dialog-shell .btn-ghost:hover:not(:disabled)) {
    background: var(--border);
    color: var(--text);
  }

  /* Danger */
  :global(.dialog-shell .btn-danger) {
    color: var(--status-error);
    border-color: var(--status-error);
    background: transparent;
  }

  :global(.dialog-shell .btn-danger:hover:not(:disabled)) {
    background: rgba(231, 76, 60, 0.1);
  }

  /* Small modifier */
  :global(.dialog-shell .btn-sm) {
    padding: 4px 10px;
    font-size: var(--font-size-xs);
  }

  /* Shared form elements */
  :global(.dialog-shell .dialog-checkbox) {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  :global(.dialog-shell .error-msg) {
    font-size: var(--font-size-sm);
    color: var(--status-error);
    margin: 0;
  }
</style>
