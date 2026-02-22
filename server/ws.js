'use strict';

const { WebSocketServer } = require('ws');
const sessions = require('./sessions');

function parseCookies(cookieHeader) {
  const cookies = {};
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

function setupWebSocket(server, authenticatedTokens, watcher) {
  const wss = new WebSocketServer({ noServer: true });
  const eventClients = new Set();

  function broadcastEvent(type) {
    const msg = JSON.stringify({ type });
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
    if (!authenticatedTokens.has(cookies.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Event channel: /ws/events
    if (request.url === '/ws/events') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        eventClients.add(ws);
        ws.on('close', () => { eventClients.delete(ws); });
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

    const sessionId = match[1];
    const session = sessions.get(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, session);
    });
  });

  wss.on('connection', (ws, request, session) => {
    const ptyProcess = session.pty;

    for (const chunk of session.scrollback) {
      ws.send(chunk);
    }

    const dataHandler = ptyProcess.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });

    ws.on('message', (msg) => {
      const str = msg.toString();
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          sessions.resize(session.id, parsed.cols, parsed.rows);
          return;
        }
      } catch (_) {}
      ptyProcess.write(str);
    });

    ws.on('close', () => {
      dataHandler.dispose();
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000);
      }
    });
  });

  return { wss, broadcastEvent };
}

module.exports = { setupWebSocket };
