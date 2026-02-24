# Update Notification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a one-click update notification toast that checks npm for newer versions and can self-update the server.

**Architecture:** New `GET /version` and `POST /update` REST endpoints in `server/index.ts`. Frontend checks `/version` on init and shows a dismissible toast. Update triggers `npm i -g claude-remote-cli@latest` then `process.exit(0)` for launchd/systemd restart.

**Tech Stack:** TypeScript backend (Express), ES5 vanilla JS frontend, node:child_process for npm install, native fetch for npm registry.

---

### Task 1: Add GET /version endpoint

**Files:**
- Modify: `server/index.ts:1-25` (imports and top-level helpers)
- Modify: `server/index.ts:382-386` (add route before server.listen)

**Step 1: Add version helper functions at module level**

Add after `const CONFIG_PATH = ...` line (line 25) in `server/index.ts`:

```typescript
// Version check cache
let versionCache: { latest: string; fetchedAt: number } | null = null;
const VERSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCurrentVersion(): string {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

function semverLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

async function getLatestVersion(): Promise<string | null> {
  if (versionCache && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL) {
    return versionCache.latest;
  }
  try {
    const res = await fetch('https://registry.npmjs.org/claude-remote-cli/latest');
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    if (data.version) {
      versionCache = { latest: data.version, fetchedAt: Date.now() };
      return data.version;
    }
    return null;
  } catch (_) {
    return null;
  }
}
```

**Step 2: Add the GET /version route**

Add before `server.listen(...)` in `server/index.ts` (around line 382):

```typescript
  // GET /version — check for updates
  app.get('/version', requireAuth, async (_req, res) => {
    const current = getCurrentVersion();
    const latest = await getLatestVersion();
    const updateAvailable = latest !== null && semverLessThan(current, latest);
    res.json({ current, latest, updateAvailable });
  });
```

**Step 3: Run build to verify it compiles**

