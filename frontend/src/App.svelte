<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth, checkExistingAuth } from './lib/state/auth.svelte.js';
  import PinGate from './components/PinGate.svelte';

  const auth = getAuth();

  onMount(() => {
    checkExistingAuth();
  });
</script>

{#if auth.checking}
  <!-- Loading -->
{:else if !auth.authenticated}
  <PinGate />
{:else}
  <p class="placeholder">Authenticated! Main app will go here.</p>
{/if}

<style>
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: var(--text-muted);
    font-size: 1rem;
  }
</style>
