# Repo Sessions + Tabbed Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to open Claude sessions directly in root repo directories (not just worktrees), with a tabbed sidebar to navigate between Repos and Worktrees views.

**Architecture:** Add `type: 'repo' | 'worktree'` to the Session data model. Add `POST /sessions/repo` route for repo sessions (no git worktree creation). Add `findRepoSession()` helper for the one-per-repo constraint. Frontend gets two sidebar tabs with shared filters and a tab-aware new-session dialog.

**Tech Stack:** TypeScript (server), vanilla JS (frontend), Node.js built-in `node:test`

---

### Task 1: Add `type` field to Session interface

**Files:**
- Modify: `server/types.ts:3-15`

**Step 1: Write the change**

In `server/types.ts`, add `type` to the `Session` interface:

```typescript
export type SessionType = 'repo' | 'worktree';

export interface Session {
  id: string;
  type: SessionType;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  pty: IPty;
  createdAt: string;
  lastActivity: string;
  scrollback: string[];
  idle: boolean;
}
```

**Step 2: Fix compile errors in `server/sessions.ts`**

In `server/sessions.ts`:

- Add `type` to `CreateParams` (line 11-23):
```typescript
type CreateParams = {
  type?: SessionType;
  repoName?: string;
  repoPath: string;
  cwd?: string;
  root?: string;
  worktreeName?: string;
  displayName?: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  configPath?: string;
};
```

- Add the import at top of file:
```typescript
import type { Session, SessionType } from './types.js';
```

- In the `create` function (line 38), destructure `type` from params:
```typescript
function create({ type, repoName, repoPath, cwd, root, worktreeName, displayName, command, args = [], cols = 80, rows = 24, configPath }: CreateParams): CreateResult {
```

- In the session object construction (line 59-71), add `type`:
```typescript
const session: Session = {
  id,
  type: type || 'worktree',
  root: root || '',
  // ... rest unchanged
};
```

- In the `list` function (line 135-149), add `type` to the mapped output:
```typescript
function list(): SessionSummary[] {
  return Array.from(sessions.values())
    .map(({ id, type, root, repoName, repoPath, worktreeName, displayName, createdAt, lastActivity, idle }) => ({
      id,
      type,
      root,
      repoName,
      repoPath,
      worktreeName,
      displayName,
      createdAt,
      lastActivity,
      idle,
    }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}
```

- In the `create` return statement (line 128), add `type`:
```typescript
return { id, type: session.type, root: session.root, repoName: session.repoName, repoPath, worktreeName: session.worktreeName, displayName: session.displayName, pid: ptyProcess.pid, createdAt, lastActivity: createdAt, idle: false };
```

**Step 3: Build to verify no compile errors**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 4: Run existing tests to verify no regressions**

Run: `npm test`
Expected: All existing tests pass. The `type` field defaults to `'worktree'` so nothing breaks.

**Step 5: Commit**

```bash
git add server/types.ts server/sessions.ts
git commit -m "feat: add type field to Session interface"
```

---

### Task 2: Add `findRepoSession` helper and export it

**Files:**
- Modify: `server/sessions.ts`

**Step 1: Write the failing test**

Add to `test/sessions.test.ts`, inside the existing `describe('sessions', ...)` block, after the last test:

```typescript
it('findRepoSession returns undefined when no repo sessions exist', () => {
  const result = sessions.findRepoSession('/tmp');
  assert.strictEqual(result, undefined);
});

it('findRepoSession returns repo session matching repoPath', () => {
  const created = sessions.create({
    type: 'repo',
    repoName: 'test-repo',
    repoPath: '/tmp/my-repo',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(created.id);

  const found = sessions.findRepoSession('/tmp/my-repo');
  assert.ok(found, 'should find the repo session');
  assert.strictEqual(found.id, created.id);
  assert.strictEqual(found.type, 'repo');
});

it('findRepoSession ignores worktree sessions at same path', () => {
  const created = sessions.create({
    type: 'worktree',
    repoName: 'test-repo',
    repoPath: '/tmp/my-repo',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(created.id);

  const found = sessions.findRepoSession('/tmp/my-repo');
  assert.strictEqual(found, undefined, 'should not match worktree sessions');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `sessions.findRepoSession is not a function`

**Step 3: Write the implementation**

In `server/sessions.ts`, add before the export line (line 183):

```typescript
function findRepoSession(repoPath: string): SessionSummary | undefined {
  for (const session of sessions.values()) {
    if (session.type === 'repo' && session.repoPath === repoPath) {
      const { id, type, root, repoName, repoPath: rp, worktreeName, displayName, createdAt, lastActivity, idle } = session;
      return { id, type, root, repoName, repoPath: rp, worktreeName, displayName, createdAt, lastActivity, idle };
    }
  }
  return undefined;
}
```

Update the export line:
```typescript
export { create, get, list, kill, resize, updateDisplayName, write, onIdleChange, findRepoSession };
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass, including the 3 new ones.

