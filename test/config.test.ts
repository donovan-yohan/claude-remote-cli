import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULTS, loadConfig, saveConfig, ensureMetaDir, readMeta, writeMeta } from '../server/config.js';

let tmpDir!: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-remote-cli-config-test-'));
});

afterEach(() => {
  for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
    const fullPath = path.join(tmpDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
  }
});

after(() => {
  fs.rmdirSync(tmpDir);
});

test('loadConfig loads a JSON config file', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const data = { port: 4000, host: '127.0.0.1' };
  fs.writeFileSync(configPath, JSON.stringify(data), 'utf8');

  const config = loadConfig(configPath);
  assert.equal(config.port, 4000);
  assert.equal(config.host, '127.0.0.1');
});

test('loadConfig merges with defaults for missing fields', () => {
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ port: 9000 }), 'utf8');

  const config = loadConfig(configPath);
  assert.equal(config.port, 9000);
  assert.equal(config.host, DEFAULTS.host);
  assert.equal(config.cookieTTL, DEFAULTS.cookieTTL);
  assert.deepEqual(config.repos, DEFAULTS.repos);
  assert.equal(config.claudeCommand, DEFAULTS.claudeCommand);
  assert.deepEqual(config.claudeArgs, DEFAULTS.claudeArgs);
});

test('loadConfig throws if config file not found', () => {
  const configPath = path.join(tmpDir, 'nonexistent.json');
  assert.throws(() => loadConfig(configPath), /Config file not found/);
});

test('saveConfig writes JSON with 2-space indent', () => {
  const configPath = path.join(tmpDir, 'output.json');
  const config = { port: 3456, host: '0.0.0.0' };

  saveConfig(configPath, config as Parameters<typeof saveConfig>[1]);

  const raw = fs.readFileSync(configPath, 'utf8');
  assert.equal(raw, JSON.stringify(config, null, 2));
});

test('DEFAULTS has expected keys and values', () => {
  assert.equal(DEFAULTS.host, '0.0.0.0');
  assert.equal(DEFAULTS.port, 3456);
  assert.equal(DEFAULTS.cookieTTL, '24h');
  assert.deepEqual(DEFAULTS.repos, []);
  assert.equal(DEFAULTS.claudeCommand, 'claude');
  assert.deepEqual(DEFAULTS.claudeArgs, []);
});

test('ensureMetaDir creates worktree-meta directory', () => {
  const configPath = path.join(tmpDir, 'config.json');
  ensureMetaDir(configPath);
  const metaPath = path.join(tmpDir, 'worktree-meta');
  assert.ok(fs.existsSync(metaPath));
});

test('writeMeta creates and readMeta reads metadata file', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const meta = { worktreePath: '/tmp/test-worktree', displayName: 'My Feature', lastActivity: '2026-02-22T00:00:00.000Z' };
  writeMeta(configPath, meta);
  const read = readMeta(configPath, '/tmp/test-worktree');
  assert.deepEqual(read, meta);
});

test('readMeta returns null for non-existent metadata', () => {
  const configPath = path.join(tmpDir, 'config.json');
  const result = readMeta(configPath, '/no/such/worktree');
  assert.equal(result, null);
});

test('writeMeta overwrites existing metadata', () => {
  const configPath = path.join(tmpDir, 'config.json');
  writeMeta(configPath, { worktreePath: '/tmp/wt', displayName: 'Old Name', lastActivity: '2026-01-01T00:00:00.000Z' });
  writeMeta(configPath, { worktreePath: '/tmp/wt', displayName: 'New Name', lastActivity: '2026-02-22T00:00:00.000Z' });
  const read = readMeta(configPath, '/tmp/wt');
  assert.equal(read!.displayName, 'New Name');
  assert.equal(read!.lastActivity, '2026-02-22T00:00:00.000Z');
});
