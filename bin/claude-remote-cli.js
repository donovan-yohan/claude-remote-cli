#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

// Parse CLI flags
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: claude-remote-cli [options]
       claude-remote-cli <command>

Commands:
  install            Install as a background service (survives reboot)
  uninstall          Stop and remove the background service
  status             Show whether the service is running

Options:
  --bg               Shortcut: install and start as background service
  --port <port>      Override server port (default: 3456)
  --host <host>      Override bind address (default: 0.0.0.0)
  --config <path>    Path to config.json (default: ~/.config/claude-remote-cli/config.json)
  --version, -v      Show version
  --help, -h         Show this help`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json');
  console.log(pkg.version);
  process.exit(0);
}

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function resolveConfigPath() {
  const explicit = getArg('--config');
  if (explicit) return explicit;
  const { CONFIG_DIR } = require('../server/service');
  return path.join(CONFIG_DIR, 'config.json');
}

function runServiceCommand(fn) {
  try {
    fn();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

const command = args[0];
if (command === 'install' || command === 'uninstall' || command === 'status' || args.includes('--bg')) {
  const service = require('../server/service');

  if (command === 'uninstall') {
    runServiceCommand(function () { service.uninstall(); });
  } else if (command === 'status') {
    runServiceCommand(function () {
      const st = service.status();
      if (!st.installed) {
        console.log('Service is not installed.');
      } else if (st.running) {
        console.log('Service is installed and running.');
      } else {
        console.log('Service is installed but not running.');
      }
    });
  } else {
    runServiceCommand(function () {
      const { DEFAULTS } = require('../server/config');
      service.install({
        configPath: resolveConfigPath(),
        port: getArg('--port') || String(DEFAULTS.port),
        host: getArg('--host') || DEFAULTS.host,
      });
    });
  }
}

const configPath = resolveConfigPath();
const configDir = path.dirname(configPath);

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Pass config path and CLI overrides to the server
process.env.CLAUDE_REMOTE_CONFIG = configPath;
if (getArg('--port')) process.env.CLAUDE_REMOTE_PORT = getArg('--port');
if (getArg('--host')) process.env.CLAUDE_REMOTE_HOST = getArg('--host');

require('../server/index.js');