Run: `npm run build`
Expected: Clean compilation, no errors

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add GET /version endpoint for update checks"
```

---

### Task 2: Add POST /update endpoint

**Files:**
- Modify: `server/index.ts` (add import for `isInstalled` from service, add route)

**Step 1: Add the service import**

Add to the imports section at the top of `server/index.ts`:

```typescript
import { isInstalled as serviceIsInstalled } from './service.js';
```

**Step 2: Add the POST /update route**

Add after the GET /version route:

```typescript
  // POST /update — install latest version and optionally restart
  app.post('/update', requireAuth, (_req, res) => {
    const npmPath = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileAsync(npmPath, ['install', '-g', 'claude-remote-cli@latest'])
      .then(() => {
        const willRestart = serviceIsInstalled();
        res.json({ ok: true, restarting: willRestart });
        if (willRestart) {
          setTimeout(() => process.exit(0), 1000);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Update failed';
        res.status(500).json({ ok: false, error: message });
      });
  });
```

Note: `execFileAsync` is already imported and defined at line 21: `const execFileAsync = promisify(execFile);`

**Step 3: Run build to verify**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add POST /update endpoint for self-update"
```

---

### Task 3: Add toast HTML and CSS

**Files:**
- Modify: `public/index.html:80-81` (add toast div before closing `</div>` of `#main-app`)
- Modify: `public/style.css` (add toast styles at end, before mobile media query)

**Step 1: Add the toast HTML**

In `public/index.html`, add after the closing `</div>` of `#toolbar` (line 78) and before the `</div>` that closes `#main-app` (line 81):

```html
    <!-- Update Toast -->
    <div id="update-toast" hidden>
      <div id="update-toast-content">
        <span id="update-toast-text"></span>
        <div id="update-toast-actions">
          <button id="update-toast-btn" class="btn-accent">Update Now</button>
          <button id="update-toast-dismiss" aria-label="Dismiss">&times;</button>
        </div>
      </div>
    </div>
```

**Step 2: Add toast CSS**

In `public/style.css`, add before the `/* ===== Mobile Responsive ===== */` section (line 821):

```css
/* ===== Update Toast ===== */
#update-toast {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 150;
  display: flex;
  justify-content: center;
  padding: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
  animation: toast-slide-up 0.3s ease;
}

@keyframes toast-slide-up {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

#update-toast-content {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 16px;
  max-width: 500px;
  width: 100%;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}

#update-toast-text {
  flex: 1;
  font-size: 0.85rem;
  color: var(--text);
  line-height: 1.3;
}

#update-toast-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

#update-toast-btn {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  touch-action: manipulation;
  border: none;
  white-space: nowrap;
}

#update-toast-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

#update-toast-dismiss {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  touch-action: manipulation;
}

#update-toast-dismiss:hover {
  color: var(--text);
}
```

**Step 3: Verify files saved correctly by visual inspection**

Open `public/index.html` and `public/style.css` to confirm.

**Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add update toast HTML and CSS"
```

---

### Task 4: Add frontend version check and toast logic

**Files:**
- Modify: `public/app.js:115-120` (add version check call in `initApp()`)
- Modify: `public/app.js` (add update toast section before the auto-auth check, around line 853)

**Step 1: Add DOM refs for the toast**

In `public/app.js`, add after the `deleteWtConfirm` DOM ref (around line 42):

```javascript
  var updateToast = document.getElementById('update-toast');
  var updateToastText = document.getElementById('update-toast-text');
  var updateToastBtn = document.getElementById('update-toast-btn');
  var updateToastDismiss = document.getElementById('update-toast-dismiss');
```

**Step 2: Add the update toast section**

In `public/app.js`, add before the `// ── Auto-auth Check` section (around line 854):

```javascript
  // ── Update Toast ──────────────────────────────────────────────────────────

  function checkForUpdates() {
    fetch('/version')
      .then(function (res) {
        if (!res.ok) return;
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.updateAvailable) return;
        showUpdateToast(data.current, data.latest);
      })
      .catch(function () {});
  }

  function showUpdateToast(current, latest) {
    updateToastText.textContent = 'Update available: v' + latest + ' (current: v' + current + ')';
    updateToastBtn.textContent = 'Update Now';
    updateToastBtn.disabled = false;
    updateToast.hidden = false;

    updateToastBtn.onclick = function () {
      triggerUpdate(latest);
    };
  }

  function triggerUpdate(latest) {
    updateToastBtn.textContent = 'Updating...';
    updateToastBtn.disabled = true;
    updateToastDismiss.hidden = true;

    fetch('/update', { method: 'POST' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          if (data.restarting) {
            updateToastText.textContent = 'Updated to v' + latest + '! Restarting server...';
            updateToastBtn.hidden = true;
            setTimeout(function () { location.reload(); }, 5000);
          } else {
            updateToastText.textContent = 'Updated to v' + latest + '! Please restart the server manually.';
            updateToastBtn.hidden = true;
          }
        } else {
          updateToastText.textContent = 'Update failed: ' + (data.error || 'Unknown error');
          updateToastBtn.textContent = 'Retry';
          updateToastBtn.disabled = false;
          updateToastDismiss.hidden = false;
          updateToastBtn.onclick = function () {
            triggerUpdate(latest);
          };
        }
      })
      .catch(function () {
        updateToastText.textContent = 'Update failed: connection error';
        updateToastBtn.textContent = 'Retry';
        updateToastBtn.disabled = false;
        updateToastDismiss.hidden = false;
        updateToastBtn.onclick = function () {
          triggerUpdate(latest);
        };
      });
  }

  updateToastDismiss.addEventListener('click', function () {
    updateToast.hidden = true;
  });
```

**Step 3: Call checkForUpdates from initApp**

In `public/app.js`, modify the `initApp` function (line 115) to add `checkForUpdates()`:

```javascript
  function initApp() {
    initTerminal();
    loadRepos();
    refreshAll();
    connectEventSocket();
    checkForUpdates();
  }
```

**Step 4: Verify by starting the server and checking in browser**

Run: `npm start`
Open browser, authenticate, check that `/version` returns expected JSON.

**Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add frontend update check and toast interaction"
```

---

### Task 5: Write tests for version helpers

**Files:**
- Create: `test/version.test.ts`

**Step 1: Write the test file**

Create `test/version.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';

// We test the semver comparison logic by extracting it.
// Since it's currently a module-level function in index.ts, we'll test it
// via the /version endpoint behavior. For unit tests, we duplicate the
// pure function here to validate the logic independently.

function semverLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

test('semverLessThan returns true when major is lower', () => {
  assert.equal(semverLessThan('1.0.0', '2.0.0'), true);
});

test('semverLessThan returns true when minor is lower', () => {
  assert.equal(semverLessThan('1.1.0', '1.2.0'), true);
});

test('semverLessThan returns true when patch is lower', () => {
  assert.equal(semverLessThan('1.1.1', '1.1.2'), true);
});

test('semverLessThan returns false for equal versions', () => {
  assert.equal(semverLessThan('1.1.1', '1.1.1'), false);
});

test('semverLessThan returns false when current is greater', () => {
  assert.equal(semverLessThan('2.0.0', '1.9.9'), false);
});

test('semverLessThan handles major version jumps', () => {
  assert.equal(semverLessThan('1.9.9', '2.0.0'), true);
});

test('semverLessThan handles two-segment versions gracefully', () => {
  assert.equal(semverLessThan('1.0', '1.1'), true);
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass (both existing and new)

**Step 3: Commit**

```bash
git add test/version.test.ts
git commit -m "test: add unit tests for semver comparison"
```

---

### Task 6: Manual integration test

**Files:** None (manual verification)

**Step 1: Build and start the server**

Run: `npm start`

**Step 2: Open browser and authenticate**

Navigate to `http://localhost:<port>`, enter PIN.

**Step 3: Verify GET /version in devtools**

Open browser devtools, Network tab. Look for the `/version` request.
Expected: JSON response with `{current: "1.1.2", latest: "<npm version>", updateAvailable: true/false}`

**Step 4: Verify toast appearance**

If `updateAvailable` is true, a toast should appear at the bottom of the screen.
If false (you're on latest), temporarily change the version in package.json to `"0.0.1"` and rebuild to force the toast to appear, then change it back.

**Step 5: Verify dismiss button**

Click the × button. Toast should hide. Refresh page — toast should reappear.

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: update notification polish"
```
