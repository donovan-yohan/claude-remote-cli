/**
 * Shared Svelte actions for list item interactions.
 * Used by SessionItem and PullRequestItem for consistent hover/tap-to-reveal UX.
 */
import { isMobileDevice } from './utils.js';

/**
 * Svelte action: scrolls overflowing text on hover/tap-reveal.
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
  // Custom events dispatched by mobileReveal for tap-to-reveal
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
 * Mobile tap-to-reveal action.
 * First tap reveals actions (adds `.longpress` class), second tap clicks through.
 * Auto-dismisses after 5s or when tapping outside.
 * On desktop, this is a no-op.
 */
function mobileReveal(node: HTMLElement) {
  if (!isMobileDevice) {
    return {
      destroy() {},
      get revealed() { return false; },
      show() {},
      scheduleDismiss() {},
    };
  }

  let revealed = false;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  function show() {
    revealed = true;
    node.classList.add('longpress');
    node.dispatchEvent(new CustomEvent('longpressstart'));
    scheduleDismiss();
  }

  function hide() {
    revealed = false;
    node.classList.remove('longpress');
    node.dispatchEvent(new CustomEvent('longpressend'));
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  }

  function scheduleDismiss() {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(hide, 5000);
  }

  // Dismiss when tapping outside the item
  function onDocumentTouchStart(e: TouchEvent) {
    if (revealed && !node.contains(e.target as Node)) {
      hide();
    }
  }

  document.addEventListener('touchstart', onDocumentTouchStart, { passive: true });

  return {
    destroy() {
      if (dismissTimer) clearTimeout(dismissTimer);
      document.removeEventListener('touchstart', onDocumentTouchStart);
    },
    get revealed() { return revealed; },
    show,
    scheduleDismiss,
  };
}

/**
 * Creates a mobile tap-to-reveal Svelte action and a guarded click handler.
 * On mobile: first tap reveals actions, second tap triggers the callback.
 * On desktop: clicks always trigger the callback (actions shown on hover).
 */
export function createLongpressClick(onclick: () => void) {
  let ref: ReturnType<typeof mobileReveal> | undefined;

  function action(node: HTMLElement) {
    ref = mobileReveal(node);
    return ref;
  }

  function handleClick() {
    if (ref && isMobileDevice) {
      if (!ref.revealed) {
        ref.show();
        return; // suppress — first tap just reveals
      }
      ref.scheduleDismiss();
    }
    onclick();
  }

  return { action, handleClick };
}
