import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
});
