'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('service', function () {
  const service = require('../server/service');

  it('getPlatform returns macos or linux', function () {
    const platform = service.getPlatform();
    assert.ok(platform === 'macos' || platform === 'linux',
      'Expected macos or linux, got ' + platform);
  });

  it('getServicePaths returns expected keys', function () {
    const paths = service.getServicePaths();
    assert.ok(paths.servicePath, 'should have servicePath');
    assert.ok(paths.logDir !== undefined, 'should have logDir');
    assert.ok(paths.label, 'should have label');
  });

  it('generateServiceFile for macos contains plist XML', function () {
    const content = service.generateServiceFile('macos', {
      nodePath: '/usr/local/bin/node',
      scriptPath: '/usr/local/lib/node_modules/claude-remote-cli/bin/claude-remote-cli.js',
      configPath: '/Users/test/.config/claude-remote-cli/config.json',
      port: '3456',
      host: '0.0.0.0',
    });
    assert.ok(content.includes('<!DOCTYPE plist'), 'should be plist XML');
    assert.ok(content.includes('com.claude-remote-cli'), 'should have label');
    assert.ok(content.includes('RunAtLoad'), 'should have RunAtLoad');
    assert.ok(content.includes('KeepAlive'), 'should have KeepAlive');
    assert.ok(content.includes('3456'), 'should include port');
  });

  it('generateServiceFile for linux contains systemd unit', function () {
    const content = service.generateServiceFile('linux', {
      nodePath: '/usr/bin/node',
      scriptPath: '/usr/lib/node_modules/claude-remote-cli/bin/claude-remote-cli.js',
      configPath: '/home/test/.config/claude-remote-cli/config.json',
      port: '3456',
      host: '0.0.0.0',
    });
    assert.ok(content.includes('[Unit]'), 'should have Unit section');
    assert.ok(content.includes('[Service]'), 'should have Service section');
    assert.ok(content.includes('[Install]'), 'should have Install section');
    assert.ok(content.includes('Restart=on-failure'), 'should restart on failure');
    assert.ok(content.includes('3456'), 'should include port');
  });

  it('isInstalled returns false when service file does not exist', function () {
    assert.strictEqual(service.isInstalled(), false);
  });
});
