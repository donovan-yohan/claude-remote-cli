import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';

import { createGitHubAppRouter } from '../server/github-app.js';
import { saveConfig, DEFAULTS } from '../server/config.js';

// ── Shared state ─────────────────────────────────────────────────────────────

let tmpDir: string;
let configPath: string;

/** Server using real fetch (no GitHub calls in these tests — just the status/URL tests) */
let server: Server;
let baseUrl: string;

/** Separate server with a mock fetchFn for callback tests */
let mockServer: Server;
let mockBaseUrl: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

function startServer(opts: {
  fetchFn?: typeof globalThis.fetch;
} = {}): Promise<{ srv: Server; url: string }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    const routerDeps = opts.fetchFn
      ? { configPath, clientId: 'test-client-id', clientSecret: 'test-client-secret', fetchFn: opts.fetchFn }
      : { configPath, clientId: 'test-client-id', clientSecret: 'test-client-secret' };
    app.use('/auth/github', createGitHubAppRouter(routerDeps));
    const srv = app.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      let url = '';
      if (typeof addr === 'object' && addr) {
        url = `http://127.0.0.1:${addr.port}`;
      }
      resolve({ srv, url });
    });
  });
}

function stopServer(srv: Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (srv) srv.close(() => resolve());
    else resolve();
  });
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-app-test-'));
  configPath = path.join(tmpDir, 'config.json');
  saveConfig(configPath, { ...DEFAULTS });

  // Start the default server (no mock fetch needed for URL/status tests)
  const result = await startServer();
  server = result.srv;
  baseUrl = result.url;
});

after(async () => {
  await stopServer(server);
  await stopServer(mockServer);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GET /auth/github returns URL containing github.com/login/oauth/authorize and client_id', async () => {
  const res = await fetch(`${baseUrl}/auth/github`);
  assert.equal(res.status, 200);

  const data = await res.json() as { url?: string };
  assert.ok(data.url, 'Response should have a url field');
  assert.ok(
    data.url.includes('github.com/login/oauth/authorize'),
    `URL should contain github.com/login/oauth/authorize, got: ${data.url}`,
  );
  assert.ok(
    data.url.includes('client_id=test-client-id'),
    `URL should contain client_id, got: ${data.url}`,
  );
});

test('GET /auth/github/status returns { connected: false } when no token', async () => {
  const res = await fetch(`${baseUrl}/auth/github/status`);
  assert.equal(res.status, 200);

  const data = await res.json() as { connected: boolean; username: string | null };
  assert.equal(data.connected, false);
  // username may be null or undefined
  assert.ok(data.username === null || data.username === undefined, 'username should be null when not connected');
});

test('GET /auth/github/callback?code=test-code exchanges code and saves token to config', async () => {
  // Build a mock fetchFn that returns a token on POST to access_token,
  // and a username on POST to graphql
  const mockFetch: typeof globalThis.fetch = async (input, _init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    if (url.includes('login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'ghs_mock_token_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('api.github.com/graphql')) {
      return new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  };

  // Use a fresh config file so this test is isolated
  const callbackConfigPath = path.join(tmpDir, 'callback-config.json');
  saveConfig(callbackConfigPath, { ...DEFAULTS });

  // Start a separate server with mock fetch and fresh config
  const mockApp = express();
  mockApp.use(express.json());
  mockApp.use('/auth/github', createGitHubAppRouter({
    configPath: callbackConfigPath,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    fetchFn: mockFetch,
  }));

  const { srv, url } = await new Promise<{ srv: Server; url: string }>((resolve) => {
    const srv = mockApp.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      let u = '';
      if (typeof addr === 'object' && addr) u = `http://127.0.0.1:${addr.port}`;
      resolve({ srv, url: u });
    });
  });
  mockServer = srv;
  mockBaseUrl = url;

  const res = await fetch(`${mockBaseUrl}/auth/github/callback?code=test-code`);
  assert.equal(res.status, 200);

  const body = await res.text();
  assert.ok(body.includes('window.close()'), 'Response should contain auto-close script');

  // Verify token was saved to config
  const savedConfig = JSON.parse(fs.readFileSync(callbackConfigPath, 'utf8')) as {
    github?: { accessToken?: string; username?: string };
  };
  assert.equal(savedConfig.github?.accessToken, 'ghs_mock_token_123');
  assert.equal(savedConfig.github?.username, 'octocat');
});

test('GET /auth/github/status returns { connected: true, username: "octocat" } after callback', async () => {
  // mockBaseUrl/mockServer were set up in the previous test; reuse them
  assert.ok(mockBaseUrl, 'mockBaseUrl should be set from previous test');

  const res = await fetch(`${mockBaseUrl}/auth/github/status`);
  assert.equal(res.status, 200);

  const data = await res.json() as { connected: boolean; username: string | null };
  assert.equal(data.connected, true);
  assert.equal(data.username, 'octocat');
});
