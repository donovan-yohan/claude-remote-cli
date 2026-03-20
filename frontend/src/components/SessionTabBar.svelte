<script lang="ts">
  import type { SessionSummary } from '../lib/types.js';

  let {
    sessions,
    activeSessionId,
    onSelectSession,
    onCloseSession,
    onNewSession,
    onNewTerminal,
  }: {
    sessions: SessionSummary[];
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
    onCloseSession: (id: string) => void;
    onNewSession: () => void;
    onNewTerminal: () => void;
  } = $props();

  let newMenuOpen = $state(false);
  let newMenuBtnEl = $state<HTMLButtonElement | null>(null);

  function tabIcon(session: SessionSummary): string {
    return session.type === 'terminal' ? '🖥' : '🤖';
  }

  function handleCloseClick(e: MouseEvent, id: string) {
    e.stopPropagation();
    onCloseSession(id);
  }

  function handleCloseKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      onCloseSession(id);
    }
  }

  function toggleNewMenu() {
    newMenuOpen = !newMenuOpen;
  }

  function selectNewSession() {
    newMenuOpen = false;
    onNewSession();
  }

  function selectNewTerminal() {
    newMenuOpen = false;
    onNewTerminal();
  }

  function onWindowClick(e: MouseEvent) {
    if (
      newMenuOpen &&
      newMenuBtnEl &&
      document.contains(e.target as Node) &&
      !newMenuBtnEl.closest('.new-btn-wrap')?.contains(e.target as Node)
    ) {
      newMenuOpen = false;
    }
  }

  function onMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && newMenuOpen) {
      newMenuOpen = false;
      newMenuBtnEl?.focus();
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="session-tab-bar" role="tablist" aria-label="Sessions">
  <div class="tabs-scroll">
    {#each sessions as session (session.id)}
      {@const isActive = session.id === activeSessionId}
      <button
        class="tab"
        class:tab--active={isActive}
        role="tab"
        aria-selected={isActive}
        aria-label="{session.displayName || session.id}"
        tabindex={isActive ? 0 : -1}
        data-track="session-tab.select"
        onclick={() => onSelectSession(session.id)}
      >
        <span class="tab-icon" aria-hidden="true">{tabIcon(session)}</span>
        <span class="tab-name">{session.displayName || session.repoName || session.id}</span>
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <span
          class="tab-close"
          role="button"
          aria-label="Close {session.displayName || session.id}"
          data-track="session-tab.close"
          onclick={(e) => handleCloseClick(e, session.id)}
          onkeydown={(e) => handleCloseKeydown(e, session.id)}
        >×</span>
      </button>
    {/each}
  </div>

  <!-- New session button -->
  <div class="new-btn-wrap">
    <button
      bind:this={newMenuBtnEl}
      class="tab-new"
      aria-label="New session"
      aria-haspopup="menu"
      aria-expanded={newMenuOpen}
      data-track="session-tab.new-menu"
      onclick={toggleNewMenu}
      onkeydown={onMenuKeydown}
    >+</button>

    {#if newMenuOpen}
      <div class="new-menu" role="menu" tabindex="-1" onkeydown={onMenuKeydown}>
        <button
          class="new-menu-item"
          role="menuitem"
          data-track="session-tab.new-claude"
          onclick={selectNewSession}
        >
          <span class="new-menu-icon">🤖</span>
          New Claude Session
        </button>
        <button
          class="new-menu-item"
          role="menuitem"
          data-track="session-tab.new-terminal"
          onclick={selectNewTerminal}
        >
          <span class="new-menu-icon">🖥</span>
          New Terminal
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .session-tab-bar {
    display: flex;
    align-items: stretch;
    height: 32px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  /* Scrollable tab strip */
  .tabs-scroll {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    min-width: 0;
    /* hide scrollbar on all browsers */
    scrollbar-width: none;
  }

  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  /* ── Individual tab ─────────────────── */
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 10px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    transition: color 0.12s, background 0.12s;
    border-radius: 0;
    /* ensure native button reset */
    -webkit-appearance: none;
    appearance: none;
  }

  .tab:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .tab--active {
    background: var(--surface);
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .tab--active:hover {
    background: var(--surface);
  }

  .tab-icon {
    font-size: 0.7rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .tab-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Close button */
  .tab-close {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    border-radius: 3px;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0; /* hidden until hover on desktop */
    transition: opacity 0.1s, color 0.1s, background 0.1s;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    color: var(--text);
    background: var(--border);
  }

  .tab--active .tab-close {
    opacity: 0;
  }

  .tab--active:hover .tab-close {
    opacity: 1;
  }

  /* ── New button wrap ─────────────────── */
  .new-btn-wrap {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
  }

  .tab-new {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    font-family: var(--font-mono);
    transition: color 0.12s, background 0.12s;
    -webkit-appearance: none;
    appearance: none;
    line-height: 1;
  }

  .tab-new:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  /* Dropdown menu */
  .new-menu {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    z-index: 200;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    padding: 4px 0;
  }

  .new-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
    -webkit-appearance: none;
    appearance: none;
    white-space: nowrap;
  }

  .new-menu-item:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .new-menu-icon {
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  /* ── Mobile: bigger touch targets, always-visible close ─── */
  @media (max-width: 600px) {
    .session-tab-bar {
      height: 44px;
    }

    .tab {
      height: 44px;
      padding: 0 12px;
      min-width: 44px;
    }

    .tab-close {
      /* always visible on mobile */
      opacity: 1;
      width: 18px;
      height: 18px;
    }

    .tab--active .tab-close {
      opacity: 1;
    }

    .tab-new {
      width: 44px;
      height: 44px;
    }
  }
</style>
