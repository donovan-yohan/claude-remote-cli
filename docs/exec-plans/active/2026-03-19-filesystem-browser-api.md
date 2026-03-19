# Plan: File System Browser API

> **Status**: Complete | **Created**: 2026-03-19
> **Design**: `docs/design-docs/2026-03-19-filesystem-browser-api-design.md`

## Scope

Build a `GET /fs/browse` backend endpoint and a `FileBrowser.svelte` frontend component for browsing the server's filesystem. The component supports lazy tree expansion, client-side filtering, multi-select with bulk import, keyboard navigation, and git repo detection. The roots→workspaces migration is **out of scope** — the file browser will call the existing `POST /roots` endpoint (or a new bulk variant) for now.

## Progress

- [x] Task 1: Add browse endpoint to `server/workspaces.ts` (deviated: used existing module)
- [x] Task 2: Add bulk import endpoint to `server/workspaces.ts`
- [x] Task 3: Add `browseFsDirectory()` + `addWorkspacesBulk()` to `frontend/src/lib/api.ts`
- [x] Task 4: Create `FileBrowser.svelte` component
- [ ] Task 5: Create `AddWorkspaceDialog.svelte` dialog
- [ ] Task 6: Wire dialog into app (Sidebar trigger)
- [ ] Task 7: Add unit tests for `fs-browse.ts`
- [ ] Task 8: Build verification

## Checkpoint: After Task 3 (backend complete)
## Checkpoint: After Task 7 (all code complete)

---

### Task 1: Create `server/fs-browse.ts` module

**File:** `server/fs-browse.ts` (new)

Create a new single-concern module exporting `createFsBrowseRouter()` that returns an Express Router with one route:

**`GET /fs/browse`** — query params: `path` (default `~`), `prefix`, `showHidden` (default `false`)

Implementation:
1. Resolve `path`: expand `~` to `os.homedir()`, then `path.resolve()`
2. Validate: `stat()` the resolved path. 400 if not a directory, 403 if EACCES
3. `readdir(resolved, { withFileTypes: true })` — filter to directories only
4. Apply denylist filter (skip `node_modules`, `.git`, `.Trash`, `__pycache__`, `Library/Caches`, `.cache`, `.npm`, `.yarn`)
5. If `!showHidden`, filter out names starting with `.`
6. If `prefix`, filter by case-insensitive name prefix
7. Sort alphabetically (case-insensitive)
8. Cap at 100 entries, set `truncated` flag
9. For each entry (parallelized via `Promise.allSettled`):
   - `isGitRepo`: check if `stat(join(entryPath, '.git'))` succeeds
   - `hasChildren`: check if `readdir(entryPath)` returns any directory entry (bail after first)
10. Return response shape: `{ resolved, entries: [{name, path, isGitRepo, hasChildren}], truncated, total }`

**Types** (inline in module, not in types.ts — this is a self-contained module):
```typescript
interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasChildren: boolean;
}

interface BrowseResponse {
  resolved: string;
  entries: BrowseEntry[];
  truncated: boolean;
  total: number;
}
```

### Task 2: Wire `fs-browse` router into `server/index.ts`

**File:** `server/index.ts`

1. Add import: `import { createFsBrowseRouter } from './fs-browse.js';`
2. Mount after auth middleware is set up: `app.use(createFsBrowseRouter());`
3. The router's route handler should be wrapped in `requireAuth` — either pass `requireAuth` to the factory function, or apply auth middleware in the router itself. Since other routes in index.ts use `requireAuth` directly, pass it as a parameter: `createFsBrowseRouter(requireAuth)`.

### Task 3: Add `browseFsDirectory()` to `frontend/src/lib/api.ts`

**File:** `frontend/src/lib/api.ts`

Add:
```typescript
export interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasChildren: boolean;
}

export interface BrowseResponse {
  resolved: string;
  entries: BrowseEntry[];
  truncated: boolean;
  total: number;
}

export async function browseFsDirectory(
  dirPath?: string,
  options?: { prefix?: string; showHidden?: boolean },
): Promise<BrowseResponse> {
  const params = new URLSearchParams();
  if (dirPath) params.set('path', dirPath);
  if (options?.prefix) params.set('prefix', options.prefix);
  if (options?.showHidden) params.set('showHidden', 'true');
  return json<BrowseResponse>(await fetch('/fs/browse?' + params.toString()));
}
```

### Task 4: Create `FileBrowser.svelte` component

**File:** `frontend/src/components/FileBrowser.svelte` (new)

A tree-view component that lazy-loads directory children from the server.

**Props:**
```typescript
let { onSelect }: { onSelect: (paths: string[]) => void } = $props();
```

**State:**
```typescript
interface BrowseNode {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasChildren: boolean;
  children: BrowseNode[] | null;
  expanded: boolean;
  selected: boolean;
  loading: boolean;
  depth: number;
}

let tree = $state<BrowseNode[]>([]);
let filterText = $state('');
let focusIndex = $state(-1);
let treeEl: HTMLElement;
```

