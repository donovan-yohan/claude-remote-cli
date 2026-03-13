# Push Notifications Design

**Created:** 2026-03-13
**Status:** Draft

## Problem

When a Claude/Codex session becomes idle (waiting for user input), the user has no way to know unless they're actively looking at the sidebar. On mobile, if the app is backgrounded or the browser is closed, the user misses the signal entirely. On desktop, switching to another browser tab means missing the amber "attention" glow.

## Goals

1. Desktop: fire browser `Notification` when a session enters attention state and the tab is not focused
2. Mobile PWA: fire push notifications via Web Push API so alerts arrive even when the app is backgrounded or closed
3. Per-session toggle: users can enable/disable notifications for individual sessions via the "..." context menu
4. Global default: a `defaultNotifications` setting in Settings controls the default for new sessions
5. Tapping a notification navigates to the correct tab and selects the session

## Non-Goals

- Throttling/batching (can add later if noisy)
- Email or SMS notifications
- Custom notification sounds

## Design

### Two notification channels

| Channel | When | Requirement | Scope |
|---------|------|-------------|-------|
| Browser Notification API | Tab open but not focused, or user on different browser tab | `Notification.permission === 'granted'` | Desktop + mobile (tab open) |
| Web Push (service worker) | App backgrounded or closed | Service worker + VAPID keys + push subscription | Mobile PWA only |

### Signal: attention state (existing)

The existing `setAttention()` in `sessions.svelte.ts` is the trigger. A session enters attention when:
- It becomes idle (no PTY output for 5s)
- It is NOT the currently-viewed session
- It is not a `terminal` type session
- It is not within the 30s dismiss cooldown

This is already the right signal for **Browser Notifications** — the frontend hooks into `setAttention`, no new detection needed.

For **Web Push**, the server must independently decide when to send push messages since the client may not be running. The server uses the existing `idleChangeCallback` (which fires `session-idle-changed` over WebSocket) as its trigger. The server applies its own attention logic: only sends a push if the session is not a `terminal` type and is in the subscription's watched list. The 30s cooldown and "not currently viewed" checks are NOT applied server-side — they are client concerns. This means push notifications may occasionally fire when the user has just dismissed attention, which is acceptable since the user is on a different device/tab anyway.

### Visibility detection

Notifications should fire when:
1. The browser tab is not focused (`document.hidden === true` via `visibilitychange`)
2. OR the window is not active (`!document.hasFocus()`)
3. OR (for Web Push) the PWA is not in the foreground at all

For case 1+2: checked client-side before firing `Notification`.
For case 3: the server sends a push message; the service worker shows it regardless.

### Per-session notification toggle

**Frontend state:** Add a `notificationSessions` reactive record in `sessions.svelte.ts`:

```typescript
let notificationSessions = $state<Record<string, boolean>>({});
```

- When a session is created, it inherits `configState.defaultNotifications`
- Users toggle via "Notifications" item in the context menu ("..." button)
- The toggle is purely client-side (localStorage-persisted) — no server API needed since notifications are a frontend concern
- Stored in localStorage as `claude-remote-notifications` JSON object mapping sessionId -> boolean
- Pruned alongside `attentionSessions` and `dismissedSessions` in `refreshAll()` — remove entries for sessions that no longer exist

**Context menu addition:** Add a "Notifications On/Off" toggle item to the context menu for active sessions (between Rename and Kill):

```
Rename
Notifications ✓    ← or "Notifications" without checkmark when off
Kill
```

### Global default setting

**Server-side:** Add `defaultNotifications: boolean` to the config schema (default: `true`).

**Config endpoints:** Reuse the existing boolean config endpoint pattern (same as `defaultYolo`, `launchInTmux`):
- `GET /config/defaultNotifications`
- `PATCH /config/defaultNotifications`

**Settings dialog:** Add a checkbox in the "Session Defaults" section:
```
☑ Enable notifications for new sessions
```

**Frontend config state:** Add `defaultNotifications` to `configState` in `config.svelte.ts`.

### Browser Notification API (desktop + open tab)

**Permission request:** On first toggle or first session creation with notifications enabled, call `Notification.requestPermission()`. Store permission state reactively.

**Firing:** In `setAttention()`, after setting `attentionSessions[sessionId] = true`:

```typescript
if (notificationSessions[sessionId] && shouldFireNotification()) {
  fireNotification(session);
}
```

Where `shouldFireNotification()` checks `document.hidden || !document.hasFocus()`.

**Notification content:**
- Title: session displayName (e.g., "claude-remote-cli")
- Body: "Session needs your input"
- Icon: app icon (if PWA manifest exists)
- Tag: `session-${sessionId}` (replaces previous notification for same session)
- Data: `{ sessionId, sessionType, tab }` for click routing

**Click handler:** `notification.onclick` navigates to the correct state:
1. `window.focus()` to bring tab/app to foreground
2. Set `activeTab` based on session type (`repo` -> `repos`, `worktree` -> `worktrees`, `terminal` -> `terminals`)
3. Set `activeSessionId` to the session
4. Call `clearAttention(sessionId)`
5. Close sidebar on mobile

### Web Push API (mobile PWA)

**Server-side components:**

1. **VAPID key pair:** Generated once on first server start, stored in config file as `vapidPublicKey` and `vapidPrivateKey`. Use the `web-push` npm package.

