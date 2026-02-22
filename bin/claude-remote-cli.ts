#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as service from '../server/service.js';
import { DEFAULTS } from '../server/config.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI flags
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: claude-remote-cli [options]
       claude-remote-cli <command>

Commands:
  update             Update to the latest version from npm
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
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function resolveConfigPath(): string {
  const explicit = getArg('--config');
  if (explicit) return explicit;
  return path.join(service.CONFIG_DIR, 'config.json');
}

function runServiceCommand(fn: () => void): never {
  try {
    fn();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

const command = args[0];
if (command === 'update') {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
    console.log(`Current version: ${pkg.version}`);
    console.log('Updating claude-remote-cli...');
    await execFileAsync('npm', ['install', '-g', 'claude-remote-cli@latest']);
    const updatedPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
    if (updatedPkg.version === pkg.version) {
      console.log(`Already on the latest version (${pkg.version}).`);
    } else {
      console.log(`Updated to ${updatedPkg.version}.`);
      if (service.isInstalled()) {
        console.log('Background service detected — restarting...');
        service.uninstall();
        service.install({
          configPath: resolveConfigPath(),
          port: getArg('--port') ?? String(DEFAULTS.port),
          host: getArg('--host') ?? DEFAULTS.host,
        });
        console.log('Service restarted.');
      }
    }
  } catch (e) {
    console.error('Update failed:', (e as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'install' || command === 'uninstall' || command === 'status' || args.includes('--bg')) {
  if (command === 'uninstall') {
    runServiceCommand(() => { service.uninstall(); });
  } else if (command === 'status') {
    runServiceCommand(() => {
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
    runServiceCommand(() => {
      service.install({
        configPath: resolveConfigPath(),
        port: getArg('--port') ?? String(DEFAULTS.port),
        host: getArg('--host') ?? DEFAULTS.host,
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
process.env['CLAUDE_REMOTE_CONFIG'] = configPath;
const portArg = getArg('--port');
if (portArg !== undefined) process.env['CLAUDE_REMOTE_PORT'] = portArg;
const hostArg = getArg('--host');
if (hostArg !== undefined) process.env['CLAUDE_REMOTE_HOST'] = hostArg;

await import('../server/index.js');
