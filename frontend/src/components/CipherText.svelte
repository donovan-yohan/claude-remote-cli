<script lang="ts">
  const GLYPHS = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`0123456789abcdef';

  let {
    text,
    loading = false,
    duration = 400,
    animate = true,
  }: {
    text: string;
    loading?: boolean;
    duration?: number;
    animate?: boolean;
  } = $props();

  let prefersReducedMotion = $state(false);
  let displayed = $state<string[]>([]);
  let isAnimating = $state(false);

  function randomGlyph(): string {
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] as string;
  }

  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    const handler = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  // Main animation effect — reacts to loading + text changes
  $effect(() => {
    if (prefersReducedMotion) {
      displayed = text.split('');
      isAnimating = false;
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeouts: ReturnType<typeof setTimeout>[] = [];

    if (loading) {
      // Cycle random glyphs matching text.length
      const len = text.length;
      displayed = Array.from({ length: len }, () => randomGlyph());
      isAnimating = true;
      intervalId = setInterval(() => {
        displayed = Array.from({ length: len }, () => randomGlyph());
      }, 40);
    } else {
      // Resolve characters left-to-right
      const target = text.split('');
      const len = target.length;

      // Ensure displayed array has correct length (filled with glyphs)
      if (displayed.length !== len) {
        displayed = Array.from({ length: len }, () => randomGlyph());
      }

      isAnimating = true;
      const msPerChar = Math.max(1, Math.round(duration / Math.max(len, 1)));

      for (let i = 0; i < len; i++) {
        const idx = i;
        const t = setTimeout(() => {
          displayed[idx] = target[idx] as string;
          if (idx === len - 1) {
            isAnimating = false;
          }
        }, idx * msPerChar);
        timeouts.push(t);
      }
    }

    return () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      for (const t of timeouts) clearTimeout(t);
    };
  });
</script>

<span aria-live="polite" class="cipher-text">{#if isAnimating || loading}{displayed.join('')}{:else}{text}{/if}</span>

<style>
  .cipher-text {
    font-family: var(--font-mono);
    white-space: pre;
  }
</style>
