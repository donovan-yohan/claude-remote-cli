# File System Browser API

**Created:** 2026-03-19
**Status:** Implemented

## Problem

The "Add Workspace" flow requires users to type a full filesystem path manually. This is error-prone, slow, and provides no validation or discovery. Users need to visually browse their filesystem, see which directories are git repos, and select one or more directories to add as workspaces.

## Design

### Data Model: Workspaces Replace Roots

Workspaces are a flat list of directory paths the user cares about. Each workspace entry is a directory — some have `.git` (full repo features: worktrees, PR tracking, branches), others don't (single-folder session only, no worktrees). The old `rootDirs` concept (parent directories scanned for repos) is replaced by direct workspace paths.

**Config change:**
```typescript
interface Config {
  // Remove: rootDirs?: string[]
  // Add:
  workspaces?: string[];  // Direct paths to workspace directories
}
```

**Workspace behavior by type:**
| Has `.git`? | Sessions | Worktrees | PR Tracking | Branch Switching |
|-------------|----------|-----------|-------------|------------------|
| Yes | Repo + worktree + terminal | Yes | Yes | Yes |
| No | Single folder session (tabs) | No | No | No |

### API: `GET /fs/browse`

Single endpoint for the file browser tree. Returns one level of directory children at a time (lazy loading).

```
GET /fs/browse?path=/Users/donovanyohan&prefix=Doc&showHidden=false
```

**Query parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `path` | `~` (home dir) | Directory to list children of. `~` expanded server-side via `os.homedir()` |
| `prefix` | (none) | Case-insensitive name prefix filter |
| `showHidden` | `false` | Include dotfiles/dotdirs |

**Response:**
```json
{
  "resolved": "/Users/donovanyohan",
  "entries": [
    {
      "name": "Documents",
      "path": "/Users/donovanyohan/Documents",
      "isGitRepo": false,
      "hasChildren": true
    },
    {
      "name": "my-project",
      "path": "/Users/donovanyohan/my-project",
      "isGitRepo": true,
      "hasChildren": true
    }
  ],
  "truncated": false,
  "total": 12
}
```

**Entry fields:**
- `name` — directory name (basename)
- `path` — absolute path
- `isGitRepo` — has `.git` directory (stat check, not recursive)
- `hasChildren` — has at least one subdirectory (for expand arrow indicator)
- Only directories returned; files are excluded

**Pagination/truncation:**
- Max 100 entries per response
- `truncated: true` + `total` count when there are more
- Client can request more via `offset` query param if needed
- Denylist: `node_modules`, `.git`, `Library/Caches`, `__pycache__`, `.Trash` are excluded from listings entirely

**Errors:**
- 400 — path is not a directory or doesn't exist
- 403 — not readable (permissions)

**Auth:** Uses existing cookie middleware (same as all other endpoints).

### Server Module: `fs-browse.ts`

New single-concern module following the composition-root pattern.

```typescript
// server/fs-browse.ts
import { Router } from 'express';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, resolve } from 'node:path';

const DENYLIST = new Set([
  'node_modules', '.git', '.Trash', '__pycache__',
  'Library/Caches', '.cache', '.npm', '.yarn',
]);

const MAX_ENTRIES = 100;

export function createFsBrowseRouter(): Router {
  const router = Router();

  router.get('/fs/browse', async (req, res) => {
    // Implementation: resolve path, readdir, stat each entry,
    // filter by prefix, apply denylist, cap at MAX_ENTRIES
  });

  return router;
}
```

**Integration in `index.ts`:**
```typescript
import { createFsBrowseRouter } from './fs-browse.js';
app.use(createFsBrowseRouter());
```

**Performance considerations:**
- `readdir` with `{ withFileTypes: true }` avoids extra stat calls for isDirectory
- `.git` check: single `stat(join(path, '.git'))` per entry (parallel, fail = not a repo)
- `hasChildren`: single `readdir` per entry, bail after first directory found
- All I/O parallelized with `Promise.all` / `Promise.allSettled`
- Consider caching hot paths (home dir children) with short TTL (~5s)

### Frontend: File Browser Component

#### Component: `FileBrowser.svelte`

A tree-view panel used inside the "Add Workspace" dialog.

**State:**
```typescript
interface BrowseNode {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasChildren: boolean;
  children: BrowseNode[] | null;  // null = not loaded, [] = empty
  expanded: boolean;
  selected: boolean;  // checkbox state for bulk import
  loading: boolean;   // currently fetching children
}

let tree = $state<BrowseNode[]>([]);       // top-level nodes (home dir children)
let filterText = $state('');                // search input
let selectedPaths = $derived(/* collect all selected nodes */);
```

**Layout:**
```
┌──────────────────────────────────────┐
│  Add Workspace                    ✕  │
│                                      │
│  Browse for folders on your machine. │
│  Git repos get PR tracking and       │
│  branch management.                  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ 🔍 Filter...                   │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ ▶ □ AndroidStudioProjects      │  │
│  │ ▶ □ Applications               │  │
│  │ ▼ □ Documents                  │  │
│  │   ▶ □ Programs                 │  │
│  │   ▶ □ Notes                    │  │
│  │ ▶ ☑ my-project          [git] │  │
│  │ ▶ □ Desktop                    │  │
│  │ ▶ □ Developer                  │  │
│  └────────────────────────────────┘  │
│                                      │
│  2 selected                          │
│  ┌──────────┐  ┌──────────────────┐  │
│  │  Cancel   │  │ Add Workspaces  │  │
│  └──────────┘  └──────────────────┘  │
└──────────────────────────────────────┘
```

