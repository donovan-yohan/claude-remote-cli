import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub } from '../server/hub-lock.js';

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-hub-liveness-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('hub liveness fallback when hub.lock missing (#1587)', () => {
  it('refuses when /health answers on configured port', async () => {
    const configDir = makeTmpDir();
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected tcp addr');
    const port = addr.port;

    try {
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ port, host: '127.0.0.1' }),
        'utf8'
      );
      await expect(
        assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub(configDir, {
          configPath,
          timeoutMs: 500,
        })
      ).rejects.toThrow(/hub is listening on/);
    } finally {
      server.close();
    }
  });

  it('treats a stale hub.lock as absent and still probes /health', async () => {
    const configDir = makeTmpDir();
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected tcp addr');
    const port = addr.port;

    try {
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ port, host: '127.0.0.1' }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(configDir, 'hub.lock'),
        JSON.stringify(
          {
            pid: 999_999,
            port,
            host: '127.0.0.1',
            startedAt: new Date().toISOString(),
            hostname: os.hostname(),
          },
          null,
          2
        ) + '\n',
        'utf8'
      );
      await expect(
        assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub(configDir, {
          configPath,
          timeoutMs: 500,
        })
      ).rejects.toThrow(/hub is listening on/);
    } finally {
      server.close();
    }
  });

  it('skips the /health probe when a live hub.lock exists (refuses by lock)', async () => {
    const configDir = makeTmpDir();
    const sleeper: ChildProcess = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1_000_000)',
    ]);
    try {
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ port: 3456, host: '127.0.0.1' }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(configDir, 'hub.lock'),
        JSON.stringify(
          {
            pid: sleeper.pid,
            port: 3456,
            host: '127.0.0.1',
            startedAt: new Date().toISOString(),
            hostname: os.hostname(),
          },
          null,
          2
        ) + '\n',
        'utf8'
      );
      await expect(
        assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub(configDir, {
          configPath,
          timeoutMs: 500,
        })
      ).rejects.toThrow(/hub\.lock/);
    } finally {
      sleeper.kill('SIGKILL');
    }
  });

  it('passes when no hub.lock exists and no /health listener answers', async () => {
    const configDir = makeTmpDir();
    const configPath = path.join(configDir, 'config.json');
    // Use a port that's very unlikely to be in use in CI.
    fs.writeFileSync(configPath, JSON.stringify({ port: 54321 }), 'utf8');
    await expect(
      assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub(configDir, {
        configPath,
        timeoutMs: 200,
      })
    ).resolves.toBeUndefined();
  });

  it('uses fallbackPort when config.json is missing', async () => {
    const configDir = makeTmpDir();
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected tcp addr');
    const port = addr.port;
    try {
      const missingConfigPath = path.join(configDir, 'config.json');
      await expect(
        assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub(configDir, {
          configPath: missingConfigPath,
          fallbackPort: port,
          timeoutMs: 500,
        })
      ).rejects.toThrow(/hub is listening on/);
    } finally {
      server.close();
    }
  });

  it('does not refuse on an unrelated listener when fallbackPort points elsewhere', async () => {
    const configDir = makeTmpDir();
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected tcp addr');
    try {
      const missingConfigPath = path.join(configDir, 'config.json');
      await expect(
        assertConfigDirNotOwnedByAnotherLiveHubOrListeningHub(configDir, {
          configPath: missingConfigPath,
          fallbackPort: addr.port + 1,
          timeoutMs: 200,
        })
      ).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });
});
