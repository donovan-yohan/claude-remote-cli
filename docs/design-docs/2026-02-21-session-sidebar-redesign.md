# Session Sidebar Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the session sidebar to show a unified list of active sessions and inactive worktrees, with root/repo filtering dropdowns, two-line list items, and inline rename.

**Architecture:** Enrich session metadata at creation time (root, repoName, worktreeName, displayName). Extend /worktrees API to scan all repos. Frontend renders a merged, deduplicated list with visual distinction between active (filled) and inactive (outline) items. Rename sends /rename through the PTY.

**Tech Stack:** Node.js, Express, node-pty, vanilla JS, CSS

---

## Task 1: Backend — Enrich session data model and API

**Files:**
- Modify: `server/sessions.js:9-47` (create function), `server/sessions.js:54-63` (list function)
- Modify: `server/index.js:106-109` (GET /sessions), `server/index.js:142-162` (GET /worktrees), `server/index.js:195-227` (POST /sessions)
- Add new route: PATCH /sessions/:id in `server/index.js`

### Step 1: Update sessions.create() to accept and store enriched fields

In `server/sessions.js`, change the `create` function signature to accept `{ repoName, repoPath, root, worktreeName, displayName, command, args, cols, rows }`. Store all new fields on the session object. Update the return value to include them.

```javascript
// server/sessions.js — updated create function signature (line 9)
function create({ repoName, repoPath, root, worktreeName, displayName, command, args = [], cols = 80, rows = 24 }) {
  // ... existing id, createdAt, env, ptyProcess, scrollback setup stays the same ...

  const session = {
    id, root: root || '', repoName: repoName || '', repoPath,
    worktreeName: worktreeName || '', displayName: displayName || worktreeName || repoName || '',
    pty: ptyProcess, createdAt, lastActivity: createdAt, scrollback,
  };
  // ... rest stays the same ...

  return { id, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, displayName: session.displayName, pid: ptyProcess.pid, createdAt };
}
```

### Step 2: Update sessions.list() to return enriched fields

```javascript
// server/sessions.js — updated list function (line 54)
function list() {
  return Array.from(sessions.values())
    .map(({ id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity }) => ({
      id, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity,
    }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}
```

### Step 3: Add updateDisplayName function to sessions module

```javascript
// server/sessions.js — new function before module.exports
function updateDisplayName(id, displayName) {
  const session = sessions.get(id);
  if (!session) throw new Error('Session not found: ' + id);
  session.displayName = displayName;
  return { id, displayName };
}

module.exports = { create, get, list, kill, resize, updateDisplayName };
```

### Step 4: Update POST /sessions to compute and pass enriched fields

In `server/index.js`, update the POST /sessions handler to compute `root` (by matching repoPath against config.rootDirs), `repoName`, and `worktreeName`, then pass them to `sessions.create()`.

```javascript
// server/index.js — replace POST /sessions handler (line 195-227)
app.post('/sessions', requireAuth, (req, res) => {
  const { repoPath, repoName, worktreePath, claudeArgs } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'repoPath is required' });

  const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
  const baseArgs = claudeArgs || config.claudeArgs || [];

  // Compute root by matching against configured rootDirs
  const roots = config.rootDirs || [];
  const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

  let args, cwd, worktreeName;

  if (worktreePath) {
    args = [...baseArgs];
    cwd = worktreePath;
    worktreeName = worktreePath.split('/').pop();
  } else {
    worktreeName = 'mobile-' + name + '-' + Date.now().toString(36);
    args = ['--worktree', worktreeName, ...baseArgs];
    cwd = repoPath;
  }

  const session = sessions.create({
    repoName: name, repoPath: cwd, root, worktreeName,
    displayName: worktreeName,
    command: config.claudeCommand, args,
  });
  return res.status(201).json(session);
});
```

### Step 5: Add PATCH /sessions/:id route for rename

```javascript
// server/index.js — add after DELETE /sessions/:id handler
app.patch('/sessions/:id', requireAuth, (req, res) => {
  const { displayName } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName is required' });
  try {
    const updated = sessions.updateDisplayName(req.params.id, displayName);
    // Send /rename through PTY
    const session = sessions.get(req.params.id);
    if (session && session.pty) {
      session.pty.write('/rename "' + displayName.replace(/"/g, '\\"') + '"\r');
    }
    res.json(updated);
  } catch (_) {
    res.status(404).json({ error: 'Session not found' });
  }
});
```

### Step 6: Update GET /worktrees to scan all repos when no repo param

