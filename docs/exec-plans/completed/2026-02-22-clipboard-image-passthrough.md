# Clipboard Image Passthrough Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to paste images from their browser clipboard into the remote Claude Code CLI session, bridging browser clipboard to server clipboard with file-path fallback.

**Architecture:** New REST endpoint `POST /sessions/:id/image` receives base64 images from the browser, saves to temp dir, attempts to set the server's system clipboard via OS tools, then sends Ctrl+V to the PTY. If clipboard tools are unavailable, returns the file path for the browser to display as a fallback toast.

**Tech Stack:** Node.js child_process (execFile), fs/tmp for image storage, browser Clipboard API, existing Express auth middleware. No new npm dependencies.

---

### Task 1: Add clipboard detection utility to server

**Files:**
- Create: `server/clipboard.ts`

**Step 1: Write the failing test**

Create `test/clipboard.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectClipboardTool, setClipboardImage } from '../server/clipboard.js';

describe('clipboard', () => {
  it('detectClipboardTool returns a string or null', () => {
    const result = detectClipboardTool();
    assert.ok(result === null || typeof result === 'string');
  });

  it('setClipboardImage rejects unsupported mime types', async () => {
    await assert.rejects(
      () => setClipboardImage('/tmp/test.txt', 'text/plain'),
      /Unsupported/,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../server/clipboard.js`

**Step 3: Write the implementation**

Create `server/clipboard.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SUPPORTED_MIME: Record<string, { ext: string; osascriptClass: string }> = {
  'image/png':  { ext: '.png',  osascriptClass: '«class PNGf»' },
  'image/jpeg': { ext: '.jpg',  osascriptClass: '«class JPEG»' },
  'image/gif':  { ext: '.gif',  osascriptClass: '«class GIFf»' },
  'image/webp': { ext: '.webp', osascriptClass: '«class PNGf»' }, // WebP fallback: convert not supported natively
};

let cachedTool: string | null | undefined;

function detectClipboardTool(): string | null {
  if (cachedTool !== undefined) return cachedTool;

  if (process.platform === 'darwin') {
    cachedTool = 'osascript';
    return cachedTool;
  }

  // Linux: check for xclip and a display server
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    try {
      require('node:child_process').execFileSync('which', ['xclip']);
      cachedTool = 'xclip';
      return cachedTool;
    } catch {
      // xclip not found
    }
  }

  cachedTool = null;
  return cachedTool;
}

function mimeInfo(mimeType: string): { ext: string; osascriptClass: string } {
  const info = SUPPORTED_MIME[mimeType];
  if (!info) throw new Error('Unsupported MIME type: ' + mimeType);
  return info;
}

function extensionForMime(mimeType: string): string {
  return mimeInfo(mimeType).ext;
}

async function setClipboardImage(filePath: string, mimeType: string): Promise<boolean> {
  const tool = detectClipboardTool();
  const info = mimeInfo(mimeType); // throws if unsupported

  if (tool === 'osascript') {
    const script = 'set the clipboard to (read (POSIX file "' + filePath + '") as ' + info.osascriptClass + ')';
    await execFileAsync('osascript', ['-e', script]);
    return true;
  }

  if (tool === 'xclip') {
    await execFileAsync('xclip', ['-selection', 'clipboard', '-t', mimeType, '-i', filePath]);
    return true;
  }

  return false;
}

// Reset cached tool for testing
function _resetForTesting(): void {
  cachedTool = undefined;
}

export { detectClipboardTool, setClipboardImage, extensionForMime, _resetForTesting };
```

**Note:** The `require('node:child_process').execFileSync` for xclip detection uses a sync check intentionally — it runs once on first call and is cached. Replace with:

```typescript
import { execFileSync } from 'node:child_process';
```

Add this import at the top alongside the existing `execFile` import. The full import line becomes:

```typescript
import { execFile, execFileSync } from 'node:child_process';
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add server/clipboard.ts test/clipboard.test.ts
git commit -m "feat: add clipboard detection and image-set utility"
```

