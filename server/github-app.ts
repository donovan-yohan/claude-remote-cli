import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';

import { loadConfig, saveConfig } from './config.js';
import type { Config } from './types.js';

// Deps type

export interface GitHubAppDeps {
  configPath: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof globalThis.fetch;
  onConnected?: () => void;
}

// CSRF state store: state value → expiry timestamp
const csrfStateStore = new Map<string, number>();
const CSRF_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, expiry] of csrfStateStore) {
    if (now > expiry) csrfStateStore.delete(state);
  }
}

/**
 * Creates and returns an Express Router that handles all /auth/github routes.
 *
 * Caller is responsible for mounting and applying auth middleware:
 *   app.use('/auth/github', requireAuth, createGitHubAppRouter({ configPath, clientId, clientSecret }));
 * The callback route must be mounted separately without auth:
 *   app.get('/auth/github/callback', ...) — handled by mounting this router at /auth/github/callback
 *   with the callback route at GET /
 */
export function createGitHubAppRouter(deps: GitHubAppDeps): Router {
  const { configPath, clientId, clientSecret } = deps;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;

  const router = Router();

  function getConfig(): Config {
    return loadConfig(configPath);
  }

  // GET / — Returns JSON { url } with the GitHub OAuth authorization URL
  // No redirect_uri — uses the GitHub App's configured callback URL
  router.get('/', (_req: Request, res: Response) => {
    pruneExpiredStates();
    const state = crypto.randomBytes(16).toString('hex');
    csrfStateStore.set(state, Date.now() + CSRF_STATE_TTL_MS);
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'repo',
      state,
    });
    const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
    res.json({ url });
  });

  // GET /callback — Exchange auth code for token
  // Also reachable at GET / when this router is mounted at /auth/github/callback
  router.get('/callback', async (req: Request, res: Response) => {
    const code = req.query['code'];
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    // Validate CSRF state
    const state = req.query['state'];
    if (!state || typeof state !== 'string' || !csrfStateStore.has(state)) {
      res.status(400).json({ error: 'Invalid or missing state parameter' });
      return;
    }
    csrfStateStore.delete(state);

    // Exchange code for access token
    let accessToken: string;
    try {
      const tokenRes = await fetchFn('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      if (!tokenRes.ok) {
        res.status(500).json({ error: 'Failed to exchange code for token' });
        return;
      }

      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        res.status(400).json({ error: tokenData.error ?? 'No access_token in response' });
        return;
      }
      accessToken = tokenData.access_token;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Token exchange failed: ${msg}` });
      return;
    }

    // Fetch username via GraphQL
    let username: string;
    try {
      const gqlRes = await fetchFn('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '{ viewer { login } }' }),
      });

      if (!gqlRes.ok) {
        res.status(500).json({ error: 'Failed to fetch GitHub username' });
        return;
      }

      const gqlData = await gqlRes.json() as { data?: { viewer?: { login?: string } } };
      const login = gqlData.data?.viewer?.login;
      if (!login) {
        res.status(500).json({ error: 'No username in GraphQL response' });
        return;
      }
      username = login;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Username fetch failed: ${msg}` });
      return;
    }

    // Save token + username to config
    const config = getConfig();
    config.github = {
      ...config.github,
      accessToken,
      username,
    };
    saveConfig(configPath, config);

    // Notify caller that connection is established (e.g. start webhook polling)
    deps.onConnected?.();

    // Return HTML page that auto-closes
    res.setHeader('Content-Type', 'text/html');
    res.send('<script>window.close();</script>');
  });

  // GET /status — Return { connected, username } from config
  router.get('/status', (_req: Request, res: Response) => {
    const config = getConfig();
    const github = config.github;
    const connected = Boolean(github?.accessToken);
    const username = github?.username ?? null;
    res.json({ connected, username });
  });

  // POST /disconnect — Delete config.github and return { ok: true }
  router.post('/disconnect', (_req: Request, res: Response) => {
    const config = getConfig();
    delete config.github;
    saveConfig(configPath, config);
    res.json({ ok: true });
  });

  return router;
}