```javascript
// server/index.js — replace GET /worktrees handler (line 142-162)
app.get('/worktrees', requireAuth, (req, res) => {
  const fs = require('fs');
  const repoParam = req.query.repo;
  const roots = config.rootDirs || [];
  const worktrees = [];

  // Build list of repos to scan
  var reposToScan = [];
  if (repoParam) {
    // Single repo mode (used by new session dialog)
    var root = roots.find(function (r) { return repoParam.startsWith(r); }) || '';
    reposToScan.push({ path: repoParam, name: repoParam.split('/').filter(Boolean).pop(), root: root });
  } else {
    // Scan all repos in all roots
    for (const rootDir of roots) {
      try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const fullPath = path.join(rootDir, entry.name);
          if (fs.existsSync(path.join(fullPath, '.git'))) {
            reposToScan.push({ path: fullPath, name: entry.name, root: rootDir });
          }
        }
      } catch (_) {}
    }
  }

  for (const repo of reposToScan) {
    const worktreeDir = path.join(repo.path, '.claude', 'worktrees');
    try {
      const entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        worktrees.push({
          name: entry.name,
          path: path.join(worktreeDir, entry.name),
          repoName: repo.name,
          repoPath: repo.path,
          root: repo.root,
        });
      }
    } catch (_) {}
  }
  res.json(worktrees);
});
```

### Step 7: Verify server starts

Run: `cd /Users/donovanyohan/Documents/Programs/personal/claude-mobile && node -e "require('./server/sessions'); console.log('OK')"`
Expected: `OK`

---

## Task 2: Frontend HTML — Update sidebar structure and simplify dialog

**Files:**
- Modify: `public/index.html:34-43` (sidebar section), `public/index.html:80-108` (new session dialog)

### Step 1: Add Root and Repo filter dropdowns to sidebar

Replace the sidebar content between the header and session-list (lines 39-40) with dropdowns + filter:

```html
<!-- In sidebar, after .sidebar-header, before #session-list -->
<div class="sidebar-filters">
  <select id="sidebar-root-filter">
    <option value="">All roots</option>
  </select>
  <select id="sidebar-repo-filter">
    <option value="">All repos</option>
  </select>
  <input type="text" id="session-filter" placeholder="Filter..." />
</div>
<ul id="session-list"></ul>
```

### Step 2: Remove worktree section from new session dialog

Remove lines 94-97 (the `#worktree-section` div) from the dialog. The dialog becomes purely for creating new worktrees.

### Step 3: Update new session dialog dropdown IDs

Rename the dialog's Root/Repo selects to `dialog-root-select` and `dialog-repo-select` to avoid ID collision with sidebar dropdowns. Update labels accordingly.

Final dialog HTML:
```html
<dialog id="new-session-dialog">
  <h2>New Session</h2>
  <div class="dialog-field">
    <label for="dialog-root-select">Root</label>
    <select id="dialog-root-select"><option value="">Select a root...</option></select>
  </div>
  <div class="dialog-field">
    <label for="dialog-repo-select">Repo</label>
    <select id="dialog-repo-select" disabled><option value="">Select a repo...</option></select>
  </div>
  <hr class="dialog-separator" />
  <div class="dialog-custom-path">
    <label for="custom-path-input">Or enter a local path:</label>
    <input type="text" id="custom-path-input" placeholder="/Users/you/code/my-repo" />
  </div>
  <div class="dialog-actions">
    <button id="dialog-cancel">Cancel</button>
    <button id="dialog-start" class="btn-accent">New Worktree</button>
  </div>
</dialog>
```

---

## Task 3: Frontend CSS — New styles for unified list and sidebar dropdowns

**Files:**
- Modify: `public/style.css`

### Step 1: Widen sidebar for two-line items

Change `--sidebar-width` from `180px` to `240px` (line 9).

### Step 2: Add sidebar filter dropdown styles

```css
/* After #session-filter:focus (line 176) */
.sidebar-filters {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  flex-shrink: 0;
}

.sidebar-filters select {
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.75rem;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23aaa' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
}

.sidebar-filters select:focus {
  border-color: var(--accent);
}

.sidebar-filters input {
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.75rem;
  outline: none;
  -webkit-appearance: none;
}

.sidebar-filters input:focus {
  border-color: var(--accent);
}
```

### Step 3: Update session list item for two-line layout

Replace the existing `#session-list li` and `.session-name` styles:

