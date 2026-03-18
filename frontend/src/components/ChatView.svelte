<script lang="ts">
  import { onMount } from 'svelte';
  import type { SdkEvent } from '../lib/types.js';
  import UserMessage from './cards/UserMessage.svelte';
  import AgentMessage from './cards/AgentMessage.svelte';
  import FileChangeCard from './cards/FileChangeCard.svelte';
  import ToolCallCard from './cards/ToolCallCard.svelte';
  import ReasoningPanel from './cards/ReasoningPanel.svelte';
  import ErrorCard from './cards/ErrorCard.svelte';
  import TurnCompletedCard from './cards/TurnCompletedCard.svelte';

  let {
    events,
    isStreaming,
    onRetry,
  }: {
    events: SdkEvent[];
    isStreaming: boolean;
    onRetry?: (() => void) | undefined;
  } = $props();

  let scrollContainer: HTMLDivElement | undefined;
  let shouldAutoScroll = $state(true);

  // Auto-scroll to bottom when new events arrive
  $effect(() => {
    // Track events length to trigger effect
    const _len = events.length;
    if (shouldAutoScroll && scrollContainer) {
      // Use microtask to allow DOM to update first
      queueMicrotask(() => {
        scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight });
      });
    }
  });

  function onScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 40;
  }

  // Track user messages: turn_started events preceded by any message context
  // We detect user messages as the text in the event before turn_started,
  // but the protocol sends agent_message for agent text. User text is sent
  // via ChatInput and appears as the user's message card.
  // For display, we use the event types directly.
</script>

<div class="chat-view" bind:this={scrollContainer} onscroll={onScroll}>
  {#if events.length === 0}
    <div class="empty-state">
      <p>Send a message to start a conversation</p>
      <span class="cursor-blink">|</span>
    </div>
  {:else}
    <div class="message-list">
      {#each events as event (event.id ?? event.timestamp)}
        {#if event.type === 'agent_message' && event.text}
          <AgentMessage text={event.text} />
        {:else if event.type === 'file_change' && event.path}
          <FileChangeCard path={event.path} additions={event.additions} deletions={event.deletions} />
        {:else if event.type === 'tool_call' && event.toolName}
          <ToolCallCard toolName={event.toolName} toolInput={event.toolInput} status={event.status} />
        {:else if event.type === 'reasoning' && event.text}
          <ReasoningPanel text={event.text} />
        {:else if event.type === 'error' && event.text}
          <ErrorCard text={event.text} onRetry={onRetry} />
        {:else if event.type === 'turn_completed'}
          <TurnCompletedCard usage={event.usage} />
        {:else if event.type === 'session_started' && event.text}
          <div class="session-started">
            <span class="session-started-text">{event.text}</span>
          </div>
        {/if}
      {/each}

      {#if isStreaming}
        <div class="working-indicator">
          <span class="working-dot">&#9679;</span>
          <span class="working-text">Claude is working...</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chat-view {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--spacing-sm);
    scroll-behavior: smooth;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 0.95rem;
    gap: var(--spacing-sm);
  }

  .cursor-blink {
    font-family: var(--code-font);
    font-size: 1.2rem;
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .message-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .session-started {
    padding: var(--spacing-sm) var(--spacing-md);
    text-align: center;
  }

  .session-started-text {
    color: var(--text-muted);
    font-size: 0.82rem;
    font-style: italic;
  }

  .working-indicator {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
  }

  .working-dot {
    color: var(--accent);
    font-size: 0.7rem;
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .working-text {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
</style>
