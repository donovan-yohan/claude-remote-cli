<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    speed = 50,
    fadeWidth = 24,
    overscroll = 32,
    children,
  }: {
    speed?: number;
    fadeWidth?: number;
    overscroll?: number;
    children: Snippet;
  } = $props();

  let containerEl = $state<HTMLDivElement | undefined>(undefined);
  let innerEl = $state<HTMLDivElement | undefined>(undefined);
  let overflow = $state(0);

  $effect(() => {
    if (!containerEl || !innerEl) return;

    const observer = new ResizeObserver(() => {
      if (containerEl && innerEl) {
        overflow = Math.max(0, innerEl.scrollWidth - containerEl.clientWidth);
      }
    });
    observer.observe(containerEl);
    observer.observe(innerEl);

    return () => observer.disconnect();
  });

  function handleMouseEnter() {
    if (!innerEl || overflow <= 0) return;
    const distance = overflow + overscroll;
    const durationSec = distance / speed;
    innerEl.style.transition = `transform ${durationSec}s ease-in-out`;
    innerEl.style.transform = `translateX(-${distance}px)`;
  }

  function handleMouseLeave() {
    if (!innerEl || overflow <= 0) return;
    const durationSec = (overflow + overscroll) / speed;
    innerEl.style.transition = `transform ${durationSec}s ease-in-out`;
    innerEl.style.transform = `translateX(0)`;
  }
</script>

<div
  class="marquee-container"
  bind:this={containerEl}
  style:--fade-width="{fadeWidth}px"
  style:--has-overflow={overflow > 0 ? '1' : '0'}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <div class="marquee-inner" bind:this={innerEl}>
    {@render children()}
  </div>
</div>

<style>
  .marquee-container {
    overflow: hidden;
    position: relative;
  }

  /* Use a CSS custom property trick for conditional mask */
  .marquee-container[style*="--has-overflow: 1"] {
    mask-image: linear-gradient(to right, black calc(100% - var(--fade-width)), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - var(--fade-width)), transparent 100%);
  }

  .marquee-inner {
    display: inline-block;
    white-space: nowrap;
    will-change: transform;
  }
</style>
