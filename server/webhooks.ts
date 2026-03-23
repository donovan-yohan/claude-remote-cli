import crypto from 'node:crypto';

import { Router } from 'express';
import express from 'express';
import type { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Deps type
// ---------------------------------------------------------------------------

export interface WebhookDeps {
  secret: string;
  broadcastEvent: (type: string, data?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();

  // Middleware: parse JSON and preserve raw body for signature verification
  router.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as Record<string, unknown>).rawBody = buf.toString('utf8');
      },
    }),
  );

  // POST / — receive GitHub webhook events
  router.post('/', (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'];

    // Reject if signature header is missing
    if (!signature || typeof signature !== 'string') {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    // Verify signature against raw body
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as string | undefined ?? '';
    if (!verifySignature(deps.secret, rawBody, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Route based on event type
    const event = req.headers['x-github-event'];

    if (event === 'pull_request' || event === 'pull_request_review') {
      deps.broadcastEvent('pr-updated');
    } else if (event === 'check_suite' || event === 'check_run') {
      deps.broadcastEvent('ci-updated');
    }
    // Unknown events: ignore, return 200 OK

    res.json({ ok: true });
  });

  return router;
}
