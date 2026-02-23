# Branch-Aware Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `claude --worktree` with manual `git worktree add` + plain `claude`, move worktrees from `.claude/worktrees/` to `.worktrees/`, and add a type-to-search branch picker to the New Session dialog.

**Architecture:** Server creates git worktrees directly via `execFileAsync('git', ...)` instead of delegating to `claude --worktree`. New `GET /branches` endpoint provides branch lists for the frontend's type-to-search UI. All worktree paths change from `<repo>/.claude/worktrees/<name>` to `<repo>/.worktrees/<name>`.

**Tech Stack:** TypeScript (server), vanilla JS (frontend), `git` CLI, `node-pty`, Express

---

### Task 1: Update worktree path validation and types

**Files:**
- Modify: `server/types.ts`
- Modify: `test/worktrees.test.ts`

**Step 1: Write failing tests for `.worktrees/` path validation**

Replace the existing `.claude/worktrees/` tests with `.worktrees/` equivalents in `test/worktrees.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('DELETE /worktrees validation', () => {
  it('should reject paths not inside .worktrees/', () => {
    const worktreePath = '/some/random/path';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, false);
  });

  it('should accept paths inside .worktrees/', () => {
    const worktreePath = '/Users/me/code/repo/.worktrees/my-worktree';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, true);
  });

  it('should not match partial .worktrees paths', () => {
    const worktreePath = '/Users/me/.worktrees-fake/foo';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, false);
  });

  it('should reject old .claude/worktrees/ paths', () => {
    const worktreePath = '/Users/me/code/repo/.claude/worktrees/my-worktree';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.worktrees' + sep);
    assert.equal(inside, false);
  });
});

describe('branch name to directory name', () => {
  it('should replace slashes with dashes', () => {
    const branchName = 'dy/feat/my-feature';
    const dirName = branchName.replace(/\//g, '-');
    assert.equal(dirName, 'dy-feat-my-feature');
  });

  it('should leave flat branch names unchanged', () => {
    const branchName = 'my-feature';
    const dirName = branchName.replace(/\//g, '-');
    assert.equal(dirName, 'my-feature');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS (since the tests are self-contained logic checks, not importing server code that changed yet)

**Step 3: Add `branchName` to WorktreeMetadata**

In `server/types.ts`, add `branchName` to `WorktreeMetadata`:

```typescript
export interface WorktreeMetadata {
  worktreePath: string;
  displayName: string;
  lastActivity: string;
  branchName?: string;
}
```

**Step 4: Commit**

```bash
git add test/worktrees.test.ts server/types.ts
git commit -m "feat: update worktree path validation for .worktrees/ and add branchName to metadata"
```

---

### Task 2: Update watcher to watch `.worktrees/`

**Files:**
- Modify: `server/watcher.ts`

**Step 1: Update `_watchRepo` to watch `.worktrees/` instead of `.claude/worktrees/`**

In `server/watcher.ts`, replace the `_watchRepo` method (lines 34-43):

```typescript
private _watchRepo(repoPath: string): void {
  const worktreeDir = path.join(repoPath, '.worktrees');
  if (fs.existsSync(worktreeDir)) {
    this._addWatch(worktreeDir);
  } else {
    // Watch the repo root so we detect when .worktrees/ is first created
    this._addWatch(repoPath);
  }
}
```

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add server/watcher.ts
git commit -m "feat: watch .worktrees/ instead of .claude/worktrees/"
```

---

### Task 3: Add `GET /branches` endpoint

**Files:**
- Modify: `server/index.ts` (add endpoint after `GET /repos` around line 216)

**Step 1: Add the endpoint**

Add after the `GET /repos` endpoint (line 216):

