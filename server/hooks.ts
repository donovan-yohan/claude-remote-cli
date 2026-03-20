import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Router } from 'express';
import express from 'express';
import type { Request, Response } from 'express';

import type { Session } from './types.js';
import type { AgentState } from './output-parsers/index.js';
import { stripAnsi, cleanEnv } from './utils.js';
import { branchToDisplayName } from './git.js';
import { writeMeta } from './config.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCALHOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const DEFAULT_RENAME_PROMPT =
  'Output ONLY a short kebab-case git branch name (no explanation, no backticks, no prefix, just the name) that describes this task:';
const RENAME_RETRY_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Deps type
// ---------------------------------------------------------------------------

export interface HookDeps {
  getSession: (id: string) => Session | undefined;
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void;
  fireStateChange: (sessionId: string, state: AgentState) => void;
  notifySessionAttention: (sessionId: string, session: { displayName: string; type: string }) => void;
  configPath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setAgentState(session: Session, state: AgentState, deps: HookDeps): void {
  session.agentState = state;
  deps.fireStateChange(session.id, state);
  session._lastHookTime = Date.now();
}

function extractToolDetail(_toolName: string, toolInput: unknown): string | undefined {
  if (toolInput && typeof toolInput === 'object') {
    const input = toolInput as Record<string, unknown>;
    if (typeof input.file_path === 'string') return input.file_path;
    if (typeof input.path === 'string') return input.path;
    if (typeof input.command === 'string') return input.command.slice(0, 80);
  }
  return undefined;
}

async function spawnBranchRename(
  session: Session,
  promptText: string,
  deps: HookDeps,
): Promise<void> {
  const cleanedPrompt = stripAnsi(promptText).slice(0, 500);
  const renamePrompt = session.branchRenamePrompt ?? DEFAULT_RENAME_PROMPT;
  const fullPrompt = renamePrompt + '\n\n' + cleanedPrompt;
  const env = cleanEnv();

  for (let attempt = 0; attempt < 2; attempt++) {
    // Check session still exists before attempting
    if (!deps.getSession(session.id)) return;

    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
      // Re-check after delay
      if (!deps.getSession(session.id)) return;
    }

    try {
      const { stdout } = await execFileAsync(
        'claude',
        ['-p', '--model', 'haiku', fullPrompt],
        { cwd: session.cwd, timeout: 30000, env },
      );

      // Sanitize output
      let branchName = stdout
        .replace(/`/g, '')
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60);

      if (!branchName) continue;

      // Check session still exists before renaming
      if (!deps.getSession(session.id)) return;

      await execFileAsync('git', ['branch', '-m', branchName], { cwd: session.cwd });

      session.branchName = branchName;
      session.displayName = branchToDisplayName(branchName);
      deps.broadcastEvent('session-renamed', { sessionId: session.id });

      if (deps.configPath) {
        writeMeta(deps.configPath, {
          worktreePath: session.repoPath,
          displayName: session.displayName,
          lastActivity: session.lastActivity,
          branchName: session.branchName,
        });
      }

      return; // success
    } catch (err) {
      if (attempt === 1) {
        console.error('[hooks] branch rename failed after 2 attempts:', err);
        session.needsBranchRename = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHooksRouter(deps: HookDeps): Router {
  const router = Router();

  // Middleware: parse JSON with generous limit for PostToolUse payloads
  router.use(express.json({ limit: '5mb' }));

  // Middleware: IP allowlist — only localhost, do NOT trust X-Forwarded-For
  router.use((req: Request, res: Response, next) => {
    const remoteAddr = req.socket.remoteAddress;
    if (!remoteAddr || !LOCALHOST_ADDRS.has(remoteAddr)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });

  // Middleware: token verification
  router.use((req: Request, res: Response, next) => {
    const sessionId = req.query.sessionId;
    const token = req.query.token;

    if (typeof sessionId !== 'string' || !sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    if (typeof token !== 'string' || !token) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }

    const session = deps.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const tokenBuf = Buffer.from(token);
    const hookTokenBuf = Buffer.from(session.hookToken);
    if (tokenBuf.length !== hookTokenBuf.length || !crypto.timingSafeEqual(tokenBuf, hookTokenBuf)) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }

    (req as unknown as Record<string, unknown>)._hookSession = session;
    next();
  });

  // ---------------------------------------------------------------------------
  // Route handlers
  // ---------------------------------------------------------------------------

  // POST /stop → idle
  router.post('/stop', (req: Request, res: Response) => {
    const session = (req as unknown as Record<string, unknown>)._hookSession as Session;
    setAgentState(session, 'idle', deps);
    res.json({ ok: true });
  });

  // POST /notification → permission-prompt | waiting-for-input
  router.post('/notification', (req: Request, res: Response) => {
    const session = (req as unknown as Record<string, unknown>)._hookSession as Session;
    const type = req.query.type;

    if (type === 'permission_prompt') {
      setAgentState(session, 'permission-prompt', deps);
      session.lastAttentionNotifiedAt = Date.now();
      deps.notifySessionAttention(session.id, { displayName: session.displayName, type: session.type });
    } else if (type === 'idle_prompt') {
      setAgentState(session, 'waiting-for-input', deps);
      session.lastAttentionNotifiedAt = Date.now();
      deps.notifySessionAttention(session.id, { displayName: session.displayName, type: session.type });
    }

    res.json({ ok: true });
  });

  // POST /prompt-submit → processing (+ optional branch rename on first message)
  router.post('/prompt-submit', (req: Request, res: Response) => {
    const session = (req as unknown as Record<string, unknown>)._hookSession as Session;
    setAgentState(session, 'processing', deps);

    if (session.needsBranchRename === true) {
      session.needsBranchRename = false;
      const promptText: string = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
      spawnBranchRename(session, promptText, deps).catch((err) => {
        console.error('[hooks] spawnBranchRename error:', err);
      });
    }

    res.json({ ok: true });
  });

  // POST /session-end → mark cleaned up (PTY onExit handles actual cleanup)
  router.post('/session-end', (req: Request, res: Response) => {
    const session = (req as unknown as Record<string, unknown>)._hookSession as Session;
    if (!session.cleanedUp) {
      session.cleanedUp = true;
    }
    res.json({ ok: true });
  });

  // POST /tool-use → set currentActivity
  router.post('/tool-use', (req: Request, res: Response) => {
    const session = (req as unknown as Record<string, unknown>)._hookSession as Session;
    const body = req.body as Record<string, unknown> | undefined;
    const toolName = typeof body?.tool_name === 'string' ? body.tool_name : '';
    const toolInput = body?.tool_input;
    const detail = extractToolDetail(toolName, toolInput);
    session.currentActivity = detail !== undefined ? { tool: toolName, detail } : { tool: toolName };
    deps.broadcastEvent('session-activity-changed', { sessionId: session.id });
    res.json({ ok: true });
  });

  // POST /tool-result → clear currentActivity
  router.post('/tool-result', (req: Request, res: Response) => {
    const session = (req as unknown as Record<string, unknown>)._hookSession as Session;
    session.currentActivity = undefined;
    deps.broadcastEvent('session-activity-changed', { sessionId: session.id });
    res.json({ ok: true });
  });

  return router;
}
