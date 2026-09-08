import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// #1587: tests must never touch the operator's real Relay config dir.
// Set run-scoped config env before any test module imports server code.
const realHome = os.homedir();
process.env['RELAY_IDE_TEST_GUARD'] = '1';
process.env['RELAY_IDE_TEST_REAL_HOME'] ??= realHome;
process.env['RELAY_IDE_TEST_REAL_XDG_CONFIG_HOME'] ??=
  process.env['XDG_CONFIG_HOME'] ?? '';

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-vitest-config-'));
const xdgHome = path.join(runDir, 'xdg');
const configDir = path.join(runDir, 'config');
fs.mkdirSync(xdgHome, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });

process.env['XDG_CONFIG_HOME'] = xdgHome;
process.env['RELAY_IDE_CONFIG'] = path.join(configDir, 'config.json');