```css
#session-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 6px;
  margin: 2px 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
  touch-action: manipulation;
  transition: background 0.15s, border-color 0.15s;
}

/* Active session (filled) */
#session-list li.active-session {
  background: var(--bg);
}

#session-list li.active-session:hover {
  background: var(--border);
}

#session-list li.active-session.active {
  background: var(--accent);
  color: #fff;
}

#session-list li.active-session.active .session-sub {
  color: rgba(255, 255, 255, 0.7);
}

/* Inactive worktree (outline) */
#session-list li.inactive-worktree {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  opacity: 0.7;
}

#session-list li.inactive-worktree:hover {
  opacity: 1;
  border-color: var(--accent);
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.session-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--text);
}

.session-sub {
  font-size: 0.7rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* Divider between active and inactive */
.session-divider {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 12px 4px;
  opacity: 0.6;
}
```

### Step 4: Add rename input and pencil icon styles

```css
.session-rename-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  touch-action: manipulation;
  flex-shrink: 0;
}

.session-rename-btn:hover {
  color: var(--accent);
}

.session-rename-input {
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.8rem;
  padding: 2px 6px;
  outline: none;
  width: 100%;
  font-weight: 500;
}
```

### Step 5: Remove old standalone #session-filter styles

Delete the `#session-filter` and `#session-filter:focus` rules (lines 161-176) since the filter is now inside `.sidebar-filters`.

---

## Task 4: Frontend JS — Unified list, sidebar filtering, rename, dialog pre-fill

**Files:**
- Modify: `public/app.js` (entire sessions section, new session dialog section)

**Depends on:** Tasks 1, 2, 3

### Step 1: Update DOM refs for new elements

Replace old refs and add new ones at the top of app.js:

```javascript
// Replace/add DOM refs (after line 33)
var sidebarRootFilter = document.getElementById('sidebar-root-filter');
var sidebarRepoFilter = document.getElementById('sidebar-repo-filter');
var sessionFilter = document.getElementById('session-filter');

// Dialog refs — updated IDs
var dialogRootSelect = document.getElementById('dialog-root-select');
var dialogRepoSelect = document.getElementById('dialog-repo-select');
```

### Step 2: Add state for worktrees and repos

```javascript
// State (add after line 9)
var cachedSessions = [];
var cachedWorktrees = [];
var allRepos = [];
```

### Step 3: Rewrite initApp to load repos, sessions, and worktrees

```javascript
function initApp() {
  initTerminal();
  loadRepos();
  refreshAll();
}

function refreshAll() {
  Promise.all([
    fetch('/sessions').then(function (r) { return r.json(); }),
    fetch('/worktrees').then(function (r) { return r.json(); }),
  ]).then(function (results) {
    cachedSessions = results[0] || [];
    cachedWorktrees = results[1] || [];
    populateSidebarFilters();
    renderUnifiedList();
  }).catch(function () {});
}
```

### Step 4: Implement sidebar filter dropdowns

```javascript
function populateSidebarFilters() {
  // Collect all roots from sessions + worktrees
  var roots = {};
  cachedSessions.forEach(function (s) { if (s.root) roots[s.root] = true; });
  cachedWorktrees.forEach(function (w) { if (w.root) roots[w.root] = true; });

  var currentRoot = sidebarRootFilter.value;
  sidebarRootFilter.innerHTML = '<option value="">All roots</option>';
  Object.keys(roots).sort().forEach(function (root) {
    var opt = document.createElement('option');
    opt.value = root;
    opt.textContent = root.split('/').filter(Boolean).pop() || root;
    sidebarRootFilter.appendChild(opt);
  });
  sidebarRootFilter.value = currentRoot; // preserve selection

  updateRepoFilter();
}

function updateRepoFilter() {
  var selectedRoot = sidebarRootFilter.value;
  var repos = {};
  cachedSessions.forEach(function (s) {
    if (!selectedRoot || s.root === selectedRoot) repos[s.repoName] = s.repoPath;
  });
  cachedWorktrees.forEach(function (w) {
    if (!selectedRoot || w.root === selectedRoot) repos[w.repoName] = w.repoPath;
  });

  var currentRepo = sidebarRepoFilter.value;
  sidebarRepoFilter.innerHTML = '<option value="">All repos</option>';
  Object.keys(repos).sort().forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sidebarRepoFilter.appendChild(opt);
  });
  sidebarRepoFilter.value = currentRepo;
}

sidebarRootFilter.addEventListener('change', function () {
  updateRepoFilter();
  renderUnifiedList();
});
sidebarRepoFilter.addEventListener('change', function () {
  renderUnifiedList();
});
sessionFilter.addEventListener('input', function () {
  renderUnifiedList();
});
```

### Step 5: Implement renderUnifiedList (core rendering)

