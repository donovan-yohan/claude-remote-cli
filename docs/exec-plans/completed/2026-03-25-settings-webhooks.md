# Settings Redesign + Webhook Self-Service

> **Status**: Active | **Created**: 2026-03-25
> **Design docs**: `docs/design-docs/2026-03-25-settings-redesign-design.md` + `docs/design-docs/2026-03-24-webhook-self-service-design.md`
> **Branch**: `dy/feat/settings-webhooks`

## Summary

Full-screen settings modal with TOC navigation, design language unification across all dialogs, webhook self-service backend (auto-provision via GitHub API), and integration accordion UI. Two design docs, one feature branch.

## Progress

### Foundation (Tasks 1-3)
- [x] Task 1: Extract DialogShell.svelte — shared dialog wrapper with fullscreen/compact variants
- [x] Task 2: Extract SettingRow.svelte — consistent setting row component
- [x] Task 3: Extract extractOwnerRepo + buildRepoMap to git.ts — DRY refactor for 3 consumers

### Backend (Tasks 4-6)
- [x] Task 4: webhook-manager.ts — new server module for smee lifecycle + GitHub webhook CRUD
- [x] Task 5: Wire webhook-manager into index.ts — unconditional mount, hot-reload, routes
- [x] Task 6: OAuth scope change + config model updates — types.ts, github-app.ts, webhooks.ts getter

### Frontend Shell (Tasks 7-9)
- [x] Task 7: Rewrite SettingsDialog as full-screen modal — 4 sections, search bar, hamburger TOC
- [x] Task 8: Migrate compact dialogs to DialogShell — CustomizeSession, DeleteWorktree, AddWorkspace
- [x] Task 9: TOC drawer component — IntersectionObserver, 150ms highlight transition, keyboard nav

### Integration UI (Tasks 10-12)
- [x] Task 10: GitHubIntegration.svelte — accordion row with device flow, re-auth banner, disconnect confirm
- [x] Task 11: WebhookIntegration.svelte — accordion row with setup, health, backfill, test ping, remove
- [x] Task 12: JiraIntegration.svelte — accordion row with CLI install instructions

### Search + Polish (Tasks 13-15)
- [x] Task 13: In-modal settings search — filter sections by query, dim non-matching (built into Task 7)
- [x] Task 14: Spotlight settings integration — settings as new result type in Cmd+K
- [x] Task 15: Smart polling refactor — repo-scoped broadcast events, per-workspace polling

### Cleanup (Task 16)
- [x] Task 16: Dead code cleanup + design language unification — delete dead CSS, fix .btn-danger, hardcoded colors, WorkspaceSettingsDialog refreshAll bug, update ARCHITECTURE.md module count

---

### Task 1: Extract DialogShell.svelte

**Why:** 5 dialogs duplicate ~420 lines of identical CSS (chrome, buttons, checkboxes, headers, footers, backdrops). Extracting a shared shell is the foundation for everything else.

**Files:**
- CREATE `frontend/src/components/dialogs/DialogShell.svelte`
- MODIFY `frontend/src/app.css` — add shared dialog tokens if needed

**Spec:**
- Slot-based wrapper: `header` slot, default slot (body), `footer` slot
- Props: `variant: 'fullscreen' | 'compact'`, `width?: string` (for compact), `title: string`
- Fullscreen variant: `100vw × 100vh` (or `inset: 24px` on >1200px screens), slide-up entrance animation
- Compact variant: centered, custom width via `min(width, 95vw)`, fade+scale entrance animation
- Terminal aesthetic: `border-radius: 0`, `var(--font-mono)` on buttons, `--surface` background
- Shared CSS: `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger` (outlined red), `.btn-sm`, `.dialog-checkbox`, `.error-msg`
- `::backdrop { background: rgba(0,0,0,0.6) }`
- Backdrop click to close, close button in header
- Exports `open()` and `close()` methods
- `aria-modal="true"`, `role="dialog"`

**Acceptance:** All 5 existing dialogs can consume this shell with zero visual regression on their current appearance (before redesign).

**Depends on:** Nothing

---

### Task 2: Extract SettingRow.svelte

