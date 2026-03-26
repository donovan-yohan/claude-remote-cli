<script lang="ts">
  const BRAILLE_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
  const LINE_FRAMES = ['|', '/', '-', '\\'];

  let {
    variant = 'braille',
    value = 0,
    width = 16,
  }: {
    variant?: 'bar' | 'knight-rider' | 'braille' | 'line';
    value?: number;
    width?: number;
    [key: string]: unknown;
  } = $props();

  let prefersReducedMotion = $state(false);
  let frame = $state(0);
  let knightPos = $state(0);
  let knightDir = $state(1); // 1 = right, -1 = left
  const KNIGHT_WIDTH = 4;

  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    const handler = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  // Braille spinner interval
  $effect(() => {
    if (variant !== 'braille' || prefersReducedMotion) return;
    const id = setInterval(() => {
      frame = (frame + 1) % BRAILLE_FRAMES.length;
    }, 80);
    return () => clearInterval(id);
  });

  // Line spinner interval
  $effect(() => {
    if (variant !== 'line' || prefersReducedMotion) return;
    const id = setInterval(() => {
      frame = (frame + 1) % LINE_FRAMES.length;
    }, 120);
    return () => clearInterval(id);
  });

  // Knight rider interval
  $effect(() => {
    if (variant !== 'knight-rider' || prefersReducedMotion) return;
    const id = setInterval(() => {
      knightPos += knightDir;
      if (knightPos >= width - KNIGHT_WIDTH) {
        knightPos = width - KNIGHT_WIDTH;
        knightDir = -1;
      } else if (knightPos <= 0) {
        knightPos = 0;
        knightDir = 1;
      }
    }, 60);
    return () => clearInterval(id);
  });

  let barText = $derived.by(() => {
    if (variant !== 'bar') return '';
    const clamped = Math.max(0, Math.min(100, value));
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    return '[' + '\u2588'.repeat(filled) + '\u2591'.repeat(empty) + '] ' + Math.round(clamped) + '%';
  });

  let knightText = $derived.by(() => {
    if (variant !== 'knight-rider') return '';
    const pos = prefersReducedMotion ? 0 : knightPos;
    const before = '\u2591'.repeat(pos);
    const block = '\u2588'.repeat(KNIGHT_WIDTH);
    const after = '\u2591'.repeat(Math.max(0, width - pos - KNIGHT_WIDTH));
    return '[' + before + block + after + ']';
  });

  let brailleChar = $derived(
    prefersReducedMotion ? BRAILLE_FRAMES[0] : BRAILLE_FRAMES[frame]
  );

  let lineChar = $derived(
    prefersReducedMotion ? LINE_FRAMES[0] : LINE_FRAMES[frame]
  );
</script>

<span class="tui-progress" role="status" aria-label="loading">
  {#if variant === 'bar'}
    {barText}
  {:else if variant === 'knight-rider'}
    {knightText}
  {:else if variant === 'braille'}
    {brailleChar}
  {:else if variant === 'line'}
    {lineChar}
  {/if}
</span>

<style>
  .tui-progress {
    font-family: var(--font-mono);
    font-size: var(--font-size-base);
    color: var(--text);
    display: inline-block;
    white-space: pre;
  }
</style>
