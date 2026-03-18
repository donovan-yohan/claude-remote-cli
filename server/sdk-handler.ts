import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentType, SdkEvent, SdkEventType, SdkSession, Session, SessionStatus, SessionSummary, SessionType } from './types.js';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKMessage, SDKUserMessage, PermissionResult, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

const MAX_EVENTS = 2000;
const IDLE_TIMEOUT_MS = 5000;

// Runtime state not stored on the SdkSession type
interface SdkRuntimeState {
  query: Query | null;
  abortController: AbortController;
  permissionQueue: Map<string, { resolve: (result: PermissionResult) => void; reject: (err: Error) => void }>;
  eventListeners: Array<(event: SdkEvent) => void>;
  inputController: SdkInputController | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// Controller for streaming user messages into an SDK query
class SdkInputController {
  private resolveNext: ((value: IteratorResult<SDKUserMessage, void>) => void) | null = null;
  private queue: SDKUserMessage[] = [];
  private done = false;

  push(msg: SDKUserMessage): void {
    if (this.done) return;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.done = true;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage, void>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.resolveNext = resolve;
        });
      },
    };
  }
}

const runtimeStates = new Map<string, SdkRuntimeState>();

// Debug log state
let debugLogEnabled = false;
const DEBUG_DIR = path.join(os.homedir(), '.config', 'claude-remote-cli', 'debug');
const MAX_DEBUG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEBUG_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function enableDebugLog(enabled: boolean): void {
  debugLogEnabled = enabled;
  if (enabled) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    cleanupOldDebugFiles();
  }
}

function cleanupOldDebugFiles(): void {
  try {
    const files = fs.readdirSync(DEBUG_DIR);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(DEBUG_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > DEBUG_FILE_MAX_AGE_MS) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // ignore if directory doesn't exist yet
  }
}

function debugLogEvent(sessionId: string, event: SdkEvent): void {
  if (!debugLogEnabled) return;
  try {
    const filePath = path.join(DEBUG_DIR, `${sessionId}.jsonl`);
    const line = JSON.stringify({ ...event, _logged: new Date().toISOString() }) + '\n';

    // Auto-rotate at 10MB
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_DEBUG_FILE_SIZE) {
        const rotatedPath = filePath + '.1';
        try { fs.unlinkSync(rotatedPath); } catch { /* ignore */ }
        fs.renameSync(filePath, rotatedPath);
      }
    } catch {
      // file doesn't exist yet, that's fine
    }

    fs.appendFileSync(filePath, line, 'utf-8');
  } catch {
    // debug logging should never crash the server
  }
}

export type CreateSdkParams = {
  id: string;
  type?: SessionType | undefined;
  agent?: AgentType | undefined;
  repoName?: string | undefined;
  repoPath: string;
  cwd?: string | undefined;
  root?: string | undefined;
  worktreeName?: string | undefined;
  branchName?: string | undefined;
  displayName?: string | undefined;
  prompt?: string | undefined;
};

export type CreateSdkResult = SessionSummary & { fallback?: boolean };

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

function extractAssistantEvents(msg: SDKAssistantMessage, timestamp: string): SdkEvent[] {
  const events: SdkEvent[] = [];
  const content = msg.message.content as ContentBlock[];

  const textParts: string[] = [];
  const thinkingParts: string[] = [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    } else if (block.type === 'thinking' && block.thinking) {
      thinkingParts.push(block.thinking);
    } else if (block.type === 'tool_use' && block.name && block.id) {
      const input = (block.input || {}) as Record<string, unknown>;
      const isFileEdit = block.name === 'Edit' || block.name === 'Write' || block.name === 'MultiEdit';
      const filePath = (input.file_path as string | undefined) || (input.path as string | undefined);

      if (isFileEdit) {
        const evt: SdkEvent = {
          type: 'file_change' as SdkEventType,
          id: block.id,
          toolName: block.name,
          toolInput: input,
          timestamp,
        };
        if (filePath) evt.path = filePath;
        events.push(evt);
      } else {
        events.push({
          type: 'tool_call' as SdkEventType,
          id: block.id,
          toolName: block.name,
          toolInput: input,
          timestamp,
        });
      }
    }
  }

  if (thinkingParts.length > 0) {
    // Prepend thinking before text/tool events
    events.unshift({
      type: 'reasoning' as SdkEventType,
      text: thinkingParts.join('\n'),
      timestamp,
    });
  }

  if (textParts.length > 0) {
    // Insert text event after thinking but before tool events
    const insertIdx = thinkingParts.length > 0 ? 1 : 0;
    events.splice(insertIdx, 0, {
      type: 'agent_message' as SdkEventType,
      id: msg.uuid,
      text: textParts.join(''),
      timestamp,
    });
  }

  return events;
}

