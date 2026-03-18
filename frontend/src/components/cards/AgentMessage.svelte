<script lang="ts">
  let { text }: { text: string } = $props();

  function renderMarkdown(src: string): string {
    // Extract code blocks first to protect them from further processing
    const codeBlocks: string[] = [];
    let processed = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang: string, code: string) => {
      const escaped = code.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const idx = codeBlocks.length;
      codeBlocks.push('<pre class="code-block"><code>' + escaped + '</code></pre>');
      return '\x00CB' + idx + '\x00';
    });

    // Extract inline code
    const inlineCode: string[] = [];
    processed = processed.replace(/`([^`]+)`/g, (_m, code: string) => {
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const idx = inlineCode.length;
      inlineCode.push('<code class="inline-code">' + escaped + '</code>');
      return '\x00IC' + idx + '\x00';
    });

    // Now escape remaining HTML
    processed = processed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headers (must be at start of line)
    processed = processed.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, text: string) => {
      const level = hashes.length;
      return `<h${level} class="md-heading">${text}</h${level}>`;
    });

    // Horizontal rules
    processed = processed.replace(/^---+$/gm, '<hr class="md-hr">');

    // Bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (single *)
    processed = processed.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');

    // Links
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => {
      // Sanitize href — only allow http(s) and relative URLs
      if (/^(?:https?:\/\/|\/|\.\/|#)/.test(href)) {
        return `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${text}</a>`;
      }
      return text;
    });

    // Unordered lists (- or * at start of line)
    processed = processed.replace(/^(?:[-*])\s+(.+)$/gm, '<li class="md-li">$1</li>');
    processed = processed.replace(/((?:<li class="md-li">.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

    // Ordered lists (1. 2. etc at start of line)
    processed = processed.replace(/^\d+\.\s+(.+)$/gm, '<li class="md-li">$1</li>');

    // Newlines (but not inside block elements)
    processed = processed.replace(/\n/g, '<br>');

    // Clean up <br> after block elements
    processed = processed.replace(/<\/(pre|ul|ol|h[1-6]|hr)><br>/g, '</$1>');
    processed = processed.replace(/<br><(pre|ul|ol|h[1-6]|hr)/g, '<$1');

    // Restore code blocks and inline code
    processed = processed.replace(/\x00CB(\d+)\x00/g, (_m, idx: string) => codeBlocks[parseInt(idx)] ?? '');
    processed = processed.replace(/\x00IC(\d+)\x00/g, (_m, idx: string) => inlineCode[parseInt(idx)] ?? '');

    return processed;
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

  .agent-message :global(em) {
    font-style: italic;
  }

  .agent-message :global(.md-heading) {
    font-weight: 600;
    margin: var(--spacing-sm) 0 var(--spacing-xs);
    line-height: 1.3;
  }

  .agent-message :global(h1.md-heading) { font-size: 1.3em; }
  .agent-message :global(h2.md-heading) { font-size: 1.15em; }
  .agent-message :global(h3.md-heading) { font-size: 1.05em; }

  .agent-message :global(.md-ul) {
    margin: var(--spacing-xs) 0;
    padding-left: 1.5em;
    list-style: disc;
  }

  .agent-message :global(.md-li) {
    margin: 2px 0;
  }

  .agent-message :global(.md-hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: var(--spacing-sm) 0;
  }
</style>
