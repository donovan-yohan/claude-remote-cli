<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="user-message">
  <div class="user-message-text">{text}</div>
</div>

<style>
  .user-message {
    border-left: 3px solid var(--accent);
    padding: var(--spacing-sm) var(--spacing-md);
    margin: var(--spacing-xs) 0;
    width: 100%;
  }

  .user-message-text {
    color: var(--text);
    font-size: 0.95rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
