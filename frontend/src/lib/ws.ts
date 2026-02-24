import type { Terminal } from '@xterm/xterm';

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

type EventCallback = (msg: { type: string; sessionId?: string; idle?: boolean }) => void;

let eventWs: WebSocket | null = null;
let ptyWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 30;

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
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;

  if (ptyWs) { ptyWs.onclose = null; ptyWs.close(); ptyWs = null; }

  const url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
  const socket = new WebSocket(url);

  socket.onopen = () => {
    ptyWs = socket;
    reconnectAttempt = 0;
    onResize();
  };

  socket.onmessage = (event) => { term.write(event.data as string); };

  socket.onclose = (event) => {
    if (event.code === 1000) {
      term.write('\r\n[Session ended]\r\n');
      ptyWs = null;
      onSessionEnd();
      return;
    }
    ptyWs = null;
    if (reconnectAttempt === 0) term.write('\r\n[Reconnecting...]\r\n');
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
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    term.write('\r\n[Gave up reconnecting after ' + MAX_RECONNECT_ATTEMPTS + ' attempts]\r\n');
    return;
  }
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
  reconnectAttempt++;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
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
