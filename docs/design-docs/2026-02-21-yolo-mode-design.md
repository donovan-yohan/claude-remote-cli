# Yolo Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "yolo mode" option that passes `--dangerously-skip-permissions` to the Claude CLI when creating or resuming sessions.

**Architecture:** Two UI entry points (new session checkbox + context menu item for resume) both send `claudeArgs: ['--dangerously-skip-permissions']` to the existing `POST /sessions` endpoint. One-line backend fix to merge `claudeArgs` with `config.claudeArgs` instead of replacing.

**Tech Stack:** Vanilla JS (ES5), HTML, CSS, TypeScript (server)

---

### Task 1: Fix backend claudeArgs merge

**Files:**
- Modify: `server/index.ts:319`

**Step 1: Fix the merge logic**

Change line 319 from:
```typescript
const baseArgs = claudeArgs || config.claudeArgs || [];
```
to:
```typescript
const baseArgs = [...(config.claudeArgs || []), ...(claudeArgs || [])];
```

This ensures `claudeArgs` from the request is appended to config-level args, not replacing them.

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compile, no errors.

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "fix: merge claudeArgs with config args instead of replacing"
```

---

### Task 2: Add yolo checkbox to new session dialog

**Files:**
- Modify: `public/index.html:101-105` (between custom-path and dialog-actions)

**Step 1: Add checkbox HTML**

After the `.dialog-custom-path` div (line 101) and before `.dialog-actions` (line 102), add:

```html
    <div class="dialog-option">
      <label>
        <input type="checkbox" id="dialog-yolo" />
        Yolo mode
      </label>
      <span class="dialog-option-hint">Skip all permission prompts</span>
    </div>
```

**Step 2: Add CSS for checkbox**

In `public/style.css`, after the `.dialog-custom-path input:focus` rule (line 591), add:

```css
.dialog-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 1rem;
}

.dialog-option label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text);
  cursor: pointer;
}

.dialog-option input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.dialog-option-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  padding-left: 24px;
}
```

**Step 3: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add yolo mode checkbox to new session dialog"
```

---

### Task 3: Add "Resume in yolo mode" to context menu

**Files:**
- Modify: `public/index.html:126-128` (context menu)

**Step 1: Add context menu item**

Add a new button before the existing delete button in the context menu:

```html
  <!-- Context Menu -->
  <div id="context-menu" class="context-menu" hidden>
    <button id="ctx-resume-yolo" class="context-menu-item">Resume in yolo mode</button>
    <button id="ctx-delete-worktree" class="context-menu-item ctx-danger">Delete worktree</button>
  </div>
```

**Step 2: Add danger styling for delete item**

In `public/style.css`, after the `.context-menu-item:hover` rule, add:

```css
.context-menu-item.ctx-danger:hover,
.context-menu-item.ctx-danger:active {
  color: #c0392b;
}
```

**Step 3: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add resume-in-yolo-mode to context menu"
```

---

### Task 4: Wire up JS logic

**Files:**
- Modify: `public/app.js`

**Step 1: Add DOM ref for yolo checkbox (after line 36)**

```javascript
var dialogYolo = document.getElementById('dialog-yolo');
```

**Step 2: Add DOM ref for resume-yolo context menu item (after line 38)**

```javascript
var ctxResumeYolo = document.getElementById('ctx-resume-yolo');
```

**Step 3: Update `startSession` to accept optional claudeArgs**

Change the function signature (line 656) from:
```javascript
function startSession(repoPath, worktreePath) {
```
to:
```javascript
function startSession(repoPath, worktreePath, claudeArgs) {
```

And add to the body construction (after line 661):
```javascript
if (claudeArgs) body.claudeArgs = claudeArgs;
```

**Step 4: Update dialogStart click handler to pass yolo flag**

Change line 707 from:
```javascript
startSession(path);
```
to:
```javascript
var args = dialogYolo.checked ? ['--dangerously-skip-permissions'] : undefined;
startSession(path, undefined, args);
```

**Step 5: Reset checkbox when dialog opens**

Add after line 680 (`customPath.value = '';`):
```javascript
dialogYolo.checked = false;
```

**Step 6: Wire resume-yolo context menu item**

Add after the `ctxDeleteWorktree` click handler (after line 556):
```javascript
ctxResumeYolo.addEventListener('click', function (e) {
  e.stopPropagation();
  hideContextMenu();
  if (!contextMenuTarget) return;
  startSession(
    contextMenuTarget.repoPath,
    contextMenuTarget.worktreePath,
    ['--dangerously-skip-permissions']
  );
});
```

**Step 7: Build and verify**

Run: `npm run build`
Expected: Clean compile (only server code compiles; frontend has no build step).

**Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat: wire yolo mode checkbox and context menu resume"
```

---

### Task 5: Manual smoke test

**Step 1: Start the server**

Run: `npm start`

**Step 2: Test new session yolo mode**

1. Open browser, authenticate
2. Click "+ New Session", select a repo
3. Check the "Yolo mode" checkbox
4. Click "New Worktree"
5. Verify the Claude session starts with `--dangerously-skip-permissions` (it should not prompt for permissions)

**Step 3: Test context menu resume**

1. Kill the session from step 2
2. Right-click (or long-press on mobile) the now-inactive worktree
3. Verify "Resume in yolo mode" appears above "Delete worktree"
4. Click "Resume in yolo mode"
5. Verify the session resumes with yolo mode active

**Step 4: Test normal resume still works**

1. Kill the session
2. Single-click the inactive worktree
3. Verify it resumes normally (with permission prompts)
