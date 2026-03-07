# Execution Plan: Searchable Filter Dropdowns

## Goal
Replace native `<select>` dropdowns for root and repo filters in SessionFilters with searchable dropdown components.

## Steps

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Create `SearchableSelect.svelte` component | `frontend/src/components/SearchableSelect.svelte` | complete |
| 2 | Replace `<select>` elements in `SessionFilters.svelte` with `SearchableSelect` | `frontend/src/components/SessionFilters.svelte` | complete |
| 3 | Remove unused `<select>` CSS from SessionFilters | `frontend/src/components/SessionFilters.svelte` | complete |
| 4 | Build and verify no TypeScript errors | - | complete |
| 5 | Run tests | - | complete |

## Step Details

### Step 1: Create SearchableSelect.svelte

Create `frontend/src/components/SearchableSelect.svelte` with:
- Props: `options`, `value`, `placeholder`, `onchange`
- State: `open`, `searchText`
- Derived: `filteredOptions` (case-insensitive substring match on labels)
- Template: wrapper div with click-to-open, text input + dropdown list when open
- Click-outside handling via window click listener
- Escape key to close
- Styling matching existing filter inputs

### Step 2: Replace selects in SessionFilters

- Import `SearchableSelect`
- Convert `availableRoots` to `rootOptions: { value, label }[]` using `rootShortName()`
- Convert `availableRepos` to `repoOptions: { value, label }[]`
- Replace `<select>` elements with `<SearchableSelect>` instances
- Wire `onchange` callbacks to update `ui.rootFilter` / `ui.repoFilter`

### Step 3: Remove unused select CSS

- Remove the `select` and `select:focus` style rules from SessionFilters since they're no longer used.

### Step 4: Build

```bash
npm run build
```

### Step 5: Test

```bash
npm test
```