**Step 5: Commit**

```bash
git add server/sessions.ts test/sessions.test.ts
git commit -m "feat: add findRepoSession helper with one-per-repo lookup"
```

---

### Task 3: Add unit tests for `type` field behavior

**Files:**
- Modify: `test/sessions.test.ts`

**Step 1: Write the tests**

Add to `test/sessions.test.ts`, inside the `describe('sessions', ...)` block:

```typescript
it('type defaults to worktree when not specified', () => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(result.id);
  assert.strictEqual(result.type, 'worktree');

  const session = sessions.get(result.id);
  assert.ok(session);
  assert.strictEqual(session.type, 'worktree');
});

it('type is set to repo when specified', () => {
  const result = sessions.create({
    type: 'repo',
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(result.id);
  assert.strictEqual(result.type, 'repo');

  const session = sessions.get(result.id);
  assert.ok(session);
  assert.strictEqual(session.type, 'repo');
});

it('list includes type field', () => {
  const r1 = sessions.create({
    type: 'repo',
    repoName: 'repo-a',
    repoPath: '/tmp/a',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(r1.id);

  const r2 = sessions.create({
    type: 'worktree',
    repoName: 'repo-b',
    repoPath: '/tmp/b',
    command: '/bin/echo',
    args: ['hello'],
  });
  createdIds.push(r2.id);

  const list = sessions.list();
  const repoSession = list.find(function (s) { return s.id === r1.id; });
  const wtSession = list.find(function (s) { return s.id === r2.id; });

  assert.ok(repoSession);
  assert.strictEqual(repoSession.type, 'repo');
  assert.ok(wtSession);
  assert.strictEqual(wtSession.type, 'worktree');
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass (implementation was done in Task 1).

**Step 3: Commit**

```bash
git add test/sessions.test.ts
git commit -m "test: add type field unit tests for sessions"
```

---

### Task 4: Add worktree path validation test for repo sessions

**Files:**
- Modify: `test/worktrees.test.ts`

**Step 1: Write the test**

Add a new describe block at the end of `test/worktrees.test.ts`:

```typescript
describe('repo session path validation', () => {
  it('repo root paths are valid (not inside .worktrees/)', () => {
    const repoPath = '/Users/me/code/my-repo';
    const sep = '/';
    const insideWorktrees = repoPath.includes(sep + '.worktrees' + sep);
    assert.equal(insideWorktrees, false, 'repo root path should not be inside .worktrees/');
  });

  it('repo session and worktree session paths are distinguishable', () => {
    const repoPath = '/Users/me/code/my-repo';
    const worktreePath = '/Users/me/code/my-repo/.worktrees/feature-branch';
    const sep = '/';
    assert.equal(repoPath.includes(sep + '.worktrees' + sep), false);
    assert.equal(worktreePath.includes(sep + '.worktrees' + sep), true);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add test/worktrees.test.ts
git commit -m "test: add repo session path validation tests"
```

---

### Task 5: Add `POST /sessions/repo` route

**Files:**
- Modify: `server/index.ts` (add route after existing `POST /sessions`, around line 505)

**Step 1: Write the route**

Add after the existing `POST /sessions` handler (after line 505 in `server/index.ts`):

```typescript
// POST /sessions/repo — start a session in the repo root (no worktree)
app.post('/sessions/repo', requireAuth, (req, res) => {
  const { repoPath, repoName, continue: continueSession, claudeArgs } = req.body as {
    repoPath?: string;
    repoName?: string;
    continue?: boolean;
    claudeArgs?: string[];
  };
  if (!repoPath) {
    res.status(400).json({ error: 'repoPath is required' });
    return;
  }

  // One repo session at a time
  const existing = sessions.findRepoSession(repoPath);
  if (existing) {
    res.status(409).json({ error: 'A session already exists for this repo', sessionId: existing.id });
    return;
  }

  const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
  const baseArgs = [...(config.claudeArgs || []), ...(claudeArgs || [])];
  const args = continueSession ? ['--continue', ...baseArgs] : [...baseArgs];

  const roots = config.rootDirs || [];
  const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

  const session = sessions.create({
    type: 'repo',
    repoName: name,
    repoPath,
    cwd: repoPath,
    root,
    displayName: name,
    command: config.claudeCommand,
    args,
  });

  res.status(201).json(session);
});
```

**Step 2: Update the existing `POST /sessions` to explicitly pass `type: 'worktree'`**

In the existing `POST /sessions` handler, find the `sessions.create()` call (around line 483) and add `type: 'worktree'`:

```typescript
const session = sessions.create({
  type: 'worktree',
  repoName: name,
  repoPath: sessionRepoPath,
  cwd,
  root,
  worktreeName,
  displayName,
  command: config.claudeCommand,
  args,
  configPath: CONFIG_PATH,
});
```

**Step 3: Build to verify no compile errors**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Run tests to verify no regressions**

Run: `npm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: add POST /sessions/repo route for repo sessions"
```

---

### Task 6: Add sidebar tabs to HTML

**Files:**
- Modify: `public/index.html:41-58`

**Step 1: Add tab markup**

Replace the sidebar-header and add tabs between `sidebar-filters` and `session-list`:

```html
<!-- Sidebar -->
<div id="sidebar">
  <div class="sidebar-header">
    <span class="sidebar-label">Sessions</span>
    <button id="sidebar-toggle" class="icon-btn" aria-label="Toggle sidebar">&#9776;</button>
  </div>
  <div class="sidebar-filters">
    <select id="sidebar-root-filter">
      <option value="">All roots</option>
    </select>
    <select id="sidebar-repo-filter">
      <option value="">All repos</option>
    </select>
    <input type="text" id="session-filter" placeholder="Filter..." />
  </div>
  <div class="sidebar-tabs">
    <button class="sidebar-tab active" data-tab="repos">Repos (<span id="tab-repos-count">0</span>)</button>
    <button class="sidebar-tab" data-tab="worktrees">Worktrees (<span id="tab-worktrees-count">0</span>)</button>
  </div>
  <ul id="session-list"></ul>
  <button id="new-session-btn">+ New Session</button>
  <button id="settings-btn">Settings</button>
</div>
```

**Step 2: Verify it renders**

Run: `npm start` and open in browser.
Expected: Two tab buttons appear between filters and the session list. They don't do anything yet.

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add sidebar tab markup for repos and worktrees"
```

---

### Task 7: Style the sidebar tabs

**Files:**
- Modify: `public/style.css`

**Step 1: Add tab styles**

Add after the `.sidebar-filters` CSS block in `style.css`:

```css
/* Sidebar Tabs */
.sidebar-tabs {
  display: flex;
  gap: 0;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}

.sidebar-tab {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 0.7rem;
  padding: 6px 4px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  text-align: center;
}

.sidebar-tab:hover {
  color: var(--text);
}

.sidebar-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
```

**Step 2: Verify styling**

Run: `npm start` and check browser.
Expected: Tabs are evenly split, active tab has orange underline and text, inactive is muted.

**Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat: style sidebar tabs"
```

---

### Task 8: Implement tab switching and split rendering in `app.js`

**Files:**
- Modify: `public/app.js`

**Step 1: Add tab state and DOM refs**

Near the top of the IIFE (around line 36, after the other DOM refs), add:

```javascript
var sidebarTabs = document.querySelectorAll('.sidebar-tab');
var tabReposCount = document.getElementById('tab-repos-count');
var tabWorktreesCount = document.getElementById('tab-worktrees-count');
var activeTab = 'repos'; // 'repos' | 'worktrees'
```

**Step 2: Add tab click handlers**

After the filter event listeners (around line 606), add:

```javascript
sidebarTabs.forEach(function (tab) {
  tab.addEventListener('click', function () {
    activeTab = tab.dataset.tab;
    sidebarTabs.forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    renderUnifiedList();
  });
});
```

**Step 3: Rewrite `renderUnifiedList` to be tab-aware**

Replace the `renderUnifiedList` function (lines 631-684) with:

```javascript
function renderUnifiedList() {
  var rootFilter = sidebarRootFilter.value;
  var repoFilter = sidebarRepoFilter.value;
  var textFilter = sessionFilter.value.toLowerCase();

  // Split sessions by type
  var repoSessions = cachedSessions.filter(function (s) { return s.type === 'repo'; });
  var worktreeSessions = cachedSessions.filter(function (s) { return s.type !== 'repo'; });

  // Filtered repo sessions
  var filteredRepoSessions = repoSessions.filter(function (s) {
    if (rootFilter && s.root !== rootFilter) return false;
    if (repoFilter && s.repoName !== repoFilter) return false;
    if (textFilter) {
      var name = (s.displayName || s.repoName || s.id).toLowerCase();
      if (name.indexOf(textFilter) === -1) return false;
    }
    return true;
  });

  // Idle repos: all repos without an active repo session
  var activeRepoPathSet = new Set();
  repoSessions.forEach(function (s) { activeRepoPathSet.add(s.repoPath); });

  var filteredIdleRepos = cachedRepos.filter(function (r) {
    if (activeRepoPathSet.has(r.path)) return false;
    if (rootFilter && r.root !== rootFilter) return false;
    if (repoFilter && r.name !== repoFilter) return false;
    if (textFilter) {
      var name = (r.name || '').toLowerCase();
      if (name.indexOf(textFilter) === -1) return false;
    }
    return true;
  });

  filteredIdleRepos.sort(function (a, b) {
    return (a.name || '').localeCompare(b.name || '');
  });

  // Filtered worktree sessions
  var filteredWorktreeSessions = worktreeSessions.filter(function (s) {
    if (rootFilter && s.root !== rootFilter) return false;
    if (repoFilter && s.repoName !== repoFilter) return false;
    if (textFilter) {
      var name = (s.displayName || s.repoName || s.worktreeName || s.id).toLowerCase();
      if (name.indexOf(textFilter) === -1) return false;
    }
    return true;
  });

  // Inactive worktrees (deduped against active sessions)
  var activeWorktreePaths = new Set();
  worktreeSessions.forEach(function (s) {
    if (s.repoPath) activeWorktreePaths.add(s.repoPath);
  });

  var filteredWorktrees = cachedWorktrees.filter(function (wt) {
    if (activeWorktreePaths.has(wt.path)) return false;
    if (rootFilter && wt.root !== rootFilter) return false;
    if (repoFilter && wt.repoName !== repoFilter) return false;
    if (textFilter) {
      var name = (wt.name || '').toLowerCase();
      if (name.indexOf(textFilter) === -1) return false;
    }
    return true;
  });

  filteredWorktrees.sort(function (a, b) {
    return (a.name || '').localeCompare(b.name || '');
  });

  // Update tab counts
  tabReposCount.textContent = filteredRepoSessions.length + filteredIdleRepos.length;
  tabWorktreesCount.textContent = filteredWorktreeSessions.length + filteredWorktrees.length;

  // Render based on active tab
  sessionList.innerHTML = '';

  if (activeTab === 'repos') {
    filteredRepoSessions.forEach(function (session) {
      sessionList.appendChild(createActiveSessionLi(session));
    });

    if (filteredRepoSessions.length > 0 && filteredIdleRepos.length > 0) {
      var divider = document.createElement('li');
      divider.className = 'session-divider';
      divider.textContent = 'Available';
      sessionList.appendChild(divider);
    }

    filteredIdleRepos.forEach(function (repo) {
      sessionList.appendChild(createIdleRepoLi(repo));
    });
  } else {
    filteredWorktreeSessions.forEach(function (session) {
      sessionList.appendChild(createActiveSessionLi(session));
    });

    if (filteredWorktreeSessions.length > 0 && filteredWorktrees.length > 0) {
      var divider = document.createElement('li');
      divider.className = 'session-divider';
      divider.textContent = 'Available';
      sessionList.appendChild(divider);
    }

    filteredWorktrees.forEach(function (wt) {
      sessionList.appendChild(createInactiveWorktreeLi(wt));
    });
  }

  highlightActiveSession();
}
```

**Step 4: Add `cachedRepos` variable and populate it**

Near the top of the IIFE (around line 14, near `cachedSessions` and `cachedWorktrees`), add:

```javascript
var cachedRepos = [];
```

In the `refreshAll` function (around line 522), add a fetch for repos. Find where `cachedSessions` and `cachedWorktrees` are fetched and add `cachedRepos`:

```javascript
fetch('/repos').then(function (r) { return r.json(); }).then(function (repos) {
  cachedRepos = repos;
  renderUnifiedList();
});
```

**Step 5: Add `createIdleRepoLi` function**

Add near `createInactiveWorktreeLi` (after it, before `highlightActiveSession`):

```javascript
function createIdleRepoLi(repo) {
  var li = document.createElement('li');
  li.className = 'inactive-worktree'; // reuse same styling as inactive worktrees
  li.title = repo.path;

  var infoDiv = document.createElement('div');
  infoDiv.className = 'session-info';

  var nameSpan = document.createElement('span');
  nameSpan.className = 'session-name';
  nameSpan.textContent = repo.name;
  nameSpan.title = repo.name;

  var dot = document.createElement('span');
  dot.className = 'status-dot status-dot--inactive';

  var subSpan = document.createElement('span');
  subSpan.className = 'session-sub';
  subSpan.textContent = repo.root ? rootShortName(repo.root) : repo.path;

  infoDiv.appendChild(dot);
  infoDiv.appendChild(nameSpan);
  infoDiv.appendChild(subSpan);
  li.appendChild(infoDiv);

  li.addEventListener('click', function () {
    openNewSessionDialogForRepo(repo);
  });

  return li;
}
```

**Step 6: Build and verify**

Run: `npm run build && npm start`
Expected: Tabs switch between repos and worktrees views. Repos tab shows active repo sessions (none yet) and idle repos. Worktrees tab shows existing behavior.

**Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: implement tab switching and split rendering"
```

---

### Task 9: Make the new-session dialog tab-aware

**Files:**
- Modify: `public/index.html:121-159` (add continue checkbox)
- Modify: `public/app.js` (dialog logic)

**Step 1: Add the continue checkbox to the dialog**

In `public/index.html`, add after the branch field `<div class="dialog-field">` block (after line 141) and before the `<hr class="dialog-separator" />`:

```html
<div class="dialog-field" id="dialog-continue-field" hidden>
  <label>
    <input type="checkbox" id="dialog-continue" />
    Continue previous conversation
  </label>
  <span class="dialog-option-hint">Resume where you left off (--continue)</span>
</div>
```

**Step 2: Add `openNewSessionDialogForRepo` and wire tab-aware dialog**

In `public/app.js`, add the DOM refs near the other dialog refs:

```javascript
var dialogContinue = document.getElementById('dialog-continue');
var dialogContinueField = document.getElementById('dialog-continue-field');
var dialogBranchField = dialogBranchInput.closest('.dialog-field');
```

Add the `openNewSessionDialogForRepo` function:

```javascript
function openNewSessionDialogForRepo(repo) {
  customPath.value = '';
  dialogYolo.checked = false;
  dialogContinue.checked = false;
  dialogBranchInput.value = '';
  dialogBranchList.hidden = true;
  allBranches = [];
  populateDialogRootSelect();

  // Pre-fill repo
  if (repo.root) {
    dialogRootSelect.value = repo.root;
    dialogRootSelect.dispatchEvent(new Event('change'));
    dialogRepoSelect.value = repo.path;
  }

  // Show repo-mode dialog
  showDialogForTab('repos');
  dialog.showModal();
}
```

Add a helper to toggle dialog fields based on tab:

```javascript
function showDialogForTab(tab) {
  if (tab === 'repos') {
    dialogBranchField.hidden = true;
    dialogContinueField.hidden = false;
    dialogStart.textContent = 'New Session';
  } else {
    dialogBranchField.hidden = false;
    dialogContinueField.hidden = true;
    dialogStart.textContent = 'New Worktree';
  }
}
```

**Step 3: Update the `newSessionBtn` click handler to be tab-aware**

Modify the existing handler (around line 1046) — add `showDialogForTab(activeTab)` before `dialog.showModal()`:

```javascript
newSessionBtn.addEventListener('click', function () {
  customPath.value = '';
  dialogYolo.checked = false;
  dialogContinue.checked = false;
  dialogBranchInput.value = '';
  dialogBranchList.hidden = true;
  allBranches = [];
  populateDialogRootSelect();

  var sidebarRoot = sidebarRootFilter.value;
  if (sidebarRoot) {
    dialogRootSelect.value = sidebarRoot;
    dialogRootSelect.dispatchEvent(new Event('change'));
    var sidebarRepo = sidebarRepoFilter.value;
    if (sidebarRepo) {
      var matchingRepo = allRepos.find(function (r) {
        return r.root === sidebarRoot && r.name === sidebarRepo;
      });
      if (matchingRepo) {
        dialogRepoSelect.value = matchingRepo.path;
      }
    }
  } else {
    dialogRepoSelect.innerHTML = '<option value="">Select a repo...</option>';
    dialogRepoSelect.disabled = true;
  }

  showDialogForTab(activeTab);
  dialog.showModal();
});
```

**Step 4: Update the `dialogStart` click handler to call the correct endpoint**

Replace the existing handler (around line 1075):

```javascript
dialogStart.addEventListener('click', function () {
  var repoPathValue = customPath.value.trim() || dialogRepoSelect.value;
  if (!repoPathValue) return;
  var args = dialogYolo.checked ? ['--dangerously-skip-permissions'] : undefined;

  if (activeTab === 'repos' || dialogContinueField.hidden === false) {
    // Repo session mode
    startRepoSession(repoPathValue, dialogContinue.checked, args);
  } else {
    // Worktree session mode (existing behavior)
    var branch = dialogBranchInput.value.trim() || undefined;
    startSession(repoPathValue, undefined, args, branch);
  }
});
```

**Step 5: Add `startRepoSession` function**

Add near `startSession`:

```javascript
function startRepoSession(repoPath, continueSession, claudeArgs) {
  var body = {
    repoPath: repoPath,
    repoName: repoPath.split('/').filter(Boolean).pop(),
  };
  if (continueSession) body.continue = true;
  if (claudeArgs) body.claudeArgs = claudeArgs;

  fetch('/sessions/repo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function (res) {
      if (res.status === 409) {
        return res.json().then(function (data) {
          // Already has a session — connect to it
          if (dialog.open) dialog.close();
          refreshAll();
          if (data.sessionId) connectToSession(data.sessionId);
          return null;
        });
      }
      return res.json();
    })
    .then(function (data) {
      if (!data) return;
      if (dialog.open) dialog.close();
      refreshAll();
      if (data.id) connectToSession(data.id);
    })
    .catch(function () {});
}
```

**Step 6: Verify end-to-end**

Run: `npm start`

- Switch to Repos tab → click an idle repo → dialog opens with "New Session" button, no branch input, has continue checkbox
- Switch to Worktrees tab → click "+" → dialog opens with "New Worktree" button, branch input visible, no continue checkbox
- Create a repo session → it appears in the Repos tab active section
- Try creating another repo session for the same repo → 409 conflict, connects to existing

**Step 7: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: tab-aware new-session dialog with repo session support"
```

---

### Task 10: Update the `+ New Session` button label to be tab-aware

**Files:**
- Modify: `public/app.js`

**Step 1: Update the button text on tab switch**

In the tab click handler (added in Task 8), update the button text:

```javascript
sidebarTabs.forEach(function (tab) {
  tab.addEventListener('click', function () {
    activeTab = tab.dataset.tab;
    sidebarTabs.forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    newSessionBtn.textContent = activeTab === 'repos' ? '+ New Session' : '+ New Worktree';
    renderUnifiedList();
  });
});
```

**Step 2: Verify**

Run: `npm start`
Expected: Button says "+ New Session" on Repos tab, "+ New Worktree" on Worktrees tab.

**Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: update new-session button label based on active tab"
```

---

### Task 11: Final integration verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run the build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Manual smoke test**

Run: `npm start` and verify:
1. Repos tab shows all discovered repos as idle items
2. Clicking an idle repo opens dialog in repo-session mode
3. Creating a repo session moves it to the active section
4. Worktrees tab shows existing worktrees behavior unchanged
5. Tab counts update correctly with filters
6. One-per-repo constraint works (409 on duplicate)

**Step 4: Commit any final fixes, then done**

```bash
git add -A
git commit -m "feat: repo sessions with tabbed sidebar complete"
```
