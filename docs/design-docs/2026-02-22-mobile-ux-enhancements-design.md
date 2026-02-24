# Mobile UX Enhancements Design

**Date:** 2026-02-22
**Status:** Approved

## Summary

Five mobile UX improvements for the claude-remote-cli web interface:
1. Always-visible terminal scrollbar
2. 2-row toolbar layout with arrow T-shape
3. Image upload button in toolbar
4. Hidden input proxy for autocorrect support
5. Toolbar buttons don't dismiss the keyboard

## 1. Hidden Input Proxy

Solves: autocorrect, keyboard retention on toolbar tap, mobile input quality.

**HTML:** `<input type="text" id="mobile-input" autocomplete="on" autocorrect="on" autocapitalize="sentences" spellcheck="true">` inside `#terminal-area`. Visually transparent/tiny (1px, opacity 0) but focusable.

**Behavior (mobile only, detected via `'ontouchstart' in window`):**
- Tapping terminal area focuses the hidden input (opens keyboard)
- `input` event: diff value to find new characters, send to WebSocket, clear input
- `keydown` captures special keys (Enter, Backspace, Tab, Escape, arrows) and sends escape sequences directly to WS with `preventDefault`
- Desktop behavior unchanged — xterm's native textarea handles input

**Keyboard retention:** All `.tb-btn` handlers use `touchstart` with `e.preventDefault()` instead of `click`, preventing input blur.

## 2. Terminal Scrollbar

Always-visible thin scrollbar on the right edge of the terminal (mobile only).

**HTML:** `<div id="terminal-scrollbar"><div id="terminal-scrollbar-thumb"></div></div>` inside `#terminal-area`, position absolute.

**CSS:** 6px wide track, semi-transparent thumb with border-radius. Only shown at `@media (max-width: 600px)`.

**JS:**
- Thumb height = `visibleRows / totalLines * trackHeight`
- Position synced via `term.onScroll()` callback
- Touch drag on thumb calls `term.scrollToLine()` for scrubbing
- Uses `term.buffer.active.baseY` (total scrollback) and `term.buffer.active.viewportY` (current position)

## 3. Toolbar Layout

5 columns x 2 rows with arrow T-shape preserved:

```
Row 1: [Tab] [⇧Tab] [  ↑  ] [Esc]  [ 📷 ]
Row 2: [^C]  [ ←  ] [  ↓  ] [ →  ] [  ⏎  ]
```

**CSS:** `grid-template-columns: repeat(5, 1fr); grid-template-rows: auto auto;`
Remove explicit grid-column/grid-row from `.tb-enter`.
Font size uses `font-size: min(0.8rem, 3.5vw)` for very narrow screens.

## 4. Image Upload Button

**HTML:** Hidden `<input type="file" id="image-file-input" accept="image/*">` in the page body. Upload button `📷` added to toolbar grid.

**JS:** Upload button triggers `imageFileInput.click()`. On `change`, reads selected file and calls existing `uploadImage(file, file.type)`. Reuses full toast/upload pipeline.

## 5. Files Modified

- `public/index.html` — add hidden input, scrollbar divs, file input, rearrange toolbar buttons
- `public/style.css` — scrollbar styles, 2-row toolbar grid, mobile input styles
- `public/app.js` — hidden input proxy logic, scrollbar sync, upload button handler, toolbar keyboard retention
