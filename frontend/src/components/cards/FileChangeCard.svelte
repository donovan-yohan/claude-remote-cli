<script lang="ts">
  let {
    path,
    additions = 0,
    deletions = 0,
  }: {
    path: string;
    additions?: number | undefined;
    deletions?: number | undefined;
  } = $props();

  let filename = $derived(path.split('/').pop() ?? path);
  let directory = $derived(path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
</script>

<div class="file-change-card">
  <span class="file-icon">&#128196;</span>
  <span class="file-path">
    {#if directory}<span class="file-dir">{directory}</span>{/if}<span class="file-name">{filename}</span>
  </span>
  <span class="diff-stats">
    {#if additions}<span class="diff-add">+{additions}</span>{/if}
    {#if deletions}<span class="diff-remove">-{deletions}</span>{/if}
  </span>
</div>

<style>
  .file-change-card {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    margin: var(--spacing-xs) 0;
    font-family: var(--code-font);
    font-size: 0.85rem;
    width: 100%;
    min-width: 0;
  }

  .file-icon {
    flex-shrink: 0;
    font-size: 0.9rem;
  }

  .file-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .file-dir {
    color: var(--text-muted);
  }

  .file-name {
    color: var(--text);
  }

  .diff-stats {
    flex-shrink: 0;
    display: flex;
    gap: var(--spacing-sm);
    font-weight: 600;
  }

  .diff-add {
    color: var(--diff-add);
  }

  .diff-remove {
    color: var(--diff-remove);
  }
</style>
