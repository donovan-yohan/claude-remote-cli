# Fix OSC 52 Clipboard UTF-8 Decoding

> **Status**: Complete | **Created**: 2026-03-13 | **Last Updated**: 2026-03-13
> **Bug Analysis**: `docs/bug-analyses/2026-03-13-osc52-clipboard-utf8-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-13 | Design | Fix `atob()` Latin-1 decoding with `TextDecoder('utf-8')` | `atob()` cannot decode multi-byte UTF-8; standard Web API `TextDecoder` is the correct approach |

## Progress

- [x] Task 1: Fix OSC 52 handler UTF-8 decoding

## Surprises & Discoveries

None — fix was straightforward, no surprises.

## Plan Drift

None — executed as planned.

---

### Task 1: Fix OSC 52 handler UTF-8 decoding

**File:** `frontend/src/components/Terminal.svelte`
**Lines:** 143–155

**What:** Replace `atob(payload)` with proper UTF-8 decoding using `Uint8Array` + `TextDecoder`.

**Current code (lines 150–152):**
```ts
try {
  const text = atob(payload);
  navigator.clipboard?.writeText(text).catch(() => { /* ignore — clipboard API may be blocked */ });
} catch { /* ignore invalid base64 */ }
```

**Fixed code:**
```ts
try {
  const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
  const text = new TextDecoder('utf-8').decode(bytes);
  navigator.clipboard?.writeText(text).catch(() => { /* ignore — clipboard API may be blocked */ });
} catch { /* ignore invalid base64 */ }
```

**Verification:**
- `npm run build` — ensures no TypeScript/Svelte compilation errors
- Manual test: open a tmux session, display a table with box-drawing characters, copy via tmux, paste — characters should be correct

---

## Outcomes & Retrospective

**What worked:**
- Bug analysis correctly identified `atob()` as the root cause from the garbled character pattern
- Standard `Uint8Array.from()` + `TextDecoder` pattern is well-known and reliable

**What didn't:**
- Nothing — this was a clean single-line bugfix

**Learnings to codify:**
- `atob()` in browsers always produces Latin-1 strings, never UTF-8 — always use `TextDecoder` for base64-encoded UTF-8 payloads
