import type { SdkEvent, PermissionRequest, TokenUsage } from '../types.js';
import { calculateCost } from '../pricing.js';

// Per-session state stores (keyed by sessionId)
const sessionEvents = $state<Record<string, SdkEvent[]>>({});
const sessionPermissions = $state<Record<string, PermissionRequest | null>>({});
const sessionUsage = $state<Record<string, TokenUsage>>({});
const sessionStreaming = $state<Record<string, boolean>>({});

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
    get activePermission() { return sessionPermissions[sessionId] ?? null; },
    get tokenUsage() { return sessionUsage[sessionId] ?? { input: 0, output: 0, estimatedCost: 0 }; },
    get isStreaming() { return sessionStreaming[sessionId] ?? false; },
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
    sessionStreaming[sessionId] = true;
  } else if (event.type === 'turn_completed' || event.type === 'error') {
    sessionStreaming[sessionId] = false;
  }

  // Update token usage if present
  if (event.usage) {
    updateUsage(sessionId, event.usage.input_tokens, event.usage.output_tokens);
  }
}

export function setPermission(sessionId: string, request: PermissionRequest): void {
  sessionPermissions[sessionId] = request;
}

export function resolvePermission(sessionId: string, status: 'approved' | 'denied' | 'timed_out'): void {
  const current = sessionPermissions[sessionId];
  if (current) {
    sessionPermissions[sessionId] = { ...current, status };
  }
}

export function updateUsage(sessionId: string, inputTokens: number, outputTokens: number): void {
  const prev = sessionUsage[sessionId] ?? { input: 0, output: 0, estimatedCost: 0 };
  sessionUsage[sessionId] = {
    input: prev.input + inputTokens,
    output: prev.output + outputTokens,
    estimatedCost: calculateCost(
      prev.input + inputTokens,
      prev.output + outputTokens,
    ),
  };
}

export function initSdkState(sessionId: string): void {
  sessionEvents[sessionId] = [];
  sessionPermissions[sessionId] = null;
  sessionUsage[sessionId] = { input: 0, output: 0, estimatedCost: 0 };
  sessionStreaming[sessionId] = false;
}

export function clearSdkState(sessionId: string): void {
  delete sessionEvents[sessionId];
  delete sessionPermissions[sessionId];
  delete sessionUsage[sessionId];
  delete sessionStreaming[sessionId];
}

export function setStreaming(sessionId: string, value: boolean): void {
  sessionStreaming[sessionId] = value;
}
