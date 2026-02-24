# Mobile UX Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the mobile terminal experience with better scrolling, compact toolbar, image upload, autocorrect support, and keyboard retention.

**Architecture:** All changes are in the frontend (public/ directory). A hidden `<input>` acts as a mobile input proxy for autocorrect and keyboard retention. A custom scrollbar overlay syncs with xterm.js scrollback. Toolbar is restructured to 5x2 grid with arrow T-shape.

**Tech Stack:** Vanilla JS (ES5 syntax), CSS, HTML. xterm.js terminal. No build step.

**IMPORTANT CONVENTIONS:**
- All JS must use ES5 syntax: `var`, function expressions, `.then()` chains. NO arrow functions, destructuring, or template literals.
- All state lives as module-level variables inside the existing IIFE in `public/app.js`
- DOM refs follow the pattern: `var myElement = document.getElementById('my-element');`

---

### Task 1: Restructure Toolbar HTML to 5x2 Grid with Upload Button

**Files:**
- Modify: `public/index.html:66-78` (toolbar section)

**Step 1: Replace the toolbar grid HTML**

Replace the current toolbar grid (lines 67-78) with the new 2-row, 5-column layout keeping the arrow T-shape:

```html
      <!-- Touch Toolbar -->
      <div id="toolbar">
        <div class="toolbar-grid">
          <button class="tb-btn" data-key="&#x09;" aria-label="Tab">Tab</button>
          <button class="tb-btn" data-key="&#x1b;[Z" aria-label="Shift+Tab">&#8679;Tab</button>
          <button class="tb-btn tb-arrow" data-key="&#x1b;[A" aria-label="Up arrow">&#8593;</button>
          <button class="tb-btn" data-key="&#x1b;" aria-label="Escape">Esc</button>
          <button class="tb-btn" id="upload-image-btn" aria-label="Upload image">&#128247;</button>
          <button class="tb-btn" data-key="&#x03;" aria-label="Ctrl+C">^C</button>
          <button class="tb-btn tb-arrow" data-key="&#x1b;[D" aria-label="Left arrow">&#8592;</button>
          <button class="tb-btn tb-arrow" data-key="&#x1b;[B" aria-label="Down arrow">&#8595;</button>
          <button class="tb-btn tb-arrow" data-key="&#x1b;[C" aria-label="Right arrow">&#8594;</button>
          <button class="tb-btn tb-enter" data-key="&#x0d;" aria-label="Enter">&#9166;</button>
        </div>
      </div>
```

**Step 2: Add the hidden file input for image upload**

Add this just before the closing `</div>` of `#main-app` (before line 103):

```html
    <!-- Hidden file input for mobile image upload -->
    <input type="file" id="image-file-input" accept="image/*" hidden />
```

**Step 3: Add the hidden mobile input proxy**

Add this inside `#terminal-area`, just before `#terminal-container` (after line 61):

```html
      <input type="text" id="mobile-input" autocomplete="on" autocorrect="on" autocapitalize="sentences" spellcheck="true" aria-label="Terminal input" />
```

**Step 4: Add the scrollbar overlay**

Add this inside `#terminal-area`, just after `#terminal-container` (after line 62, which is now line 63 after the mobile input addition):

```html
      <div id="terminal-scrollbar"><div id="terminal-scrollbar-thumb"></div></div>
```

**Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: restructure toolbar HTML for mobile 5x2 grid with upload and input proxy"
```

---

### Task 2: Update CSS for 2-Row Toolbar and Scrollbar

**Files:**
- Modify: `public/style.css:431-480` (toolbar styles) and `947-1014` (mobile responsive)

**Step 1: Update the toolbar grid CSS**

Replace the `.toolbar-grid` rule (lines 441-448) with:

```css
.toolbar-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: auto auto;
  gap: 4px;
  max-width: 500px;
  margin: 0 auto;
}
```

**Step 2: Remove the explicit grid placement from `.tb-enter`**

Delete the `.tb-btn.tb-enter` rule (lines 477-480):

```css
/* Delete this entire rule: */
.tb-btn.tb-enter {
  grid-column: 4;
  grid-row: 3;
}
```

**Step 3: Add the mobile input proxy CSS**

Add this right after the `#no-session-msg` rule (after line 429):

```css
#mobile-input {
  position: absolute;
  top: -9999px;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  font-size: 16px; /* prevents iOS zoom on focus */
  z-index: -1;
}
```

**Step 4: Add the terminal scrollbar CSS**

Add this right after the mobile input CSS (new section):

```css
/* ===== Terminal Scrollbar ===== */
#terminal-scrollbar {
  display: none;
  position: absolute;
  top: 0;
  right: 2px;
  bottom: 0;
  width: 6px;
  z-index: 10;
  pointer-events: auto;
}

#terminal-scrollbar-thumb {
  position: absolute;
  right: 0;
  width: 6px;
  min-height: 20px;
  background: var(--border);
  border-radius: 3px;
  opacity: 0.7;
  touch-action: none;
}
```

