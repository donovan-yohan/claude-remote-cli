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
    assert.ok(paths.servicePath, 'missing servicePath');
    assert.strictEqual(typeof paths.label, 'string', 'label should be a string');
    assert.ok('logDir' in paths, 'missing logDir key');
  });

  it('generateServiceFile for macos contains plist XML', function () {
    const content = service.generateServiceFile('macos', {
      nodePath: '/usr/local/bin/node',
      scriptPath: '/usr/local/lib/node_modules/claude-remote-cli/bin/claude-remote-cli.js',
      configPath: '/Users/test/.config/claude-remote-cli/config.json',
      port: '3456',
      host: '0.0.0.0',
    });
    assert.match(content, /<!DOCTYPE plist/, 'should be plist XML');
    assert.match(content, /com\.claude-remote-cli/, 'should have label');
    assert.match(content, /RunAtLoad/, 'should have RunAtLoad');
    assert.match(content, /KeepAlive/, 'should have KeepAlive');
    assert.match(content, /3456/, 'should include port');
  });

  it('generateServiceFile for linux contains systemd unit', function () {
    const content = service.generateServiceFile('linux', {
      nodePath: '/usr/bin/node',
      scriptPath: '/usr/lib/node_modules/claude-remote-cli/bin/claude-remote-cli.js',
      configPath: '/home/test/.config/claude-remote-cli/config.json',
      port: '3456',
      host: '0.0.0.0',
    });
    assert.match(content, /\[Unit\]/, 'should have Unit section');
    assert.match(content, /\[Service\]/, 'should have Service section');
    assert.match(content, /\[Install\]/, 'should have Install section');
    assert.match(content, /Restart=on-failure/, 'should restart on failure');
    assert.match(content, /3456/, 'should include port');
  });

  it('isInstalled returns false when service file does not exist', function () {
    assert.strictEqual(service.isInstalled(), false);
  });
});