**Why:** Design spec defines a precise row anatomy — name, description, right-aligned action — that must be consistent across every setting. Without a component, each developer re-implements it differently.

**Files:**
- CREATE `frontend/src/components/dialogs/SettingRow.svelte`

**Spec:**
- Props: `name: string`, `description?: string`
- Slot for action (toggle, select, button)
- Typography: name=`var(--font-size-base)` weight 500, desc=`var(--font-size-sm)` `var(--text-muted)`
- Layout: flex row, action right-aligned, `min-height: 44px`, `padding: 12px 0`
- Mobile (<600px): if action is wide (select dropdown), stack vertically

**Depends on:** Nothing (independent of DialogShell)

---

### Task 3: Extract extractOwnerRepo + buildRepoMap to git.ts

**Why:** This utility exists in 3 places (org-dashboard.ts:60, review-poller.ts:86, and will be needed by webhook-manager). DRY emergency.

**Files:**
- MODIFY `server/git.ts` — add exported `extractOwnerRepo()` and `buildRepoMap()`
- MODIFY `server/org-dashboard.ts` — delete local copy, import from git.ts
- MODIFY `server/review-poller.ts` — delete local copy, import from git.ts
- CREATE `test/git-utils.test.ts` — test extractOwnerRepo with SSH, HTTPS, non-GitHub, malformed URLs

