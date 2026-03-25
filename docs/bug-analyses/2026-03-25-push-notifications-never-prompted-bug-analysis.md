# Bug Analysis: Push Notifications Never Prompted or Delivered

> **Status**: Confirmed | **Date**: 2026-03-25
> **Severity**: High
> **Affected Area**: `frontend/src/lib/notifications.ts`, `frontend/src/components/dialogs/SettingsDialog.svelte`, `frontend/src/App.svelte`

## Symptoms
- User is never prompted to enable notifications when using the PWA
- Push notifications never fire, even when sessions need attention
- No visible indication that notifications require browser permission
- The Settings "Notifications" toggle appears to do nothing

## Reproduction Steps
1. Install the PWA (add to home screen)
2. Open Settings → General → Notifications → toggle ON
3. Start a Claude agent session and wait for it to reach idle/permission state
4. Observe: no notification appears, no permission prompt ever shown

## Root Cause

**`requestPermission()` is exported from `notifications.ts` (line 27) but never called anywhere in the application.** The entire push notification backend is properly implemented (VAPID keys, service worker, web-push library), but the frontend never acquires browser permission.

The broken chain:

| Step | Code | What happens |
|------|------|-------------|
| 1. User toggles "Notifications" ON | `SettingsDialog.svelte:292` | Sets `config.defaultNotifications` — controls *which sessions* should notify. **Never calls `requestPermission()`.** |
| 2. App initializes push | `App.svelte:269` → `initPushNotifications()` | Registers `/sw.js` service worker. **Does not request permission.** |
| 3. App syncs push subscription | `App.svelte:270` → `resubscribeIfNeeded()` | Calls `pushManager.subscribe()` which **requires `granted` permission**. Fails silently in catch block. |
| 4. Session reaches idle state | `sessions.svelte.ts:140` → `fireNotification()` | Checks `Notification.permission !== 'granted'` → **early return, notification dropped.** |
| 5. Server tries web push | `push.ts:114` → `webpush.sendNotification()` | **Never reached** because no subscription was ever registered (step 3 failed). |

The `requestPermission()` function exists but has zero call sites outside its own definition.

## Evidence
- `grep -r "requestPermission" frontend/src/` → only 2 hits, both in `notifications.ts` (definition + implementation). Zero callers.
- `Notification.permission` starts as `'default'` — without an explicit `requestPermission()` call triggered by user gesture, it stays that way forever.
- All error paths in the notification pipeline use silent catches (`catch {}` or early returns), so the failure is completely invisible.
- On iOS PWA (Safari 16.4+), push notifications additionally require: (a) the app to be installed as PWA, (b) permission requested via a user gesture (button click), (c) the service worker registered before the permission request.

## Impact Assessment
- **All users** are affected — no one can receive push notifications
- The feature appears to work (toggle exists, service worker registers) but silently does nothing
- Mobile PWA users are most impacted — notifications are the primary way to know a session needs attention when the app is backgrounded
- L-002 (mobile WebSocket reconnection) partially mitigates this by detecting stale connections on resume, but doesn't help when the app is fully backgrounded

## Recommended Fix Direction

1. **Permission acquisition flow**: When the user toggles "Notifications" ON in settings, call `requestPermission()`. If denied, show the current state and instructions.
2. **Permission state UI**: Show the browser permission state next to the toggle (e.g., "Blocked — check browser settings", "Granted", "Not yet asked").
3. **Push subscription chaining**: After permission is granted, immediately call `syncPushSubscription()` to register the push endpoint.
4. **iOS PWA considerations**: The permission request must be triggered by a direct user gesture (button click). The current `onchange` handler on the checkbox satisfies this requirement on most browsers, but iOS may need an explicit tap-to-enable button.
5. **First-run prompt**: Consider prompting for notification permission on first authenticated session (with a dismissible banner), not just buried in settings.

## Architecture Review

### Systemic Spread

The silent-failure pattern is isolated to the notification pipeline. However, the broader issue — **exported-but-never-called functions** — could exist elsewhere. The `requestPermission()` function was clearly written with the intent to be called, but the call site was never wired up, likely because the notification pipeline was built bottom-up (server → service worker → subscription → fire) without a top-down integration pass.

No other instances of this pattern were found in the current codebase.

### Design Gap

The Settings UI treats "enable notifications" as a single boolean, but browser notifications actually have a **two-layer permission model**:

1. **App-level**: which sessions should trigger notifications (what `defaultNotifications` controls)
2. **Browser-level**: whether the browser allows notifications at all (`Notification.permission`)

The settings toggle only addresses layer 1. Layer 2 is completely absent from the UI. This is a design gap — any feature that depends on browser permissions should surface the permission state and provide a way to acquire it.

Additionally, the notification toggle's description says "Push notifications when sessions need attention" — implying it enables push notifications, when it actually only controls session-level opt-in. This creates a false sense of enablement.

### Testing Gaps

There are no tests for the notification permission flow. The existing test infrastructure (`node:test`, no browser environment) makes it difficult to test browser APIs like `Notification.requestPermission()`, but the *logic* of the permission acquisition flow (when to prompt, what state to show) could be tested as pure functions.

The silent error handling (`catch {}`) in `syncPushSubscription()` and `initPushNotifications()` means even integration testing would show no failures — the broken state is indistinguishable from success.

### Harness Context Gaps

None — the notification module (`push.ts`, `notifications.ts`) is documented in ARCHITECTURE.md and FRONTEND.md. The gap is in the implementation, not the documentation.