---

### Task 2: Add image upload REST endpoint

**Files:**
- Modify: `server/index.ts` (add new route after existing session routes, ~line 417)
- Modify: `server/sessions.ts` (add `write` export to forward data to PTY)

**Step 1: Write the failing test**

Add to `test/sessions.test.ts` after the existing `resize throws` test:

```typescript
it('write sends data to PTY stdin', (_, done) => {
  const result = sessions.create({
    repoName: 'test-repo',
    repoPath: '/tmp',
    command: '/bin/cat',
    args: [],
    cols: 80,
    rows: 24,
  });

  createdIds.push(result.id);

  const session = sessions.get(result.id);
  assert.ok(session);

  // cat echoes stdin to stdout — verify write works by checking PTY output
  let output = '';
  session.pty.onData((data) => {
    output += data;
    if (output.includes('hello')) {
      done();
    }
  });

  sessions.write(result.id, 'hello');
});

it('write throws for nonexistent session', () => {
  assert.throws(
    () => sessions.write('nonexistent-id', 'data'),
    /Session not found/,
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `sessions.write is not a function`

**Step 3: Add `write` to sessions.ts**

Add before the `export` line at `server/sessions.ts:119`:

```typescript
function write(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  session.pty.write(data);
}
```

Update the export line to include `write`:

```typescript
export { create, get, list, kill, resize, updateDisplayName, write };
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add server/sessions.ts test/sessions.test.ts
git commit -m "feat: add sessions.write for PTY stdin access"
```

**Step 6: Add the image upload route to index.ts**

Add after the `PATCH /sessions/:id` route (after line 417 in `server/index.ts`):

```typescript
import fs from 'node:fs';
import os from 'node:os';
```

(Note: `fs` is already imported at line 1. Add `os` import at the top with the other node imports.)

Then add the route:

```typescript
  // POST /sessions/:id/image — upload clipboard image
  app.post('/sessions/:id/image', requireAuth, async (req, res) => {
    const { data, mimeType } = req.body as { data?: string; mimeType?: string };
    if (!data || !mimeType) {
      res.status(400).json({ error: 'data and mimeType are required' });
      return;
    }

    // Validate MIME type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      res.status(400).json({ error: 'Unsupported image type: ' + mimeType });
      return;
    }

    // Check size (base64 is ~33% larger than binary, so 10MB binary ≈ 13.3MB base64)
    if (data.length > 14 * 1024 * 1024) {
      res.status(413).json({ error: 'Image too large (max 10MB)' });
      return;
    }

    const sessionId = req.params['id'] as string;
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      const { extensionForMime, setClipboardImage } = await import('./clipboard.js');
      const ext = extensionForMime(mimeType);
      const dir = path.join(os.tmpdir(), 'claude-remote-cli', sessionId);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'paste-' + Date.now() + ext);
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

      let clipboardSet = false;
      try {
        clipboardSet = await setClipboardImage(filePath, mimeType);
      } catch {
        // Clipboard tools failed — fall back to path
      }

      if (clipboardSet) {
        // Send Ctrl+V to PTY so Claude Code reads from clipboard
        sessions.write(sessionId, '\x16');
      }

      res.json({ path: filePath, clipboardSet });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed';
      res.status(500).json({ error: message });
    }
  });
