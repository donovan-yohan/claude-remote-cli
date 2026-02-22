import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// At runtime, __dirname resolves to dist/test/.
// The server runs from dist/server/, which uses path.join(__dirname, '..', '..', ...)
// to reach the project root. This test verifies that relationship is correct.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This test file is at dist/test/, server is at dist/server/ — same depth
const projectRoot = path.resolve(__dirname, '..', '..');

test('project root from dist/ contains public/ directory', () => {
  const publicDir = path.join(projectRoot, 'public');
  assert.ok(fs.existsSync(publicDir), `Expected public/ at ${publicDir}`);
});

test('project root from dist/ contains public/index.html', () => {
  const indexHtml = path.join(projectRoot, 'public', 'index.html');
  assert.ok(fs.existsSync(indexHtml), `Expected public/index.html at ${indexHtml}`);
});

test('dist/server/ exists after compilation', () => {
  const serverDir = path.join(projectRoot, 'dist', 'server');
  assert.ok(fs.existsSync(serverDir), `Expected dist/server/ at ${serverDir}`);
});

test('server index.ts uses correct path depth to reach project root', async () => {
  // Read the source file and verify the path pattern
  const indexSource = fs.readFileSync(
    path.join(projectRoot, 'server', 'index.ts'),
    'utf8'
  );

  // Static serving must go up two levels from dist/server/ to project root
  assert.ok(
    indexSource.includes("path.join(__dirname, '..', '..', 'public')"),
    'express.static must resolve public/ two levels up from dist/server/'
  );

  // Config fallback must also go up two levels
  assert.ok(
    indexSource.includes("path.join(__dirname, '..', '..', 'config.json')"),
    'CONFIG_PATH must resolve config.json two levels up from dist/server/'
  );
});
