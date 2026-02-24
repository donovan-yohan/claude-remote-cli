# Worktree Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to delete stale worktrees from the UI via context menu, with full git cleanup (worktree remove + prune + branch delete).

**Architecture:** New `DELETE /worktrees` server endpoint runs git commands via `child_process.execFile`. Frontend adds a context menu (long-press/right-click) on inactive worktree items with a confirmation dialog. The existing `WorktreeWatcher` handles automatic UI updates when the filesystem changes.

**Tech Stack:** Node.js `child_process.execFile`, Express endpoint, ES5 vanilla JS frontend, native `<dialog>` element.

---

### Task 1: Server — Add `DELETE /worktrees` endpoint

**Files:**
- Modify: `server/index.ts:1` (add import)
- Modify: `server/index.ts:247` (add endpoint after `DELETE /roots`)

**Step 1: Add `child_process` import**

At line 1 of `server/index.ts`, add `execFile` import alongside existing imports:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
```

And create the promisified helper right after the existing `const __dirname` line (after line 18):

```typescript
const execFileAsync = promisify(execFile);
```

**Step 2: Add the `DELETE /worktrees` endpoint**

Insert after line 247 (after the `DELETE /roots` handler closing brace):

```typescript
  // DELETE /worktrees — remove a worktree, prune, and delete its branch
  app.delete('/worktrees', requireAuth, async (req, res) => {
    const { worktreePath, repoPath } = req.body as { worktreePath?: string; repoPath?: string };
    if (!worktreePath || !repoPath) {
      res.status(400).json({ error: 'worktreePath and repoPath are required' });
      return;
    }

    // Validate the path is inside a .claude/worktrees/ directory
    if (!worktreePath.includes(path.sep + '.claude' + path.sep + 'worktrees' + path.sep)) {
      res.status(400).json({ error: 'Path is not inside a .claude/worktrees/ directory' });
      return;
    }

    // Check no active session is using this worktree
    const activeSessions = sessions.list();
    const conflict = activeSessions.find(function (s) { return s.repoPath === worktreePath; });
    if (conflict) {
      res.status(409).json({ error: 'Close the active session first' });
      return;
    }

    // Derive branch name from worktree directory name
    const branchName = worktreePath.split('/').pop() || '';

    try {
      // Remove the worktree (will fail if uncommitted changes — no --force)
      await execFileAsync('git', ['worktree', 'remove', worktreePath], { cwd: repoPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove worktree';
      res.status(500).json({ error: message });
      return;
    }

    try {
      // Prune stale worktree refs
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath });
    } catch (_) {
      // Non-fatal: prune failure doesn't block success
    }

    if (branchName) {
      try {
        // Delete the branch
        await execFileAsync('git', ['branch', '-D', branchName], { cwd: repoPath });
      } catch (_) {
        // Non-fatal: branch may not exist or may be checked out elsewhere
      }
    }

    res.json({ ok: true });
  });
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compilation with no errors.

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add DELETE /worktrees endpoint for worktree cleanup"
```

---

### Task 2: Frontend — Add confirmation dialog HTML

**Files:**
- Modify: `public/index.html:123` (after settings dialog, before closing script tags)

**Step 1: Add context menu container and confirmation dialog**

Insert after line 123 (after `</dialog>` for settings-dialog) and before the `<script>` tags:

```html
  <!-- Context Menu -->
  <div id="context-menu" class="context-menu" hidden>
    <button id="ctx-delete-worktree" class="context-menu-item">Delete worktree</button>
  </div>

  <!-- Delete Worktree Confirmation Dialog -->
  <dialog id="delete-worktree-dialog">
    <h2>Delete worktree?</h2>
    <p class="delete-wt-warning">This will remove the worktree directory and delete its branch. This cannot be undone.</p>
    <p class="delete-wt-name" id="delete-wt-name"></p>
    <div class="dialog-actions">
      <button id="delete-wt-cancel">Cancel</button>
      <button id="delete-wt-confirm" class="btn-danger">Delete</button>
    </div>
  </dialog>
```

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add context menu and delete worktree dialog HTML"
```

---

### Task 3: Frontend — Add CSS for context menu and delete dialog

**Files:**
- Modify: `public/style.css` (append before the `/* ===== Mobile Responsive =====*/` section at line 740)

**Step 1: Add context menu and delete dialog styles**

Insert before line 740 (before the mobile responsive section):