```typescript
// GET /branches?repo=<path> — list local and remote branches for a repo
app.get('/branches', requireAuth, async (req, res) => {
  const repoPath = typeof req.query.repo === 'string' ? req.query.repo : undefined;
  if (!repoPath) {
    res.status(400).json({ error: 'repo query parameter is required' });
    return;
  }

  try {
    // Fetch all local and remote branches
    const { stdout } = await execFileAsync('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: repoPath });
    const branches = stdout
      .split('\n')
      .map((b: string) => b.trim())
      .filter((b: string) => b && !b.includes('HEAD'))
      .map((b: string) => b.replace(/^origin\//, ''));

    // Deduplicate (local and remote may share names)
    const unique = [...new Set(branches)];
    res.json(unique.sort());
  } catch (_) {
    res.json([]);
  }
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: PASS (no test for endpoint itself, but build must succeed)

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: add GET /branches endpoint for branch listing"
```

---

### Task 4: Update `GET /worktrees` to scan `.worktrees/`

**Files:**
- Modify: `server/index.ts` (lines 232-254)

**Step 1: Change the worktree directory path**

In the `GET /worktrees` handler, change line 233 from:
```typescript
const worktreeDir = path.join(repo.path, '.claude', 'worktrees');
```
to:
```typescript
const worktreeDir = path.join(repo.path, '.worktrees');
```

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: scan .worktrees/ for worktree discovery"
```

---

### Task 5: Update `DELETE /worktrees` for `.worktrees/`

**Files:**
- Modify: `server/index.ts` (lines 297-348)

**Step 1: Update path validation**

Change line 306 from:
```typescript
if (!worktreePath.includes(path.sep + '.claude' + path.sep + 'worktrees' + path.sep)) {
```
to:
```typescript
if (!worktreePath.includes(path.sep + '.worktrees' + path.sep)) {
```

**Step 2: Update error message**

Change line 307 from:
```typescript
res.status(400).json({ error: 'Path is not inside a .claude/worktrees/ directory' });
```
to:
```typescript
res.status(400).json({ error: 'Path is not inside a .worktrees/ directory' });
```

**Step 3: Update branch name derivation to use metadata**

Replace line 320:
```typescript
const branchName = worktreePath.split('/').pop() || '';
```
with:
```typescript
const meta = readMeta(CONFIG_PATH, worktreePath);
const branchName = (meta && meta.branchName) || worktreePath.split('/').pop() || '';
```

**Step 4: Run tests**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: update DELETE /worktrees for .worktrees/ paths and metadata-based branch names"
```

---

### Task 6: Rewrite `POST /sessions` for manual git worktree creation

**Files:**
- Modify: `server/index.ts` (lines 350-402)

**Step 1: Add gitignore helper function**

Add this helper function before the `main()` function (around line 93):

```typescript
function ensureGitignore(repoPath: string, entry: string): void {
  const gitignorePath = path.join(repoPath, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (content.split('\n').some((line: string) => line.trim() === entry)) return;
      fs.appendFileSync(gitignorePath, '\n' + entry + '\n');
    } else {
      fs.writeFileSync(gitignorePath, entry + '\n');
    }
  } catch (_) {
    // Non-fatal: gitignore update failure shouldn't block session creation
  }
}
```

**Step 2: Rewrite the POST /sessions handler**

Replace the entire `POST /sessions` handler (lines 350-402):

```typescript
// POST /sessions
app.post('/sessions', requireAuth, async (req, res) => {
  const { repoPath, repoName, worktreePath, branchName, claudeArgs } = req.body as {
    repoPath?: string;
    repoName?: string;
    worktreePath?: string;
    branchName?: string;
    claudeArgs?: string[];
  };
  if (!repoPath) {
    res.status(400).json({ error: 'repoPath is required' });
    return;
  }

  const name = repoName || repoPath.split('/').filter(Boolean).pop() || 'session';
  const baseArgs = [...(config.claudeArgs || []), ...(claudeArgs || [])];

  // Compute root by matching repoPath against configured rootDirs
  const roots = config.rootDirs || [];
  const root = roots.find(function (r) { return repoPath.startsWith(r); }) || '';

  let args: string[];
  let cwd: string;
  let worktreeName: string;
  let sessionRepoPath: string;
  let resolvedBranch = '';

  if (worktreePath) {
    // Resume existing worktree
    args = ['--continue', ...baseArgs];
    cwd = worktreePath;
    sessionRepoPath = worktreePath;
    worktreeName = worktreePath.split('/').pop() || '';
  } else {
    // Create new worktree via git
    let dirName: string;
    if (branchName) {
      dirName = branchName.replace(/\//g, '-');
      resolvedBranch = branchName;
    } else {
      dirName = 'mobile-' + name + '-' + Date.now().toString(36);
      resolvedBranch = dirName;
    }

    const worktreeDir = path.join(repoPath, '.worktrees');
    let targetDir = path.join(worktreeDir, dirName);

    // Handle duplicate directory names
    if (fs.existsSync(targetDir)) {
      targetDir = targetDir + '-' + Date.now().toString(36);
      dirName = path.basename(targetDir);
    }

    // Ensure .worktrees/ is gitignored
    ensureGitignore(repoPath, '.worktrees/');

    try {
      // Check if branch exists locally or on remote
      let branchExists = false;
      if (branchName) {
        try {
          await execFileAsync('git', ['rev-parse', '--verify', branchName], { cwd: repoPath });
          branchExists = true;
        } catch (_) {
          // Check remote
          try {
            await execFileAsync('git', ['rev-parse', '--verify', 'origin/' + branchName], { cwd: repoPath });
            branchExists = true;
            // Use the remote-tracking branch
            resolvedBranch = 'origin/' + branchName;
          } catch (_) {
            branchExists = false;
          }
        }
      }

      if (branchName && branchExists) {
        await execFileAsync('git', ['worktree', 'add', targetDir, resolvedBranch], { cwd: repoPath });
      } else if (branchName) {
        await execFileAsync('git', ['worktree', 'add', '-b', branchName, targetDir, 'HEAD'], { cwd: repoPath });
      } else {
        await execFileAsync('git', ['worktree', 'add', '-b', dirName, targetDir, 'HEAD'], { cwd: repoPath });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create worktree';
      res.status(500).json({ error: message });
      return;
    }

    worktreeName = dirName;
    sessionRepoPath = targetDir;
    cwd = targetDir;
    args = [...baseArgs];
  }

  const displayName = branchName || worktreeName;

  const session = sessions.create({
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

  // Store branch name in metadata
  if (resolvedBranch) {
    writeMeta(CONFIG_PATH, {
      worktreePath: sessionRepoPath,
      displayName,
      lastActivity: new Date().toISOString(),
      branchName: branchName || worktreeName,
    });
  }

  res.status(201).json(session);
});
```

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: create worktrees via git directly instead of claude --worktree"
```

---

### Task 7: Update config.ts to handle branchName in metadata

**Files:**
- Modify: `server/config.ts`

**Step 1: Read the config.ts file to understand current metadata functions**

Read `server/config.ts` and check how `readMeta` and `writeMeta` handle the metadata object.

**Step 2: Update `writeMeta` and `readMeta` to include `branchName`**

The `WorktreeMetadata` type already has `branchName?: string` from Task 1. Verify that `readMeta` and `writeMeta` pass through all properties (they should, since they serialize/deserialize the full object). If they destructure specific fields, add `branchName`.

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit (if changes were needed)**

```bash
git add server/config.ts
git commit -m "feat: support branchName in worktree metadata"
```

---

### Task 8: Add branch input to New Session dialog HTML

**Files:**
- Modify: `public/index.html` (lines 121-150)

**Step 1: Add the branch input field with dropdown container**

After the repo select `</div>` (line 132) and before the `<hr>` (line 134), add:

```html
<div class="dialog-field">
  <label for="dialog-branch-input">Branch</label>
  <div class="branch-input-wrapper">
    <input type="text" id="dialog-branch-input" placeholder="Search or create branch..." autocomplete="off" />
    <ul id="dialog-branch-list" class="branch-dropdown" hidden></ul>
  </div>
  <span class="dialog-option-hint">Leave empty for auto-generated name</span>
</div>
```

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add branch input field to New Session dialog"
```

---

### Task 9: Style the branch input and dropdown

**Files:**
- Modify: `public/style.css`

**Step 1: Add styles for the branch input wrapper and dropdown**

Add after the `.dialog-field select:disabled` rule (around line 619):

```css
/* ===== Branch Input ===== */
.branch-input-wrapper {
  position: relative;
}

.branch-input-wrapper input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.875rem;
  outline: none;
  -webkit-appearance: none;
}

.branch-input-wrapper input:focus {
  border-color: var(--accent);
}

.branch-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 6px 6px;
  list-style: none;
  z-index: 10;
  margin: 0;
  padding: 0;
}

.branch-dropdown li {
  padding: 8px 12px;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
}

.branch-dropdown li:hover,
.branch-dropdown li.highlighted {
  background: var(--surface);
  color: var(--accent);
}

.branch-dropdown li.branch-create-new {
  color: var(--accent);
  font-style: italic;
}
```

**Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add branch input dropdown styles"
```

---

### Task 10: Implement type-to-search branch picker in app.js

**Files:**
- Modify: `public/app.js`

**Step 1: Add DOM refs for branch input**

After the `dialogYolo` ref (line 39), add:

```javascript
var dialogBranchInput = document.getElementById('dialog-branch-input');
var dialogBranchList = document.getElementById('dialog-branch-list');
```

**Step 2: Add branch list state and fetch function**

After the `allRepos` variable (line 91), add:

```javascript
var allBranches = [];

function loadBranches(repoPath) {
  allBranches = [];
  dialogBranchList.innerHTML = '';
  dialogBranchList.hidden = true;
  if (!repoPath) return;

  fetch('/branches?repo=' + encodeURIComponent(repoPath))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      allBranches = data || [];
    })
    .catch(function () {
      allBranches = [];
    });
}
```

**Step 3: Add type-to-search filtering logic**

After the `loadBranches` function, add:

```javascript
function filterBranches(query) {
  dialogBranchList.innerHTML = '';
  if (!query) {
    dialogBranchList.hidden = true;
    return;
  }

  var lower = query.toLowerCase();
  var matches = allBranches.filter(function (b) {
    return b.toLowerCase().indexOf(lower) !== -1;
  }).slice(0, 10);

  // Always show "Create new" option for the exact typed text
  var exactMatch = allBranches.some(function (b) { return b === query; });

  if (!exactMatch) {
    var createLi = document.createElement('li');
    createLi.className = 'branch-create-new';
    createLi.textContent = 'Create new: ' + query;
    createLi.addEventListener('click', function () {
      dialogBranchInput.value = query;
      dialogBranchList.hidden = true;
    });
    dialogBranchList.appendChild(createLi);
  }

  matches.forEach(function (branch) {
    var li = document.createElement('li');
    li.textContent = branch;
    li.addEventListener('click', function () {
      dialogBranchInput.value = branch;
      dialogBranchList.hidden = true;
    });
    dialogBranchList.appendChild(li);
  });

  dialogBranchList.hidden = dialogBranchList.children.length === 0;
}

