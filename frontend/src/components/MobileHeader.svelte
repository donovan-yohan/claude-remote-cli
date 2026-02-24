<script lang="ts">
  let {
    title,
    onMenuClick,
    hidden = false,
  }: {
    title: string;
    onMenuClick: () => void;
    hidden?: boolean;
  } = $props();
</script>

<div class="mobile-header" class:hidden>
  <button
    class="icon-btn"
    aria-label="Open sessions menu"
    onclick={onMenuClick}
  >&#9776;</button>
  <span class="mobile-title">{title}</span>
</div>

<style>
  .mobile-header {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    min-height: 44px;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .mobile-header {
      display: flex;
    }
    .mobile-header.hidden {
      display: none;
    }
  }

  .mobile-title {
    font-size: 0.95rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 6px;
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    touch-action: manipulation;
  }

  .icon-btn:hover {
    background: var(--border);
  }
</style>
