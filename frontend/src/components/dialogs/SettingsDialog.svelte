<script lang="ts">
  import { setDefaultAgent, setDefaultContinue, setDefaultYolo, setLaunchInTmux, setDefaultNotifications, checkVersion, triggerUpdate, fetchAnalyticsSize, clearAnalytics, fetchGitHubStatus, fetchGitHubAuthUrl, disconnectGitHub } from '../../lib/api.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';
  import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';

  let dialogEl: HTMLDialogElement;

  let devtoolsEnabled = $state(false);
  const config = getConfigState();
  let error = $state('');

  let currentVersion = $state('');
  let latestVersion = $state<string | null>(null);
  let updateAvailable = $state(false);
  let versionChecked = $state(false);
  let versionChecking = $state(false);
  let updating = $state(false);
  let updateStatus = $state('');

  let analyticsSize = $state<number | null>(null);
  let clearing = $state(false);

  let githubStatus = $state<{ connected: boolean; username: string | null }>({ connected: false, username: null });
  let githubPollInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    fetchGitHubStatus().then(s => { githubStatus = s; }).catch(() => {});
    return () => {
      if (githubPollInterval) { clearInterval(githubPollInterval); githubPollInterval = null; }
    };
  });

  async function connectGitHub() {
    const url = await fetchGitHubAuthUrl();
    window.open(url, '_blank', 'width=600,height=700');
    // Poll for connection status with cleanup
    githubPollInterval = setInterval(async () => {
      try {
        const status = await fetchGitHubStatus();
        if (status.connected) {
          githubStatus = status;
          if (githubPollInterval) { clearInterval(githubPollInterval); githubPollInterval = null; }
        }
      } catch { /* ignore network errors during polling */ }
    }, 2000);
    setTimeout(() => {
      if (githubPollInterval) { clearInterval(githubPollInterval); githubPollInterval = null; }
    }, 120_000);
  }

  async function handleDisconnectGitHub() {
    await disconnectGitHub();
    githubStatus = { connected: false, username: null };
  }

  export async function open() {
    error = '';
    updateStatus = '';
    versionChecked = false;
    updating = false;
    devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
    await refreshConfig();
    dialogEl.showModal();
    handleCheckVersion();
    fetchAnalyticsSize().then(d => { analyticsSize = d.bytes; }).catch(() => {});
  }

  export function close() {
    dialogEl.close();
  }

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

  async function handleCheckVersion() {
    versionChecking = true;
    updateStatus = '';
    try {
      const data = await checkVersion();
      currentVersion = data.current;
      latestVersion = data.latest;
      updateAvailable = data.updateAvailable;
      versionChecked = true;
    } catch {
      updateStatus = 'Failed to check for updates.';
    } finally {
      versionChecking = false;
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

  function onDevtoolsChange() {
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

  async function handleClose() {
    dialogEl.close();
    await refreshAll();
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      handleClose();
    }
  }

  // Root directory management removed — workspaces are managed from the sidebar
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  onclick={onDialogClick}
  class="dialog"
>
  <div class="dialog-content">
    <div class="dialog-header">
      <h2 class="dialog-title">Relay Settings</h2>
      <button class="close-btn" aria-label="Close settings" onclick={handleClose}>&#10005;</button>
    </div>

    <div class="dialog-body">
      {#if error}
        <p class="error-msg">{error}</p>
      {/if}

      <!-- Default coding agent section -->
      <section class="settings-section">
        <h3 class="section-title">Default Coding Agent</h3>
        <p class="section-desc">CLI used when creating new sessions.</p>
        <select
          class="agent-select"
          bind:value={config.defaultAgent}
          onchange={handleAgentChange}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </section>

      <!-- Session defaults section -->
      <section class="settings-section">
        <h3 class="section-title">Global Defaults</h3>
        <p class="section-desc">Default options for all workspaces. Override per-workspace in workspace settings.</p>
        <div class="devtools-row">
          <input id="default-continue" type="checkbox" class="dialog-checkbox" bind:checked={config.defaultContinue} onchange={handleContinueChange} />
          <label for="default-continue" class="devtools-label">Continue existing session</label>
        </div>
        <div class="devtools-row">
          <input id="default-yolo" type="checkbox" class="dialog-checkbox" bind:checked={config.defaultYolo} onchange={handleYoloChange} />
          <label for="default-yolo" class="devtools-label">YOLO mode (skip permission checks)</label>
        </div>
        <div class="devtools-row">
          <input id="default-tmux" type="checkbox" class="dialog-checkbox" bind:checked={config.launchInTmux} onchange={handleTmuxChange} />
          <label for="default-tmux" class="devtools-label">Launch in tmux</label>
        </div>
        <div class="devtools-row">
          <input id="default-notifications" type="checkbox" class="dialog-checkbox" bind:checked={config.defaultNotifications} onchange={handleNotificationsChange} />
          <label for="default-notifications" class="devtools-label">Enable notifications for new sessions</label>
        </div>
      </section>

      <!-- GitHub Connection section -->
      <section class="settings-section">
        <h3 class="section-title">GitHub Connection</h3>
        {#if githubStatus.connected}
          <div class="version-row">
            <span class="version-current">Connected as <strong>{githubStatus.username}</strong></span>
            <button
              class="btn btn-ghost btn-sm"
              onclick={handleDisconnectGitHub}
              data-track="dialog.settings.github-disconnect"
            >
              Disconnect
            </button>
          </div>
        {:else}
          <p class="section-desc">Connect your GitHub account to enable PR and CI features.</p>
          <div>
            <button
              class="btn btn-primary btn-sm"
              onclick={connectGitHub}
              data-track="dialog.settings.github-connect"
            >
              Connect GitHub
            </button>
          </div>
        {/if}
      </section>

      <!-- Developer tools section -->
      <section class="settings-section">
        <h3 class="section-title">Developer Tools</h3>
        <div class="devtools-row">
          <input
            id="devtools-toggle"
            type="checkbox"
            class="dialog-checkbox"
            bind:checked={devtoolsEnabled}
            onchange={onDevtoolsChange}
          />
          <label for="devtools-toggle" class="devtools-label">Enable mobile debug panel</label>
        </div>
      </section>

      <!-- Analytics section -->
      <section class="settings-section">
        <h3 class="section-title">Analytics</h3>
        <div class="version-row">
          <span class="version-current">
            DB size: {analyticsSize !== null ? (analyticsSize / 1024 / 1024).toFixed(1) + ' MB' : '...'}
          </span>
          <button
            class="btn btn-ghost btn-sm"
            onclick={handleClearAnalytics}
            disabled={clearing}
            data-track="dialog.settings.clear-analytics"
          >
            {clearing ? 'Clearing\u2026' : 'Clear'}
          </button>
        </div>
      </section>

      <!-- Version & Updates section -->
      <section class="settings-section">
        <h3 class="section-title">Version</h3>
        <div class="version-row">
          <span class="version-current">
            {#if currentVersion}v{currentVersion}{:else}...{/if}
          </span>
          {#if versionChecked && !updateAvailable && !updating}
            <span class="version-status">Up to date</span>
          {/if}
        </div>
        {#if updateAvailable}
          <div class="version-update-row">
            <span class="version-update-text">v{currentVersion} &rarr; v{latestVersion}</span>
            <button class="btn btn-primary btn-sm" onclick={handleUpdate} disabled={updating}>
              {updating ? 'Updating\u2026' : 'Update Now'}
            </button>
          </div>
        {:else if !versionChecked}
          <button
            class="btn btn-ghost btn-sm"
            onclick={handleCheckVersion}
            disabled={versionChecking}
          >
            {versionChecking ? 'Checking\u2026' : 'Check for updates'}
          </button>
        {/if}
        {#if updateStatus}
          <p class="version-status-msg">{updateStatus}</p>
        {/if}
      </section>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={handleClose}>Close</button>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0;
    width: min(460px, 95vw);
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .dialog-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .section-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin: 0;
  }

  .empty-msg {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
  }

  .roots-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .root-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
  }

  .root-path {
    font-size: 0.85rem;
    font-family: monospace;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 2px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
  }

  .remove-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .add-root-row {
    display: flex;
    gap: 8px;
  }

  .add-root-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    padding: 7px 10px;
  }

  .error-msg {
    font-size: 0.82rem;
    color: #e74c3c;
    margin: 0;
  }

  .agent-select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    padding: 7px 10px;
    width: 100%;
    box-sizing: border-box;
  }

  .devtools-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dialog-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .devtools-label {
    font-size: 0.9rem;
    cursor: pointer;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
    flex-shrink: 0;
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  .btn-ghost:hover {
    background: var(--border);
    color: var(--text);
  }

  .btn-sm {
    padding: 5px 12px;
    font-size: 0.8rem;
  }

  .version-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .version-current {
    font-size: 0.9rem;
    font-family: monospace;
    color: var(--text);
  }

  .version-status {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .version-update-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
  }

  .version-update-text {
    font-size: 0.85rem;
    color: var(--accent);
  }

  .version-status-msg {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin: 0;
  }
</style>