dialogBranchInput.addEventListener('input', function () {
  filterBranches(dialogBranchInput.value.trim());
});

dialogBranchInput.addEventListener('focus', function () {
  if (dialogBranchInput.value.trim()) {
    filterBranches(dialogBranchInput.value.trim());
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
  if (!dialogBranchInput.contains(e.target) && !dialogBranchList.contains(e.target)) {
    dialogBranchList.hidden = true;
  }
});
```

**Step 4: Hook branch loading into repo selection**

In the existing `dialogRootSelect.addEventListener('change', ...)` handler (around line 917), add at the end before the closing `});`:
```javascript
dialogBranchInput.value = '';
allBranches = [];
```

In the existing `dialogRepoSelect`, add a change listener after the root select handler:
```javascript
dialogRepoSelect.addEventListener('change', function () {
  var repoPath = dialogRepoSelect.value;
  dialogBranchInput.value = '';
  loadBranches(repoPath);
});
```

**Step 5: Update `startSession` to pass `branchName`**

Modify the `startSession` function (line 937) to accept and pass `branchName`:

```javascript
function startSession(repoPath, worktreePath, claudeArgs, branchName) {
  var body = {
    repoPath: repoPath,
    repoName: repoPath.split('/').filter(Boolean).pop(),
  };
  if (worktreePath) body.worktreePath = worktreePath;
  if (claudeArgs) body.claudeArgs = claudeArgs;
  if (branchName) body.branchName = branchName;

  fetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (dialog.open) dialog.close();
      refreshAll();
      if (data.id) {
        connectToSession(data.id);
      }
    })
    .catch(function () {});
}
```

**Step 6: Update the dialog Start button handler**

Modify the `dialogStart` click handler (line 987):

```javascript
dialogStart.addEventListener('click', function () {
  var repoPathValue = customPath.value.trim() || dialogRepoSelect.value;
  if (!repoPathValue) return;
  var args = dialogYolo.checked ? ['--dangerously-skip-permissions'] : undefined;
  var branch = dialogBranchInput.value.trim() || undefined;
  startSession(repoPathValue, undefined, args, branch);
});
```

**Step 7: Reset branch input when dialog opens**

In the `newSessionBtn` click handler (line 961), add after `dialogYolo.checked = false;`:

```javascript
dialogBranchInput.value = '';
dialogBranchList.hidden = true;
allBranches = [];
```

**Step 8: Also load branches when custom path is used**

Add a blur listener for customPath:
```javascript
customPath.addEventListener('blur', function () {
  var pathValue = customPath.value.trim();
  if (pathValue) {
    loadBranches(pathValue);
  }
});
```

**Step 9: Run tests**

Run: `npm test`
Expected: PASS (frontend is vanilla JS, no test coverage needed — test build only)

**Step 10: Commit**

```bash
git add public/app.js
git commit -m "feat: implement type-to-search branch picker in New Session dialog"
```

---

### Task 11: Manual integration test

**Step 1: Build and start the server**

Run: `npm start`

**Step 2: Test new branch creation**

1. Open the app in browser
2. Click "New Session"
3. Select a repo
4. Type a branch name like `test/my-feature` in the branch input
5. Verify the dropdown shows "Create new: test/my-feature"
6. Click Start
7. Verify worktree is created at `<repo>/.worktrees/test-my-feature/`
8. Verify `.worktrees/` was added to `.gitignore`
9. Verify Claude starts in the worktree

**Step 3: Test existing branch checkout**

1. Create a branch in a test repo: `git branch test-existing`
2. Open the app, click "New Session"
3. Type "test-e" — verify "test-existing" appears in dropdown
4. Select it and click Start
5. Verify worktree checks out the existing branch

**Step 4: Test empty branch (backward compat)**

1. Click "New Session", select repo, leave branch empty
2. Click Start
3. Verify auto-generated `mobile-<repo>-<timestamp>` behavior works

**Step 5: Test resume**

1. Kill a session
2. Click the inactive worktree in sidebar
3. Verify it resumes with `claude --continue`

**Step 6: Test delete**

1. Right-click an inactive worktree
2. Click Delete
3. Verify it's removed (both directory and branch)

**Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 12: Final cleanup and version bump prep

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: branch-aware session creation with .worktrees/ location (breaking change)"
```
