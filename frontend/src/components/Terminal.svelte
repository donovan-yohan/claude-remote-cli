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

  onMount(() => {
    const t = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
    });

    fitAddon = new FitAddon();
    t.loadAddon(fitAddon);
    t.open(containerEl);
    fitAddon.fit();

    t.onData((data) => sendPtyData(data));

    // Custom key handler: Ctrl+V on non-Mac for clipboard/image paste
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
    t.attachCustomKeyEventHandler((e) => {
      if (isMobileDevice) return false;
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

    // Scrollbar updates
    t.onScroll(updateScrollbar);
    t.onWriteParsed(updateScrollbar);

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      sendPtyResize(t.cols, t.rows);
      updateScrollbar();
    });
    ro.observe(containerEl);

    term = t;

    return () => {
      ro.disconnect();
      t.dispose();
      term = null;
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
    e.preventDefault();
    scrollbarDragging = true;
    scrollbarDragStartY = e.touches[0]!.clientY;
    scrollbarDragStartTop = thumbTop;
  }

  function onDocumentTouchMove(e: TouchEvent) {
    if (!scrollbarDragging || !term || !scrollbarEl) return;
    e.preventDefault();
    const deltaY = e.touches[0]!.clientY - scrollbarDragStartY;
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
  }

  function onDocumentTouchEnd() {
    scrollbarDragging = false;
  }

  function onScrollbarClick(e: MouseEvent) {
    if (e.target === thumbEl) return;
    scrollbarScrollToY(e.clientY);
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
</script>

<svelte:document
  ontouchmove={isMobileDevice ? onDocumentTouchMove : undefined}
  ontouchend={isMobileDevice ? onDocumentTouchEnd : undefined}
/>

<div
  class="terminal-wrapper"
  class:drag-over={dragOver}
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

  .terminal-container.drag-over {
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
    .terminal-scrollbar {
      width: 12px;
    }
    .terminal-scrollbar-thumb {
      width: 8px;
      min-height: 44px;
    }
  }
</style>