**Tree node anatomy:**
```
[▶/▼] [☐/☑] [icon] Name              [git badge]
  ↑      ↑     ↑                          ↑
expand  select  folder/repo icon    isGitRepo indicator
```

#### Filtering Behavior

The filter input applies a case-insensitive name match across all **visible** nodes (loaded into the tree). Rules:

1. **Matching nodes** — any node whose name matches the filter text is shown
2. **Ancestor chain** — all ancestors of a matching node are shown (so matches deep in the tree have context)
3. **Expanded directories are never filtered** — if the user explicitly expanded a directory, it and all its loaded children remain visible regardless of filter text
4. **Empty filter** — shows everything currently loaded

**Implementation approach:**
```typescript
function isVisible(node: BrowseNode, filter: string): boolean {
  if (!filter) return true;
  if (node.expanded) return true;  // never filter expanded dirs
  if (nameMatches(node.name, filter)) return true;
  if (node.children?.some(c => isVisible(c, filter))) return true;  // ancestor of match
  return false;
}
```

#### Keyboard Navigation (Desktop)

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus through visible tree items |
| `→` | Expand focused directory (or move to first child if already expanded) |
| `←` | Collapse focused directory (or move to parent if already collapsed) |
| `Space` | Toggle selection (checkbox) of focused item |
| `Enter` | If single item focused, add it and close. If multiple selected, add all selected |
| `Tab` | Move focus from filter input into tree |
| `Escape` | Close dialog |
| Type while tree focused | Jump to first item starting with typed characters |

#### Mobile Interaction

- **Tap expand arrow** — toggle expand/collapse
- **Tap checkbox** — toggle selection
- **Tap row (not arrow/checkbox)** — expand if collapsed, toggle select if leaf or expanded
- **Scroll** — standard touch scroll within the tree container
- **Filter input** — standard mobile text input, virtual keyboard pushes tree up

#### Bulk Import Flow

1. User opens "Add Workspace" dialog
2. Tree loads showing `~` children (one API call)
3. User expands directories to browse, filter to search
4. User checks multiple directories via checkboxes
5. Footer shows "{N} selected" count
6. "Add Workspaces" button adds all selected paths
7. Each path becomes a workspace entry in config
8. Dialog closes, sidebar refreshes with new workspaces

**API call on confirm:**
```typescript
// New endpoint or modify existing
POST /workspaces/bulk
Body: { paths: ["/Users/donovanyohan/my-project", "/Users/donovanyohan/Documents/other"] }
```

### Performance & Security

**Denylist** — hardcoded set of directory names excluded from listings:
- `node_modules`, `.git`, `__pycache__`, `.Trash`
- `Library/Caches`, `.cache`, `.npm`, `.yarn`
- Extensible via config if needed later

**Entry cap** — 100 entries max per response. Directories with more show a "100 of {N} shown" indicator. User can filter to narrow results.

**No path traversal** — `path` parameter is resolved via `path.resolve()` and must be an absolute path after resolution. Relative paths and `..` traversal are resolved to absolute before any filesystem access.

**Rate limiting** — not needed beyond existing auth; the endpoint is no more expensive than `GET /repos` which already scans the filesystem.

**Caching** — optional short TTL (5s) cache keyed on `(path, showHidden)` to avoid redundant reads during rapid tree expansion. Filter prefix is applied post-cache on the server.

### Migration: Roots to Workspaces

The `rootDirs` config field currently stores parent directories that are scanned for repos. Migration:

1. On startup, if `rootDirs` exists and `workspaces` doesn't:
   - Scan each root dir for git repos (one level deep, existing logic)
   - Add discovered repo paths to `workspaces`
   - Also add the root dirs themselves if user had non-repo content there
   - Remove `rootDirs` from config
   - Save config
2. All existing code referencing `rootDirs` updated to use `workspaces`
3. `GET /repos` becomes `GET /workspaces` (returns workspace list with metadata)
4. `POST/DELETE /roots` becomes `POST/DELETE /workspaces` (or bulk variant)

### New Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/fs/browse` | Browse filesystem directories (tree node expansion) |
| `GET` | `/workspaces` | List configured workspaces with metadata |
| `POST` | `/workspaces/bulk` | Add multiple workspace paths at once |
| `DELETE` | `/workspaces` | Remove a workspace path |

### Accessibility

- Tree follows WAI-ARIA Treeview pattern (`role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-selected`)
- Focus visible indicator on keyboard navigation
- Checkbox states announced via `aria-checked`
- Git badge conveyed via `aria-label` ("git repository") not just visual icon
- Filter input has `aria-label="Filter directories"`

## Alternatives Considered

### 1. Path autocomplete (dropdown under text input)
Similar to what the screenshots showed initially. Simpler to build, but doesn't support browsing without knowing the path prefix. Poor for discovery on unfamiliar machines. Doesn't support bulk import naturally.

### 2. Native file picker via `<input type="file" webkitdirectory>`
Browser-native directory picker. Doesn't work well: returns files not directories, can't select multiple directories at different levels, no git repo indicators, inconsistent across browsers, and critically — the browser runs on a different device than the server (remote CLI), so the browser's filesystem is the wrong one.

### 3. Full virtual filesystem (WebDAV/FUSE)
Way over-engineered for directory browsing. Would enable file editing but that's not the goal.

## Open Questions

1. **Favorites/bookmarks** — Should we persist frequently-used paths for quick access? (e.g., pinned at the top of the tree)
2. **Recent paths** — Show recently added workspaces at the top?
3. **Path bar** — Should there be a breadcrumb-style path bar above the tree for direct navigation (click "Users" > "donovanyohan" > "Documents")?