This is the main function that renders both active sessions and inactive worktrees, filtered by the sidebar dropdowns and text search, with active first, divider, then inactive.

```javascript
function renderUnifiedList() {
  var rootFilter = sidebarRootFilter.value;
  var repoFilter = sidebarRepoFilter.value;
  var textFilter = sessionFilter.value.toLowerCase();

  // Filter active sessions
  var activeSessions = cachedSessions.filter(function (s) {
    if (rootFilter && s.root !== rootFilter) return false;
    if (repoFilter && s.repoName !== repoFilter) return false;
    if (textFilter && (s.displayName || s.worktreeName || s.id).toLowerCase().indexOf(textFilter) === -1) return false;
    return true;
  });

  // Build set of active worktree paths for deduplication
  var activeWorktreePaths = new Set();
  cachedSessions.forEach(function (s) {
    if (s.repoPath) activeWorktreePaths.add(s.repoPath);
  });

  // Filter inactive worktrees (exclude those with active sessions)
  var inactiveWorktrees = cachedWorktrees.filter(function (w) {
    if (activeWorktreePaths.has(w.path)) return false;
    if (rootFilter && w.root !== rootFilter) return false;
    if (repoFilter && w.repoName !== repoFilter) return false;
    if (textFilter && w.name.toLowerCase().indexOf(textFilter) === -1) return false;
    return true;
  });

  inactiveWorktrees.sort(function (a, b) { return a.name.localeCompare(b.name); });

  sessionList.innerHTML = '';

  // Render active sessions
  activeSessions.forEach(function (session) {
    sessionList.appendChild(createActiveSessionLi(session));
  });

  // Divider
  if (activeSessions.length > 0 && inactiveWorktrees.length > 0) {
    var divider = document.createElement('li');
    divider.className = 'session-divider';
    divider.textContent = 'Available';
    sessionList.appendChild(divider);
  }

  // Render inactive worktrees
  inactiveWorktrees.forEach(function (wt) {
    sessionList.appendChild(createInactiveWorktreeLi(wt));
  });

  highlightActiveSession();
}
```

### Step 6: Implement createActiveSessionLi

```javascript
function rootShortName(rootPath) {
  return rootPath ? rootPath.split('/').filter(Boolean).pop() : '';
}

function createActiveSessionLi(session) {
  var li = document.createElement('li');
  li.className = 'active-session';
  li.dataset.sessionId = session.id;

  var info = document.createElement('div');
  info.className = 'session-info';

  var nameSpan = document.createElement('span');
  nameSpan.className = 'session-name';
  nameSpan.textContent = session.displayName || session.worktreeName || session.id;
  nameSpan.title = nameSpan.textContent;

  var subSpan = document.createElement('span');
  subSpan.className = 'session-sub';
  subSpan.textContent = rootShortName(session.root) + ' \u00B7 ' + (session.repoName || '');

  info.appendChild(nameSpan);
  info.appendChild(subSpan);

  var actions = document.createElement('div');
  actions.className = 'session-actions';

  var renameBtn = document.createElement('button');
  renameBtn.className = 'session-rename-btn';
  renameBtn.textContent = '\u270E'; // pencil
  renameBtn.title = 'Rename';
  renameBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    startRename(li, session);
  });

  var killBtn = document.createElement('button');
  killBtn.className = 'session-kill';
  killBtn.textContent = '\u00D7';
  killBtn.title = 'Kill session';
  killBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    killSession(session.id);
  });

  actions.appendChild(renameBtn);
  actions.appendChild(killBtn);

  li.appendChild(info);
  li.appendChild(actions);

  li.addEventListener('click', function () {
    connectToSession(session.id);
  });

  return li;
}
```

### Step 7: Implement createInactiveWorktreeLi

```javascript
function createInactiveWorktreeLi(wt) {
  var li = document.createElement('li');
  li.className = 'inactive-worktree';

  var info = document.createElement('div');
  info.className = 'session-info';

  var nameSpan = document.createElement('span');
  nameSpan.className = 'session-name';
  nameSpan.textContent = wt.name;
  nameSpan.title = wt.name;

  var subSpan = document.createElement('span');
  subSpan.className = 'session-sub';
  subSpan.textContent = rootShortName(wt.root) + ' \u00B7 ' + (wt.repoName || '');

  info.appendChild(nameSpan);
  info.appendChild(subSpan);
  li.appendChild(info);

  li.addEventListener('click', function () {
    startSession(wt.repoPath, wt.path);
  });

  return li;
}
```

### Step 8: Implement startRename

