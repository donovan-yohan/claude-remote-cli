<script lang="ts">
  let { text }: { text: string } = $props();

  function renderMarkdown(src: string): string {
    let html = src
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Code blocks (``` ... ```)
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang: string, code: string) =>
        '<pre class="code-block"><code>' + code.trim() + '</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Newlines
      .replace(/\n/g, '<br>');
    return html;
  }
</script>

<div class="agent-message">
  {@html renderMarkdown(text)}
</div>

<style>
  .agent-message {
    padding: var(--spacing-sm) var(--spacing-md);
    margin: var(--spacing-xs) 0;
    width: 100%;
    color: var(--text);
    font-size: 0.95rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .agent-message :global(.code-block) {
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    overflow-x: auto;
    font-family: var(--code-font);
    font-size: 0.85rem;
    margin: var(--spacing-sm) 0;
    white-space: pre;
  }

  .agent-message :global(.inline-code) {
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    padding: 1px 4px;
    font-family: var(--code-font);
    font-size: 0.88em;
  }

  .agent-message :global(a) {
    color: var(--info);
    text-decoration: underline;
  }

  .agent-message :global(strong) {
    color: var(--text);
    font-weight: 600;
  }
</style>
