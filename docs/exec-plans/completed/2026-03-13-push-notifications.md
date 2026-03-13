# Push Notifications Implementation Plan

> **Status**: Active | **Created**: 2026-03-13 | **Last Updated**: 2026-03-13 (All 8 tasks complete)
> **Design Doc**: `docs/design-docs/2026-03-13-push-notifications-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-13 | Plan | 8 tasks, server-first then frontend | Server module and types must exist before frontend can integrate |

## Progress

- [x] Task 1: Server types + config defaults _(completed 2026-03-13)_
- [x] Task 2: New server module `push.ts` _(completed 2026-03-13)_
- [x] Task 3: Server routes in `index.ts` _(completed 2026-03-13)_
- [x] Task 4: Frontend API functions + config state _(completed 2026-03-13)_
- [x] Task 5: Frontend notifications module _(completed 2026-03-13)_
- [x] Task 6: Frontend session state integration (per-session toggle + fire on attention) _(completed 2026-03-13)_
- [x] Task 7: UI — Settings dialog + context menu + App.svelte URL routing _(completed 2026-03-13)_
- [x] Task 8: Service worker + build verification _(completed 2026-03-13)_

## Surprises & Discoveries

| Date | What | Impact | Resolution |
|------|------|--------|------------|
| 2026-03-13 | Existing `sw.js` already present in `frontend/public/` (minimal PWA install stub) | No new file needed — extended existing | Added push + notificationclick handlers to existing sw.js |
| 2026-03-13 | `onIdleChange` was single-subscriber — needed multi-callback support | Changed to array-based callbacks in sessions.ts | Simple refactor: replaced single callback with `idleChangeCallbacks[]` array |
| 2026-03-13 | Uint8Array type incompatibility with `applicationServerKey` in PushManager.subscribe | Build would fail on strict TS | Used `.buffer as ArrayBuffer` cast |

## Plan Drift

| Date | What planned | What happened | Impact |
|------|-------------|---------------|--------|

---

**Goal:** Add push notifications (Browser Notification API + Web Push via service worker) that fire when sessions need user input, with per-session toggle and global default setting.

**Tech Stack:** TypeScript + ESM backend, Svelte 5 frontend, `web-push` npm package (server only)

---

### Task 1: Server types + config defaults

**Files:**
- `server/types.ts`
- `server/config.ts`

**Changes:**
1. In `types.ts`, add to `Config` interface:
   - `defaultNotifications: boolean`
   - `vapidPublicKey?: string | undefined`
   - `vapidPrivateKey?: string | undefined`

2. In `config.ts`, add to `DEFAULTS`:
   - `defaultNotifications: true`

**Verification:** `npm run build` succeeds (type-check).

---

### Task 2: New server module `push.ts`

**Files:**
- `server/push.ts` (new)

**Changes:**
Create `server/push.ts` with:

1. **VAPID key management:**
   - `ensureVapidKeys(config, configPath, saveConfig)` — checks if `vapidPublicKey`/`vapidPrivateKey` exist in config; if not, generates via `web-push.generateVAPIDKeys()`, saves to config, and calls `webpush.setVapidDetails()`. Returns public key.
   - Uses `mailto:noreply@claude-remote-cli.local` as VAPID subject.

2. **Subscription registry:**
   - `const subscriptions = new Map<string, { subscription: PushSubscription, sessionIds: Set<string> }>()` — keyed by endpoint URL
   - `subscribe(subscription, sessionIds)` — upserts subscription, replaces sessionIds
   - `unsubscribe(endpoint)` — removes subscription
   - `removeSession(sessionId)` — removes sessionId from all subscriptions
   - `getVapidPublicKey()` — returns the public key

3. **Push sending:**
   - `notifySessionIdle(sessionId, session)` — iterates subscriptions, sends push to any that include this sessionId. Payload: `{ type: 'session-attention', sessionId, displayName, sessionType }`. On 410 Gone response, auto-removes stale subscription.

4. Export: `ensureVapidKeys`, `subscribe`, `unsubscribe`, `removeSession`, `notifySessionIdle`, `getVapidPublicKey`

**Dependencies:** `npm install web-push` + `npm install -D @types/web-push` (if types exist, otherwise inline type declarations).

**Verification:** `npm run build` succeeds.

---

### Task 3: Server routes in `index.ts`

**Files:**
- `server/index.ts`

**Changes:**
1. Import `push.ts`: `import * as push from './push.js';`

2. After config load, call `push.ensureVapidKeys(config, CONFIG_PATH, saveConfig)`.

3. Add boolean config endpoint: `boolConfigEndpoints('defaultNotifications', true);`

4. Add push routes (after `requireAuth`):
   ```typescript
   // GET /push/vapid-key
   app.get('/push/vapid-key', requireAuth, (_req, res) => {
     const key = push.getVapidPublicKey();
     if (!key) { res.status(501).json({ error: 'Push not available' }); return; }
     res.json({ vapidPublicKey: key });
   });

   // POST /push/subscribe
   app.post('/push/subscribe', requireAuth, (req, res) => {
     const { subscription, sessionIds } = req.body;
     if (!subscription?.endpoint) { res.status(400).json({ error: 'subscription required' }); return; }
     push.subscribe(subscription, sessionIds || []);
     res.json({ ok: true });
   });

   // POST /push/unsubscribe
   app.post('/push/unsubscribe', requireAuth, (req, res) => {
     const { endpoint } = req.body;
     if (!endpoint) { res.status(400).json({ error: 'endpoint required' }); return; }
     push.unsubscribe(endpoint);
     res.json({ ok: true });
   });
   ```

5. Wire idle callback to push: In the existing `sessions.onIdleChange` (currently in `ws.ts`), or add a second idle listener. Since `onIdleChange` is single-subscriber, we need to modify the approach:
   - In `index.ts`, after `setupWebSocket`, add a wrapper: hook into the existing `broadcastEvent` pattern or modify `sessions.onIdleChange` to support multiple listeners (preferred: change `onIdleChange` in `sessions.ts` to accept multiple callbacks).
   - Alternative (simpler): In `ws.ts`, the `onIdleChange` callback already fires `broadcastEvent`. Add push notification there by importing push. But `ws.ts` should not import `push.ts` (architecture: modules don't cross-import except downward from index). So instead: change `sessions.ts` `onIdleChange` to support multiple callbacks, then in `index.ts` register a second callback for push.

6. In `sessions.ts`, change `onIdleChange` to support multiple callbacks:
   ```typescript
   const idleChangeCallbacks: IdleChangeCallback[] = [];
   function onIdleChange(cb: IdleChangeCallback): void {
     idleChangeCallbacks.push(cb);
   }
   // In resetIdleTimer, call all callbacks
   ```

7. In `index.ts`, after `setupWebSocket`, register push idle callback:
   ```typescript
   sessions.onIdleChange((sessionId, idle) => {
     if (idle) {
       const session = sessions.get(sessionId);
       if (session && session.type !== 'terminal') {
         push.notifySessionIdle(sessionId, session);
       }
     }
   });
   ```

8. In `sessions.kill()`, call `push.removeSession(id)` — but `sessions.ts` should not import `push.ts`. Instead, add this in `index.ts` by hooking into the kill flow, or by adding a generic `onSessionKill` callback in `sessions.ts`. Simplest: just do it in the DELETE /sessions/:id handler in `index.ts`.

**Files also modified:** `server/sessions.ts` (multi-callback `onIdleChange`)

**Verification:** `npm run build` succeeds. Server starts without errors.

---

### Task 4: Frontend API functions + config state

**Files:**
- `frontend/src/lib/api.ts`
- `frontend/src/lib/state/config.svelte.ts`

**Changes:**
1. In `api.ts`, add:
   ```typescript
   export const fetchDefaultNotifications = () => fetchConfigBool('defaultNotifications');
   export const setDefaultNotifications = (v: boolean) => setConfigBool('defaultNotifications', v);

   export async function fetchVapidKey(): Promise<string | null> {
     try {
       const data = await json<{ vapidPublicKey: string }>(await fetch('/push/vapid-key'));
       return data.vapidPublicKey;
     } catch { return null; }
   }

   export async function pushSubscribe(subscription: PushSubscriptionJSON, sessionIds: string[]): Promise<void> {
     await fetch('/push/subscribe', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ subscription, sessionIds }),
     });
   }

   export async function pushUnsubscribe(endpoint: string): Promise<void> {
     await fetch('/push/unsubscribe', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ endpoint }),
     });
   }
   ```

2. In `config.svelte.ts`, add `defaultNotifications: true` to `configState` initial value, and fetch it in `refreshConfig()`.

**Verification:** `npm run build` succeeds.

---

### Task 5: Frontend notifications module

**Files:**
- `frontend/src/lib/notifications.ts` (new)

**Changes:**
Create a module that:

1. **Permission management:**
   - `getPermissionState()` — returns `Notification.permission` or `'unsupported'`
   - `requestPermission()` — calls `Notification.requestPermission()`, returns result

2. **Browser Notification firing:**
   - `fireNotification(session: { id, displayName, type })` — creates `new Notification(displayName, { body: 'Session needs your input', tag: 'session-' + id, data: { sessionId: id, sessionType: type } })`. Attaches onclick handler.
   - `shouldFireNotification()` — returns `document.hidden || !document.hasFocus()`

3. **Click handler setup:**
   - Accept a `onNotificationClick: (sessionId, sessionType) => void` callback during init
   - Browser notifications: `notification.onclick = () => { window.focus(); onNotificationClick(sessionId, sessionType); }`

4. **Service worker + Web Push (conditional):**
   - `initPushNotifications()` — registers `sw.js`, gets VAPID key from server, subscribes via `pushManager.subscribe()`, stores subscription
   - `syncPushSubscription(sessionIds: string[])` — sends current subscription + sessionIds to server
   - `hasPushSupport()` — returns `'serviceWorker' in navigator && 'PushManager' in window`
   - Listen for `message` events from service worker for notification click routing

5. **Re-subscription:** `resubscribeIfNeeded(sessionIds)` — checks `getSubscription()`, if exists, re-sends to server. Called on page load.

Export all functions.

**Verification:** `npm run build` succeeds.

---

### Task 6: Frontend session state integration

**Files:**
- `frontend/src/lib/state/sessions.svelte.ts`

**Changes:**
1. Add `notificationSessions` reactive state:
   ```typescript
   let notificationSessions = $state<Record<string, boolean>>({});
   ```

2. Load from localStorage on module init:
   ```typescript
   try {
     const stored = localStorage.getItem('claude-remote-notifications');
     if (stored) notificationSessions = JSON.parse(stored);
   } catch {}
   ```

3. Add functions:
   - `getNotificationSessions()` — returns `notificationSessions`
   - `setNotificationEnabled(sessionId: string, enabled: boolean)` — sets `notificationSessions[sessionId] = enabled`, saves to localStorage, syncs push subscription if available
   - `initSessionNotification(sessionId: string, defaultEnabled: boolean)` — called on session creation, sets default
   - Expose via `getSessionState()` return object

4. In `refreshAll()`, prune `notificationSessions` entries for dead sessions (same pattern as `attentionSessions`).

5. In `setAttention()`, after setting `attentionSessions[sessionId] = true`, call notification fire logic:
   ```typescript
   import { fireNotification, shouldFireNotification } from '../notifications.js';
   if (notificationSessions[sessionId] && shouldFireNotification()) {
     fireNotification(session);
   }
   ```

6. Save to localStorage helper: called after any mutation to `notificationSessions`.

**Verification:** `npm run build` succeeds.

---

### Task 7: UI — Settings dialog + context menu + App.svelte URL routing

**Files:**
- `frontend/src/components/dialogs/SettingsDialog.svelte`
- `frontend/src/components/SessionList.svelte`
- `frontend/src/App.svelte`

**Changes:**

1. **SettingsDialog:** In "Session Defaults" section, add checkbox:
   ```svelte
   <div class="devtools-row">
     <input id="default-notifications" type="checkbox" class="dialog-checkbox" bind:checked={config.defaultNotifications} onchange={handleNotificationsChange} />
     <label for="default-notifications" class="devtools-label">Enable notifications for new sessions</label>
   </div>
   ```
   Add handler `handleNotificationsChange` following same pattern as `handleYoloChange`.

2. **SessionList:** In `activeSessionMenu()`, add notification toggle between Rename and Kill:
   ```typescript
   function activeSessionMenu(session: SessionSummary): MenuItem[] {
     const notifEnabled = sessionState.notificationSessions[session.id] ?? false;
     return [
       { label: 'Rename', action: () => handleRenameSession(session) },
       { label: notifEnabled ? 'Notifications \u2713' : 'Notifications', action: () => toggleNotification(session) },
       { label: 'Kill', action: () => handleKillSession(session), danger: true },
     ];
   }
   ```
   Add `toggleNotification` function that calls `setNotificationEnabled`.

3. **App.svelte:** On mount (after auth check), read URL params `?session=<id>&tab=<tab>` and navigate:
   ```typescript
   const params = new URLSearchParams(window.location.search);
   const sessionParam = params.get('session');
   const tabParam = params.get('tab');
   if (sessionParam) {
     // Clean URL
     window.history.replaceState({}, '', '/');
     // Navigate after sessions load
     // ... set activeTab, activeSessionId
   }
   ```
   Also set up service worker message listener for notification clicks.

4. **App.svelte:** On auth success + sessions loaded, call `resubscribeIfNeeded()` with current notification session IDs.

**Verification:** `npm run build` succeeds. UI renders correctly.

---

### Task 8: Service worker + build verification

**Files:**
- `frontend/public/sw.js` (new)

**Changes:**
1. Create `sw.js`:
   ```javascript
   self.addEventListener('push', (event) => {
     const data = event.data?.json() ?? {};
     event.waitUntil(
       self.registration.showNotification(data.displayName || 'Claude Remote CLI', {
         body: 'Session needs your input',
         tag: 'session-' + (data.sessionId || ''),
         data: { sessionId: data.sessionId, sessionType: data.sessionType },
       })
     );
   });

   self.addEventListener('notificationclick', (event) => {
     event.notification.close();
     const { sessionId, sessionType } = event.notification.data || {};
     const tabMap = { repo: 'repos', worktree: 'worktrees' };
     const tab = tabMap[sessionType] || 'repos';
     const url = '/?session=' + sessionId + '&tab=' + tab;

     event.waitUntil(
       clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
         for (const client of clientList) {
           if (client.url.includes(self.location.origin)) {
             client.postMessage({ type: 'notification-click', sessionId, sessionType });
             return client.focus();
           }
         }
         return clients.openWindow(url);
       })
     );
   });
   ```

2. Run `npm install web-push` (if not done in Task 2).

3. Run `npm run build` — verify no errors.

4. Run `npm test` — verify existing tests pass.

**Verification:** Full build succeeds, tests pass, `dist/frontend/sw.js` exists in build output.
