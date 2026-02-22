# ADR-006: Dual Distribution via npm Global Install and Local Dev

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
claude-remote-cli needs to be easy to install for end users while remaining convenient for local development. End users expect a single `npm install -g` command followed by a named CLI command. Developers cloning the repo expect `npm start` to work immediately. These two modes have different expectations for where configuration files live: global installs should follow XDG conventions and not pollute the project directory, while local dev should keep config adjacent to the source code.

## Decision

### CLI Entry Point
- The package MUST declare a `bin` entry pointing to `bin/claude-remote-cli.js`
- `bin/claude-remote-cli.js` MUST parse CLI flags (`--port`, `--host`, `--config`, `--version`, `--help`) before delegating to `server/index.js`
- CLI flags MUST be passed to the server via environment variables (`CLAUDE_REMOTE_CONFIG`, `CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`)

### Configuration Resolution
Configuration values MUST be resolved in the following precedence order (highest to lowest):

1. CLI flags (`--port`, `--host`, `--config`)
2. Environment variables (`CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`, `CLAUDE_REMOTE_CONFIG`)
3. Config file values
4. Built-in defaults (`host: '0.0.0.0'`, `port: 3456`, `cookieTTL: '24h'`)

### Config File Location
- When run via the CLI bin (global install): `~/.config/claude-remote-cli/config.json`
- When run directly via `npm start` or `node server/index.js` (local dev): `./config.json` in the project root
- The config directory MUST be created automatically if it does not exist
- The `CLAUDE_REMOTE_CONFIG` environment variable MAY override both defaults

### Published Files
The `files` field in `package.json` MUST limit the published package to: `bin/`, `server/`, `public/`, and `config.example.json`. Test files, documentation, and development configuration MUST NOT be included in the published package.

## Consequences

### Positive
- End users get a clean install experience: `npm install -g claude-remote-cli && claude-remote-cli`
- Global config in `~/.config/` follows platform conventions and survives package upgrades
- Local dev config in `./config.json` is gitignored and does not interfere with the global install
- CLI flag precedence allows one-off overrides without editing the config file

### Negative
- Two config file locations means developers must be aware of which mode they are running in to find the right config
- CLI flag parsing in `bin/claude-remote-cli.js` is manual (no argument parsing library like yargs or commander), which means adding new flags requires updating the parser by hand
- Environment variable bridging between the bin script and server is an implicit coupling

### Risks
- If a user runs `npm start` after a global install, they get the local dev config path, which may cause confusion if they have already configured the global path
- The `postinstall` script for node-pty native binaries (`chmod +x` on macOS prebuilds) may fail silently on some platforms, leaving the package in a broken state
