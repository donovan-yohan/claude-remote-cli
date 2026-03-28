# Bug Analysis: --bg first-run exits with "No PIN configured" despite web-based PIN setup flow

> **Status**: Confirmed | **Date**: 2026-03-28
> **Severity**: High
> **Affected Area**: bin/claude-remote-cli.ts, server/index.ts (startup PIN gate)

## Symptoms
- Running `claude-remote-cli --bg` for the first time prints: "No PIN configured. Run claude-remote-cli interactively first to set a PIN."
- The service is installed by launchd but immediately crash-loops (KeepAlive restarts → same failure)
- This occurs even after the recent fix (v3.18.0) that added interactive PIN setup and web-based PIN setup (PinGate UI + POST /auth/setup)

## Reproduction Steps
1. Ensure no config file exists (`rm ~/.config/claude-remote-cli/config.json`)
2. Run `claude-remote-cli --bg`
3. Service installs successfully, but the spawned background process exits with the PIN error
4. Check logs at `~/.config/claude-remote-cli/logs/stderr.log` — shows the error message in a loop

## Root Cause

The `--bg` path in `bin/claude-remote-cli.ts:273-295` and the server startup in `server/index.ts:192-196` are disconnected — the CLI installs the service and exits *before* ever checking if a PIN exists, and the service-spawned process cannot prompt for a PIN because it has no TTY.

**Data flow:**
1. `bin/claude-remote-cli.ts:273` — `--bg` flag detected, enters service install branch
2. `bin/claude-remote-cli.ts:288` — calls `runServiceCommand(() => service.install({...}))`
3. `service.ts:126` — writes launchd plist and runs `launchctl load`
4. `bin/claude-remote-cli.ts:75` — `runServiceCommand` calls `process.exit(0)` — **no PIN check happened**
5. launchd starts a new `claude-remote-cli` process (no `--bg`, no TTY)
6. `server/index.ts:192` — `!startupConfig.pinHash` is true (first run, no config)
7. `server/index.ts:193` — `!process.stdin.isTTY` is true (launchd provides no TTY)
8. `server/index.ts:194` — hard exit with error message
9. launchd `KeepAlive: true` → restart → same failure → infinite crash loop

The non-TTY guard at `server/index.ts:193-196` was written before the web-based PIN setup flow existed. The recent fix added `GET /auth/status`, `POST /auth/setup`, and the `PinGate` frontend component — a complete web-based PIN setup path that allows setting a PIN through the browser. But the server hard-exits at line 194 before it ever binds the HTTP port, so the web UI never loads.

## Evidence
- `server/index.ts:192-196` — hard exit when no PIN + no TTY, predates web setup flow
- `server/index.ts:500-557` — `GET /auth/status` and `POST /auth/setup` endpoints exist and work correctly
- `bin/claude-remote-cli.ts:273-295` — `--bg` path has zero awareness of PIN state
- `bin/claude-remote-cli.ts:68-76` — `runServiceCommand` always calls `process.exit()`, preventing fallthrough to server startup
- `service.ts:69` — launchd `KeepAlive: true` ensures crash loop on repeated failure

## Impact Assessment
- **First-run UX completely broken for `--bg` users** — the primary "quick start" path doesn't work
- Same bug affects `claude-remote-cli install` (identical code path)
- launchd crash loop wastes system resources until the user manually uninstalls
- Workaround exists: run `claude-remote-cli` interactively first to set PIN, then run `--bg`

## Recommended Fix Direction

1. **Remove the non-TTY hard exit** in `server/index.ts:193-196`. The server should start without a PIN when `pinHash` is absent, relying on the existing PinGate frontend to gate all access and the `POST /auth/setup` endpoint to set the initial PIN. The non-TTY exit was a safety measure that is now obsolete — the web-based setup flow provides the same guarantee (no access without PIN) without requiring a TTY.

2. The interactive CLI prompt at lines 197-200 can remain as a convenience for foreground users, but it must not be the *only* path to PIN setup.

3. **Update README.md** to document:
   - The web-based PIN setup flow (what users see when connecting via browser for the first time)
   - The `pin reset` subcommand (currently only the manual config-editing method is documented)
   - A simplified first-time flow where `--bg` can be the very first command (no need to run interactively first)
   - Clear documentation of all CLI commands and the expected user journey

## Architecture Review

### Systemic Spread
- `bin/claude-remote-cli.ts:273` — the `install` command (without `--bg`) has the same bug: installs service without checking PIN
- `bin/claude-remote-cli.ts:79-105` — the `update` command re-installs the service (line 93) after update, also without PIN check — would fail if config was corrupted/deleted between updates
- No other non-TTY exits gate server startup, so this is isolated to the PIN check

### Design Gap
The startup PIN gate and the web-based PIN setup flow are two independent systems that don't know about each other. The non-TTY exit in `server/index.ts` was designed as a hard gate ("server must not run without PIN"), but `POST /auth/setup` provides the same invariant at the HTTP layer ("no authenticated endpoints accessible without PIN"). The design gap is: **there is no single authority for "is the server ready to serve?"** — the startup code checks one thing (pinHash exists at boot), while the HTTP middleware checks another (valid cookie token per request). When the web setup flow was added, the startup gate should have been relaxed to trust the HTTP-layer gate.

### Testing Gaps
- **Missing test cases:** A test that calls `main()` with an empty config and `process.stdin.isTTY = false` would have caught this — it should verify the server binds its port and serves the auth/status endpoint rather than exiting. Specifically: spawn the server process with `CLAUDE_REMOTE_CONFIG` pointing to a PIN-less config, assert it starts listening, then call `GET /auth/status` and assert `{ hasPIN: false }`.
- **Infrastructure gaps:** There are no integration tests for the service install flow (`--bg` / `install` → service starts → server is healthy). The entire CLI-to-launchd-to-server pipeline is untested. This is a structural gap — the CLI entry point (`bin/claude-remote-cli.ts`) has zero test coverage.

### Harness Context Gaps
- `docs/DESIGN.md` does not document the auth/PIN startup flow at all — it mentions "bcrypt + cookie tokens" but says nothing about the PIN setup process, the non-TTY gate, or the web-based setup path
- `docs/ARCHITECTURE.md` lists `auth.ts` as "PIN hashing, rate limiting, cookie tokens" but doesn't describe the startup PIN gate in `index.ts`
- The CLAUDE.md "PIN reset" entry only covers the `pin reset` subcommand, not first-run PIN setup
