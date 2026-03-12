# Fix: Mobile Touch Scroll in tmux / Alternate Screen

> **Status**: Complete | **Created**: 2026-03-12 | **Last Updated**: 2026-03-12
> **Bug Analysis**: `docs/bug-analyses/2026-03-12-mobile-touch-scroll-tmux-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-12 | Design | Use SGR mouse wheel escape sequences for alternate screen scroll | tmux manages its own scrollback; xterm.js `scrollToLine` is a no-op in alternate buffer. Must send PTY data instead. |
| 2026-03-12 | Design | Detect alternate screen via `term.buffer.active.type === 'alternate'` | xterm.js built-in API, no heuristics needed |
| 2026-03-12 | Design | Accumulate fractional line deltas to avoid requiring large swipes | Without accumulation, sub-line swipes are lost and scrolling feels unresponsive |

## Progress

- [x] Task 1: Add alternate screen detection and SGR mouse wheel escape sequence generation to touch scroll handler
- [x] Task 2: Type check and build validation

## Surprises & Discoveries

- Review found hardcoded `col=1;row=1` would route scroll events to wrong pane in multi-pane tmux — fixed with center coordinates
- Review suggested per-frame line cap to prevent scroll overshoot on fast swipes — added cap of 5

## Plan Drift

_None — execution matched plan exactly. Review fixes were additive refinements._

---

### Task 1: Add alternate screen scroll via mouse wheel escape sequences

**File:** `frontend/src/components/Terminal.svelte`

**What:** When `term.buffer.active.type === 'alternate'`, convert touch scroll deltas into SGR mouse wheel escape sequences and send via `sendPtyData()` instead of calling `term.scrollToLine()`.

**Steps:**

1. Add a `contentScrollAccumulator` variable alongside existing content scroll state (after line 230):
   ```ts
   let contentScrollAccumulator = 0;
   ```

2. In `onDocumentTouchMove`, inside the content-area touch scroll block (lines 400-410), branch on alternate screen:
   ```ts
   if (term.rows === 0 || containerEl.clientHeight === 0) return;
   const deltaY = contentTouchStartY - touch.clientY;
   if (Math.abs(deltaY) > 5) {
     contentTouchMoved = true;
     e.preventDefault();
     const lineHeight = containerEl.clientHeight / term.rows;

     if (term.buffer.active.type === 'alternate') {
       // Alternate screen (tmux, vim, less): send mouse wheel escape sequences
       const lineDelta = deltaY / lineHeight;
       contentScrollAccumulator += lineDelta;
       const lines = Math.trunc(contentScrollAccumulator);
       if (lines !== 0) {
         contentScrollAccumulator -= lines;
         const button = lines > 0 ? 65 : 64; // 65=wheel down, 64=wheel up
         const seq = `\x1b[<${button};1;1M`;
         const count = Math.abs(lines);
         for (let i = 0; i < count; i++) sendPtyData(seq);
       }
     } else {
       // Normal screen: scroll xterm.js scrollback buffer
       const lineDelta = deltaY / lineHeight;
       const maxScroll = term.buffer.active.baseY;
       const targetLine = Math.max(0, Math.min(maxScroll, Math.round(contentScrollStartLine + lineDelta)));
       term.scrollToLine(targetLine);
     }
   }
   ```

3. Reset accumulator in `onDocumentTouchEnd` (after line 421):
   ```ts
   contentScrollAccumulator = 0;
   ```

4. Reset accumulator in `onTerminalTouchStart` alongside other state resets (after line 357):
   ```ts
   contentScrollAccumulator = 0;
   ```

**Verification:** `npm run check` passes (svelte-check + tsc). No backend tests to update — this is frontend-only touch event logic.

---

### Task 2: Type check and build validation

**Commands:**
```bash
npm run check    # svelte-check + tsc
npm run build    # Full build
npm test         # Run all tests (should still pass — no backend changes)
```

**Expected:** All pass. No type errors introduced.

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Root cause was clear from bug analysis — single function, well-scoped fix
- Code review caught multi-pane tmux targeting issue before it shipped

**What didn't:**
- Initial implementation had hardcoded coordinates and no scroll rate cap — review caught both

**Learnings to codify:**
- When sending mouse escape sequences to a PTY, always use meaningful coordinates (not 1;1) — tmux uses them for pane routing
- xterm.js alternate screen buffer (`term.buffer.active.type === 'alternate'`) makes `baseY` and `scrollToLine` useless — must send PTY data for scroll
