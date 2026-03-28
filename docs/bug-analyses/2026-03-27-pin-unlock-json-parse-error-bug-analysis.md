# Bug Analysis: PIN Unlock — cryptic error + missing PIN management UI

> **Status**: Confirmed | **Date**: 2026-03-27
> **Severity**: Medium
> **Affected Area**: `frontend/src/lib/api.ts`, `frontend/src/components/PinGate.svelte`, `server/index.ts` (POST /auth), `server/auth.ts`

## Symptoms
- User enters PIN on the lock screen and clicks Unlock
- Instead of "Invalid PIN" or a successful login, the error reads: `Failed to execute 'json' on 'Response': Unexpected end of JSON input`
- No way to set or reset a PIN from the web UI — requires CLI access or manual config file editing

## Reproduction Steps
1. Access the Relay web interface (the login screen appears)
2. Enter a PIN and click Unlock
3. If the server returns a non-JSON error response (empty body, HTML error page, or truncated response), the cryptic error appears instead of a meaningful message

Trigger conditions (any of):
- Server encounters an unhandled exception in the `/auth` handler (Express 4 does NOT catch async errors)
- `getConfig()` returns a fallback config without `pinHash` (if config file is unreadable and `lastGoodConfig` is null, the fallback is `DEFAULTS` which excludes `pinHash`)
- Network issue truncates the response body

## Root Cause

**Three issues:**

### 1. Frontend: `authenticate()` blindly parses error response bodies as JSON

`frontend/src/lib/api.ts:38`:
```ts
if (!res.ok) {
  const data = await res.json() as { error?: string };  // crashes if body is empty/non-JSON
  throw new Error(data.error || 'Authentication failed');
}
```

When the server returns a non-OK response with an empty or non-JSON body, `res.json()` throws a `TypeError` with the message "Failed to execute 'json' on 'Response': Unexpected end of JSON input". The same fragile pattern exists in 6 other API functions.

### 2. Server: No guard against `pinHash` being undefined

`server/index.ts:514-515`:
```ts
const authConfig = getConfig();
const valid = await auth.verifyPin(pin, authConfig.pinHash as string);
```

If `getConfig()` falls back to `DEFAULTS` (no `pinHash`), then `verifyPin(pin, undefined)` calls `undefined.startsWith('scrypt:')` → TypeError. Express 4.22.1 doesn't catch async errors, so the response hangs.

### 3. No server-side awareness of "PIN not configured" state

The server assumes `pinHash` always exists at runtime (set via CLI at startup). But if the config file is edited, corrupted, or the user deletes `pinHash` to reset, the server has no way to communicate this to the UI — it just crashes. There's no `GET /auth/status` endpoint to tell the frontend whether a PIN is configured, needs setup, or needs reset.

## Evidence
- `auth.ts:22` — `verifyPin` crashes on `undefined` hash (no null check)
- `server/index.ts:192-200` — PIN setup is CLI-only (interactive `promptPin` on first run)
- `CLAUDE.md:37` — "PIN reset: delete `pinHash` from config file and restart server" (manual process)
- No `GET /auth/status` or `POST /auth/setup` endpoints exist
- No PIN change UI in `WorkspaceSettingsDialog.svelte` or `SettingsDialog.svelte`

## Impact Assessment
- Users see a cryptic error instead of actionable UI
- PIN reset requires SSH/terminal access to the machine running the server
- If the config file loses `pinHash`, the server becomes unusable from the web (must restart from CLI)
- No way to change PIN without deleting config and restarting

## Recommended Fix Direction

### 1. Server: Auth status + PIN setup endpoints

**`GET /auth/status`** (no auth required):
```json
{ "hasPIN": true }
```
Returns whether a PIN is configured. If `pinHash` is missing from config, returns `{ "hasPIN": false }`.

**`POST /auth/setup`** (no auth required, only works when no PIN is set):
```json
// Request: { "pin": "1234", "confirm": "1234" }
// Response: { "ok": true } + sets auth cookie (auto-login after setup)
```
Sets the initial PIN. Rejects if a PIN is already configured (prevents remote hijacking).

**PIN reset stays CLI-only** — this is a security feature, not a gap. If a user forgets their PIN, they must have local machine access.

**`claude-remote-cli pin reset`** (new CLI subcommand):
```
$ claude-remote-cli pin reset
Current PIN (or press Enter to skip if forgotten): ****
New PIN: ****
Confirm new PIN: ****
PIN updated successfully.
```
- If user knows current PIN → verify it first, then set new one
- If user forgot PIN → skip verification (local machine access = proof of ownership)
- Must be run on the host machine (TTY required)
- Updates `pinHash` in config and invalidates all existing auth tokens (force re-login)
- The web UI tells users to run this command when PIN is invalid/forgotten

### 2. Frontend: PinGate becomes context-aware

`PinGate.svelte` checks `GET /auth/status` on mount:
- **`hasPIN: true`** → current unlock form (enter PIN to unlock)
- **`hasPIN: false`** → "Set up a PIN" form (enter + confirm, with match validation)
- **Invalid PIN** → "Invalid PIN" error + hint: "forgot your PIN? run `claude-remote-cli --reset-pin` on the host machine"

Auth state (`auth.svelte.ts`) gains:
- `needsSetup: boolean` — drives the PinGate mode
- `setupPin(pin, confirm)` — calls `POST /auth/setup`

### 3. Defensive fixes

- `api.ts`: `parseErrorBody(res)` helper with try-catch around `.json()` — apply to all 7 call sites
- `server/index.ts` POST /auth: guard `if (!authConfig.pinHash)` → return `{ needsSetup: true }` instead of crashing
- `auth.ts:22`: add `if (!hash) return false;` at the top of `verifyPin`

## Architecture Review

### Systemic Spread
The fragile `.json()` pattern exists at 7 call sites in `api.ts`. All have the same vulnerability. The `parseErrorBody` helper fixes all of them in one pass.

### Design Gap
PIN setup is CLI-only — if the server starts without a PIN (non-TTY, config reset), the web UI has no way to set one. Initial PIN setup should be possible from the web. PIN reset correctly stays CLI-only (local access = proof of ownership).

Express 4 doesn't catch async handler errors. All async handlers should be wrapped.

### Testing Gaps
No test covers: the `authenticate()` error path with a non-JSON response, the `/auth` handler when `pinHash` is missing, or PIN setup flow.

### Harness Context Gaps
None.
