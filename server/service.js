'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SERVICE_LABEL = 'com.claude-remote-cli';
const HOME = process.env.HOME || process.env.USERPROFILE || '~';
const CONFIG_DIR = path.join(HOME, '.config', 'claude-remote-cli');

function getPlatform() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  throw new Error('Unsupported platform: ' + process.platform + '. Only macOS and Linux are supported.');
}

function getServicePaths() {
  const platform = getPlatform();
  if (platform === 'macos') {
    return {
      servicePath: path.join(HOME, 'Library', 'LaunchAgents', SERVICE_LABEL + '.plist'),
      logDir: path.join(CONFIG_DIR, 'logs'),
      label: SERVICE_LABEL,
    };
  }
  return {
    servicePath: path.join(HOME, '.config', 'systemd', 'user', 'claude-remote-cli.service'),
    logDir: null,
    label: 'claude-remote-cli',
  };
}

function generateServiceFile(platform, opts) {
  const { nodePath, scriptPath, configPath, port, host } = opts;

  if (platform === 'macos') {
    const logDir = path.join(CONFIG_DIR, 'logs');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>--config</string>
    <string>${configPath}</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--host</string>
    <string>${host}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>`;
  }

  return `[Unit]
Description=Claude Remote CLI
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${scriptPath} --config ${configPath} --port ${port} --host ${host}
Restart=on-failure
RestartSec=5
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target`;
}

function isInstalled() {
  const { servicePath } = getServicePaths();
  return fs.existsSync(servicePath);
}

function install(opts) {
  const platform = getPlatform();
  const { servicePath, logDir } = getServicePaths();

  if (isInstalled()) {
    throw new Error('Service is already installed. Run `claude-remote-cli uninstall` first.');
  }

  const nodePath = process.execPath;
  const scriptPath = path.resolve(__dirname, '..', 'bin', 'claude-remote-cli.js');
  const configPath = opts.configPath || path.join(CONFIG_DIR, 'config.json');
  const port = opts.port || '3456';
  const host = opts.host || '0.0.0.0';

  const content = generateServiceFile(platform, { nodePath, scriptPath, configPath, port, host });

  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  if (logDir) fs.mkdirSync(logDir, { recursive: true });

  fs.writeFileSync(servicePath, content, 'utf8');

  if (platform === 'macos') {
    execSync('launchctl load -w ' + servicePath, { stdio: 'inherit' });
  } else {
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync('systemctl --user enable --now claude-remote-cli', { stdio: 'inherit' });
  }

  console.log('Service installed and started.');
  if (logDir) {
    console.log('Logs: ' + logDir);
  } else {
    console.log('Logs: journalctl --user -u claude-remote-cli -f');
  }
}

function uninstall() {
  const platform = getPlatform();
  const { servicePath } = getServicePaths();

  if (!isInstalled()) {
    throw new Error('Service is not installed.');
  }

  if (platform === 'macos') {
    try { execSync('launchctl unload ' + servicePath, { stdio: 'inherit' }); } catch (_) {}
  } else {
    try { execSync('systemctl --user disable --now claude-remote-cli', { stdio: 'inherit' }); } catch (_) {}
  }

  fs.unlinkSync(servicePath);
  console.log('Service uninstalled.');
}

function status() {
  const platform = getPlatform();

  if (!isInstalled()) {
    return { installed: false, running: false };
  }

  let running = false;
  if (platform === 'macos') {
    try {
      const out = execSync('launchctl list ' + SERVICE_LABEL, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      running = !out.includes('"LastExitStatus" = -1');
    } catch (_) {
      running = false;
    }
  } else {
    try {
      execSync('systemctl --user is-active claude-remote-cli', { stdio: ['pipe', 'pipe', 'pipe'] });
      running = true;
    } catch (_) {
      running = false;
    }
  }

  return { installed: true, running };
}

module.exports = { getPlatform, getServicePaths, generateServiceFile, isInstalled, install, uninstall, status, SERVICE_LABEL, CONFIG_DIR };