function mapSdkMessageAll(msg: SDKMessage): SdkEvent[] {
  const timestamp = new Date().toISOString();
  const events: SdkEvent[] = [];

  if (msg.type === 'system' && msg.subtype === 'init') {
    events.push({
      type: 'session_started' as SdkEventType,
      id: msg.session_id,
      timestamp,
    });
    return events;
  }

  if (msg.type === 'assistant') {
    return extractAssistantEvents(msg, timestamp);
  }

  if (msg.type === 'result') {
    if (msg.subtype === 'success') {
      events.push({
        type: 'turn_completed' as SdkEventType,
        usage: {
          input_tokens: msg.usage.input_tokens,
          output_tokens: msg.usage.output_tokens,
        },
        timestamp,
      });
    } else {
      events.push({
        type: 'error' as SdkEventType,
        text: msg.errors.join('; '),
        timestamp,
      });
    }
    return events;
  }

  return events;
}

function addEvent(session: SdkSession, event: SdkEvent, state: SdkRuntimeState): void {
  session.events.push(event);
  // FIFO cap
  while (session.events.length > MAX_EVENTS) {
    session.events.shift();
  }
  // Notify listeners
  for (const listener of state.eventListeners) {
    try {
      listener(event);
    } catch {
      // listeners should not crash the handler
    }
  }
  // Debug log
  debugLogEvent(session.id, event);
}

function resetIdleTimer(
  session: SdkSession,
  state: SdkRuntimeState,
  idleChangeCallbacks: Array<(sessionId: string, idle: boolean) => void>,
): void {
  if (session.idle) {
    session.idle = false;
    for (const cb of idleChangeCallbacks) cb(session.id, false);
  }
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (!session.idle) {
      session.idle = true;
      for (const cb of idleChangeCallbacks) cb(session.id, true);
    }
  }, IDLE_TIMEOUT_MS);
}