**Step 5: Update the mobile responsive section**

Inside `@media (max-width: 600px)`, add these rules (before the closing `}`):

```css
  #terminal-scrollbar {
    display: block;
  }

  #mobile-input {
    /* Keep offscreen but focusable */
  }
```

Also update the `.tb-btn` mobile override (currently lines 1001-1005) to handle narrower widths:

```css
  .tb-btn {
    padding: 14px 2px;
    font-size: min(0.8rem, 3.5vw);
    min-height: 44px;
  }

  .tb-btn.tb-arrow {
    font-size: min(1.1rem, 4.5vw);
  }
```

**Step 6: Commit**

```bash
git add public/style.css
git commit -m "feat: CSS for 5x2 toolbar grid, terminal scrollbar, and mobile input proxy"
```

---

### Task 3: Implement Image Upload Button Handler

**Files:**
- Modify: `public/app.js` (add DOM ref + handler after existing image paste handling section)

**Step 1: Add DOM refs for the new elements**

After the existing DOM refs (around line 52), add:

```javascript
var imageFileInput = document.getElementById('image-file-input');
var uploadImageBtn = document.getElementById('upload-image-btn');
```

**Step 2: Add the upload button click handler**

After the `imageToastDismiss` event listener (around line 1063), add:

```javascript
  // ── Image Upload Button (mobile) ──────────────────────────────────────────

  uploadImageBtn.addEventListener('click', function (e) {
    e.preventDefault();
    if (!activeSessionId) return;
    imageFileInput.click();
  });

  imageFileInput.addEventListener('change', function () {
    var file = imageFileInput.files[0];
    if (file && file.type.indexOf('image/') === 0) {
      uploadImage(file, file.type);
    }
    imageFileInput.value = '';
  });
```

**Step 3: Verify the build still works**

Run: `npm run build`
Expected: Clean compilation (frontend JS has no build step, but verify server TS compiles).

**Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add image upload button handler for mobile toolbar"
```

---

### Task 4: Implement Terminal Scrollbar

**Files:**
- Modify: `public/app.js` (add scrollbar logic after terminal init)

**Step 1: Add DOM refs for scrollbar**

After the other new DOM refs added in Task 3:

```javascript
var terminalScrollbar = document.getElementById('terminal-scrollbar');
var terminalScrollbarThumb = document.getElementById('terminal-scrollbar-thumb');
```

**Step 2: Add scrollbar sync logic**

After the `sendResize` function (around line 223), add a new section:

```javascript
  // ── Terminal Scrollbar ──────────────────────────────────────────────────────

  var scrollbarDragging = false;
  var scrollbarDragStartY = 0;
  var scrollbarDragStartTop = 0;

  function updateScrollbar() {
    if (!term || !terminalScrollbar || terminalScrollbar.style.display === 'none') return;
    var buf = term.buffer.active;
    var totalLines = buf.baseY + term.rows;
    var viewportTop = buf.viewportY;
    var trackHeight = terminalScrollbar.clientHeight;

    if (totalLines <= term.rows) {
      terminalScrollbarThumb.style.display = 'none';
      return;
    }

    terminalScrollbarThumb.style.display = 'block';
    var thumbHeight = Math.max(20, (term.rows / totalLines) * trackHeight);
    var thumbTop = (viewportTop / (totalLines - term.rows)) * (trackHeight - thumbHeight);

    terminalScrollbarThumb.style.height = thumbHeight + 'px';
    terminalScrollbarThumb.style.top = thumbTop + 'px';
  }

  function scrollbarScrollToY(clientY) {
    var rect = terminalScrollbar.getBoundingClientRect();
    var buf = term.buffer.active;
    var totalLines = buf.baseY + term.rows;
    if (totalLines <= term.rows) return;

    var thumbHeight = Math.max(20, (term.rows / totalLines) * terminalScrollbar.clientHeight);
    var trackUsable = terminalScrollbar.clientHeight - thumbHeight;
    var relativeY = clientY - rect.top - thumbHeight / 2;
    var ratio = Math.max(0, Math.min(1, relativeY / trackUsable));
    var targetLine = Math.round(ratio * (totalLines - term.rows));

    term.scrollToLine(targetLine);
  }

  terminalScrollbarThumb.addEventListener('touchstart', function (e) {
    e.preventDefault();
    scrollbarDragging = true;
    scrollbarDragStartY = e.touches[0].clientY;
    scrollbarDragStartTop = parseInt(terminalScrollbarThumb.style.top, 10) || 0;
  });

  document.addEventListener('touchmove', function (e) {
    if (!scrollbarDragging) return;
    e.preventDefault();
    var deltaY = e.touches[0].clientY - scrollbarDragStartY;
    var buf = term.buffer.active;
    var totalLines = buf.baseY + term.rows;
    if (totalLines <= term.rows) return;

    var thumbHeight = Math.max(20, (term.rows / totalLines) * terminalScrollbar.clientHeight);
    var trackUsable = terminalScrollbar.clientHeight - thumbHeight;
    var newTop = Math.max(0, Math.min(trackUsable, scrollbarDragStartTop + deltaY));
    var ratio = newTop / trackUsable;
    var targetLine = Math.round(ratio * (totalLines - term.rows));

    term.scrollToLine(targetLine);
  }, { passive: false });

  document.addEventListener('touchend', function () {
    scrollbarDragging = false;
  });

  terminalScrollbar.addEventListener('click', function (e) {
    if (e.target === terminalScrollbarThumb) return;
    scrollbarScrollToY(e.clientY);
  });
