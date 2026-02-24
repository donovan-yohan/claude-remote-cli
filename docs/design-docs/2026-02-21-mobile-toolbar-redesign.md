# Mobile Toolbar Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the mobile touch toolbar with inverted-T arrow keys, larger buttons, gesture nav safe area, and keyboard-aware resizing.

**Architecture:** CSS Grid for the toolbar layout, `env(safe-area-inset-bottom)` for gesture nav padding, `visualViewport` API for keyboard detection. All changes are in the frontend SPA (no server changes).

**Tech Stack:** Vanilla HTML/CSS/JS (ES5), xterm.js

---

### Task 1: Update viewport meta tag and toolbar HTML

**Files:**
- Modify: `public/index.html:5` (viewport meta)
- Modify: `public/index.html:66-83` (toolbar markup)

**Step 1: Update the viewport meta tag to support safe areas**

In `public/index.html`, change line 5 from:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```
to:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

**Step 2: Replace the toolbar markup**

Replace the entire `<!-- Touch Toolbar -->` section (lines 66-83) with:
```html
<!-- Touch Toolbar -->
<div id="toolbar">
  <div class="toolbar-grid">
    <button class="tb-btn" data-key="&#x09;" aria-label="Tab">Tab</button>
    <button class="tb-btn tb-arrow" data-key="&#x1b;[A" aria-label="Up arrow">&#8593;</button>
    <button class="tb-btn" data-key="&#x1b;[Z" aria-label="Shift+Tab">&#8679;Tab</button>
    <button class="tb-btn" data-key="&#x1b;" aria-label="Escape">Esc</button>
    <button class="tb-btn tb-arrow" data-key="&#x1b;[D" aria-label="Left arrow">&#8592;</button>
    <button class="tb-btn tb-arrow" data-key="&#x1b;[B" aria-label="Down arrow">&#8595;</button>
    <button class="tb-btn tb-arrow" data-key="&#x1b;[C" aria-label="Right arrow">&#8594;</button>
    <button class="tb-btn" data-key="&#x03;" aria-label="Ctrl+C">^C</button>
    <button class="tb-btn tb-enter" data-key="&#x0d;" aria-label="Enter">&#9166;</button>
  </div>
</div>
```

**Step 3: Verify in browser**

Open the app on mobile or in Chrome DevTools responsive mode. The toolbar should render (unstyled grid) with 9 buttons. Confirm no JS console errors.

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "refactor: update toolbar markup for inverted-T arrow layout"
```

---

### Task 2: Style the toolbar grid and safe area

**Files:**
- Modify: `public/style.css:417-457` (toolbar section)
- Modify: `public/style.css:731-789` (mobile media query)

**Step 1: Replace the toolbar CSS**

Replace the entire `/* ===== Touch Toolbar ===== */` section (lines 417-457) with:

```css
/* ===== Touch Toolbar ===== */
#toolbar {
  flex-shrink: 0;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 6px 4px;
  padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
}

.toolbar-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 4px;
  max-width: 400px;
  margin: 0 auto;
}

.tb-btn {
  padding: 14px 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.85rem;
  font-family: monospace;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  text-align: center;
  white-space: nowrap;
  min-height: 44px;
}

.tb-btn:active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.tb-btn.tb-arrow {
  font-size: 1.1rem;
}

/* Enter button: bottom-right cell only */
.tb-btn.tb-enter {
  grid-column: 4;
  grid-row: 3;
}
```

**Step 2: Update the mobile media query toolbar overrides**

In the `@media (max-width: 600px)` block, replace the `.tb-btn` rule (lines 785-788) with:

```css
.tb-btn {
  padding: 16px 2px;
  font-size: 0.8rem;
  min-height: 48px;
}

.tb-btn.tb-arrow {
  font-size: 1.2rem;
}
```

**Step 3: Verify layout in Chrome DevTools responsive mode**

Open DevTools, toggle device toolbar to a phone (iPhone 14 Pro or similar). The toolbar should show:
- Row 1: Tab, ↑, ⇧Tab, Esc
- Row 2: ←, ↓, →, ^C
- Row 3: (empty, empty, empty, Enter)

Buttons should be at least 44px tall. Bottom padding should account for gesture nav.

**Step 4: Commit**

```bash
git add public/style.css
git commit -m "style: grid-based inverted-T toolbar with safe area padding"
```

---

### Task 3: Add keyboard-aware viewport resizing

**Files:**
- Modify: `public/app.js` (add visualViewport listener near end of IIFE, before auto-auth check)

**Step 1: Add the visualViewport resize handler**

In `public/app.js`, add the following code after the toolbar click handler (after line 721, before the `// ── Auto-auth Check` comment):

```javascript
// ── Keyboard-Aware Viewport ─────────────────────────────────────────────────

(function () {
  if (!window.visualViewport) return;

  var vv = window.visualViewport;

  function onViewportResize() {
    var keyboardHeight = window.innerHeight - vv.height;
    if (keyboardHeight > 50) {
      // Keyboard is open — shrink main-app to visual viewport
      mainApp.style.height = vv.height + 'px';
    } else {
      // Keyboard closed — use full viewport
      mainApp.style.height = '';
    }
    if (fitAddon) {
      fitAddon.fit();
      sendResize();
    }
  }

  vv.addEventListener('resize', onViewportResize);
  vv.addEventListener('scroll', onViewportResize);
})();
```

**Step 2: Update the `#main-app` CSS to support dynamic height**

In `public/style.css`, in the `#main-app` rule (line 103-109), change `height: 100vh` to `height: 100dvh` with a fallback:

```css
#main-app {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
```

**Step 3: Test on a real phone or simulator**

1. Open the app on a phone (or iOS Simulator / Android emulator)
2. Tap on the terminal to bring up the keyboard
3. Verify: the toolbar stays visible above the keyboard
4. Verify: the terminal shrinks to fit the remaining space
5. Dismiss the keyboard — layout returns to normal

**Step 4: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: keyboard-aware viewport resizing with visualViewport API"
```

---

### Task 4: Final verification and cleanup

**Step 1: Run the test suite**

```bash
npm test
```

Expected: All tests pass (no server changes were made).

**Step 2: Manual verification checklist**

- [ ] Desktop: toolbar renders, buttons work, no visual regression
- [ ] Mobile (Chrome DevTools responsive): inverted-T layout visible
- [ ] Mobile: buttons are large enough to tap (44px+ height)
- [ ] Mobile: bottom of toolbar not cut off by gesture nav bar
- [ ] Mobile with keyboard open: toolbar stays above keyboard, terminal shrinks
- [ ] Mobile with keyboard dismissed: layout returns to normal

**Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: mobile toolbar redesign cleanup"
```
