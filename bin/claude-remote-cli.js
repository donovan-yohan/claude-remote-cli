#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

// Parse CLI flags
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: claude-remote-cli [options]

Options:
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

// Determine config directory
const configDir = getArg('--config')
  ? path.dirname(getArg('--config'))
  : path.join(process.env.HOME || process.env.USERPROFILE || '~', '.config', 'claude-remote-cli');

const configPath = getArg('--config') || path.join(configDir, 'config.json');

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Pass config path and CLI overrides to the server
process.env.CLAUDE_REMOTE_CONFIG = configPath;
if (getArg('--port')) process.env.CLAUDE_REMOTE_PORT = getArg('--port');
if (getArg('--host')) process.env.CLAUDE_REMOTE_HOST = getArg('--host');

require('../server/index.js');
