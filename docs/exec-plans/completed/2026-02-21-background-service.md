# Background Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow claude-remote-cli to run as a persistent background service that survives reboots using native platform service managers.

**Architecture:** A new `server/service.js` module handles platform detection and generates launchd plists (macOS) or systemd user units (Linux). The CLI entry point (`bin/claude-remote-cli.js`) gains `install`, `uninstall`, `status` subcommands and a `--bg` shortcut flag. No new dependencies — just `fs`, `path`, and `child_process`.

**Tech Stack:** Node.js `child_process.execSync`, launchd (macOS), systemd user units (Linux)

---

### Task 1: Write the service module — platform detection and path helpers

**Files:**
- Create: `server/service.js`
- Test: `test/service.test.js`

**Step 1: Write the failing tests for platform detection and paths**

```js
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
    assert.ok(paths.logDir, 'should have logDir');
    assert.ok(paths.label, 'should have label');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/service.test.js`
Expected: FAIL — cannot find module `../server/service`

**Step 3: Write minimal implementation**

```js
'use strict';

const path = require('path');

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
  // linux
  return {
    servicePath: path.join(HOME, '.config', 'systemd', 'user', 'claude-remote-cli.service'),
    logDir: null, // systemd uses journalctl
    label: 'claude-remote-cli',
  };
}

module.exports = { getPlatform, getServicePaths, SERVICE_LABEL, CONFIG_DIR };
```

**Step 4: Run test to verify it passes**

Run: `node --test test/service.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add server/service.js test/service.test.js
git commit -m "feat: add service module with platform detection and path helpers"
```

---

### Task 2: Add service file generation (plist / systemd unit)

**Files:**
- Modify: `server/service.js`
- Modify: `test/service.test.js`

**Step 1: Write the failing tests for service file content generation**

Append to `test/service.test.js`:

```js
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
```

**Step 2: Run test to verify it fails**

Run: `node --test test/service.test.js`
Expected: FAIL — `service.generateServiceFile is not a function`

**Step 3: Write the implementation**

Add to `server/service.js` before `module.exports`:

```js
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

  // linux systemd
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
```

Update `module.exports` to include `generateServiceFile`.

**Step 4: Run test to verify it passes**

Run: `node --test test/service.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add server/service.js test/service.test.js
git commit -m "feat: add service file generation for launchd and systemd"
```

---

### Task 3: Add install, uninstall, status functions

**Files:**
- Modify: `server/service.js`
- Modify: `test/service.test.js`

**Step 1: Write the failing tests**

Append to `test/service.test.js`:

```js
  it('isInstalled returns false when service file does not exist', function () {
    assert.strictEqual(service.isInstalled(), false);
  });
```

**Step 2: Run test to verify it fails**

Run: `node --test test/service.test.js`
Expected: FAIL — `service.isInstalled is not a function`

**Step 3: Write the implementation**

Add to `server/service.js`:

```js
const fs = require('fs');
const { execSync } = require('child_process');

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

  // Ensure parent directories exist
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
```

Update `module.exports` to include `isInstalled`, `install`, `uninstall`, `status`.

**Step 4: Run test to verify it passes**

Run: `node --test test/service.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add server/service.js test/service.test.js
git commit -m "feat: add install, uninstall, status service management functions"
```

---

### Task 4: Wire subcommands and --bg into the CLI

**Files:**
- Modify: `bin/claude-remote-cli.js:8-51`

**Step 1: Update the help text**

Replace the help text block (lines 11-18) to include new commands:

```js
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
```

**Step 2: Add subcommand handling after the version check and getArg helper (after line 32)**

Insert before the config directory logic:

```js
// Subcommands
const command = args[0];
if (command === 'install' || command === 'uninstall' || command === 'status' || args.includes('--bg')) {
  const service = require('../server/service');

  if (command === 'uninstall') {
    try {
      service.uninstall();
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === 'status') {
    const st = service.status();
    if (!st.installed) {
      console.log('Service is not installed.');
    } else if (st.running) {
      console.log('Service is installed and running.');
    } else {
      console.log('Service is installed but not running.');
    }
    process.exit(0);
  }

  // install or --bg
  const configDir = getArg('--config')
    ? path.dirname(getArg('--config'))
    : path.join(process.env.HOME || process.env.USERPROFILE || '~', '.config', 'claude-remote-cli');
  const configPath = getArg('--config') || path.join(configDir, 'config.json');

  try {
    service.install({
      configPath,
      port: getArg('--port') || '3456',
      host: getArg('--host') || '0.0.0.0',
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}
```

**Step 3: Verify syntax**

Run: `node -c bin/claude-remote-cli.js`
Expected: No errors

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass (existing + new service tests)

**Step 5: Commit**

```bash
git add bin/claude-remote-cli.js
git commit -m "feat: add install/uninstall/status subcommands and --bg flag to CLI"
```

---

### Task 5: Update README and docs

**Files:**
- Modify: `README.md`
- Modify: `docs/guides/architecture.md`
- Modify: `docs/guides/patterns.md`

**Step 1: Add Background Service section to README**

After the "CLI Usage" section, add:

```markdown
## Background Service

Run as a persistent service that starts on login and restarts on crash:

\`\`\`bash
claude-remote-cli --bg
\`\`\`

Or with custom options:

\`\`\`bash
claude-remote-cli install --port 4000
\`\`\`

Manage the service:

\`\`\`bash
claude-remote-cli status      # Check if running
claude-remote-cli uninstall   # Stop and remove
\`\`\`

- **macOS**: Uses launchd (`~/Library/LaunchAgents/`)
- **Linux**: Uses systemd user units (`~/.config/systemd/user/`)
- **Logs (macOS)**: `~/.config/claude-remote-cli/logs/`
- **Logs (Linux)**: `journalctl --user -u claude-remote-cli -f`
```

**Step 2: Update the help text in CLI Usage section to match the new help output**

**Step 3: Add `service.js` to architecture docs**

In `docs/guides/architecture.md` Server Modules table, add:
```
| `server/service.js` | Background service install/uninstall/status (launchd on macOS, systemd on Linux) |
```

**Step 4: Add service pattern to patterns.md**

Add a "Background Service" section to `docs/guides/patterns.md`:
```markdown
## Background Service

- `--bg` is a shortcut for `install` (installs + starts)
- Service files are generated with current CLI flags baked in
- macOS: launchd plist with `RunAtLoad` + `KeepAlive`
- Linux: systemd user unit with `Restart=on-failure`
- To change port/host: `uninstall` then re-install with new flags
```

**Step 5: Commit**

```bash
git add README.md docs/guides/architecture.md docs/guides/patterns.md
git commit -m "docs: add background service documentation"
```

---

### Task 6: Integration smoke test

**Step 1: Install the service**

```bash
node bin/claude-remote-cli.js install --port 3456
```

Expected: "Service installed and started."

**Step 2: Check status**

```bash
node bin/claude-remote-cli.js status
```

Expected: "Service is installed and running."

**Step 3: Verify the server is actually running**

```bash
curl -s http://localhost:3456 | head -5
```

Expected: HTML response from the app

**Step 4: Uninstall**

```bash
node bin/claude-remote-cli.js uninstall
```

Expected: "Service uninstalled."

**Step 5: Verify status after uninstall**

```bash
node bin/claude-remote-cli.js status
```

Expected: "Service is not installed."

**Step 6: Fix any issues found, commit if needed**
