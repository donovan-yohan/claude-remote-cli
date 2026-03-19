import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IPty } from 'node-pty';
import * as sessions from './sessions.js';
import { WorktreeWatcher } from './watcher.js';
import type { Session, SdkSession } from './types.js';
import { onSdkEvent, sendMessage as sdkSendMessage, handlePermission as sdkHandlePermission } from './sdk-handler.js';
import { writeMeta } from './config.js';

const execFileAsync = promisify(execFile);

const BACKPRESSURE_HIGH = 1024 * 1024; // 1MB
const BACKPRESSURE_LOW = 512 * 1024; // 512KB

const RENAME_CORE = `rename the current git branch using \`git branch -m <new-name>\` to a short, descriptive kebab-case name based on the task I'm asking about. Do not include any ticket numbers or prefixes.`;

// Prepended to the user's first message in SDK mode
const SDK_BRANCH_RENAME_INSTRUCTION = `Before responding to my message, first ${RENAME_CORE} After renaming, proceed with my request normally.\n\n`;

// Sent as a standalone first message in PTY mode, before the user types
const PTY_BRANCH_RENAME_INSTRUCTION = `When I send my next message, before responding to it, first ${RENAME_CORE} After renaming, proceed with my request normally. Reply with only "Ready." and nothing else.`;

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

const BRANCH_POLL_INTERVAL_MS = 3000;
const BRANCH_POLL_MAX_ATTEMPTS = 10;

function startBranchWatcher(
  session: Session,
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void,
  configPath: string,
): void {
  const originalBranch = session.branchName;
  let attempts = 0;

  const timer = setInterval(async () => {
    attempts++;
    if (attempts > BRANCH_POLL_MAX_ATTEMPTS) {
      clearInterval(timer);
      return;
    }

    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: session.cwd });
      const currentBranch = stdout.trim();

      if (currentBranch && currentBranch !== originalBranch) {
        clearInterval(timer);
        session.branchName = currentBranch;
        session.displayName = currentBranch;
        broadcastEvent('session-renamed', { sessionId: session.id, branchName: currentBranch, displayName: currentBranch });
        writeMeta(configPath, {
          worktreePath: session.repoPath,
          displayName: currentBranch,
          lastActivity: new Date().toISOString(),
          branchName: currentBranch,
        });
      }
    } catch {
      // git command failed — session cwd may not exist yet, retry
    }
  }, BRANCH_POLL_INTERVAL_MS);
}

function setupWebSocket(server: http.Server, authenticatedTokens: Set<string>, watcher: WorktreeWatcher | null, configPath: string): { wss: WebSocketServer; broadcastEvent: (type: string, data?: Record<string, unknown>) => void } {
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

    // For PTY sessions needing branch rename, send the rename instruction once Claude CLI is ready.
    // We watch for PTY idle (Claude shows its prompt and waits for input) as the trigger.
    let pendingIdleHandler: ((sessionId: string, idle: boolean) => void) | null = null;
    if (ptySession.needsBranchRename) {
      ptySession.needsBranchRename = false;

      const idleHandler = (sessionId: string, idle: boolean) => {
        if (idle && sessionId === ptySession.id) {
          sessions.offIdleChange(idleHandler);
          pendingIdleHandler = null;
          ptySession.pty.write(PTY_BRANCH_RENAME_INSTRUCTION + '\r');
          startBranchWatcher(ptySession, broadcastEvent, configPath);
        }
      };
      pendingIdleHandler = idleHandler;
      sessions.onIdleChange(idleHandler);
    }

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
      if (pendingIdleHandler) sessions.offIdleChange(pendingIdleHandler);
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

    // Replay stored events (send as-is — client expects raw SdkEvent shape)
    for (const event of session.events) {
      if (ws.readyState !== ws.OPEN) break;
      ws.send(JSON.stringify(event));
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

      ws.send(JSON.stringify(event));
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
          if (session.needsBranchRename) {
            session.needsBranchRename = false;
            sdkSendMessage(session.id, SDK_BRANCH_RENAME_INSTRUCTION + parsed.text);
            startBranchWatcher(session, broadcastEvent, configPath);
          } else {
            sdkSendMessage(session.id, parsed.text);
          }
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