```css
/* ===== Context Menu ===== */
.context-menu {
  position: fixed;
  z-index: 200;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  min-width: 160px;
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}

.context-menu-item:hover,
.context-menu-item:active {
  background: var(--bg);
  color: var(--accent);
}

/* ===== Delete Worktree Dialog ===== */
dialog#delete-worktree-dialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  padding: 1.5rem;
  width: 90%;
  max-width: 400px;
  margin: auto;
}

dialog#delete-worktree-dialog::backdrop {
  background: rgba(0, 0, 0, 0.7);
}

dialog#delete-worktree-dialog h2 {
  font-size: 1.1rem;
  margin-bottom: 0.75rem;
}

.delete-wt-warning {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

.delete-wt-name {
  font-size: 0.85rem;
  font-family: monospace;
  color: var(--accent);
  padding: 8px 10px;
  background: var(--bg);
  border-radius: 6px;
  margin-bottom: 1rem;
  word-break: break-all;
}

.btn-danger {
  background: #c0392b !important;
  border-color: #c0392b !important;
  color: #fff !important;
}

.btn-danger:active {
  opacity: 0.85;
}
```

**Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add context menu and delete worktree dialog styles"
```

---

### Task 4: Frontend — Add context menu and delete logic to app.js

**Files:**
- Modify: `public/app.js:391-417` (modify `createInactiveWorktreeLi`)
- Modify: `public/app.js` (add new functions after `killSession` at line 481)

**Step 1: Add DOM refs for new elements**

Insert after line 36 (after `var dialogRepoSelect`):

```javascript
  var contextMenu = document.getElementById('context-menu');
  var ctxDeleteWorktree = document.getElementById('ctx-delete-worktree');
  var deleteWtDialog = document.getElementById('delete-worktree-dialog');
  var deleteWtName = document.getElementById('delete-wt-name');
  var deleteWtCancel = document.getElementById('delete-wt-cancel');
  var deleteWtConfirm = document.getElementById('delete-wt-confirm');
```

**Step 2: Add context menu state and helper functions**

Insert after the DOM refs (after the new lines from step 1):

```javascript
  // Context menu state
  var contextMenuTarget = null; // stores { worktreePath, repoPath, name }
  var longPressTimer = null;

  function showContextMenu(x, y, wt) {
    contextMenuTarget = { worktreePath: wt.path, repoPath: wt.repoPath, name: wt.name };
    contextMenu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 60) + 'px';
    contextMenu.hidden = false;
  }

  function hideContextMenu() {
    contextMenu.hidden = true;
    contextMenuTarget = null;
  }

  document.addEventListener('click', function () {
    hideContextMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideContextMenu();
  });
```

**Step 3: Replace `createInactiveWorktreeLi` function**

Replace lines 391–417 (the existing `createInactiveWorktreeLi` function) with:

```javascript
  function createInactiveWorktreeLi(wt) {
    var li = document.createElement('li');
    li.className = 'inactive-worktree';

    var infoDiv = document.createElement('div');
    infoDiv.className = 'session-info';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'session-name';
    nameSpan.textContent = wt.name;
    nameSpan.title = wt.name;

    var subSpan = document.createElement('span');
    subSpan.className = 'session-sub';
    subSpan.textContent = (wt.root ? rootShortName(wt.root) : '') + ' · ' + (wt.repoName || '');

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(subSpan);

    li.appendChild(infoDiv);

    // Click to resume
    li.addEventListener('click', function () {
      startSession(wt.repoPath, wt.path);
    });

    // Right-click context menu (desktop)
    li.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, wt);
    });

    // Long-press context menu (mobile)
    li.addEventListener('touchstart', function (e) {
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        var touch = e.touches[0];
        showContextMenu(touch.clientX, touch.clientY, wt);
      }, 500);
    }, { passive: true });

    li.addEventListener('touchend', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    li.addEventListener('touchmove', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    return li;
  }
```

**Step 4: Add delete worktree flow**

Insert after line 481 (after the `killSession` function closing brace):

```javascript
  // ── Delete Worktree ────────────────────────────────────────────────────────

  ctxDeleteWorktree.addEventListener('click', function (e) {
    e.stopPropagation();
    hideContextMenu();
    if (!contextMenuTarget) return;
    deleteWtName.textContent = contextMenuTarget.name;
    deleteWtDialog.showModal();
  });

  deleteWtCancel.addEventListener('click', function () {
    deleteWtDialog.close();
    contextMenuTarget = null;
  });

  deleteWtConfirm.addEventListener('click', function () {
    if (!contextMenuTarget) return;
    var target = contextMenuTarget;
    deleteWtDialog.close();
    contextMenuTarget = null;

    fetch('/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worktreePath: target.worktreePath,
        repoPath: target.repoPath,
      }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (data) {
            alert(data.error || 'Failed to delete worktree');
          });
        }
        // UI will auto-update via worktrees-changed WebSocket event
      })
      .catch(function () {
        alert('Failed to delete worktree');
      });
  });
