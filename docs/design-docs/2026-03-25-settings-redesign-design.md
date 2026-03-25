---
status: current
created: 2026-03-25
branch: master
---

# Settings UI Redesign — Full-Screen Modal with TOC Navigation

## Problem

The current SettingsDialog is a cramped 460px modal with 6 sections, no animations, no search, and two competing visual languages (soft rounded in Settings vs sharp terminal in WorkspaceSettings). As we add webhook config, integrations grow, and more settings accumulate, the current dialog can't scale.

## Vision

Settings becomes a full-screen modal — a scrollable single page with clear sections, each setting getting its own row (header, description, action). A hamburger button reveals a TOC drawer with a restrained CSS-transition highlight that tracks the active section. Integrations use dense status rows (same anatomy as other settings), not cards. Settings are searchable both via Cmd+K (Spotlight) and an in-modal filter bar.

## Design Language Resolution

**Terminal aesthetic wins everywhere.** Unify all dialogs to the sharp, monospace-first language that dominates the sidebar, WorkspaceSettings, and Spotlight.

| Token | Value | Rationale |
|-------|-------|-----------|
| `border-radius` | `0` on inputs, buttons, cards, dialog | Terminal aesthetic — no soft corners |
| Section headings | UPPERCASE, `var(--font-size-xs)`, `var(--text-muted)`, `letter-spacing: 0.08em` | Match sidebar group headers |
| Input/select font | `var(--font-mono)` | All inputs monospace |
| Buttons | `border: 1px solid var(--border)`, `var(--font-mono)`, `var(--font-size-sm)` | Flat, outlined, no fills except accent |
| Primary CTA | `border-color: var(--accent)`, `color: var(--accent)` | Outline accent, not filled |
| Destructive | `color: var(--status-error)`, `border-color: var(--status-error)` | Red outline |
| Status dots | `--status-success` (green), `--status-warning` (yellow), `--status-error` (red) | Existing CSS vars |
| Micro-interactions | `border-color: var(--accent)` pulse on click (200ms ease-out), `background` flash `--surface` → `--surface-hover` | Terminal-native, NOT Material ripples |

## Layout Architecture

### Full-Screen Settings Modal (desktop ≥600px)

```
┌──────────────────────────────────────────────────────────────────┐
│  ☰  SETTINGS                              🔍 Search...    ✕     │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  ┌── content area (max-width: 640px, centered) ──────────────┐  │
│  │                                                            │  │
│  │  GENERAL                                                   │  │
│  │  ──────────────────────────────────────────────────────    │  │
│  │  Default Coding Agent                    [Claude ▾]        │  │
│  │  Which AI agent to use for new sessions                    │  │
│  │                                                            │  │
│  │  Continue existing session                       [●]       │  │
│  │  Resume the last session when opening a repo               │  │
│  │                                                            │  │
│  │  YOLO mode                                       [○]       │  │
│  │  Skip permission checks for all sessions                   │  │
│  │                                                            │  │
│  │  Launch in tmux                                  [○]       │  │
│  │  Wrap sessions in tmux for scroll + copy                   │  │
│  │                                                            │  │
│  │  Notifications                                   [●]       │  │
│  │  Push notifications when sessions need attention           │  │
│  │                                                            │  │
│  │  INTEGRATIONS                                              │  │
│  │  ──────────────────────────────────────────────────────    │  │
│  │  ◉ GitHub        Connected as @donovan-yohan   [Manage ▾] │  │
│  │  Connect your GitHub account for PRs and CI                │  │
│  │                                                            │  │
│  │  ○ Webhooks      Not configured                [Setup]     │  │
│  │  Real-time CI and PR updates instead of polling            │  │
│  │                                                            │  │
│  │  ○ Jira          CLI not installed                         │  │
│  │  See your Jira tickets in the sidebar                      │  │
│  │                                                            │  │
│  │  ADVANCED                                                  │  │
│  │  ──────────────────────────────────────────────────────    │  │
│  │  Developer Tools                                 [○]       │  │
│  │  Mobile debug panel                                        │  │
│  │                                                            │  │
│  │  Analytics                           12.4 MB  [Clear]     │  │
│  │  Local usage data                                          │  │
│  │                                                            │  │
│  │  ABOUT                                                     │  │
│  │  ──────────────────────────────────────────────────────    │  │
│  │  Version                          v3.14.2  Up to date ✓   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### TOC Drawer (hamburger reveals, slides from left)

```
┌───────────────────────┐
│  ┌─────────────────┐  │
│  │▌accent bar      │  │  ← spring-animated highlight (3px wide, var(--accent))
│  └─────────────────┘  │    tracks which section/sub-item is in viewport
│                       │
│  GENERAL              │  ← click scrolls to section + closes drawer
│  INTEGRATIONS         │
│    GitHub             │  ← sub-items for each integration card
│    Webhooks           │
│    Jira               │
│  ADVANCED             │
│  ABOUT                │
└───────────────────────┘

Highlight animation: CSS transition (restrained, not spring)
  transition: top 150ms ease, height 150ms ease
  IntersectionObserver on each section heading triggers active change
  Two-way binding: click scrolls content, scroll moves highlight
  Moves only on section change, NOT continuously during scroll