```

Also add `os` to the imports at the top of `server/index.ts`:

```typescript
import os from 'node:os';
```

And add the body size limit for this route. Update the `express.json()` middleware (line 138) to allow larger payloads:

```typescript
app.use(express.json({ limit: '15mb' }));
```

**Step 7: Add temp file cleanup to sessions.ts**

In `sessions.ts`, add imports at the top:

```typescript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
```

In the `ptyProcess.onExit` callback (line 69-71), add cleanup:

```typescript
  ptyProcess.onExit(() => {
    sessions.delete(id);
    // Clean up temp image files
    const tmpDir = path.join(os.tmpdir(), 'claude-remote-cli', id);
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  });
```

**Step 8: Run tests**

Run: `npm test`
Expected: PASS

**Step 9: Commit**

```bash
git add server/index.ts server/sessions.ts
git commit -m "feat: add POST /sessions/:id/image endpoint with clipboard proxy"
```

---

### Task 3: Add paste interception to frontend

**Files:**
- Modify: `public/app.js` (add paste listener after terminal init)
- Modify: `public/index.html` (add image toast markup)
- Modify: `public/style.css` (add toast styles)

**Step 1: Add image toast HTML to index.html**

Add after the update toast (after line 90, before the closing `</div>` of `#main-app`):

```html
    <!-- Image Paste Toast -->
    <div id="image-toast" hidden>
      <div id="image-toast-content">
        <span id="image-toast-text"></span>
        <div id="image-toast-actions">
          <button id="image-toast-insert" class="btn-accent" hidden>Insert Path</button>
          <button id="image-toast-dismiss" aria-label="Dismiss">&times;</button>
        </div>
      </div>
    </div>
```

**Step 2: Add toast styles to style.css**

Look at the existing `#update-toast` styles and add matching styles for `#image-toast`. Add at the end of `style.css`:

```css
/* Image Paste Toast */
#image-toast {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 8px;
  padding: 8px 14px;
  color: #d4d4d4;
  font-size: 13px;
  max-width: 90vw;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}

#image-toast-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

#image-toast-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

#image-toast-dismiss {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
}
```

**Step 3: Add paste interception and image upload logic to app.js**

Add DOM refs near the other DOM refs (around line 48):

```javascript
  var imageToast = document.getElementById('image-toast');
  var imageToastText = document.getElementById('image-toast-text');
  var imageToastInsert = document.getElementById('image-toast-insert');
  var imageToastDismiss = document.getElementById('image-toast-dismiss');
```

Add the paste handling section after the Touch Toolbar section (after line 852), before the Keyboard-Aware Viewport section:

```javascript
  // ── Image Paste Handling ────────────────────────────────────────────────────

  var imageUploadInProgress = false;
  var pendingImagePath = null;

  function showImageToast(text, showInsert) {
    imageToastText.textContent = text;
    imageToastInsert.hidden = !showInsert;
    imageToast.hidden = false;
  }

  function hideImageToast() {
    imageToast.hidden = true;
    pendingImagePath = null;
  }

  function autoDismissImageToast(ms) {
    setTimeout(function () {
      if (!pendingImagePath) {
        hideImageToast();
      }
    }, ms);
  }

  function uploadImage(blob, mimeType) {
    if (imageUploadInProgress) return;
    if (!activeSessionId) return;

    imageUploadInProgress = true;
    showImageToast('Pasting image\u2026', false);

    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];

      fetch('/sessions/' + activeSessionId + '/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64, mimeType: mimeType }),
      })
        .then(function (res) {
          if (res.status === 413) {
            showImageToast('Image too large (max 10MB)', false);
            autoDismissImageToast(4000);
            return;
          }
          if (!res.ok) {
            return res.json().then(function (data) {
              showImageToast(data.error || 'Image upload failed', false);
              autoDismissImageToast(4000);
            });
          }
          return res.json().then(function (data) {
            if (data.clipboardSet) {
              showImageToast('Image pasted', false);
              autoDismissImageToast(2000);
            } else {
              pendingImagePath = data.path;
              showImageToast(data.path, true);
            }
          });
        })
        .catch(function () {
          showImageToast('Image upload failed', false);
          autoDismissImageToast(4000);
        })
        .finally(function () {
          imageUploadInProgress = false;
        });
    };

    reader.readAsDataURL(blob);
  }

  // Intercept paste events on the terminal container
  terminalContainer.addEventListener('paste', function (e) {
    if (!e.clipboardData || !e.clipboardData.items) return;

    var items = e.clipboardData.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        e.preventDefault();
        e.stopPropagation();
        var blob = items[i].getAsFile();
        if (blob) {
          uploadImage(blob, items[i].type);
        }
        return;
      }
    }
    // No image found — let xterm.js handle text paste normally
  });

  // Drag-and-drop support
  terminalContainer.addEventListener('dragover', function (e) {
    if (e.dataTransfer && e.dataTransfer.types.indexOf('Files') !== -1) {
      e.preventDefault();
      terminalContainer.classList.add('drag-over');
    }
  });

  terminalContainer.addEventListener('dragleave', function () {
    terminalContainer.classList.remove('drag-over');
  });

  terminalContainer.addEventListener('drop', function (e) {
    e.preventDefault();
    terminalContainer.classList.remove('drag-over');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;

    var file = e.dataTransfer.files[0];
    if (file.type.indexOf('image/') === 0) {
      uploadImage(file, file.type);
    }
  });

  // Insert path button
  imageToastInsert.addEventListener('click', function () {
    if (pendingImagePath && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pendingImagePath);
    }
    hideImageToast();
  });

  imageToastDismiss.addEventListener('click', function () {
    hideImageToast();
  });
```

