---
status: implemented
created: 2026-03-06
branch: master
supersedes:
implemented-by:
consulted-learnings: []
---

# Searchable Filter Dropdowns

## Problem
The root and repo filter dropdowns in `SessionFilters.svelte` use native `<select>` elements. On projects with many roots or repos, users must scroll through the entire list to find their target. Native selects also render differently across browsers and are not searchable. The branch autocomplete in `NewSessionDialog` already demonstrates a better pattern — a text input with a filtered option list — but it's inlined in the dialog rather than extracted as a reusable component.

## Decision
Create a `SearchableSelect.svelte` component that encapsulates the text-input-with-dropdown pattern, then replace both `<select>` elements in `SessionFilters.svelte` with instances of this component.

## Design

### SearchableSelect Component

**Props:**
- `options: { value: string; label: string }[]` — available options
- `value: string` — currently selected value (bindable)
- `placeholder: string` — placeholder text when nothing is selected and input is empty
- `onchange: (value: string) => void` — callback when selection changes

**Behavior:**
1. **Collapsed state**: Shows the selected option's label (or placeholder) as static text. Clicking opens the dropdown.
2. **Expanded state**: Shows a text input for filtering + a dropdown list of matching options.
3. **Filtering**: Case-insensitive substring match on option labels, real-time as user types.
4. **Selection**: Clicking an option selects it, closes the dropdown, and fires `onchange`.
5. **Clear**: An "All" or reset option at the top of the list clears the selection (sets value to `''`).
6. **Close**: Clicking outside the component or pressing Escape closes the dropdown without changing the value.
7. **Empty input**: Shows all options (unfiltered).

### Integration in SessionFilters

Replace the two `<select>` elements with:
```svelte
<SearchableSelect
  options={rootOptions}
  value={ui.rootFilter}
  placeholder="All roots"
  onchange={(v) => { ui.rootFilter = v; ui.repoFilter = ''; }}
/>

<SearchableSelect
  options={repoOptions}
  value={ui.repoFilter}
  placeholder="All repos"
  onchange={(v) => { ui.repoFilter = v; }}
/>
```

Where `rootOptions` and `repoOptions` are derived arrays of `{ value, label }` objects built from the existing `availableRoots` and `availableRepos` sets.

### Styling
- Match existing filter input styling: `var(--bg)` background, `var(--border)` border, 6px radius, 0.75rem font size.
- Dropdown: absolute positioned below input, `var(--surface)` background, `var(--border)` border, max-height 200px with overflow scroll.
- Selected/hover item: `var(--border)` background highlight.
- Focus state: border-color changes to `var(--accent)`.

### Keyboard Support
- **Escape**: Close dropdown.
- Standard text input behavior for the search field.

### Differences from Branch Autocomplete
- No "Create new" option — these are pure selection filters.
- Empty input shows all options (branch autocomplete hides dropdown when input is empty).
- Includes a reset/clear option at the top.
- Component is self-contained (branch autocomplete is inline in the dialog).

## Files Changed
| File | Change |
|------|--------|
| `frontend/src/components/SearchableSelect.svelte` | New reusable component |
| `frontend/src/components/SessionFilters.svelte` | Replace `<select>` with `SearchableSelect` |

## Non-Goals
- Not refactoring the branch autocomplete in NewSessionDialog to use this component (different behavior: create-new, branch-specific loading).
- Not adding keyboard arrow navigation through dropdown items (keep it simple).