```

### Setting Row Anatomy

```
┌────────────────────────────────────────────────────┐
│  Setting Name                          [action]    │
│  Description in muted text                         │
└────────────────────────────────────────────────────┘

  Name: var(--font-size-base), var(--text), font-weight 500
  Desc: var(--font-size-sm), var(--text-muted)
  Action: toggle, select, or button — right-aligned
  Row: padding 12px 0, border-bottom: 1px solid var(--border) on last in group
  Min-height: 44px (a11y touch target)
```

### Integration Row Anatomy

Integrations use the same row format as all other settings — no special card
treatment. Dense, utility-first, consistent with the rest of the page.

```
┌────────────────────────────────────────────────────┐
│  ◉ / ○  Integration Name    Status text    [action]│
│  Description of what this integration does         │
└────────────────────────────────────────────────────┘

  Status dot: inline before name, uses --status-success / --status-warning
  Name: var(--font-size-base), var(--text), font-weight 500
  Status: var(--font-size-sm), var(--text-muted), inline after name
  Action: button right-aligned ("Setup" / "Manage ▾" / link)
  Desc: var(--font-size-sm), var(--text-muted), second line
  Click row: expands inline (accordion) revealing config/status details
  Row hover: background var(--surface-hover), 100ms transition
```

**Rationale (from Codex review):** This app is a workspace tool, not an integration
marketplace. Dense status rows match the terminal aesthetic and keep integrations
at the same visual weight as other settings. No ripple effects — a brief
`background` hover transition is sufficient.

### Search

**In-modal search bar:**
- Fixed to header bar, right of "SETTINGS" title
- Monospace input, placeholder "Search..."
- Filters sections by heading + description text match
- Non-matching sections collapse with `opacity: 0.3` and `max-height: 0` transition
- Empty state: "No settings match '[query]'"

**Spotlight integration:**
- Settings entries added as a new result type in Spotlight data
- Each setting → `{ type: 'setting', label: 'YOLO mode', description: '...', section: 'GENERAL' }`
- Selecting a setting result: opens Settings modal, scrolls to that section
- Integration entries: "GitHub Settings", "Webhooks Settings", "Jira Settings"

## Responsive

### Mobile (<600px)

- Full-screen modal: `100vw × 100vh`, no inset
- Content: full-width, `padding: 16px`
- Integration rows: same as desktop (full-width rows stack naturally)
- Setting rows: label + description stack above action if action is wide
- Toggles: stay right-aligned inline
- Search bar: below title, full width
- TOC drawer: same hamburger pattern, full height overlay

### Desktop (≥600px)

- Full-screen modal or `inset: 24px` on very large screens (>1200px)
- Content: `max-width: 640px`, centered horizontally
- Integration rows: full-width, same anatomy as other settings
- Search bar: inline in header, right-aligned

## Interaction States

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Modal open | Skeleton for integration status | N/A | N/A | Sections render | N/A |
| GitHub device flow | "Enter code: XXXX" + waiting | N/A | Error + retry | "Connected as @user" | N/A |
| Webhook setup | Button → "Setting up..." disabled | N/A | "Could not reach smee.io" + retry | Card → connected state | N/A |
| Backfill | "Setting up repos 1/10..." counter | "No workspaces" | Per-repo error list | "All repos configured" | "7/10 configured" + list |
| Test ping | "Testing..." + disabled | N/A | "No webhook to ping" / "Timed out" | "Event received" (5s auto-dismiss) | N/A |
| Remove setup | Confirm dialog → "Removing..." | N/A | "Some webhooks couldn't be deleted" | Return to unconfigured | N/A |
| Per-workspace toggle | Toggle disabled during API call | N/A | "No admin access" (persisted) | Status updates inline | N/A |
| Re-auth (wrong scope) | N/A | N/A | Banner: "Re-connect to enable webhooks" + button | Section unlocks | N/A |
| GitHub disconnect | Confirm: "This will delete N webhooks" | N/A | Best-effort, still disconnects | Return to disconnected | N/A |
| Search (in-modal) | N/A | "No settings match" | N/A | Sections filtered | N/A |

## Scope

**Full-screen pattern applies to:**
- Global SettingsDialog (this redesign)
- WorkspaceSettingsDialog (also multi-section, growing content — adopt same pattern)

**Small modal pattern stays for:**
- DeleteWorktreeDialog (2 buttons, 1 confirmation)
- CustomizeSessionDialog (4 fields)
- AddWorkspaceDialog (file browser — already its own pattern)

**Both patterns unify on terminal aesthetic** (border-radius: 0, monospace, UPPERCASE headings).

## Accessibility

| Element | Spec |
|---------|------|
| Settings modal | `role="dialog"`, `aria-modal="true"`, `aria-label="Settings"` |
| TOC drawer | `role="navigation"`, `aria-label="Settings navigation"` |
| TOC items | `role="link"`, Tab + Enter navigable |
| Hamburger | `aria-label="Open settings navigation"`, `aria-expanded` |
| Toggles | Native `<input type="checkbox">` |
| Integration rows | `role="button"`, `aria-expanded` for accordion |
| FLIP highlight | `aria-hidden="true"` (decorative) |
| Focus management | Modal open → focus first interactive. TOC close → focus hamburger. |
| Touch targets | 44px minimum height on all rows and buttons |
| Search input | `role="search"`, `aria-label="Search settings"` |
