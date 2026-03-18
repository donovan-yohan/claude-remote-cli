import type { SdkEvent, PermissionRequest, TokenUsage } from '../types.js';
import { calculateCost } from '../pricing.js';

// Per-session event stores
const sessionEvents = $state<Record<string, SdkEvent[]>>({});

// Active permission request (only one at a time globally)
let activePermission = $state<PermissionRequest | null>(null);

// Cumulative token usage
let tokenUsage = $state<TokenUsage>({ input: 0, output: 0, estimatedCost: 0 });

// Whether the agent is currently streaming / working
let isStreaming = $state(false);

// Quick reply suggestions derived from last event
function deriveQuickReplies(sessionId: string): string[] {
  const events = sessionEvents[sessionId];
  if (!events || events.length === 0) return [];
  const last = events[events.length - 1]!;
  switch (last.type) {
    case 'turn_completed':
      return ['Continue', 'Show diff', 'Summarize changes'];
    case 'error':
      return ['Retry', 'Show logs', 'Skip'];
    case 'agent_message':
      return ['Continue', 'Thanks'];
    default:
      return [];
  }
}

export function getSdkState(sessionId: string) {
  return {
    get events() { return sessionEvents[sessionId] ?? []; },
    get activePermission() { return activePermission; },
    get tokenUsage() { return tokenUsage; },
    get isStreaming() { return isStreaming; },
    get quickReplies() { return deriveQuickReplies(sessionId); },
  };
}

export function appendEvent(sessionId: string, event: SdkEvent): void {
  if (!sessionEvents[sessionId]) {
    sessionEvents[sessionId] = [];
  }
  sessionEvents[sessionId]!.push(event);

  // Update streaming state based on event type
  if (event.type === 'turn_started') {
    isStreaming = true;
  } else if (event.type === 'turn_completed' || event.type === 'error') {
    isStreaming = false;
  }

  // Update token usage if present
  if (event.usage) {
    updateUsage(event.usage.input_tokens, event.usage.output_tokens);
  }
}

export function setPermission(request: PermissionRequest): void {
  activePermission = request;
}

export function resolvePermission(status: 'approved' | 'denied' | 'timed_out'): void {
  if (activePermission) {
    activePermission = { ...activePermission, status };
  }
}

export function updateUsage(inputTokens: number, outputTokens: number): void {
  tokenUsage = {
    input: tokenUsage.input + inputTokens,
    output: tokenUsage.output + outputTokens,
    estimatedCost: calculateCost(
      tokenUsage.input + inputTokens,
      tokenUsage.output + outputTokens,
    ),
  };
}

export function initSdkState(sessionId: string): void {
  sessionEvents[sessionId] = [];
  activePermission = null;
  tokenUsage = { input: 0, output: 0, estimatedCost: 0 };
  isStreaming = false;
}

export function clearSdkState(sessionId: string): void {
  delete sessionEvents[sessionId];
  activePermission = null;
  isStreaming = false;
}

export function setStreaming(value: boolean): void {
  isStreaming = value;
}
