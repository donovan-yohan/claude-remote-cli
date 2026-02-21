const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DEFAULTS, loadConfig, saveConfig } = require('../server/config.js');

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mobile-config-test-'));
});

afterEach(() => {
  for (const file of fs.readdirSync(tmpDir)) {
    fs.unlinkSync(path.join(tmpDir, file));
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

  saveConfig(configPath, config);

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
