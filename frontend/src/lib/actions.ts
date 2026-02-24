/**
 * Shared Svelte actions for list item interactions.
 * Used by SessionItem and PullRequestItem for consistent hover/longpress UX.
 */

/**
 * Svelte action: scrolls overflowing text on hover/longpress.
 * Requires an inner element (first child) that will be translated.
 * Applies `.has-overflow` class to the node when text overflows.
 */
export function scrollOnHover(node: HTMLElement) {
  const textEl = node.firstElementChild as HTMLElement;
  const li = node.closest('li') as HTMLElement;
  if (!textEl || !li) return;

  let overflow = 0;

  const measure = () => {
    overflow = node.scrollWidth - node.clientWidth;
    if (overflow > 0) {
      node.classList.add('has-overflow');
    } else {
      node.classList.remove('has-overflow');
      textEl.style.transform = '';
      textEl.style.transition = '';
    }
  };

  const onEnter = () => {
    if (overflow <= 0) return;
    const duration = Math.max(0.6, overflow / 80);
    textEl.style.transition = `transform ${duration}s linear 0.3s`;
    textEl.style.transform = `translateX(-${overflow}px)`;
  };

  const onLeave = () => {
    if (overflow <= 0) return;
    const duration = Math.max(0.4, overflow / 100);
    textEl.style.transition = `transform ${duration}s linear`;
    textEl.style.transform = 'translateX(0)';
  };

  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(node);

  li.addEventListener('mouseenter', onEnter);
  li.addEventListener('mouseleave', onLeave);
  li.addEventListener('longpressstart', onEnter);
  li.addEventListener('longpressend', onLeave);

  return {
    destroy() {
      ro.disconnect();
      li.removeEventListener('mouseenter', onEnter);
      li.removeEventListener('mouseleave', onLeave);
      li.removeEventListener('longpressstart', onEnter);
      li.removeEventListener('longpressend', onLeave);
    }
  };
}

/**
 * Svelte action: adds longpress support for touch devices.
 * After 500ms hold, adds `.longpress` class and dispatches `longpressstart`.
 * On release, keeps state for 3s (to allow button taps), then dispatches `longpressend`.
 */
function longpressable(node: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deactivateTimer: ReturnType<typeof setTimeout> | null = null;
  let active = false;

  const activate = () => {
    active = true;
    node.classList.add('longpress');
    node.dispatchEvent(new CustomEvent('longpressstart'));
  };

  const deactivate = () => {
    active = false;
    node.classList.remove('longpress');
    node.dispatchEvent(new CustomEvent('longpressend'));
  };

  const onTouchStart = () => {
    if (deactivateTimer) { clearTimeout(deactivateTimer); deactivateTimer = null; }
    timer = setTimeout(activate, 500);
  };

  const onTouchMove = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const onTouchEnd = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (active) {
      deactivateTimer = setTimeout(deactivate, 3000);
    }
  };

  const onTouchCancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (active) deactivate();
  };

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: true });
  node.addEventListener('touchend', onTouchEnd, { passive: true });
  node.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return {
    destroy() {
      if (timer) clearTimeout(timer);
      if (deactivateTimer) clearTimeout(deactivateTimer);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    },
    get active() { return active; },
  };
}

/**
 * Creates a longpress Svelte action and a guarded click handler.
 * The click handler suppresses the callback while longpress is active.
 *
 * Usage in a component:
 *   const { action: longpressAction, handleClick } = createLongpressClick(onclick);
 *   <li use:longpressAction onclick={handleClick}>
 */
export function createLongpressClick(onclick: () => void) {
  let ref: ReturnType<typeof longpressable> | undefined;

  function action(node: HTMLElement) {
    ref = longpressable(node);
    return ref;
  }

  function handleClick() {
    if (ref?.active) return;
    onclick();
  }

  return { action, handleClick };
}
