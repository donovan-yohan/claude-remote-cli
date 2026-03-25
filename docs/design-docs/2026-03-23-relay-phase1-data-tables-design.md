---
status: current
---
# Relay Phase 1: DataTable Component + Table UI Redesign

> **Status**: Planned
> **Phase**: 1 of 3 (Relay product evolution)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/ceo-plans/2026-03-23-relay-product-evolution.md`
> **Depends on**: Nothing (first phase)
> **Reviews**: Design review (8/10), CEO review (CLEAR), Eng review (CLEAR)

## Goal

Replace the inconsistent, duplicated table/list components across OrgDashboard, RepoDashboard, and TicketsPanel with a shared `DataTable.svelte` component. Add filter chips, sortable column headers, keyboard navigation, row grouping, and saved filter presets. Normalize all lists to fixed-height scroll containers with gradient fade.

## Problem

Current state has 10 documented inconsistencies:
1. Scrolling: OrgDashboard = unbounded page scroll, RepoDashboard = fixed-height with fade, TicketsPanel = inherits parent
2. Search: Only RepoDashboard has it (conditional, >5 PRs), not reusable
3. Filtering: Only OrgDashboard has native `<select>` dropdowns
4. Sorting: Only OrgDashboard (client-side, 3 options). No column-header sorting
5. Status dots: Green = "open" with no draft/approved/changes-requested distinction
6. `deriveColor()` duplicated in 3 files
7. Skeleton loading CSS duplicated in 3+ files
8. No column sorting, no pagination
9. Action pill in OrgDashboard has no onclick handler
10. Conditional search (>5 PRs) causes layout shift

## Approach

### New Shared Components

#### DataTable.svelte (monolithic with snippets)

```typescript
interface DataTableProps<T> {
  columns: Column[];          // { key, label, sortable?, width? }
  rows: T[];                  // data to render
  groupBy?: string;           // column key for row grouping
  sortBy: string;             // active sort column
  sortDir: 'asc' | 'desc';
  onSort: (column: string) => void;
  loading: boolean;
  error?: string;
  emptyMessage: string;       // shown when rows.length === 0 (no filters)
  filteredEmptyMessage: string; // shown when filters produce 0 results
  onClearFilters?: () => void;
  maxHeight?: string;         // fixed height, gradient fade
  onRowAction?: (item: T) => void; // Enter key / click action
  // Row rendering via Svelte 5 snippets:
  // {#snippet row(item: T)} ... {/snippet}
  // {#snippet mobileCard(item: T)} ... {/snippet} (for <600px)
}
```

**Owns:** Fixed-height scroll container, gradient fade `::after`, column header rendering with sort indicators, skeleton loading, empty/filtered-zero/error states, keyboard navigation (arrow up/down, Enter, type-to-filter), focus ring (`var(--accent)` 2px outline), mobile breakpoint switching to card layout.

**Does not own:** Row content (via snippets), filter state, sort state (lifted to parent).

#### FilterChipBar.svelte

```typescript
interface FilterChipBarProps {
  chips: FilterChip[];       // { id, label, dotClass?, count? }
  activeChips: string[];     // active chip IDs
  onToggle: (id: string) => void;
  onClearAll?: () => void;
}
```

Styling: monospace text, `var(--border)` outline, no rounded pills. Active chip = `var(--accent)` border. Terminal-native feel, not Material UI chips.

#### StatusDot.svelte

```typescript
interface StatusDotProps {
  status: 'draft' | 'open' | 'approved' | 'changes-requested' |
          'review-requested' | 'merged' | 'closed' | 'unknown' |
          // Jira workflow states:
          'in-progress' | 'code-review' | 'ready-for-qa' | 'unmapped';
}
```

PR dot vocabulary:
- `○` gray ring = Draft (not ready)
- `●` green fill = Open (ready for review)
- `●` blue fill = Approved
- `●` red fill = Changes Requested
- `●` amber fill = Review Requested
- `●` purple fill = Merged
- `—` gray dash = Closed

Jira dot vocabulary (derived from StatusMappingModal workflow mappings):
- `●` blue = In Progress
- `●` amber = Code Review
- `●` green = Ready for QA
- `●` gray = Unmapped status

#### Extracted Utilities

- `lib/colors.ts` — `deriveColor(name: string): string` (replaces 3 inline copies)
- `lib/skeleton.css` or `Skeleton.svelte` — shared skeleton loading animation (replaces 3+ copies)

### Table Layout: Hybrid Column Headers + Two-Line Rows

```
┌─ FILTER CHIPS ─────────────────────────────────────┐
│ [● Open] [○ Draft] [◑ Approved] [● Changes]       │
│ Repo: [All ▾]  Role: [All ▾]         [search...]  │
│ Preset: [Needs Attention ▾] [Save current view...] │
└────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────┐
│ St  Title ▲           Repo     Role   Age ▼  Act  │
├────────────────────────────────────────────────────┤
│ ● │ feat: add ISSUER_CYCLED   │ ext-api │ auth │ 2d │ ▸ │
│   │  #9156 · by you           │         │      │    │   │
├────────────────────────────────────────────────────┤
│ ○ │ fix: broken validation    │ belayer │ revw │ 3d │ ▸ │
│   │  #9154 · review requested │         │      │    │   │
│               ▼ gradient fade ▼                    │
└────────────────────────────────────────────────────┘
```

### Default Sort: "Best Available"

PR1 sorts by role (reviewer → author) then by updated date. This is the best available signal from the current search API data. PR2 upgrades to the full "what should I do next?" priority algorithm when reviewDecision and isDraft data arrive via GraphQL.

### Filter Pipeline

`filter chips → search text → sort` (pipeline precedence). All three can be active simultaneously. Filters narrow the dataset, search narrows further, sort orders the result.

### Row Grouping

Collapsible repo group headers in the org-level PR table. Each header shows repo name, PR count, and overall health indicator (any red dots?). Sort applies within groups.

### Saved Filter Presets

```typescript
interface FilterPreset {
  name: string;
  builtIn?: boolean;
  filters: { status?: string[]; repo?: string[]; role?: string[] };
  sort: { column: string; direction: 'asc' | 'desc' };
}
```

Stored in `config.json` under `filterPresets: FilterPreset[]`.
Built-in presets: "Needs Attention" (default), "All PRs".
UI: dropdown next to filter chips. "Save current view..." at bottom. Edit/delete via context menu on user presets. Built-in presets cannot be deleted.

### Keyboard Navigation

When DataTable has focus:
- Arrow up/down moves focus between rows (with scroll-into-view)
- Enter triggers `onRowAction` (navigates to workspace for PRs)
- Typing starts search filter (debounced 200ms)
- Tab moves to next interactive element (filter chips, search)
- Focus ring: `var(--accent)` 2px outline on focused row
- Selected row: `var(--surface-hover)` background

### Mobile (<600px)

Tables switch to stacked cards:
```
┌───────────────────────────────────┐
│ ● feat: add ISSUER_CYCLED...     │
│ ext-api · by you · 2d ago        │
│ [Review PR ▸]                    │
├───────────────────────────────────┤
│ ○ fix: broken validation...      │
│ belayer · review req · 3d ago    │
│ [Review PR ▸]                    │
└───────────────────────────────────┘
```
No column headers. Touch targets ≥44px. Action button full-width.

### Interaction States

| Feature | Loading | Empty | Filtered-Zero | Error |
|---------|---------|-------|---------------|-------|
| Org PR table | 3 skeleton rows | "No open PRs across workspaces." | "No PRs match filters. [Clear]" inside table body | "Couldn't load PRs. [Retry]" |
| Repo PR table | 2 skeleton rows | "No open PRs for {workspace}." | "No results for '{search}'. [Clear]" | "Couldn't load dashboard. [Retry]" |
| Tickets table | 3 skeleton rows | "No assigned tickets." | "No tickets match filters. [Clear]" | "Couldn't load tickets. [Retry]" |

### Action Pill Behavior

OrgDashboard action pills navigate to workspace via `onOpenWorkspace` callback. All actions = navigate to workspace. The workspace view has the real merge/resolve UI.

### Other Changes

- Jira tab comes first (default) in TicketsPanel
- Search always visible (remove conditional >5 threshold)
- Tab badge counts: PRs tab shows attention count, Tickets tab shows assigned count
- "Enjoy the quiet." copy replaced with "No assigned tickets."

## Consumers

| Surface | DataTable usage |
|---------|----------------|
| OrgDashboard PRs | Full: columns, filter chips, sort, search, grouping, presets, keyboard nav |
| RepoDashboard PRs | Partial: columns, sort, search (no grouping — single repo) |
| TicketsPanel GitHub | Partial: columns, sort, search |
| TicketsPanel Jira | Partial: columns, sort, search |
| RepoDashboard Activity | NOT DataTable — stays as compact log (both design voices agreed) |

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/DataTable.svelte` | Shared table component with all features |
| `frontend/src/components/FilterChipBar.svelte` | Filter chip bar component |
| `frontend/src/components/StatusDot.svelte` | Shared status dot component |
| `frontend/src/lib/colors.ts` | Extracted `deriveColor()` utility |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/OrgDashboard.svelte` | Replace inline PR list with DataTable, add filter chips + presets |
| `frontend/src/components/RepoDashboard.svelte` | Replace inline PR list with DataTable |
| `frontend/src/components/TicketsPanel.svelte` | Wrap ticket lists in DataTable, Jira tab first |
| `frontend/src/components/TicketCard.svelte` | Use StatusDot, use extracted deriveColor |
| `frontend/src/components/WorkspaceItem.svelte` | Use extracted deriveColor |
| `frontend/src/app.css` | Add shared skeleton animation, DataTable CSS variables |

## Tests

- DataTable: sort, filter, search, keyboard nav, empty states, mobile responsive, grouping
- StatusDot: all 7 PR states + Jira workflow states
- FilterChipBar: toggle, multi-select, clear all
- deriveColor: consistent hash output
- Saved presets: CRUD, corrupt config recovery
