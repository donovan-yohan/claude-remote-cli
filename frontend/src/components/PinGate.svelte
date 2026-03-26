<script lang="ts">
  import { getAuth, submitPin } from '../lib/state/auth.svelte.js';

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
    <input
      type="password"
      inputmode="numeric"
      maxlength="20"
      placeholder="PIN"
      bind:value={pinValue}
      onkeydown={handleKeydown}
      autofocus
    />
    <button onclick={handleSubmit}>Unlock</button>
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

  input {
    width: 100%;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-size: var(--font-size-lg);
    text-align: center;
    outline: none;
    -webkit-appearance: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  button {
    width: 100%;
    padding: 14px;
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  button:active {
    opacity: 0.8;
  }

  .error {
    color: var(--accent);
    font-size: var(--font-size-base);
  }
</style>
