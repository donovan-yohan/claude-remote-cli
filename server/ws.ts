import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import type { IPty } from 'node-pty';
import * as sessions from './sessions.js';
import { WorktreeWatcher } from './watcher.js';
import type { Session } from './types.js';

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

    // PTY channel: /ws/:sessionId
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

    let dataDisposable: { dispose(): void } | null = null;
    let exitDisposable: { dispose(): void } | null = null;

    function attachToPty(ptyProcess: IPty): void {
      // Dispose previous handlers
      dataDisposable?.dispose();
      exitDisposable?.dispose();

      // Replay scrollback
      for (const chunk of session!.scrollback) {
        if (ws.readyState === ws.OPEN) ws.send(chunk);
      }

      dataDisposable = ptyProcess.onData((data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });

      exitDisposable = ptyProcess.onExit(() => {
        if (ws.readyState === ws.OPEN) ws.close(1000);
      });
    }

    attachToPty(session.pty);

    const ptyReplacedHandler = (newPty: IPty) => attachToPty(newPty);
    session.onPtyReplacedCallbacks.push(ptyReplacedHandler);

    ws.on('message', (msg) => {
      const str = msg.toString();
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          sessions.resize(session.id, parsed.cols, parsed.rows);
          return;
        }
      } catch (_) {}

      // Branch rename interception: prepend rename prompt before the user's first message
      if (session.needsBranchRename) {
        if (!(session as any)._renameBuffer) (session as any)._renameBuffer = '';
        const enterIndex = str.indexOf('\r');
        if (enterIndex === -1) {
          // No Enter yet — buffer and pass through so the user sees echo
          (session as any)._renameBuffer += str;
          session.pty.write(str);
          return;
        }
        // Enter detected — inject rename prompt before the user's message
        const buffered: string = (session as any)._renameBuffer;
        const beforeEnter = buffered + str.slice(0, enterIndex);
        const afterEnter = str.slice(enterIndex); // includes the \r
        const renamePrompt = `Before doing anything else, rename the current git branch using \`git branch -m <new-name>\`. Choose a short, descriptive kebab-case branch name based on the task below.${session.branchRenamePrompt ? ' User preferences: ' + session.branchRenamePrompt : ''} Do not ask for confirmation — just rename and proceed.\n\n`;
        const clearLine = '\x15'; // Ctrl+U clears the current input line
        session.pty.write(clearLine + renamePrompt + beforeEnter + afterEnter);
        session.needsBranchRename = false;
        delete (session as any)._renameBuffer;
        return;
      }

      // Use session.pty dynamically so writes go to current PTY
      session.pty.write(str);
    });

    ws.on('close', () => {
      dataDisposable?.dispose();
      exitDisposable?.dispose();
      const idx = session.onPtyReplacedCallbacks.indexOf(ptyReplacedHandler);
      if (idx !== -1) session.onPtyReplacedCallbacks.splice(idx, 1);
    });
  });

  sessions.onIdleChange((sessionId, idle) => {
    broadcastEvent('session-idle-changed', { sessionId, idle });
  });

  return { wss, broadcastEvent };
}

export { setupWebSocket };
