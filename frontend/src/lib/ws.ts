import type { Terminal } from '@xterm/xterm';
import type { SdkEvent } from './types.js';

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

type EventCallback = (msg: { type: string; sessionId?: string; idle?: boolean; branchName?: string; displayName?: string }) => void;

export type SdkMessageCallback = (event: SdkEvent) => void;
export type SdkTerminalDataCallback = (data: string) => void;
export type SdkTerminalExitCallback = () => void;
export type SessionModeCallback = (mode: 'sdk' | 'pty') => void;

let eventWs: WebSocket | null = null;
let ptyWs: WebSocket | null = null;
let pendingPtySocket: WebSocket | null = null;
let sdkWs: WebSocket | null = null;
const MAX_RECONNECT_ATTEMPTS = 30;

// Per-connection reconnect state (not shared between PTY and SDK)
let ptyReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let ptyReconnectAttempt = 0;
let sdkReconnectAttempt = 0;

export function connectEventSocket(onMessage: EventCallback): void {
  if (eventWs) { eventWs.close(); eventWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/events';
  eventWs = new WebSocket(url);

  eventWs.onmessage = (event) => {
    try { onMessage(JSON.parse(event.data as string)); } catch { /* ignore parse errors */ }
  };

  eventWs.onclose = () => {
    setTimeout(() => connectEventSocket(onMessage), 3000);
  };

  eventWs.onerror = () => {};
}

export function connectPtySocket(
  sessionId: string,
  term: Terminal,
  onResize: () => void,
  onSessionEnd: () => void,
): void {
  if (ptyReconnectTimer) { clearTimeout(ptyReconnectTimer); ptyReconnectTimer = null; }
  ptyReconnectAttempt = 0;

  // Close any socket still in CONNECTING state from a previous call
  if (pendingPtySocket) {
    pendingPtySocket.onopen = null;
    pendingPtySocket.onmessage = null;
    pendingPtySocket.onclose = null;
    pendingPtySocket.onerror = null;
    pendingPtySocket.close();
    pendingPtySocket = null;
  }

  if (ptyWs) { ptyWs.onclose = null; ptyWs.close(); ptyWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  const socket = new WebSocket(url);
  pendingPtySocket = socket;

  socket.onopen = () => {
    pendingPtySocket = null;
    ptyWs = socket;
    ptyReconnectAttempt = 0;
    onResize();
  };

  socket.onmessage = (event) => { term.write(event.data as string); };

  socket.onclose = (event) => {
    // Clear pending ref if this socket closed before onopen
    if (pendingPtySocket === socket) pendingPtySocket = null;
    // If this socket was superseded, ignore its close event
    if (pendingPtySocket !== socket && ptyWs !== socket) return;
    if (event.code === 1000) {
      term.write('\r\n[Session ended]\r\n');
      ptyWs = null;
      onSessionEnd();
      return;
    }
    ptyWs = null;
    if (ptyReconnectAttempt === 0) term.write('\r\n[Reconnecting...]\r\n');
    scheduleReconnect(sessionId, term, onResize, onSessionEnd);
  };

  socket.onerror = () => {};
}

function scheduleReconnect(
  sessionId: string,
  term: Terminal,
  onResize: () => void,
  onSessionEnd: () => void,
): void {
  if (ptyReconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    term.write('\r\n[Gave up reconnecting after ' + MAX_RECONNECT_ATTEMPTS + ' attempts]\r\n');
    return;
  }
  const delay = Math.min(1000 * 2 ** ptyReconnectAttempt, 10000);
  ptyReconnectAttempt++;

  ptyReconnectTimer = setTimeout(async () => {
    ptyReconnectTimer = null;
    try {
      const res = await fetch('/sessions');
      const sessionList = await res.json() as Array<{ id: string }>;
      if (!sessionList.some(s => s.id === sessionId)) {
        term.write('\r\n[Session ended]\r\n');
        onSessionEnd();
        return;
      }
      term.clear();
      connectPtySocket(sessionId, term, onResize, onSessionEnd);
    } catch {
      scheduleReconnect(sessionId, term, onResize, onSessionEnd);
    }
  }, delay);
}

export function sendPtyData(data: string): void {
  if (ptyWs && ptyWs.readyState === WebSocket.OPEN) ptyWs.send(data);
}

export function sendPtyResize(cols: number, rows: number): void {
  if (ptyWs && ptyWs.readyState === WebSocket.OPEN) {
    ptyWs.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

export function isPtyConnected(): boolean {
  return ptyWs !== null && ptyWs.readyState === WebSocket.OPEN;
}

// ── SDK WebSocket ──────────────────────────────────────────────────────────

export interface SdkSocketCallbacks {
  onEvent: SdkMessageCallback;
  onTerminalData?: SdkTerminalDataCallback | undefined;
  onTerminalExit?: SdkTerminalExitCallback | undefined;
  onSessionEnd: () => void;
}

let sdkCallbacksRef: SdkSocketCallbacks | null = null;

export function connectSdkSocket(
  sessionId: string,
  callbacks: SdkSocketCallbacks,
): void {
  if (sdkWs) { sdkWs.onclose = null; sdkWs.close(); sdkWs = null; }
  sdkReconnectAttempt = 0;
  sdkCallbacksRef = callbacks;

  const url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  const socket = new WebSocket(url);

  socket.onopen = () => {
    sdkWs = socket;
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      // Skip session_info frame (protocol negotiation)
      if (data.type === 'session_info') return;
      // Companion terminal data
      if (data.type === 'terminal_data') {
        sdkCallbacksRef?.onTerminalData?.(data.data as string);
        return;
      }
      if (data.type === 'terminal_exit') {
        sdkCallbacksRef?.onTerminalExit?.();
        return;
      }
      // SDK event
      sdkCallbacksRef?.onEvent(data as SdkEvent);
    } catch {
      // Not JSON — ignore for SDK mode
    }
  };

  socket.onclose = (event) => {
    sdkWs = null;
    if (event.code === 1000) {
      callbacks.onSessionEnd();
      return;
    }
    // Reconnect logic for SDK
    scheduleSdkReconnect(sessionId, callbacks);
  };

  socket.onerror = () => {};
}

function scheduleSdkReconnect(
  sessionId: string,
  callbacks: SdkSocketCallbacks,
): void {
  if (sdkReconnectAttempt >= MAX_RECONNECT_ATTEMPTS) return;
  const delay = Math.min(1000 * 2 ** sdkReconnectAttempt, 10000);
  sdkReconnectAttempt++;
  setTimeout(() => {
    connectSdkSocket(sessionId, callbacks);
  }, delay);
}

export function sendSdkMessage(text: string): void {
  if (sdkWs && sdkWs.readyState === WebSocket.OPEN) {
    sdkWs.send(JSON.stringify({ type: 'message', text }));
  }
}

export function sendPermissionResponse(requestId: string, approved: boolean): void {
  if (sdkWs && sdkWs.readyState === WebSocket.OPEN) {
    sdkWs.send(JSON.stringify({ type: 'permission', requestId, approved }));
  }
}

export function sendOpenCompanion(): void {
  if (sdkWs && sdkWs.readyState === WebSocket.OPEN) {
    sdkWs.send(JSON.stringify({ type: 'open_companion' }));
  }
}

export function isSdkConnected(): boolean {
  return sdkWs !== null && sdkWs.readyState === WebSocket.OPEN;
}

// ── Session mode detection ─────────────────────────────────────────────────

export function connectSessionSocket(
  sessionId: string,
  term: Terminal,
  onResize: () => void,
  onSessionEnd: () => void,
  onModeDetected: SessionModeCallback,
  sdkCallbacks: SdkSocketCallbacks,
): void {
  if (ptyReconnectTimer) { clearTimeout(ptyReconnectTimer); ptyReconnectTimer = null; }
  ptyReconnectAttempt = 0;
  sdkReconnectAttempt = 0;

  // Close any existing connections
  if (ptyWs) { ptyWs.onclose = null; ptyWs.close(); ptyWs = null; }
  if (sdkWs) { sdkWs.onclose = null; sdkWs.close(); sdkWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  const socket = new WebSocket(url);
  let modeDetected = false;

  socket.onopen = () => {
    ptyReconnectAttempt = 0;
    sdkReconnectAttempt = 0;
  };

  socket.onmessage = (event) => {
    if (!modeDetected) {
      // Try to parse first message as session_info
      try {
        const data = JSON.parse(event.data as string) as { type: string; mode?: string };
        if (data.type === 'session_info' && data.mode === 'sdk') {
          modeDetected = true;
          sdkWs = socket;
          sdkCallbacksRef = sdkCallbacks;
          // Re-wire to SDK handler
          socket.onmessage = (e) => {
            try {
              const d = JSON.parse(e.data as string);
              if (d.type === 'session_info') return;
              if (d.type === 'terminal_data') {
                sdkCallbacksRef?.onTerminalData?.(d.data as string);
                return;
              }
              if (d.type === 'terminal_exit') {
                sdkCallbacksRef?.onTerminalExit?.();
                return;
              }
              sdkCallbacksRef?.onEvent(d as SdkEvent);
            } catch { /* ignore */ }
          };
          socket.onclose = (closeEvent) => {
            sdkWs = null;
            if (closeEvent.code === 1000) {
              sdkCallbacks.onSessionEnd();
              return;
            }
            scheduleSdkReconnect(sessionId, sdkCallbacks);
          };
          onModeDetected('sdk');
          return;
        }
      } catch {
        // Not JSON — this is PTY raw data
      }
      // Fall through to PTY mode
      modeDetected = true;
      ptyWs = socket;
      socket.onmessage = (e) => { term.write(e.data as string); };
      socket.onclose = (closeEvent) => {
        if (closeEvent.code === 1000) {
          term.write('\r\n[Session ended]\r\n');
          ptyWs = null;
          onSessionEnd();
          return;
        }
        ptyWs = null;
        if (ptyReconnectAttempt === 0) term.write('\r\n[Reconnecting...]\r\n');
        scheduleReconnect(sessionId, term, onResize, onSessionEnd);
      };
      onModeDetected('pty');
      // Write the first message (it was raw PTY data)
      term.write(event.data as string);
      onResize();
      return;
    }
  };

  socket.onerror = () => {};
}