```

**Step 3: Hook scrollbar updates into terminal initialization**

Inside the `initTerminal` function, after `fitAddon.fit()` (around line 150), add:

```javascript
    term.onScroll(updateScrollbar);
    term.onWriteParsed(updateScrollbar);
```

Also add an `updateScrollbar()` call inside the ResizeObserver callback (around line 214), after `sendResize()`:

```javascript
      updateScrollbar();
```

**Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add always-visible terminal scrollbar for mobile"
```

---

### Task 5: Implement Hidden Input Proxy for Mobile

This is the most complex task. The hidden input captures keyboard input on mobile with autocorrect enabled, then forwards keystrokes to the WebSocket.

**Files:**
- Modify: `public/app.js` (add mobile input proxy logic)

**Step 1: Add DOM ref and mobile detection**

After the existing new DOM refs:

```javascript
var mobileInput = document.getElementById('mobile-input');
var isMobileDevice = 'ontouchstart' in window;
```

**Step 2: Add the mobile input proxy logic**

Add a new section after the keyboard-aware viewport section (after line 1087):

```javascript
  // ── Mobile Input Proxy ──────────────────────────────────────────────────────

  (function () {
    if (!isMobileDevice) return;

    var lastInputValue = '';

    function focusMobileInput() {
      if (mobileInput && document.activeElement !== mobileInput) {
        mobileInput.focus();
      }
    }

    // Tap on terminal area focuses the hidden input (opens keyboard)
    terminalContainer.addEventListener('touchend', function (e) {
      // Don't interfere with scrollbar drag or selection
      if (scrollbarDragging) return;
      if (e.target === terminalScrollbarThumb || e.target === terminalScrollbar) return;
      focusMobileInput();
    });

    // When xterm would receive focus, redirect to hidden input
    terminalContainer.addEventListener('focus', function () {
      focusMobileInput();
    }, true);

    // Handle text input with autocorrect
    mobileInput.addEventListener('input', function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      var currentValue = mobileInput.value;

      // Autocorrect may replace the entire value — figure out what changed
      if (currentValue.length > lastInputValue.length) {
        // Characters were added (normal typing or autocorrect expansion)
        // Find the common prefix length
        var commonLen = 0;
        while (commonLen < lastInputValue.length && commonLen < currentValue.length &&
               lastInputValue[commonLen] === currentValue[commonLen]) {
          commonLen++;
        }

        // If autocorrect changed earlier text, we need to backspace and retype
        var charsToDelete = lastInputValue.length - commonLen;
        var newChars = currentValue.slice(commonLen);

        for (var i = 0; i < charsToDelete; i++) {
          ws.send('\x7f'); // backspace
        }
        ws.send(newChars);
      } else if (currentValue.length < lastInputValue.length) {
        // Characters were deleted (autocorrect correction)
        var commonLen2 = 0;
        while (commonLen2 < currentValue.length && commonLen2 < lastInputValue.length &&
               lastInputValue[commonLen2] === currentValue[commonLen2]) {
          commonLen2++;
        }

        var charsToDelete2 = lastInputValue.length - commonLen2;
        var newChars2 = currentValue.slice(commonLen2);

        for (var j = 0; j < charsToDelete2; j++) {
          ws.send('\x7f');
        }
        if (newChars2) {
          ws.send(newChars2);
        }
      } else if (currentValue !== lastInputValue) {
        // Same length but different content (replacement)
        var commonLen3 = 0;
        while (commonLen3 < currentValue.length &&
               lastInputValue[commonLen3] === currentValue[commonLen3]) {
          commonLen3++;
        }

        var charsToDelete3 = lastInputValue.length - commonLen3;
        var newChars3 = currentValue.slice(commonLen3);

        for (var k = 0; k < charsToDelete3; k++) {
          ws.send('\x7f');
        }
        ws.send(newChars3);
      }

      lastInputValue = currentValue;
    });

    // Handle special keys (Enter, Backspace, Escape, arrows, Tab)
    mobileInput.addEventListener('keydown', function (e) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      var handled = true;

      switch (e.key) {
        case 'Enter':
          ws.send('\r');
          mobileInput.value = '';
          lastInputValue = '';
          break;
        case 'Backspace':
          if (mobileInput.value.length === 0) {
            // Input is empty, send backspace directly
            ws.send('\x7f');
          }
          // Otherwise, let the input event handle it via diff
          handled = false;
          break;
        case 'Escape':
          ws.send('\x1b');
          break;
        case 'Tab':
          e.preventDefault();
          ws.send('\t');
          break;
        case 'ArrowUp':
          e.preventDefault();
          ws.send('\x1b[A');
          break;
        case 'ArrowDown':
          e.preventDefault();
          ws.send('\x1b[B');
          break;
        case 'ArrowLeft':
          // Let input handle cursor movement for autocorrect
          handled = false;
          break;
        case 'ArrowRight':
          handled = false;
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
      }
    });

    // Periodically clear the hidden input to prevent it from growing unbounded
    // but only when the user hasn't typed recently
    var clearTimer = null;
    mobileInput.addEventListener('input', function () {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(function () {
        mobileInput.value = '';
        lastInputValue = '';
      }, 5000);
    });
  })();
```

**Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add hidden input proxy for mobile autocorrect support"
```

---

### Task 6: Prevent Toolbar from Dismissing Keyboard

**Files:**
- Modify: `public/app.js` (update toolbar click handler)

**Step 1: Update the toolbar event handler**

Replace the existing toolbar click handler (around line 925-939) with one that uses `touchstart` on mobile to prevent blur, falling back to `click` for desktop:

```javascript
  // ── Touch Toolbar ───────────────────────────────────────────────────────────

  function handleToolbarButton(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    // Skip the upload button (handled separately)
    if (btn.id === 'upload-image-btn') return;

    e.preventDefault();

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    var text = btn.dataset.text;
    var key = btn.dataset.key;

    if (text !== undefined) {
      ws.send(text);
    } else if (key !== undefined) {
      ws.send(key);
    }

    // Re-focus the mobile input to keep keyboard open
    if (isMobileDevice && mobileInput) {
      mobileInput.focus();
    }
  }

  toolbar.addEventListener('touchstart', function (e) {
    handleToolbarButton(e);
  }, { passive: false });

  toolbar.addEventListener('click', function (e) {
    // On non-touch devices, handle normally
    if (isMobileDevice) return; // already handled by touchstart
    handleToolbarButton(e);
  });
```

**Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: prevent toolbar buttons from dismissing keyboard on mobile"
```

---

### Task 7: Manual Testing Checklist

No automated frontend tests exist for this project. Test manually on a mobile device:

**Toolbar layout:**
- [ ] Toolbar shows exactly 2 rows of buttons on Pixel (or similar narrow device)
- [ ] Arrow keys maintain T-shape: up above down, left and right flanking down
- [ ] All 10 buttons are visible and tappable without overflow

**Scrollbar:**
- [ ] Thin scrollbar visible on right edge of terminal
- [ ] Thumb moves when scrolling through terminal output
- [ ] Dragging thumb scrolls the terminal
- [ ] Thumb hides when terminal has no scrollback

**Image upload:**
- [ ] Tapping camera button opens file picker
- [ ] Selecting an image triggers upload toast
- [ ] "Insert Path" button works if clipboard set fails
- [ ] Upload works for PNG, JPG

**Autocorrect:**
- [ ] Typing in terminal shows autocorrect suggestions
- [ ] Accepting an autocorrect suggestion replaces the word correctly (not duplicating)
- [ ] Backspace works normally
- [ ] Enter sends the command

**Keyboard retention:**
- [ ] Tapping Tab, Esc, ^C, arrows does NOT close the keyboard
- [ ] The correct key is still sent to the terminal
- [ ] Keyboard stays open across multiple toolbar taps

**Desktop regression:**
- [ ] Terminal input works normally on desktop (no regressions)
- [ ] Toolbar is hidden on desktop
- [ ] Scrollbar is hidden on desktop
- [ ] Image paste (Ctrl+V / Cmd+V) still works on desktop

**Step 1: Run the server and test**

```bash
npm start
```

Then open on mobile device or Chrome DevTools device emulator.

**Step 2: Final commit with any fixes**

```bash
git add -A
git commit -m "fix: mobile UX testing fixes"
```

---

### Task 8: Ensure Server Build Passes

**Step 1: Run the full build**

Run: `npm run build`
Expected: Clean TypeScript compilation

**Step 2: Run all tests**

Run: `npm test`
Expected: All existing tests pass (these changes are frontend-only)

**Step 3: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "chore: ensure build and tests pass after mobile UX enhancements"
```