export function createSdkSession(
  params: CreateSdkParams,
  sessionsMap: Map<string, Session>,
  idleChangeCallbacks: Array<(sessionId: string, idle: boolean) => void>,
): { session: SdkSession; result: CreateSdkResult } | { fallback: true } {
  const {
    id,
    type,
    agent = 'claude',
    repoName,
    repoPath,
    cwd,
    root,
    worktreeName,
    branchName,
    displayName,
    prompt,
  } = params;

  const createdAt = new Date().toISOString();
  const resolvedCwd = cwd || repoPath;

  // Strip sensitive env vars from child process
  const env = Object.assign({}, process.env) as Record<string, string>;
  delete env.CLAUDECODE;
  // Strip server-internal env vars
  for (const key of Object.keys(env)) {
    if (key.startsWith('VAPID_') || key === 'PIN_HASH') {
      delete env[key];
    }
  }

  const abortController = new AbortController();
  const inputController = new SdkInputController();

  // Permission queue for canUseTool callbacks
  const permissionQueue = new Map<string, { resolve: (result: PermissionResult) => void; reject: (err: Error) => void }>();

  const session: SdkSession = {
    id,
    type: type || 'worktree',
    agent,
    mode: 'sdk' as const,
    root: root || '',
    repoName: repoName || '',
    repoPath,
    worktreeName: worktreeName || '',
    branchName: branchName || worktreeName || '',
    displayName: displayName || worktreeName || repoName || '',
    createdAt,
    lastActivity: createdAt,
    idle: false,
    cwd: resolvedCwd,
    customCommand: null,
    status: 'active' as SessionStatus,
    events: [],
    sdkSessionId: null,
    tokenUsage: { input: 0, output: 0 },
    estimatedCost: 0,
  };

  const state: SdkRuntimeState = {
    query: null,
    abortController,
    permissionQueue,
    eventListeners: [],
    inputController,
    idleTimer: null,
  };

  // Try to create the SDK query
  let q: Query;
  try {
    q = sdkQuery({
      prompt: inputController as unknown as AsyncIterable<SDKUserMessage>,
      options: {
        abortController,
        cwd: resolvedCwd,
        env,
        canUseTool: async (toolName, input, options) => {
          const requestId = options.toolUseID || crypto.randomBytes(8).toString('hex');

          // Emit a tool_call event for the permission request
          const permEvent: SdkEvent = {
            type: 'tool_call' as SdkEventType,
            id: requestId,
            toolName,
            toolInput: input,
            status: 'pending_permission',
            text: options.title || `Claude wants to use ${toolName}`,
            timestamp: new Date().toISOString(),
          };
          addEvent(session, permEvent, state);

          return new Promise<PermissionResult>((resolve, reject) => {
            permissionQueue.set(requestId, { resolve, reject });

            // Clean up on abort
            options.signal.addEventListener('abort', () => {
              permissionQueue.delete(requestId);
              reject(new Error('Permission request aborted'));
            }, { once: true });
          });
        },
      },
    });
    state.query = q;
  } catch {
    return { fallback: true };
  }

  sessionsMap.set(id, session);
  runtimeStates.set(id, state);

  // Send initial prompt if provided
  if (prompt) {
    inputController.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
      session_id: id,
    });
  }

  // Start consuming the event stream in the background
  void (async () => {
    try {
      for await (const msg of q) {
        session.lastActivity = new Date().toISOString();
        resetIdleTimer(session, state, idleChangeCallbacks);

        const events = mapSdkMessageAll(msg);
        for (const event of events) {
          addEvent(session, event, state);

          // Track token usage
          if (event.type === 'turn_completed' && event.usage) {
            session.tokenUsage.input += event.usage.input_tokens;
            session.tokenUsage.output += event.usage.output_tokens;
          }

          // Track session ID
          if (event.type === 'session_started' && event.id) {
            session.sdkSessionId = event.id;
          }
        }
      }
    } catch (err) {
      const errorEvent: SdkEvent = {
        type: 'error' as SdkEventType,
        text: err instanceof Error ? err.message : 'SDK stream error',
        timestamp: new Date().toISOString(),
      };
      addEvent(session, errorEvent, state);
    }
  })();

  const result: CreateSdkResult = {
    id,
    type: session.type,
    agent: session.agent,
    mode: 'sdk' as const,
    root: session.root,
    repoName: session.repoName,
    repoPath,
    worktreeName: session.worktreeName,
    branchName: session.branchName,
    displayName: session.displayName,
    createdAt,
    lastActivity: createdAt,
    idle: false,
    cwd: resolvedCwd,
    customCommand: null,
    useTmux: false,
    tmuxSessionName: '',
    status: 'active' as SessionStatus,
  };

  return { session, result };
}

