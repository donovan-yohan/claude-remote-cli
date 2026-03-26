<script lang="ts">
  import { getAuth, submitPin } from '../lib/state/auth.svelte.js';
  import TuiButton from './TuiButton.svelte';
  import TuiInput from './TuiInput.svelte';

  const auth = getAuth();
  let pinValue = $state('');

  async function handleSubmit() {
    const pin = pinValue.trim();
    if (!pin) return;
    await submitPin(pin);
    if (auth.pinError) {
      pinValue = '';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }
</script>

<div class="pin-gate">
  <div class="pin-container">
    <h1>Relay</h1>
    <p>Enter PIN to continue</p>
    <TuiInput
      type="password"
      bind:value={pinValue}
      onkeydown={handleKeydown}
      placeholder="PIN"
      inputmode="numeric"
      maxlength="20"
      autofocus
    />
    <TuiButton variant="primary" onclick={handleSubmit}>Unlock</TuiButton>
    {#if auth.pinError}
      <p class="error">{auth.pinError}</p>
    {/if}
  </div>
</div>

<style>
  .pin-gate {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--bg);
    padding: 1rem;
  }

  .pin-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
    max-width: 320px;
    text-align: center;
  }

  .pin-container h1 {
    font-size: var(--font-size-lg);
    color: var(--text);
  }

  .pin-container p {
    color: var(--text-muted);
    font-size: var(--font-size-base);
  }

  .pin-container :global(.tui-input) {
    padding: 14px 16px;
    background: var(--surface);
    font-size: var(--font-size-lg);
    text-align: center;
  }

  .error {
    color: var(--accent);
    font-size: var(--font-size-base);
  }
</style>
