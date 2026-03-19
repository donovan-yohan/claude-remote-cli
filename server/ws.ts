import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IPty } from 'node-pty';
import * as sessions from './sessions.js';
import { WorktreeWatcher } from './watcher.js';
import type { Session } from './types.js';
import { writeMeta } from './config.js';
import { branchToDisplayName } from './git.js';

const execFileAsync = promisify(execFile);

const BRANCH_POLL_INTERVAL_MS = 3000;
const BRANCH_POLL_MAX_ATTEMPTS = 10;


function startBranchWatcher(
  session: Session,
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void,
  cfgPath: string,
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
        const displayName = branchToDisplayName(currentBranch);
        session.branchName = currentBranch;
        session.displayName = displayName;
        broadcastEvent('session-renamed', { sessionId: session.id, branchName: currentBranch, displayName });
        writeMeta(cfgPath, {
          worktreePath: session.repoPath,
          displayName,
          lastActivity: new Date().toISOString(),
          branchName: currentBranch,
        });
      }
    } catch {
      // git command failed — session cwd may not exist yet, retry
    }
  }, BRANCH_POLL_INTERVAL_MS);
}

/** Sideband branch rename: uses headless claude to generate a branch name from the first message */
async function spawnBranchRename(
  session: Session,
  firstMessage: string,
  cfgPath: string | undefined,
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  try {
    const prompt = `Output ONLY a short kebab-case git branch name (no explanation, no backticks, no prefix, just the name) that describes this task:\n\n${firstMessage.slice(0, 500)}`;
    const { stdout } = await execFileAsync('claude', ['-p', '--model', 'haiku', prompt], {
      cwd: session.cwd,
      timeout: 30000,
    });
    const branchName = stdout.trim().replace(/`/g, '').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
    if (!branchName) return;

    await execFileAsync('git', ['branch', '-m', branchName], { cwd: session.cwd });

    // Update session state
    const displayName = branchToDisplayName(branchName);
    session.branchName = branchName;
    session.displayName = displayName;
    broadcastEvent('session-renamed', {
      sessionId: session.id,
      branchName,
      displayName,
    });

    if (cfgPath) {
      writeMeta(cfgPath, {
        worktreePath: session.repoPath,
        displayName,
        lastActivity: new Date().toISOString(),
        branchName,
      });
    }
  } catch {
    // Sideband rename is best-effort — fall back to branch watcher if claude CLI isn't available
    if (cfgPath) startBranchWatcher(session, broadcastEvent, cfgPath);
  }
}

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

function setupWebSocket(server: http.Server, authenticatedTokens: Set<string>, watcher: WorktreeWatcher | null, configPath?: string): { wss: WebSocketServer; broadcastEvent: (type: string, data?: Record<string, unknown>) => void } {
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

      // Sideband branch rename: capture first message, pass through unmodified, rename out-of-band
      if (ptySession.needsBranchRename) {
        if (!(ptySession as any)._renameBuffer) (ptySession as any)._renameBuffer = '';
        const enterIndex = str.indexOf('\r');
        if (enterIndex === -1) {
          (ptySession as any)._renameBuffer += str;
          ptySession.pty.write(str); // pass through to PTY normally — user sees their typing
          return;
        }
        // Enter detected — pass everything through unmodified
        const buffered: string = (ptySession as any)._renameBuffer;
        const firstMessage = buffered + str.slice(0, enterIndex);
        ptySession.pty.write(str); // pass through the Enter key
        ptySession.needsBranchRename = false;
        delete (ptySession as any)._renameBuffer;

        // Sideband: spawn headless claude to generate branch name (async, non-blocking)
        spawnBranchRename(ptySession, firstMessage, configPath, broadcastEvent);
        return;
      }

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

  sessions.onIdleChange((sessionId, idle) => {
    broadcastEvent('session-idle-changed', { sessionId, idle });
  });

  sessions.onStateChange((sessionId, state) => {
    broadcastEvent('session-state-changed', { sessionId, state });
  });

  sessions.onSessionEnd((sessionId, repoPath, branchName) => {
    broadcastEvent('session-ended', { sessionId, repoPath, branchName });
  });

  return { wss, broadcastEvent };
}

export { setupWebSocket };
