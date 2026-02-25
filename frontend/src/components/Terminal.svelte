<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { connectPtySocket, sendPtyData, sendPtyResize } from '../lib/ws.js';
  import { isMobileDevice } from '../lib/utils.js';
  import { uploadImage } from '../lib/api.js';

  let {
    sessionId,
    onImageUpload,
  }: {
    sessionId: string | null;
    onImageUpload?: (text: string, showInsert: boolean, path?: string) => void;
  } = $props();

  let containerEl: HTMLDivElement;
  let term: Terminal | null = $state(null);
  let fitAddon: FitAddon;
  let imageUploadInProgress = false;

  // Expose term instance for MobileInput
  export function getTerm() {
    return term;
  }

  export function focusTerm() {
    if (!isMobileDevice) term?.focus();
  }

  export function fitTerm() {
    fitAddon?.fit();
    if (term) sendPtyResize(term.cols, term.rows);
    updateScrollbar();
  }

  onMount(() => {
    const t = new Terminal({
      cursorBlink: true,
      fontSize: isMobileDevice ? 12 : 14,
      fontFamily: 'Menlo, monospace',
      scrollback: 10000,
      theme: {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
    });

    fitAddon = new FitAddon();
    t.loadAddon(fitAddon);
    t.open(containerEl);
    if (isMobileDevice) {
      // Disable xterm's internal textarea to prevent focus fights with MobileInput.
      // Relies on internal class name — re-verify after @xterm/xterm upgrades.
      const xtermTextarea = containerEl.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
      if (xtermTextarea) {
        xtermTextarea.disabled = true;
        xtermTextarea.tabIndex = -1;
      }
      // Disable xterm's internal touch scroll — it scrolls one line at a time.
      // We implement our own smooth content-area touch scroll instead.
      // Relies on internal class name — re-verify after @xterm/xterm upgrades.
      const xtermViewport = containerEl.querySelector('.xterm-viewport') as HTMLElement | null;
      if (xtermViewport) {
        xtermViewport.style.touchAction = 'none';
        xtermViewport.style.overflowY = 'hidden';
      } else {
        console.warn('[Terminal] .xterm-viewport not found — xterm DOM may have changed. Touch scroll may conflict with xterm.');
      }
    }
    fitAddon.fit();

    // Desktop-only: wire xterm's own input handlers.
    // On mobile, MobileInput sends directly via sendPtyData() — skip to avoid double-sends.
    if (!isMobileDevice) {
      t.onData((data) => sendPtyData(data));

      // Ctrl+V on non-Mac for clipboard/image paste
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
      t.attachCustomKeyEventHandler((e) => {
        if (
          !isMac &&
          e.type === 'keydown' &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          (e.key === 'v' || e.key === 'V')
        ) {
          if (navigator.clipboard && navigator.clipboard.read) {
            navigator.clipboard
              .read()
              .then((clipboardItems) => {
                let imageBlob: ClipboardItem | null = null;
                let imageType: string | null = null;
                for (const item of clipboardItems) {
                  for (const type of item.types) {
                    if (type.startsWith('image/')) {
                      imageType = type;
                      imageBlob = item;
                      break;
                    }
                  }
                  if (imageBlob) break;
                }
                if (imageBlob && imageType) {
                  imageBlob.getType(imageType).then((blob) => handleImageUpload(blob, imageType!));
                } else {
                  navigator.clipboard.readText().then((text) => {
                    if (text) t.paste(text);
                  });
                }
              })
              .catch(() => {
                if (navigator.clipboard.readText) {
                  navigator.clipboard.readText().then((text) => {
                    if (text) t.paste(text);
                  }).catch(() => { /* ignore */ });
                }
              });
            return false;
          }
        }
        return true;
      });
    }

    // Scrollbar updates
    t.onScroll(updateScrollbar);
    t.onWriteParsed(updateScrollbar);

    let roTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (roTimer) clearTimeout(roTimer);
      roTimer = setTimeout(() => {
        fitAddon.fit();
        sendPtyResize(t.cols, t.rows);
        updateScrollbar();
      }, isMobileDevice ? 150 : 0);
    });
    ro.observe(containerEl);

    // On mobile, register document-level touch handlers with { passive: false }
    // so e.preventDefault() works. Svelte's <svelte:document ontouchmove> registers
    // as passive by default on Chrome/Android, silently ignoring preventDefault.
    if (isMobileDevice) {
      document.addEventListener('touchmove', onDocumentTouchMove, { passive: false });
      document.addEventListener('touchend', onDocumentTouchEnd);
      document.addEventListener('touchcancel', onDocumentTouchEnd);
    }

    term = t;

    return () => {
      if (roTimer) clearTimeout(roTimer);
      if (longPressTimer) clearTimeout(longPressTimer);
      ro.disconnect();
      t.dispose();
      term = null;
      contentScrolling = false;
      scrollbarDragging = false;
      if (isMobileDevice) {
        document.removeEventListener('touchmove', onDocumentTouchMove);
        document.removeEventListener('touchend', onDocumentTouchEnd);
        document.removeEventListener('touchcancel', onDocumentTouchEnd);
      }
    };
  });

  // React to sessionId changes
  $effect(() => {
    if (sessionId && term) {
      term.clear();
      connectPtySocket(
        sessionId,
        term,
        () => {
          if (term) sendPtyResize(term.cols, term.rows);
        },
        () => { /* session ended */ },
      );
    }
  });

  // ── Scrollbar state ──────────────────────────────────────────────────────────
  let scrollbarDragging = false;
  let scrollbarDragStartY = 0;
  let scrollbarDragStartTop = 0;
  let thumbHeight = $state(0);
  let thumbTop = $state(0);
  let thumbVisible = $state(false);

  // ── Content-area touch scroll state (mobile) ───────────────────────────────
  let contentScrolling = false;
  let contentTouchStartY = 0;
  let contentScrollStartLine = 0;
  let contentTouchMoved = false;

  // Long-press text selection state (mobile)
  let selectionMode = $state(false);
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressStartX = 0;
  let longPressStartY = 0;
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 10;

  function updateScrollbar() {
    if (!term) return;
    const buf = term.buffer.active;
    const totalLines = buf.baseY + term.rows;
    const viewportTop = buf.viewportY;
    const trackEl = scrollbarEl;
    if (!trackEl) return;
    const trackHeight = trackEl.clientHeight;

    if (totalLines <= term.rows) {
      thumbVisible = false;
      return;
    }
    thumbVisible = true;
    thumbHeight = Math.max(isMobileDevice ? 44 : 20, (term.rows / totalLines) * trackHeight);
    thumbTop = (viewportTop / (totalLines - term.rows)) * (trackHeight - thumbHeight);
  }

  function scrollbarScrollToY(clientY: number) {
    if (!term || !scrollbarEl) return;
    const rect = scrollbarEl.getBoundingClientRect();
    const buf = term.buffer.active;
    const totalLines = buf.baseY + term.rows;
    if (totalLines <= term.rows) return;

    const trackHeight = scrollbarEl.clientHeight;
    const th = Math.max(isMobileDevice ? 44 : 20, (term.rows / totalLines) * trackHeight);
    const trackUsable = trackHeight - th;
    const relativeY = clientY - rect.top - th / 2;
    const ratio = Math.max(0, Math.min(1, relativeY / trackUsable));
    const targetLine = Math.round(ratio * (totalLines - term.rows));
    term.scrollToLine(targetLine);
  }

  function onThumbTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    // Note: e.preventDefault() is not called here because Svelte 5 registers
    // ontouchstart as passive. Browser default scroll is already prevented by
    // touch-action: none on .terminal-container via CSS.
    scrollbarDragging = true;
    scrollbarDragStartY = touch.clientY;
    scrollbarDragStartTop = thumbTop;
  }

  function enterSelectionMode() {
    longPressTimer = null;
    selectionMode = true;
    contentScrolling = false;
    if (navigator.vibrate) navigator.vibrate(50);
    const xtermScreen = containerEl.querySelector('.xterm-screen') as HTMLElement | null;
    if (xtermScreen) {
      xtermScreen.style.userSelect = 'text';
      xtermScreen.style.webkitUserSelect = 'text';
    }
  }

  function exitSelectionMode() {
    selectionMode = false;
    const xtermScreen = containerEl.querySelector('.xterm-screen') as HTMLElement | null;
    if (xtermScreen) {
      xtermScreen.style.userSelect = '';
      xtermScreen.style.webkitUserSelect = '';
    }
    window.getSelection()?.removeAllRanges();
  }

  function onTerminalTouchStart(e: TouchEvent) {
    if (selectionMode) {
      exitSelectionMode();
      return;
    }
    if ((e.target as HTMLElement).closest('.terminal-scrollbar')) return;
    if ((e.target as HTMLElement).closest('.scroll-fabs')) return;
    if (!term) return;
    const touch = e.touches[0];
    if (!touch) return;
    contentTouchStartY = touch.clientY;
    contentScrollStartLine = term.buffer.active.viewportY;
    contentTouchMoved = false;
    contentScrolling = true;
    // Long-press detection
    longPressStartX = touch.clientX;
    longPressStartY = touch.clientY;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      enterSelectionMode();
    }, LONG_PRESS_MS);
  }

  function onDocumentTouchMove(e: TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;

    // Scrollbar thumb drag
    if (scrollbarDragging) {
      if (!term || !scrollbarEl) return;
      e.preventDefault();
      const deltaY = touch.clientY - scrollbarDragStartY;
      const buf = term.buffer.active;
      const totalLines = buf.baseY + term.rows;
      if (totalLines <= term.rows) return;
      const trackHeight = scrollbarEl.clientHeight;
      const th = Math.max(44, (term.rows / totalLines) * trackHeight);
      const trackUsable = trackHeight - th;
      const newTop = Math.max(0, Math.min(trackUsable, scrollbarDragStartTop + deltaY));
      const ratio = newTop / trackUsable;
      const targetLine = Math.round(ratio * (totalLines - term.rows));
      term.scrollToLine(targetLine);
      return;
    }

    // Content-area touch scroll
    if (contentScrolling && term && !selectionMode) {
      if (longPressTimer) {
        const moveX = Math.abs(touch.clientX - longPressStartX);
        const moveY = Math.abs(contentTouchStartY - touch.clientY);
        if (moveX > LONG_PRESS_MOVE_TOLERANCE || moveY > LONG_PRESS_MOVE_TOLERANCE) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
      if (term.rows === 0 || containerEl.clientHeight === 0) return;
      const deltaY = contentTouchStartY - touch.clientY;
      if (Math.abs(deltaY) > 5) {
        contentTouchMoved = true;
        e.preventDefault();
        const lineHeight = containerEl.clientHeight / term.rows;
        const lineDelta = deltaY / lineHeight;
        const maxScroll = term.buffer.active.baseY;
        const targetLine = Math.max(0, Math.min(maxScroll, Math.round(contentScrollStartLine + lineDelta)));
        term.scrollToLine(targetLine);
      }
    }
  }

  function onDocumentTouchEnd() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    scrollbarDragging = false;
    contentScrolling = false;
    contentTouchMoved = false;
  }

  function onScrollbarClick(e: MouseEvent) {
    if (e.target === thumbEl) return;
    scrollbarScrollToY(e.clientY);
  }

  function scrollPageUp() {
    term?.scrollPages(-1);
  }

  function scrollPageDown() {
    term?.scrollPages(1);
  }

  let scrollbarEl: HTMLDivElement;
  let thumbEl: HTMLDivElement;

  // ── Image upload ─────────────────────────────────────────────────────────────

  export async function handleImageUpload(blob: Blob, mimeType: string) {
    if (imageUploadInProgress || !sessionId) return;
    imageUploadInProgress = true;
    onImageUpload?.('Pasting image\u2026', false);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]!;
      try {
        const data = await uploadImage(sessionId!, base64, mimeType);
        if (data.clipboardSet) {
          onImageUpload?.('Image pasted', false);
        } else {
          onImageUpload?.(data.path, true, data.path);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Image upload failed';
        onImageUpload?.(msg, false);
      } finally {
        imageUploadInProgress = false;
      }
    };
    reader.readAsDataURL(blob);
  }

  function onContainerPaste(e: ClipboardEvent) {
    if (!e.clipboardData?.items) return;
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        e.stopPropagation();
        const blob = item.getAsFile();
        if (blob) handleImageUpload(blob, item.type);
        return;
      }
    }
  }

  let dragOver = $state(false);

  function onContainerDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragOver = true;
    }
  }

  function onContainerDragLeave() {
    dragOver = false;
  }

  function onContainerDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (!e.dataTransfer?.files.length) return;
    const file = e.dataTransfer.files[0]!;
    if (file.type.startsWith('image/')) handleImageUpload(file, file.type);
  }

  // Touch: tap on terminal area to focus mobile input
  let mobileInputRef: HTMLInputElement | null = null;

  export function setMobileInputRef(el: HTMLInputElement | null) {
    mobileInputRef = el;
  }

  function onTerminalTouchEnd(e: TouchEvent) {
    if (scrollbarDragging) return;
    if (contentTouchMoved) return;
    if ((e.target as HTMLElement).closest('.terminal-scrollbar')) return;
    if (selectionMode) return;
    mobileInputRef?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-wrapper"
  class:drag-over={dragOver}
  class:selection-mode={selectionMode}
  ontouchstart={isMobileDevice ? onTerminalTouchStart : undefined}
  ontouchend={isMobileDevice ? onTerminalTouchEnd : undefined}
>
  <div
    class="terminal-container"
    bind:this={containerEl}
    onpaste={onContainerPaste}
    ondragover={onContainerDragOver}
    ondragleave={onContainerDragLeave}
    ondrop={onContainerDrop}
    role="presentation"
  ></div>
  <div
    class="terminal-scrollbar"
    bind:this={scrollbarEl}
    onclick={onScrollbarClick}
    role="scrollbar"
    aria-valuenow={0}
    aria-orientation="vertical"
  >
    <div
      class="terminal-scrollbar-thumb"
      bind:this={thumbEl}
      style:display={thumbVisible ? 'block' : 'none'}
      style:height={thumbHeight + 'px'}
      style:top={thumbTop + 'px'}
      ontouchstart={onThumbTouchStart}
      role="presentation"
    ></div>
  </div>
  {#if isMobileDevice && thumbVisible}
    <div class="scroll-fabs">
      <!-- svelte-ignore a11y_consider_explicit_label -->
      <button class="scroll-fab" onclick={scrollPageUp} aria-label="Page up">&#9650;</button>
      <!-- svelte-ignore a11y_consider_explicit_label -->
      <button class="scroll-fab" onclick={scrollPageDown} aria-label="Page down">&#9660;</button>
    </div>
  {/if}
</div>

<style>
  .terminal-wrapper {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .terminal-container {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 4px;
  }

  .terminal-wrapper.drag-over {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
  }

  .terminal-scrollbar {
    width: 8px;
    background: transparent;
    position: relative;
    flex-shrink: 0;
  }

  .terminal-scrollbar-thumb {
    position: absolute;
    right: 0;
    width: 6px;
    background: var(--border);
    border-radius: 3px;
    cursor: pointer;
  }

  @media (hover: none) {
    .terminal-wrapper.selection-mode .terminal-container {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .terminal-container {
      touch-action: none;
    }
    .terminal-scrollbar {
      width: 12px;
    }
    .terminal-scrollbar-thumb {
      width: 8px;
      min-height: 44px;
    }
    .scroll-fabs {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 1;
      opacity: 0.15;
      pointer-events: auto;
    }
    .scroll-fab {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
    }
    .scroll-fab:active {
      opacity: 1;
      background: var(--border);
    }
  }
</style>