2. **Push subscription endpoint:**
   - `POST /push/subscribe` — stores/updates push subscription object (endpoint, keys) in memory (ephemeral, like sessions). Body: `{ subscription: PushSubscription, sessionIds: string[] }`. The `sessionIds` array is the full set of sessions this client wants notifications for — replaces any previous list for this subscription endpoint. Invalid sessionIds are silently ignored (no error, just not watched).
   - `POST /push/unsubscribe` — removes the entire subscription (used when PWA is uninstalled or user disables all notifications). Body: `{ endpoint: string }`.
   - `GET /push/vapid-key` — returns the public VAPID key for client registration

3. **Push message sending:** When `idleChangeCallback` fires with `idle: true`, the server checks if any push subscriptions include that sessionId (and session is not type `terminal`), and sends a push message via `web-push`.

**Push message payload:**
```json
{
  "type": "session-attention",
  "sessionId": "abc123",
  "displayName": "claude-remote-cli",
  "sessionType": "repo"
}
```

**Service worker (`sw.js`):**
- Registered by the frontend on PWA install
- Listens for `push` events, shows notification
- Listens for `notificationclick`, sends message to client via `clients.matchAll()` + `postMessage`, or opens the app URL with query params `?session=<id>&tab=<tab>`
- The frontend handles the query params on load to auto-select the session

**Frontend PWA integration:**
- Check `'serviceWorker' in navigator && 'PushManager' in window`
- Register service worker
- On notification enable: subscribe via `registration.pushManager.subscribe()` with VAPID public key
- Send subscription to server via `POST /push/subscribe`
- On notification disable for a session: update server via `POST /push/subscribe` with updated sessionId list

**Subscription management:**
- Subscriptions are stored in-memory on the server (no persistence needed)
- Each subscription tracks which sessionIds it's watching
- When a session is killed, its ID is removed from all subscriptions

**Re-subscription after server restart:** On page load / service worker activation, the frontend checks if it has an active push subscription (via `registration.pushManager.getSubscription()`). If it does, it re-sends `POST /push/subscribe` with the current `notificationSessions` list from localStorage. This handles server restarts transparently — the client always re-registers on connect.

**Multiple tabs/clients:** Each browser tab or PWA instance manages its own notification state via localStorage (shared per origin) and its own push subscription (one per service worker registration, so shared across tabs). Browser Notifications are deduplicated via the `tag` field (`session-${sessionId}`) — the browser replaces duplicate tags automatically. Push subscriptions are deduplicated server-side by endpoint URL.

### Navigation on notification click

Both Browser Notification and Web Push use the same routing logic:

```typescript
function navigateToSession(sessionId: string, sessionType: string) {
  const tabMap: Record<string, TabId> = {
    repo: 'repos',
    worktree: 'worktrees',
  };
  ui.activeTab = tabMap[sessionType] || 'repos';
  sessionState.activeSessionId = sessionId;
  clearAttention(sessionId);
  closeSidebar(); // mobile
}
```

For service worker clicks when the app is closed, the URL opened is:
```
/?session=<sessionId>&tab=<tabId>
```
The frontend reads these params on mount and calls `navigateToSession`.

### File changes summary

**Server:**
| File | Change |
|------|--------|
| `server/types.ts` | Add `defaultNotifications`, `vapidPublicKey`, `vapidPrivateKey` to `Config` |
| `server/config.ts` | Add `defaultNotifications: true` to `DEFAULTS` |
| `server/index.ts` | Add `/push/*` routes, `/config/defaultNotifications` endpoints; import `push.ts` and wire idle callback |
| `server/push.ts` | **New module** — VAPID key generation + persistence, push subscription registry, `web-push` send logic. Owns the `web-push` dependency exclusively |

**Frontend:**
| File | Change |
|------|--------|
| `frontend/src/lib/state/sessions.svelte.ts` | Add `notificationSessions` state, localStorage persistence, fire notification in `setAttention` |
| `frontend/src/lib/state/config.svelte.ts` | Add `defaultNotifications` to config state |
| `frontend/src/lib/notifications.ts` | **New module** — Browser Notification API wrapper, permission management, service worker registration, push subscription |
| `frontend/src/lib/api.ts` | Add `fetchDefaultNotifications`, `setDefaultNotifications`, push subscribe/unsubscribe API calls |
| `frontend/src/App.svelte` | Read URL params for notification click routing, initialize notification module |
| `frontend/src/components/SessionItem.svelte` | No change (menu items passed from parent) |
| `frontend/src/components/dialogs/SettingsDialog.svelte` | Add "Enable notifications" checkbox in Session Defaults |
| `frontend/public/sw.js` | **New file** — service worker for push notifications (Vite copies `public/` to build output automatically) |

**Sidebar (menu items builder):** Wherever context menu items are built for active sessions, add the "Notifications" toggle item.

### Architecture compliance

- **New server module `push.ts`** owns the `web-push` dependency and subscription registry — follows the single-concern module pattern (ADR-001)
- `index.ts` imports `push.ts` and wires routes — composition root pattern maintained
- No new external test framework — push.ts can be tested with `node:test`
- Config changes follow existing boolean config endpoint pattern (e.g., `defaultYolo`, `launchInTmux`)
- Frontend notification state is client-side + localStorage (no server round-trip for per-session toggles)

### Progressive enhancement

The feature degrades gracefully:
1. If `Notification` API unavailable → no desktop notifications, no errors
2. If service worker unavailable → no push notifications, browser notifications still work
3. If user denies notification permission → toggle appears disabled with "(blocked)" label
4. If VAPID keys fail to generate → push routes return 501, browser notifications still work

### Dependencies

| Package | Purpose | Where |
|---------|---------|-------|
| `web-push` | VAPID key generation, push message sending | Server (`push.ts`) |

No frontend dependencies added — Browser Notification API and Push API are built-in.