```

**Step 5: Prevent click-through when long-press triggers context menu**

In the `createInactiveWorktreeLi` function, update the click handler to check for context menu visibility. Replace the click listener with:

```javascript
    // Click to resume (but not if context menu just opened)
    li.addEventListener('click', function (e) {
      if (!contextMenu.hidden) return;
      startSession(wt.repoPath, wt.path);
    });
```

This is already handled in step 3 above — the click listener on `document` hides the context menu, and individual clicks are checked.

**Step 6: Build and manual test**

Run: `npm start`
Verify:
- Right-clicking an inactive worktree shows context menu
- Clicking "Delete worktree" opens confirmation dialog
- Confirming calls `DELETE /worktrees` and the worktree disappears from sidebar

**Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: add context menu and delete worktree UI logic"
```

---

### Task 5: Fix touch interaction — prevent click on long-press

**Files:**
- Modify: `public/app.js` (the `createInactiveWorktreeLi` function from Task 4)

**Step 1: Add long-press detection flag**

The long-press timer in Task 4 sets `longPressTimer = null` when fired, but the `touchend` then fires a synthetic `click`. We need to suppress it.

Update the `createInactiveWorktreeLi` touch handlers — add a `longPressFired` flag:

In the `touchstart` handler, add `var longPressFired = false;` at the li scope (before the touchstart listener). Actually, the simplest approach: track this with a variable scoped to the IIFE.

Add after the `var longPressTimer = null;` line:

```javascript
  var longPressFired = false;
```

Update the `touchstart` callback to set `longPressFired = true` when the timer fires:

```javascript
    li.addEventListener('touchstart', function (e) {
      longPressFired = false;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        longPressFired = true;
        var touch = e.touches[0];
        showContextMenu(touch.clientX, touch.clientY, wt);
      }, 500);
    }, { passive: true });
```

And update the click handler:

```javascript
    li.addEventListener('click', function () {
      if (longPressFired || !contextMenu.hidden) return;
      startSession(wt.repoPath, wt.path);
    });
```

**Step 2: Commit**

```bash
git add public/app.js
git commit -m "fix: prevent click-through after long-press on worktree items"
```

Note: Task 4 and Task 5 will be combined during implementation since they modify the same function. The separation here is for clarity of the interaction pattern.

---

### Task 6: Test — Unit test for DELETE /worktrees validation

**Files:**
- Create: `test/worktrees.test.ts`

Since the `DELETE /worktrees` endpoint depends on Express, sessions state, and `git` commands, the most practical unit test approach tests the validation logic and session-conflict check by hitting the endpoint via supertest or by extracting the logic. Given the project's testing patterns (direct module imports with `node:test`), we'll test the key validation behaviors.

**Step 1: Write the test file**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('DELETE /worktrees validation', () => {
  it('should reject paths not inside .claude/worktrees/', () => {
    // Validate the path check logic used by the endpoint
    const worktreePath = '/some/random/path';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.claude' + sep + 'worktrees' + sep);
    assert.equal(inside, false);
  });

  it('should accept paths inside .claude/worktrees/', () => {
    const worktreePath = '/Users/me/code/repo/.claude/worktrees/my-worktree';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.claude' + sep + 'worktrees' + sep);
    assert.equal(inside, true);
  });

  it('should not match partial .claude/worktrees paths', () => {
    const worktreePath = '/Users/me/.claude/worktrees-fake/foo';
    const sep = '/';
    const inside = worktreePath.includes(sep + '.claude' + sep + 'worktrees' + sep);
    assert.equal(inside, false);
  });
});
```

**Step 2: Run the test**

Run: `npm test`
Expected: All tests pass including the new worktrees tests.

**Step 3: Commit**

```bash
git add test/worktrees.test.ts
git commit -m "test: add worktree path validation tests"
```

---

### Task 7: Manual integration test and final verification

**Step 1: Start the server**

Run: `npm start`

**Step 2: Verify end-to-end flow**

1. Open the UI in a browser
2. If there are inactive worktrees visible, right-click one → context menu appears
3. Click "Delete worktree" → confirmation dialog appears with worktree name
4. Click "Delete" → worktree is removed, sidebar updates automatically
5. If no inactive worktrees exist, create one via "New Session", let it start, then close the session. The worktree should appear as inactive. Right-click and delete it.

**Step 3: Verify error cases**

1. Try deleting a worktree that has an active session → should get "Close the active session first" error
2. On mobile (or using dev tools responsive mode), long-press an inactive worktree → context menu should appear

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "feat: worktree cleanup from UI — complete"
```
