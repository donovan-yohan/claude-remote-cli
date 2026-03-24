import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, DEFAULTS } from '../server/config.js';
import type { Config } from '../server/types.js';

describe('config freshness', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-config-test-'));
    configPath = path.join(tmpDir, 'config.json');
    const initial: Config = { ...DEFAULTS } as Config;
    initial.workspaces = ['/existing/workspace'];
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadConfig sees workspaces added to disk after initial load', () => {
    // Simulate: server starts, loads config
    const initial = loadConfig(configPath);
    assert.deepEqual(initial.workspaces, ['/existing/workspace']);

    // Simulate: workspace router adds a workspace and saves to disk
    const updated = loadConfig(configPath);
    updated.workspaces = [...(updated.workspaces ?? []), '/new/workspace'];
    saveConfig(configPath, updated);

    // Simulate: session handler reads config (fresh)
    const fresh = loadConfig(configPath);
    assert.ok(fresh.workspaces!.includes('/new/workspace'),
      'Fresh loadConfig should see workspace added after initial load');
    assert.ok(fresh.workspaces!.includes('/existing/workspace'),
      'Fresh loadConfig should still see original workspace');
  });

  it('loadConfig sees workspaces removed from disk after initial load', () => {
    const initial = loadConfig(configPath);
    assert.deepEqual(initial.workspaces, ['/existing/workspace']);

    // Simulate: workspace router removes the workspace
    const updated = loadConfig(configPath);
    updated.workspaces = [];
    saveConfig(configPath, updated);

    // Fresh read should see empty list
    const fresh = loadConfig(configPath);
    assert.deepEqual(fresh.workspaces, []);
  });

  it('loadConfig sees workspace settings changes', () => {
    // Add workspace settings to disk
    const config = loadConfig(configPath);
    config.workspaceSettings = { '/existing/workspace': { defaultAgent: 'codex' as any } };
    saveConfig(configPath, config);

    // Fresh read should see settings
    const fresh = loadConfig(configPath);
    assert.equal(fresh.workspaceSettings?.['/existing/workspace']?.defaultAgent, 'codex');
  });

  it('loadConfig throws when config file is missing', () => {
    fs.unlinkSync(configPath);
    assert.throws(
      () => loadConfig(configPath),
      { message: /Config file not found/ },
    );
  });

  it('loadConfig throws on corrupted JSON', () => {
    fs.writeFileSync(configPath, '{bad json');
    assert.throws(
      () => loadConfig(configPath),
    );
  });
});
