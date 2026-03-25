<script lang="ts">
  import DialogShell from './DialogShell.svelte';
  import SettingRow from './SettingRow.svelte';
  import GitHubIntegration from './integrations/GitHubIntegration.svelte';
  import WebhookIntegration from './integrations/WebhookIntegration.svelte';
  import JiraIntegration from './integrations/JiraIntegration.svelte';
  import {
    setDefaultAgent,
    setDefaultContinue,
    setDefaultYolo,
    setLaunchInTmux,
    setDefaultNotifications,
    checkVersion,
    triggerUpdate,
    fetchAnalyticsSize,
    clearAnalytics,
    fetchGitHubStatus,
  } from '../../lib/api.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';
  import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';

  let shellRef = $state<ReturnType<typeof DialogShell> | undefined>(undefined);
  let contentEl = $state<HTMLDivElement | undefined>(undefined);

  const config = getConfigState();
  let error = $state('');

  // Version state
  let currentVersion = $state('');
  let latestVersion = $state<string | null>(null);
  let updateAvailable = $state(false);
  let versionChecked = $state(false);
  let updating = $state(false);
  let updateStatus = $state('');

  // Analytics state
  let analyticsSize = $state<number | null>(null);
  let clearing = $state(false);

  // GitHub state (for integration props)
  let githubConnected = $state(false);
  let webhookCount = $state(0);

  // Devtools state
  let devtoolsEnabled = $state(false);

  // Search state
  let searchQuery = $state('');

  // TOC drawer state
  let tocOpen = $state(false);

  function matchesSearch(sectionId: string): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    if (sectionId.includes(q)) return true;
    const sectionData: Record<string, string[]> = {
      general: ['default coding agent', 'continue existing session', 'yolo mode', 'launch in tmux', 'notifications', 'push notifications'],
      integrations: ['github', 'webhooks', 'jira', 'real-time', 'ci', 'pr', 'tickets'],
      advanced: ['developer tools', 'analytics', 'debug panel', 'usage data'],
      about: ['version', 'update'],
    };
    return sectionData[sectionId]?.some(term => term.includes(q)) ?? false;
  }

  async function checkVersionAsync() {
    updateStatus = '';
    try {
      const data = await checkVersion();
      currentVersion = data.current;
      latestVersion = data.latest;
      updateAvailable = data.updateAvailable;
      versionChecked = true;
    } catch {
      updateStatus = 'Failed to check for updates.';
    }
  }

  async function fetchAnalyticsSizeAsync() {
    try {
      const d = await fetchAnalyticsSize();
      analyticsSize = d.bytes;
    } catch {
      // ignore
    }
  }

  async function fetchGitHubStatusAsync() {
    try {
      const s = await fetchGitHubStatus();
      githubConnected = s.connected;
    } catch {
      // ignore
    }
  }

  export function open(scrollToId?: string) {
    error = '';
    updateStatus = '';
    versionChecked = false;
    updating = false;
    devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
    refreshConfig();
    checkVersionAsync();
    fetchAnalyticsSizeAsync();
    fetchGitHubStatusAsync();
    shellRef?.open();
    if (scrollToId) {
      requestAnimationFrame(() => {
        contentEl?.querySelector(`#${scrollToId}`)?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }

  export function close() {
    shellRef?.close();
    refreshAll();
  }

  // -- Handler functions (API calls with optimistic updates) --

  async function handleAgentChange() {
    const prev = config.defaultAgent;
    error = '';
    try {
      await setDefaultAgent(config.defaultAgent);
    } catch {
      config.defaultAgent = prev;
      error = 'Failed to update default agent.';
    }
  }

  async function handleContinueChange() {
    const prev = config.defaultContinue;
    error = '';
    try {
      await setDefaultContinue(config.defaultContinue);
    } catch {
      config.defaultContinue = prev;
      error = 'Failed to update continue default.';
    }
  }

  async function handleYoloChange() {
    const prev = config.defaultYolo;
    error = '';
    try {
      await setDefaultYolo(config.defaultYolo);
    } catch {
      config.defaultYolo = prev;
      error = 'Failed to update yolo default.';
    }
  }

  async function handleTmuxChange() {
    const prev = config.launchInTmux;
    error = '';
    try {
      await setLaunchInTmux(config.launchInTmux);
    } catch (err) {
      config.launchInTmux = prev;
      error = err instanceof Error ? err.message : 'Failed to update tmux setting.';
    }
  }

  async function handleNotificationsChange() {
    const prev = config.defaultNotifications;
    error = '';
    try {
      await setDefaultNotifications(config.defaultNotifications);
    } catch {
      config.defaultNotifications = prev;
      error = 'Failed to update notifications default.';
    }
  }

  function handleDevtoolsChange() {
    localStorage.setItem('devtools-enabled', devtoolsEnabled ? 'true' : 'false');
    window.dispatchEvent(new Event('devtools-changed'));
  }

  async function handleClearAnalytics() {
    if (!confirm('Clear all analytics data? This cannot be undone.')) return;
    clearing = true;
    try {
      await clearAnalytics();
      analyticsSize = 0;
    } catch {
      error = 'Failed to clear analytics.';
    } finally {
      clearing = false;
    }
  }

  async function handleUpdate() {
    updating = true;
    updateStatus = '';
    try {
      const result = await triggerUpdate();
      if (result.restarting) {
        updateStatus = 'Updated! Restarting server\u2026';
        setTimeout(() => { location.reload(); }, 5000);
      } else {
        updateStatus = 'Updated! Please restart the server manually.';
      }
      updateAvailable = false;
    } catch {
      updateStatus = 'Update failed. Please try again.';
      updating = false;
    }
  }

  function handleGitHubDisconnect() {
    githubConnected = false;
  }

  function scrollToSection(sectionId: string) {
    tocOpen = false;
    contentEl?.querySelector(`#${sectionId}`)?.scrollIntoView({ behavior: 'smooth' });
  }
</script>

{#snippet headerExtra()}
  <div class="header-extra-content">
    <button class="hamburger-btn" onclick={() => tocOpen = !tocOpen} aria-label="Navigation">&#9776;</button>
    <input
      class="search-input"
      type="text"
      placeholder="Search..."
      bind:value={searchQuery}
      aria-label="Search settings"
    />
  </div>
{/snippet}

<DialogShell bind:this={shellRef} title="SETTINGS" variant="fullscreen" header-extra={headerExtra}>
  <div class="settings-content" bind:this={contentEl}>
    {#if error}
      <p class="error-msg">{error}</p>
    {/if}

    <!-- TOC drawer overlay -->
    {#if tocOpen}
      <div class="toc-backdrop" onclick={() => tocOpen = false} role="presentation"></div>
      <nav class="toc-drawer" aria-label="Settings navigation">
        <button class="toc-item" onclick={() => scrollToSection('section-general')}>GENERAL</button>
        <button class="toc-item" onclick={() => scrollToSection('section-integrations')}>INTEGRATIONS</button>
        <button class="toc-item toc-sub" onclick={() => scrollToSection('section-integrations')}>GitHub</button>
        <button class="toc-item toc-sub" onclick={() => scrollToSection('section-integrations')}>Webhooks</button>
        <button class="toc-item toc-sub" onclick={() => scrollToSection('section-integrations')}>Jira</button>
        <button class="toc-item" onclick={() => scrollToSection('section-advanced')}>ADVANCED</button>
        <button class="toc-item" onclick={() => scrollToSection('section-about')}>ABOUT</button>
      </nav>
    {/if}

    <!-- GENERAL section -->
    <section id="section-general" class="settings-section" class:dimmed={!matchesSearch('general')}>
      <h3 class="section-heading">GENERAL</h3>

      <SettingRow name="Default Coding Agent" description="Which AI agent to use for new sessions">
        <select bind:value={config.defaultAgent} onchange={handleAgentChange}>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </SettingRow>

      <SettingRow name="Continue existing session" description="Resume the last session when opening a repo">
        <input type="checkbox" class="dialog-checkbox" bind:checked={config.defaultContinue} onchange={handleContinueChange} />
      </SettingRow>

      <SettingRow name="YOLO mode" description="Skip permission checks for all sessions">
        <input type="checkbox" class="dialog-checkbox" bind:checked={config.defaultYolo} onchange={handleYoloChange} />
      </SettingRow>

      <SettingRow name="Launch in tmux" description="Wrap sessions in tmux for scroll and copy">
        <input type="checkbox" class="dialog-checkbox" bind:checked={config.launchInTmux} onchange={handleTmuxChange} />
      </SettingRow>

      <SettingRow name="Notifications" description="Push notifications when sessions need attention">
        <input type="checkbox" class="dialog-checkbox" bind:checked={config.defaultNotifications} onchange={handleNotificationsChange} />
      </SettingRow>
    </section>

    <!-- INTEGRATIONS section -->
    <section id="section-integrations" class="settings-section" class:dimmed={!matchesSearch('integrations')}>
      <h3 class="section-heading">INTEGRATIONS</h3>
      <GitHubIntegration
        onDisconnect={handleGitHubDisconnect}
        webhookCount={webhookCount}
      />
      <WebhookIntegration
        githubConnected={githubConnected}
      />
      <JiraIntegration />
    </section>

    <!-- ADVANCED section -->
    <section id="section-advanced" class="settings-section" class:dimmed={!matchesSearch('advanced')}>
      <h3 class="section-heading">ADVANCED</h3>

      <SettingRow name="Developer Tools" description="Mobile debug panel">
        <input type="checkbox" class="dialog-checkbox" bind:checked={devtoolsEnabled} onchange={handleDevtoolsChange} />
      </SettingRow>

      <SettingRow name="Analytics" description="Local usage data">
        <div class="analytics-action">
          {#if analyticsSize !== null}
            <span class="analytics-size">{(analyticsSize / 1024 / 1024).toFixed(1)} MB</span>
          {/if}
          <button class="btn btn-ghost btn-sm" onclick={handleClearAnalytics} disabled={clearing}>
            {clearing ? 'Clearing\u2026' : 'Clear'}
          </button>
        </div>
      </SettingRow>
    </section>

    <!-- ABOUT section -->
    <section id="section-about" class="settings-section" class:dimmed={!matchesSearch('about')}>
      <h3 class="section-heading">ABOUT</h3>

      <SettingRow name="Version" description={currentVersion ? `v${currentVersion}` : ''}>
        {#if updateAvailable}
          <button class="btn btn-primary btn-sm" onclick={handleUpdate} disabled={updating}>
            {updating ? 'Updating\u2026' : `Update to v${latestVersion}`}
          </button>
        {:else if versionChecked}
          <span class="version-ok">Up to date</span>
        {/if}
      </SettingRow>

      {#if updateStatus}
        <p class="update-status">{updateStatus}</p>
      {/if}
    </section>
  </div>
</DialogShell>

<style>
  .header-extra-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 32px;
    position: relative;
  }

  .settings-section {
    transition: opacity 200ms ease, max-height 200ms ease;
  }

  .settings-section.dimmed {
    opacity: 0.3;
    max-height: 0;
    overflow: hidden;
    padding: 0;
    margin: 0;
  }

  .section-heading {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .search-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    padding: 6px 12px;
    flex: 1;
    max-width: 200px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .hamburger-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    font-family: var(--font-mono);
  }

  .hamburger-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  /* TOC drawer */
  .toc-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  .toc-drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 220px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    z-index: 11;
    padding: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: toc-slide-in 150ms ease forwards;
  }

  @keyframes toc-slide-in {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .toc-item {
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    text-align: left;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }

  .toc-item:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .toc-sub {
    padding-left: 32px;
    font-size: var(--font-size-xs);
  }

  .analytics-action {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .analytics-size {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .version-ok {
    font-size: var(--font-size-sm);
    color: var(--status-success);
  }

  .update-status {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    margin: 0;
  }

  select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    padding: 6px 10px;
    cursor: pointer;
  }

  select:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