**Step 4: Add drag-over style to style.css**

```css
#terminal-container.drag-over {
  outline: 2px dashed #007acc;
  outline-offset: -2px;
}
```

**Step 5: Manually test in browser**

1. Start the server: `npm start`
2. Open in browser, authenticate
3. Create/connect to a session
4. Copy an image to clipboard
5. Press Ctrl+V in the terminal
6. Verify: toast appears, image is uploaded, clipboard is set, Ctrl+V is sent to PTY
7. Verify: text paste still works normally (type some text, copy, paste)

**Step 6: Commit**

```bash
git add public/app.js public/index.html public/style.css
git commit -m "feat: add clipboard image paste interception with toast UI"
```

---

### Task 4: Increase express.json body limit

**Files:**
- Modify: `server/index.ts:138`

**Step 1: Update the body parser limit**

Change line 138 in `server/index.ts` from:

```typescript
  app.use(express.json());
```

to:

```typescript
  app.use(express.json({ limit: '15mb' }));
```

This allows the base64-encoded image payload (up to ~13.3MB for a 10MB image) to be accepted.

**Step 2: Run tests**

Run: `npm test`
Expected: PASS (no existing tests rely on body size limits)

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: increase express.json limit to 15mb for image uploads"
```

**Note:** This task can be combined with Task 2 step 6 if doing them in one pass.

---

### Task 5: End-to-end manual verification

**Files:** None (verification only)

**Step 1: Build and start**

Run: `npm start`

**Step 2: Test clipboard proxy path (macOS)**

1. Take a screenshot (Cmd+Shift+4)
2. Open the remote CLI in browser
3. Connect to a Claude Code session
4. Press Ctrl+V in the terminal
5. Verify: "Pasting image..." toast → "Image pasted" toast (auto-dismiss)
6. Verify: Claude Code receives the image and responds to it

**Step 3: Test fallback path**

1. Temporarily modify `clipboard.ts` to force `detectClipboardTool()` to return `null`
2. Paste an image
3. Verify: toast shows the file path with "Insert Path" button
4. Click "Insert Path"
5. Verify: file path is typed into the terminal
6. Revert the temporary modification

**Step 4: Test text paste still works**

1. Copy some text to clipboard
2. Paste in the terminal
3. Verify: text is pasted normally, no toast appears

**Step 5: Test drag-and-drop**

1. Drag an image file from Finder onto the terminal
2. Verify: drop zone highlight appears
3. Drop the file
4. Verify: same upload flow as paste

**Step 6: Test error cases**

1. Paste an image with no active session → verify no crash
2. Paste a very large image (>10MB) → verify "Image too large" toast

**Step 7: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: cleanup after image paste verification"
```
