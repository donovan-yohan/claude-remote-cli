# Update Notification Feature Design

> One-click update notification and self-update for claude-remote-cli.

## Summary

When a newer version of claude-remote-cli is available on npm, the frontend shows a dismissible toast with an "Update Now" button. Clicking it triggers a server-side `npm i -g claude-remote-cli@latest`, then the server restarts itself (relying on launchd/systemd KeepAlive).

## Backend

### GET /version (authenticated)

- Reads current version from package.json
- Fetches `https://registry.npmjs.org/claude-remote-cli/latest` and extracts `version`
- Caches registry response for 5 minutes in memory (`{version, fetchedAt}`)
- Returns `{current, latest, updateAvailable}` where `updateAvailable = semver current < latest`
- On fetch failure: returns `{current, latest: null, updateAvailable: false}` (silent)

### POST /update (authenticated)

- Runs `npm install -g claude-remote-cli@latest` via `child_process.exec`
- On success:
  - If `service.isInstalled()`: responds `{ok: true, restarting: true}`, then `process.exit(0)` after 1s delay (launchd/systemd restarts the server)
  - If not a service: responds `{ok: true, restarting: false}` (toast tells user to restart manually)
- On failure: responds `{ok: false, error: stderr}` with the error output

### Version comparison

Use simple semver comparison (split on `.`, compare major/minor/patch numerically). No need for a semver library — versions from npm are always clean semver.

## Frontend

### Toast (in app.js, ES5)

- On `initApp()`, call `fetch('/version')`
- If `updateAvailable` is true, show a fixed-position toast at bottom-center:
  - Text: "Update available: v{latest} (current: v{current})"
  - "Update Now" button
  - Dismiss (×) button — hides for this page session only
- "Update Now" flow:
  1. Button shows "Updating..." loading state
  2. POST /update
  3. Success + restarting: toast says "Updated! Restarting server..." → auto-reload page after 5s
  4. Success + not restarting: toast says "Updated to v{latest}! Please restart the server manually."
  5. Failure: toast shows error message with "Retry" button
- Warning text: "This will restart the server and close all active sessions."

### HTML additions

- `<div id="update-toast" hidden>` inside `#main-app`

### CSS additions

- Toast: fixed bottom-center, dark bg matching theme (#1e1e1e/#2d2d2d), rounded corners, slide-up animation
- Responsive: full-width on mobile, max-width ~500px on desktop

## Files changed

- `server/index.ts` — add GET /version, POST /update endpoints
- `public/app.js` — add version check on init, toast rendering and interaction
- `public/index.html` — add toast container div
- `public/style.css` — add toast styles
- `test/` — add tests for version check and update endpoints

## Edge cases

- **npm not in PATH / permissions error**: Return stderr to frontend, user sees what went wrong. Never use sudo.
- **No service installed**: Respond with `restarting: false`, toast says "restart manually".
- **Network offline**: `/version` returns `updateAvailable: false`, no toast shown.
- **Multiple clients clicking Update**: First wins, second gets either success (already updated) or npm conflict. Both acceptable.
- **Active PTY sessions**: Restart kills them. Toast warns user. Acceptable since user clicked "Update Now" knowingly.