**Spec:**
- `extractOwnerRepo(remoteUrl: string): string | null` — handles SSH (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo.git`)
- `buildRepoMap(workspacePaths: string[], exec: typeof execFileAsync): Promise<Map<string, string>>` — maps owner/repo → workspace path
- Tests: SSH URL, HTTPS URL, HTTPS with .git suffix, non-GitHub URL → null, empty string → null, GHE URL → null

**Depends on:** Nothing

---

### Task 4: webhook-manager.ts — new server module

**Why:** Core backend for webhook self-service. Owns smee client lifecycle, GitHub webhook CRUD, health state, and backfill.

**Files:**
- CREATE `server/webhook-manager.ts`
- CREATE `test/webhook-manager.test.ts`

**Spec:**
- Interface: `WebhookManagerDeps { configPath: string; broadcastEvent: (...) => void; fetchFn?: typeof fetch; execAsync?: typeof execFileAsync }`
- Exports: `createWebhookManagerRouter(deps)` → Express Router mounted at `/webhooks/manage`
- Internal: smee client singleton, health state (`{ smeeConnected, lastEventAt }`)
- Routes (all behind requireAuth):
  - `POST /setup` — generate smee channel (`GET https://smee.io/new` follow redirect), generate secret (`crypto.randomBytes(20).toString('hex')`), save to config, start smee client
  - `DELETE /setup` — delete all tracked GH webhooks (best-effort), clear config fields, stop smee
  - `GET /status` — return `{ configured, smeeConnected, lastEventAt, autoProvision, secretPreview }`
  - `POST /reload` — stop old smee, start new from fresh config
  - `POST /ping` — call GitHub API `POST /repos/{owner}/{repo}/hooks/{id}/pings` on first tracked webhook
  - `POST /repos` — create GH webhook for a repo, store webhookId in workspaceSettings
  - `POST /repos/remove` — delete GH webhook, remove webhookId
  - `POST /backfill` — create webhooks for all workspaces (bounded concurrency: 5), return per-repo results
- GitHub API: `POST /repos/{owner}/{repo}/hooks` with `{ config: { url: smeeUrl, content_type: 'json', secret }, events: ['pull_request', 'pull_request_review', 'check_suite', 'check_run'] }`
- Error handling: 403 → `webhookError: 'not-admin'`, 404 → `webhookError: 'not-found'`, 422 → treat as success, 401 → scope error
- smee channel creation: `GET https://smee.io/new`, follow redirect, validate URL format, handle non-redirect response
- Tests: fetch injection pattern (match github-app.test.ts). Cover: setup happy path, setup smee-down, createWebhook 403/404/422/401, deleteWebhook 404, backfill partial failure, ping happy + timeout, status endpoint

**Depends on:** Task 3 (uses extractOwnerRepo from git.ts)

---

### Task 5: Wire webhook-manager into index.ts

**Why:** Composition root needs to mount the new router, delegate smee lifecycle, and support unconditional webhook receiver mount.

**Files:**
- MODIFY `server/index.ts` — mount webhook-manager router, remove inline smee code, mount webhook receiver unconditionally
- MODIFY `server/webhooks.ts` — change `WebhookDeps.secret` from `string` to `() => string | undefined`, add runtime validation
- MODIFY `test/webhooks.test.ts` — update mock to use getter pattern

**Spec:**
- Mount webhook receiver (`/webhooks`) unconditionally (not behind `if (webhookSecret)`)
- `webhooks.ts`: if getter returns undefined, respond 401 "Webhooks not configured"
- Move smee client lifecycle from index.ts (lines 462-513) to webhook-manager.ts
- Mount webhook-manager router at `/webhooks/manage`
- Pass `broadcastEvent` to webhook-manager via delegate pattern (same as current webhook router)
- `onConnected` callback in github-app: call `reloadSmee()` from webhook-manager instead of `startWebhookPolling()`
- Add repo identity to webhook broadcasts: extract `repository.full_name` from payload body in webhooks.ts

**Depends on:** Task 4

---

### Task 6: OAuth scope + config model updates

**Why:** Webhook CRUD requires `admin:repo_hook` scope. Config needs new fields for webhook state.

**Files:**
- MODIFY `server/types.ts` — add `autoProvision`, `backfillOffered` to `Config.github`; add `webhookId`, `webhookEnabled`, `webhookError` to `WorkspaceSettings`
- MODIFY `server/github-app.ts` — change scope from `'repo'` to `'repo admin:repo_hook'`
- MODIFY `server/workspaces.ts` — on workspace DELETE, call webhook deletion before removing workspaceSettings
- MODIFY `test/github-app.test.ts` — update scope assertion

**Spec:**
- `Config.github.autoProvision?: boolean` (defaults false)
- `Config.github.backfillOffered?: boolean` (defaults false)
- `WorkspaceSettings.webhookId?: number`
- `WorkspaceSettings.webhookEnabled?: boolean`
- `WorkspaceSettings.webhookError?: string` ('not-admin' | 'not-found' | null)
- Workspace DELETE handler: before removing from workspaces[], check if webhookId exists in workspaceSettings, if so call GitHub API to delete it (best-effort, log failure)

**Depends on:** Task 4 (needs webhook-manager for deletion)

---

### Task 7: Rewrite SettingsDialog as full-screen modal

**Why:** Core UI redesign — replace the 460px dialog with a full-screen scrollable settings page.

**Files:**
- REWRITE `frontend/src/components/dialogs/SettingsDialog.svelte`
- MODIFY `frontend/src/lib/api.ts` — add webhook management API calls

**Spec:**
- Uses `DialogShell variant="fullscreen"`
- Header: hamburger button (☰), "SETTINGS" title, search input, close button (✕)
- Body: 4 sections (GENERAL, INTEGRATIONS, ADVANCED, ABOUT) using UPPERCASE section headings
- GENERAL: 5 `SettingRow` components (agent select, 4 toggles)
- INTEGRATIONS: 3 integration rows (`GitHubIntegration`, `WebhookIntegration`, `JiraIntegration`)
- ADVANCED: 2 `SettingRow` components (dev tools toggle, analytics with clear button)
- ABOUT: version row
- Content: `max-width: 640px`, centered, scrollable
- Each section has an `id` for scroll targeting
- Mobile: full-width, search below title
- API calls: existing config endpoints + new webhook management endpoints in api.ts
- Delete ~68 lines dead CSS (root directory remnants)

**Depends on:** Tasks 1, 2 (DialogShell + SettingRow), Tasks 10-12 (integration components)

*Note: Tasks 7 and 10-12 are co-dependent. Implementation order: create integration component stubs first in Task 10-12, then wire them into Task 7.*

---

### Task 8: Migrate compact dialogs to DialogShell

**Why:** Unify visual language. 3 remaining dialogs adopt the shared shell + terminal aesthetic.

**Files:**
- MODIFY `frontend/src/components/dialogs/CustomizeSessionDialog.svelte`
- MODIFY `frontend/src/components/dialogs/DeleteWorktreeDialog.svelte`
- MODIFY `frontend/src/components/dialogs/AddWorkspaceDialog.svelte`

**Spec:**
- Each dialog: replace local `.dialog`, `.dialog-content`, `.dialog-header`, `.dialog-body`, `.dialog-footer`, `.btn*`, `.close-btn`, `.dialog-checkbox`, `.error-msg` CSS with `DialogShell variant="compact"`
- Terminal aesthetic: `border-radius: 0`, monospace font on buttons/inputs
- DeleteWorktree: `.btn-danger` uses outlined style (red border + text, transparent bg) — matches WorkspaceSettings
- Fade+scale entrance animation (from DialogShell)
- Fix WorkspaceSettingsDialog: add `refreshAll()` to save handler

**Depends on:** Task 1 (DialogShell)

---

### Task 9: TOC drawer component

**Why:** Hamburger-activated navigation for settings sections with scroll-linked active state.

**Files:**
- CREATE `frontend/src/components/dialogs/SettingsToc.svelte`

**Spec:**
- Props: `sections: Array<{ id: string, label: string, children?: Array<{ id, label }> }>`, `contentEl: HTMLElement` (scroll container ref)
- Hamburger button toggles drawer visibility
- Drawer: slides from left (`transform: translateX(-100%)` → `translateX(0)`, `transition: transform 0.25s ease`), overlay on content
- Section items: click → `contentEl.querySelector('#' + id).scrollIntoView({ behavior: 'smooth' })` + close drawer
- Active tracking: `IntersectionObserver` on each section heading, threshold 0.1
- Highlight bar: 3px wide `var(--accent)` bar, `transition: top 150ms ease, height 150ms ease`
- Sub-items for integrations (GitHub, Webhooks, Jira) indented
- Keyboard: Tab through items, Enter to scroll
- `role="navigation"`, `aria-label="Settings navigation"`, hamburger has `aria-expanded`

**Depends on:** Task 7 (needs the section structure to exist)

---

### Task 10: GitHubIntegration.svelte

**Why:** Self-contained integration accordion row for GitHub device flow auth.

**Files:**
- CREATE `frontend/src/components/dialogs/integrations/GitHubIntegration.svelte`

**Spec:**
- Row: status dot (green if connected, grey if not), "GitHub", status text, action button
- Accordion: click row expands to reveal:
  - Connected: username display + [Disconnect] button
  - Not connected: "Connect your GitHub account" + [Connect] button → device flow inline
  - Wrong scope: banner "Re-connect to enable webhook management" + [Re-connect] button
  - Device flow in-progress: code + verification URL + "Waiting..."
  - Error: error text + [Try Again]
- Disconnect: confirm dialog "This will delete N webhooks. Continue?" → calls cleanup then disconnect
- `aria-expanded` on row
- All state is local `$state` (fetches status on mount via `GET /auth/github/status`)

**Depends on:** Task 2 (SettingRow for base structure)

---

### Task 11: WebhookIntegration.svelte

**Why:** Self-contained accordion row for webhook setup, health monitoring, backfill, and test.

**Files:**
- CREATE `frontend/src/components/dialogs/integrations/WebhookIntegration.svelte`

**Spec:**
- Row: status dot, "Webhooks", status text, action button
- States (accordion expanded):
  - Not configured: "Real-time CI and PR updates" + [Setup Webhooks] button
  - Setup in-progress: "Setting up..." disabled button
  - Configured + connected: green dot, "Connected via smee.io", last event timestamp, auto-provision toggle, [Test Connection] [Remove Setup]
  - Configured + errored: yellow dot, "Reconnecting (polling fallback)", same controls
  - Backfill banner (shown once after setup, persisted via `config.github.backfillOffered`): "You have N repos. Set up webhooks?" + [Setup All] [Skip]
  - Backfill results: "7/10 configured" with per-repo result list
  - Test in-progress: "Testing..." disabled
  - Test success: "Event received" (auto-dismiss 5s)
  - Test failure: "No webhook to ping" or "Timed out"
  - Remove confirm dialog
  - Advanced: expandable "Use custom smee URL" input (visible when not configured)
- All API calls via `frontend/src/lib/api.ts` webhook functions
- Polls `GET /webhooks/manage/status` on mount and after actions
- Requires GitHub to be connected (check passed as prop)

**Depends on:** Task 2, Task 4 (backend must exist for API calls)

---

### Task 12: JiraIntegration.svelte

**Why:** Self-contained accordion row for Jira CLI integration status.

**Files:**
- CREATE `frontend/src/components/dialogs/integrations/JiraIntegration.svelte`

**Spec:**
- Row: status dot (green if CLI installed + authenticated, grey otherwise), "Jira", status text
- Accordion: CLI install instructions (brew install, acli auth login), link to docs
- Checks `GET /integration-jira/configured` on mount
- Minimal — primarily informational until Jira CLI integration ships

**Depends on:** Task 2

---

### Task 13: In-modal settings search

**Why:** Make every setting findable without scrolling.

**Files:**
- MODIFY `frontend/src/components/dialogs/SettingsDialog.svelte` — add search logic

**Spec:**
- Search input in header bar, monospace, placeholder "Search..."
- On input: filter sections by matching query against setting names + descriptions
- Non-matching sections: `opacity: 0.3`, `max-height: 0`, `overflow: hidden`, `transition: max-height 200ms ease, opacity 200ms ease`
- Empty state: "No settings match '[query]'" centered message
- Clear button (✕) in search input when query is non-empty
- Sections with any matching child stay visible

**Depends on:** Task 7

---

### Task 14: Spotlight settings integration

**Why:** Settings discoverable from Cmd+K without opening the modal.

**Files:**
- MODIFY `frontend/src/components/Spotlight.svelte` — add settings result type

**Spec:**
- New result type: `{ type: 'setting', label, description, section, action: 'openSettings' }`
- Static list of settings entries (name + description + section ID)
- Integration entries: "GitHub Settings", "Webhooks Settings", "Jira Settings"
- Selecting a result: opens SettingsDialog + scrolls to `#section-id`
- Settings results appear after workspace/session results in Spotlight
- SettingsDialog needs an `open(scrollToId?: string)` overload

**Depends on:** Task 7

---

### Task 15: Smart polling refactor

**Why:** Current 30s polling broadcasts globally for all repos. With per-workspace webhook tracking, only poll repos without webhooks.

**Files:**
- MODIFY `server/webhooks.ts` — extract `repository.full_name` from payload, include in broadcast
- MODIFY `server/webhook-manager.ts` — smart polling logic
- MODIFY `frontend/src/App.svelte` — handle repo-scoped events for targeted cache invalidation

**Spec:**
- `webhooks.ts`: parse `req.body.repository?.full_name`, pass as `broadcastEvent('pr-updated', { repo })` and `broadcastEvent('ci-updated', { repo })`
- Smart polling in webhook-manager: only broadcast for workspaces where `webhookEnabled` is false or `webhookError` is set
- Frontend: `App.svelte` event handler checks `msg.repo` — if present, invalidate only matching queries; if absent (polling fallback), invalidate all (backward compatible)
- Polling interval stays at 30s for non-webhook workspaces

**Depends on:** Tasks 4, 5

---

### Task 16: Dead code cleanup + design unification

**Why:** Clean up pre-existing debt identified during reviews.

**Files:**
- MODIFY all dialog components — terminal aesthetic tokens
- MODIFY `server/index.ts` — remove old smee inline code (now in webhook-manager)
- MODIFY `docs/ARCHITECTURE.md` — update module count to twenty-five, add webhook-manager to table

**Spec:**
- Delete dead CSS in SettingsDialog (root dir remnants) — already done as part of Task 7 rewrite
- Standardize `border-radius: 0` across all dialogs (fix remaining 10px/8px values)
- Replace hardcoded `#e74c3c` with `var(--status-error)` everywhere
- Unify `.btn-danger` to outlined style (red border + text, transparent bg)
- Fix WorkspaceSettingsDialog: add `refreshAll()` to save handler — already done as part of Task 8
- Update ARCHITECTURE.md: module count → twenty-five, add webhook-manager row to table
- Verify all dialogs use `var(--font-mono)` on inputs and buttons

**Depends on:** Tasks 7, 8 (dialogs must be migrated first)