```javascript
function startRename(li, session) {
  var nameSpan = li.querySelector('.session-name');
  var oldName = nameSpan.textContent;

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-rename-input';
  input.value = oldName;

  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    var newName = input.value.trim();
    if (!newName || newName === oldName) {
      cancel();
      return;
    }
    fetch('/sessions/' + session.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: newName }),
    }).then(function () {
      session.displayName = newName;
      refreshAll();
    }).catch(function () {
      cancel();
    });
  }

  function cancel() {
    var span = document.createElement('span');
    span.className = 'session-name';
    span.textContent = oldName;
    span.title = oldName;
    input.replaceWith(span);
  }

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}
```

### Step 9: Update startSession and refreshSessions

Replace `refreshSessions()` calls with `refreshAll()`. Update `startSession` to close the dialog and call `refreshAll`.

```javascript
function startSession(repoPath, worktreePath) {
  var body = { repoPath: repoPath, repoName: repoPath.split('/').filter(Boolean).pop() };
  if (worktreePath) body.worktreePath = worktreePath;

  fetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (dialog.open) dialog.close();
      refreshAll();
      if (data.id) connectToSession(data.id);
    })
    .catch(function () {});
}
```

### Step 10: Update new session dialog to use new IDs and pre-fill from sidebar

```javascript
// Update all references from rootSelect/repoSelect to dialogRootSelect/dialogRepoSelect
// in the dialog event handlers.

newSessionBtn.addEventListener('click', function () {
  customPath.value = '';
  // Pre-fill from sidebar filter state
  loadRepos();
  setTimeout(function () {
    populateDialogRootSelect();
    // If sidebar has a root selected, pre-select it in dialog
    if (sidebarRootFilter.value) {
      dialogRootSelect.value = sidebarRootFilter.value;
      dialogRootSelect.dispatchEvent(new Event('change'));
      // If sidebar has a repo selected, pre-select it too
      if (sidebarRepoFilter.value) {
        // Find the repo path for this name
        var match = allRepos.find(function (r) {
          return r.name === sidebarRepoFilter.value && r.root === sidebarRootFilter.value;
        });
        if (match) dialogRepoSelect.value = match.path;
      }
    }
    dialog.showModal();
  }, 150);
});

dialogRootSelect.addEventListener('change', function () {
  var root = dialogRootSelect.value;
  dialogRepoSelect.innerHTML = '<option value="">Select a repo...</option>';
  if (!root) { dialogRepoSelect.disabled = true; return; }
  var filtered = allRepos.filter(function (r) { return r.root === root; });
  filtered.sort(function (a, b) { return a.name.localeCompare(b.name); });
  filtered.forEach(function (repo) {
    var opt = document.createElement('option');
    opt.value = repo.path;
    opt.textContent = repo.name;
    dialogRepoSelect.appendChild(opt);
  });
  dialogRepoSelect.disabled = false;
});

dialogStart.addEventListener('click', function () {
  var repoPath = customPath.value.trim() || dialogRepoSelect.value;
  if (!repoPath) return;
  startSession(repoPath, null);
});

function populateDialogRootSelect() {
  var roots = {};
  allRepos.forEach(function (repo) { roots[repo.root || 'Other'] = true; });
  dialogRootSelect.innerHTML = '<option value="">Select a root...</option>';
  Object.keys(roots).forEach(function (root) {
    var opt = document.createElement('option');
    opt.value = root;
    opt.textContent = root.split('/').filter(Boolean).pop() || root;
    dialogRootSelect.appendChild(opt);
  });
  dialogRepoSelect.innerHTML = '<option value="">Select a repo...</option>';
  dialogRepoSelect.disabled = true;
}
```

### Step 11: Update killSession to use refreshAll

```javascript
function killSession(sessionId) {
  fetch('/sessions/' + sessionId, { method: 'DELETE' })
    .then(function () {
      if (sessionId === activeSessionId) {
        if (ws) { ws.close(); ws = null; }
        activeSessionId = null;
        term.clear();
        noSessionMsg.hidden = false;
        updateSessionTitle();
      }
      refreshAll();
    })
    .catch(function () {});
}
```

### Step 12: Verify everything works

Run: Restart server, open http://localhost:3456, verify:
1. Sidebar shows Root/Repo dropdowns + text filter
2. Active sessions appear with filled style, two-line items
3. Inactive worktrees appear below "Available" divider with outline style
4. Clicking inactive worktree starts a session
5. Pencil icon triggers inline rename
6. New Session dialog pre-fills from sidebar filters
7. Dropdowns filter both active and inactive items