export function sendMessage(sessionId: string, text: string): void {
  const state = runtimeStates.get(sessionId);
  if (!state || !state.inputController) {
    throw new Error(`SDK session not found or not active: ${sessionId}`);
  }

  state.inputController.push({
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
}

export function handlePermission(sessionId: string, requestId: string, approved: boolean): void {
  const state = runtimeStates.get(sessionId);
  if (!state) {
    throw new Error(`SDK session not found: ${sessionId}`);
  }

  const pending = state.permissionQueue.get(requestId);
  if (!pending) {
    throw new Error(`No pending permission request: ${requestId}`);
  }

  state.permissionQueue.delete(requestId);

  if (approved) {
    pending.resolve({ behavior: 'allow' });
  } else {
    pending.resolve({ behavior: 'deny', message: 'User denied permission' });
  }
}

export function interruptSession(sessionId: string): void {
  const state = runtimeStates.get(sessionId);
  if (!state) {
    throw new Error(`SDK session not found: ${sessionId}`);
  }

  if (state.query) {
    void state.query.interrupt().catch(() => {
      // If interrupt fails, abort
      state.abortController.abort();
    });
  }
}

export function killSdkSession(sessionId: string): void {
  const state = runtimeStates.get(sessionId);
  if (!state) return;

  // Reject all pending permission requests
  for (const [, pending] of state.permissionQueue) {
    pending.reject(new Error('Session killed'));
  }
  state.permissionQueue.clear();

  // Close input stream
  if (state.inputController) {
    state.inputController.close();
  }

  // Close the query
  if (state.query) {
    state.query.close();
  }

  // Abort
  state.abortController.abort();

  // Clear idle timer
  if (state.idleTimer) clearTimeout(state.idleTimer);

  // Clean up runtime state
  runtimeStates.delete(sessionId);
}

export function getEvents(sessionId: string): SdkEvent[] {
  const state = runtimeStates.get(sessionId);
  if (!state) return [];
  // We need to get the session from wherever it's stored
  // The events are on the session object, but we need it from the sessions map
  // This is a convenience — callers should use session.events directly
  return [];
}

export function onSdkEvent(sessionId: string, callback: (event: SdkEvent) => void): () => void {
  const state = runtimeStates.get(sessionId);
  if (!state) {
    return () => {};
  }
  state.eventListeners.push(callback);
  return () => {
    const idx = state.eventListeners.indexOf(callback);
    if (idx !== -1) state.eventListeners.splice(idx, 1);
  };
}

export function hasSdkRuntime(sessionId: string): boolean {
  return runtimeStates.has(sessionId);
}

export function getLastActivityTime(sessionId: string): string | null {
  const state = runtimeStates.get(sessionId);
  if (!state) return null;
  // Runtime state doesn't store lastActivity — that's on the session
  return null;
}

// Serialization for SDK sessions
export interface SerializedSdkSession {
  id: string;
  type: SessionType;
  agent: AgentType;
  mode: 'sdk';
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  cwd: string;
  sdkSessionId: string | null;
  tokenUsage: { input: number; output: number };
  estimatedCost: number;
  events: SdkEvent[];
}

export function serializeSdkSession(session: SdkSession): SerializedSdkSession {
  return {
    id: session.id,
    type: session.type,
    agent: session.agent,
    mode: 'sdk',
    root: session.root,
    repoName: session.repoName,
    repoPath: session.repoPath,
    worktreeName: session.worktreeName,
    branchName: session.branchName,
    displayName: session.displayName,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    cwd: session.cwd,
    sdkSessionId: session.sdkSessionId,
    tokenUsage: { ...session.tokenUsage },
    estimatedCost: session.estimatedCost,
    events: session.events.slice(-100), // Keep last 100 events for restore
  };
}

export function restoreSdkSession(
  serialized: SerializedSdkSession,
  sessionsMap: Map<string, Session>,
): SdkSession {
  const session: SdkSession = {
    id: serialized.id,
    type: serialized.type,
    agent: serialized.agent,
    mode: 'sdk',
    root: serialized.root,
    repoName: serialized.repoName,
    repoPath: serialized.repoPath,
    worktreeName: serialized.worktreeName,
    branchName: serialized.branchName,
    displayName: serialized.displayName,
    createdAt: serialized.createdAt,
    lastActivity: serialized.lastActivity,
    idle: true,
    cwd: serialized.cwd,
    customCommand: null,
    status: 'disconnected' as SessionStatus,
    events: serialized.events || [],
    sdkSessionId: serialized.sdkSessionId,
    tokenUsage: serialized.tokenUsage || { input: 0, output: 0 },
    estimatedCost: serialized.estimatedCost || 0,
  };

  sessionsMap.set(session.id, session);
  return session;
}