**Lifecycle:**
- On mount: call `browseFsDirectory()` (default = home dir), populate `tree` with top-level nodes

**Tree rendering:**
- Recursive: flatten visible nodes into a list for rendering (using `$derived`)
- Each row: expand/collapse button (if `hasChildren`), checkbox, folder icon, name, git badge (if `isGitRepo`)
- Indentation via `padding-left: {depth * 20}px`
- Click expand arrow → toggle `expanded`, lazy-load children if `children === null`
- Click checkbox → toggle `selected`
- Click row body → expand if collapsed, toggle select if leaf or already expanded

**Filtering:**
- `isVisible(node, filter)` function per design doc:
  - No filter → visible
  - Node is expanded → always visible
  - Name matches filter (case-insensitive contains) → visible
  - Any descendant matches → visible (ancestor chain rule)
- `$derived` flattened list recomputes when `filterText` or tree changes

**Keyboard navigation:**
- Arrow up/down: move `focusIndex` through visible flat list
- Arrow right: expand focused item (or move to first child if already expanded)
- Arrow left: collapse focused item (or move to parent if already collapsed)
- Space: toggle selection
- Enter: confirm selection (`onSelect` callback)
- Listen on the tree container `keydown`

**Selected paths:**
- `$derived` that collects all paths where `selected === true` recursively

**Git badge:**
- Small monospace `[git]` label styled with `--accent` color

**Styling:**
- Use project CSS variables (`--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`)
- Tree container: `overflow-y: auto`, max-height from parent
- Hover: `background: var(--border)` on rows
- Focus: `outline: 2px solid var(--accent)` on focused row
- Checkbox: `accent-color: var(--accent)`
- Loading: show "Loading..." placeholder with muted text while fetching children

**ARIA:**
- Container: `role="tree"`, `aria-label="File browser"`
- Each row: `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-level={depth+1}`
- Filter input: `aria-label="Filter directories"`

### Task 5: Create `AddWorkspaceDialog.svelte` dialog

**File:** `frontend/src/components/dialogs/AddWorkspaceDialog.svelte` (new)

A modal dialog wrapping `FileBrowser.svelte`.

**Structure:**
```
<dialog>
  <header> "Add Workspace" + close button </header>
  <p> "Browse for folders on your machine. Git repos get PR tracking and branch management." </p>
  <FileBrowser onSelect={handleAdd} />
  <footer> "{N} selected" label, Cancel + "Add Workspaces" buttons </footer>
</dialog>
```

**API integration:**
- `handleAdd(paths)`: call `addRoot(path)` for each selected path (using existing API), then `refreshAll()`, then close dialog
- "Add Workspaces" button disabled when 0 selected
- Error handling: show error message if any `addRoot` call fails

**Exported methods:** `open()` and `close()` (same pattern as SettingsDialog)

**Styling:** Reuse dialog patterns from `SettingsDialog.svelte` (`.dialog`, `.dialog-content`, `.dialog-header`, `.dialog-footer`, `.btn`, `.btn-primary`, `.btn-ghost`). Dialog width: `min(520px, 95vw)`. Tree area max-height: `50vh`.

### Task 6: Wire dialog into app (Sidebar trigger)

**File:** `frontend/src/components/Sidebar.svelte` (or wherever the "Add Workspace" button lives)

1. Import `AddWorkspaceDialog`
2. Add a `<AddWorkspaceDialog bind:this={addWorkspaceDialog} />` instance
3. Add a button/action that calls `addWorkspaceDialog.open()`
4. The exact trigger location depends on the current sidebar structure — look for where workspace/root management is triggered and add the button there. If the sidebar has a "+" button or settings gear, add it nearby.

### Task 7: Add unit tests for `fs-browse.ts`

**File:** `test/fs-browse.test.ts` (new)

Using `node:test` and `node:assert` (project convention). Test the module's core logic without requiring a running server:

1. **Tilde expansion**: verify `~` resolves to `os.homedir()`
2. **Denylist**: verify `node_modules`, `.git`, etc. are excluded
3. **Hidden files**: verify dotfiles excluded by default, included with `showHidden=true`
4. **Prefix filter**: verify case-insensitive prefix matching
5. **Directories only**: verify files are excluded from results
6. **Entry cap**: verify max 100 entries with `truncated` flag
7. **Git detection**: verify `isGitRepo` for directories with `.git` subdirectory
8. **Invalid path**: verify 400-equivalent error for non-directory path
9. **Sort order**: verify alphabetical case-insensitive sort

Approach: Create a temp directory tree using `node:fs` in `before()`, clean up in `after()`. Import and test the route handler logic directly (may need to extract core logic into a testable function).

### Task 8: Build verification

Run `npm run build` to verify TypeScript compilation succeeds for both backend and frontend.
Run `npm test` to verify all tests pass including the new `fs-browse.test.ts`.
