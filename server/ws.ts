import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import type { IPty } from 'node-pty';
import * as sessions from './sessions.js';
import { WorktreeWatcher } from './watcher.js';
import type { Session, SdkSession } from './types.js';
import { onSdkEvent, sendMessage as sdkSendMessage, handlePermission as sdkHandlePermission } from './sdk-handler.js';

const BACKPRESSURE_HIGH = 1024 * 1024; // 1MB
const BACKPRESSURE_LOW = 512 * 1024; // 512KB

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function setupWebSocket(server: http.Server, authenticatedTokens: Set<string>, watcher: WorktreeWatcher | null): { wss: WebSocketServer; broadcastEvent: (type: string, data?: Record<string, unknown>) => void } {
  const wss = new WebSocketServer({ noServer: true });
  const eventClients = new Set<WebSocket>();

  function broadcastEvent(type: string, data?: Record<string, unknown>): void {
    const msg = JSON.stringify({ type, ...data });
    for (const client of eventClients) {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    }
  }

  if (watcher) {
    watcher.on('worktrees-changed', function () {
      broadcastEvent('worktrees-changed');
    });
  }

  server.on('upgrade', (request, socket, head) => {
    const cookies = parseCookies(request.headers.cookie);
    if (!authenticatedTokens.has(cookies['token'] ?? '')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Event channel: /ws/events
    if (request.url === '/ws/events') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const cleanup = () => { eventClients.delete(ws); };
        eventClients.add(ws);
        ws.on('close', cleanup);
        ws.on('error', cleanup);
      });
      return;
    }

    // PTY/SDK channel: /ws/:sessionId
    const match = request.url && request.url.match(/^\/ws\/([a-f0-9]+)$/);
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = match[1]!;
    const session = sessions.get(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      sessionMap.set(ws, session);
      wss.emit('connection', ws, request);
    });
  });

  const sessionMap = new WeakMap<WebSocket, Session>();

  wss.on('connection', (ws: WebSocket, _request: http.IncomingMessage) => {
    const session = sessionMap.get(ws);
    if (!session) return;

    if (session.mode === 'sdk') {
      handleSdkConnection(ws, session);
      return;
    }

    // PTY mode — existing behavior
    if (session.mode !== 'pty') {
      ws.close(1008, 'Session mode does not support PTY streaming');
      return;
    }

    const ptySession = session;

    let dataDisposable: { dispose(): void } | null = null;
    let exitDisposable: { dispose(): void } | null = null;

    function attachToPty(ptyProcess: IPty): void {
      // Dispose previous handlers
      dataDisposable?.dispose();
      exitDisposable?.dispose();

      // Replay scrollback
      for (const chunk of ptySession.scrollback) {
        if (ws.readyState === ws.OPEN) ws.send(chunk);
      }

      dataDisposable = ptyProcess.onData((data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });

      exitDisposable = ptyProcess.onExit(() => {
        if (ws.readyState === ws.OPEN) ws.close(1000);
      });
    }

    attachToPty(ptySession.pty);

    const ptyReplacedHandler = (newPty: IPty) => attachToPty(newPty);
    ptySession.onPtyReplacedCallbacks.push(ptyReplacedHandler);

    ws.on('message', (msg) => {
      const str = msg.toString();
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          sessions.resize(ptySession.id, parsed.cols, parsed.rows);
          return;
        }
      } catch (_) {}
      // Use ptySession.pty dynamically so writes go to current PTY
      ptySession.pty.write(str);
    });

    ws.on('close', () => {
      dataDisposable?.dispose();
      exitDisposable?.dispose();
      const idx = ptySession.onPtyReplacedCallbacks.indexOf(ptyReplacedHandler);
      if (idx !== -1) ptySession.onPtyReplacedCallbacks.splice(idx, 1);
    });
  });

  function handleSdkConnection(ws: WebSocket, session: SdkSession): void {
    // Send session info
    const sessionInfo = JSON.stringify({
      type: 'session_info',
      mode: 'sdk',
      sessionId: session.id,
    });
    if (ws.readyState === ws.OPEN) ws.send(sessionInfo);

    // Replay stored events
    for (const event of session.events) {
      if (ws.readyState !== ws.OPEN) break;
      ws.send(JSON.stringify({ type: 'sdk_event', event }));
    }

    // Subscribe to live events with backpressure
    let paused = false;

    const unsubscribe = onSdkEvent(session.id, (event) => {
      if (ws.readyState !== ws.OPEN) return;

      // Backpressure check
      if (ws.bufferedAmount > BACKPRESSURE_HIGH) {
        paused = true;
        return;
      }

      ws.send(JSON.stringify({ type: 'sdk_event', event }));
    });

    // Periodically check if we can resume
    const backpressureInterval = setInterval(() => {
      if (paused && ws.bufferedAmount < BACKPRESSURE_LOW) {
        paused = false;
      }
    }, 100);

    // Handle incoming messages
    ws.on('message', (msg) => {
      const str = msg.toString();
      try {
        const parsed = JSON.parse(str) as Record<string, unknown>;

        if (parsed.type === 'message' && typeof parsed.text === 'string') {
          if (parsed.text.length > 100_000) return;
          sdkSendMessage(session.id, parsed.text);
          return;
        }

        if (parsed.type === 'permission' && typeof parsed.requestId === 'string' && typeof parsed.approved === 'boolean') {
          sdkHandlePermission(session.id, parsed.requestId, parsed.approved);
          return;
        }

        if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
          // TODO: wire up companion shell — currently open_companion message is unhandled server-side
          return;
        }

        if (parsed.type === 'open_companion') {
          // TODO: spawn companion PTY in session CWD and relay via terminal_data/terminal_exit frames
          return;
        }
      } catch (_) {
        // Not JSON — ignore for SDK sessions
      }
    });

    ws.on('close', () => {
      unsubscribe();
      clearInterval(backpressureInterval);
    });

    ws.on('error', () => {
      unsubscribe();
      clearInterval(backpressureInterval);
    });
  }

  sessions.onIdleChange((sessionId, idle) => {
    broadcastEvent('session-idle-changed', { sessionId, idle });
  });

  return { wss, broadcastEvent };
}

export { setupWebSocket };
