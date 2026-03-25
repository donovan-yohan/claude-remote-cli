# Fix Push Notification Permission Flow

> **Status**: Completed | **Created**: 2026-03-25 | **Last Updated**: 2026-03-25
> **Bug Analysis**: `docs/bug-analyses/2026-03-25-push-notifications-never-prompted-bug-analysis.md`
> **Consulted Learnings**: L-018, L-019
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-25 | Design | Request permission when toggle is turned ON, not on app startup | User gesture required (especially iOS PWA); settings toggle is the natural place |
| 2026-03-25 | Design | Show permission state as dynamic description text on SettingRow | Minimal UI change, reuses existing component structure |
| 2026-03-25 | Design | Chain push subscription immediately after permission grant | Permission + subscription should be a single atomic user action |
| 2026-03-25 | Design | Skip first-run prompt for now | Settings toggle is discoverable enough; a prompt can be added later |

## Progress

- [x] Task 1: Wire permission request into notifications toggle
- [x] Task 2: Add permission state display to settings
- [x] Task 3: Chain push subscription after permission grant
- [x] Task 4: Build and verify

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Wire permission request into notifications toggle

**Goal:** When user turns ON the Notifications toggle, request browser permission. If denied, revert the toggle.

**File:** `frontend/src/components/dialogs/SettingsDialog.svelte`

**Steps:**

1. Import `requestPermission` and `getPermissionState` from `../../lib/notifications.js`
2. Update `handleNotificationsChange()`:
   - When toggling ON (`config.defaultNotifications` is now true): call `requestPermission()`
   - If result is `'denied'` or `'unsupported'`: revert toggle, set error message
   - If result is `'granted'`: proceed with `setDefaultNotifications()` as before
   - When toggling OFF: no permission change needed, just call `setDefaultNotifications()` as before
3. The `onchange` handler on the checkbox fires from a user gesture, which satisfies the iOS PWA requirement

**Verification:** Build succeeds (`npm run build`)

---

### Task 2: Add permission state display to settings

**Goal:** Show the browser notification permission state as the description text on the Notifications SettingRow.

**File:** `frontend/src/components/dialogs/SettingsDialog.svelte`

**Steps:**

1. Add a reactive variable `notificationPermission` that reads `getPermissionState()`
2. Update it after `requestPermission()` resolves in `handleNotificationsChange()`
3. Derive a description string from the permission state:
   - `'granted'` → `"Notify when sessions need attention"`
   - `'denied'` → `"Blocked by browser — check site settings to enable"`
   - `'default'` → `"Notify when sessions need attention"` (neutral — permission will be requested on toggle)
   - `'unsupported'` → `"Not supported in this browser"`
4. Replace the static description on the Notifications SettingRow with the dynamic one
5. When permission is `'denied'`, disable the checkbox to prevent toggling ON (it would just fail)

**Verification:** Build succeeds (`npm run build`)

---

### Task 3: Chain push subscription after permission grant

**Goal:** After permission is granted, immediately register the push subscription with the server.

**Files:** `frontend/src/components/dialogs/SettingsDialog.svelte`, `frontend/src/lib/notifications.ts`

**Steps:**

1. Import `syncPushSubscription` and `getNotificationSessionIds` into SettingsDialog
2. In `handleNotificationsChange()`, after permission is granted and `setDefaultNotifications()` succeeds:
   - Call `syncPushSubscription(getNotificationSessionIds())` to register the endpoint
3. In `notifications.ts`, add console.warn to the catch blocks in `syncPushSubscription()` and `initPushNotifications()` so failures are at least visible in DevTools (addresses L-019)

**Verification:** Build succeeds (`npm run build`)

---

### Task 4: Build and verify

**Goal:** Ensure the project builds and tests pass.

**Steps:**

1. Run `npm run build`
2. Run `npm test`
3. Fix any TypeScript or test errors

**Verification:** Both commands exit 0

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Bug analysis correctly identified the full broken chain — implementation was straightforward
- All four tasks touched only two files, keeping blast radius small
- The two-layer permission model (app-level toggle + browser permission) maps cleanly to SettingRow's name/description/action pattern

**What didn't:**
- The original push-notifications plan (2026-03-13) implemented the backend but never wired the permission request — a top-down integration pass would have caught this

**Learnings to codify:**
- L-018 and L-019 already captured during bug analysis phase
