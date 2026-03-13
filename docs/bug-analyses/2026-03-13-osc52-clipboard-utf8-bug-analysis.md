# Bug Analysis: OSC 52 Clipboard Mangles UTF-8 Characters

> **Status**: Confirmed | **Date**: 2026-03-13
> **Severity**: Medium
> **Affected Area**: `frontend/src/components/Terminal.svelte` — OSC 52 handler

## Symptoms
- Copying text from tmux sessions via the remote CLI produces garbled box-drawing characters
- `┌─────────────┬───────────┐` becomes `âââââââââââââââ¬âââââââââââââ`
- Only affects tmux copy (OSC 52 path); desktop native selection and mobile selection are unaffected

## Reproduction Steps
1. Open a session in claude-remote-cli that runs tmux
2. Have tmux display a table with box-drawing characters (e.g., `column -t` output or any CLI table)
3. Copy text from tmux (tmux sends OSC 52 to browser clipboard)
4. Paste into any text editor — box-drawing chars are garbled

## Root Cause
`Terminal.svelte` line 151 uses `atob()` to decode the OSC 52 base64 payload:

```ts
const text = atob(payload);
navigator.clipboard?.writeText(text).catch(() => {});
```

`atob()` decodes base64 into a **Latin-1 (ISO-8859-1) byte string**, not UTF-8. OSC 52 payloads are base64-encoded **UTF-8** bytes. Multi-byte UTF-8 characters (like box-drawing chars U+2500–U+257F, which are 3-byte sequences) get split into individual Latin-1 code points, producing garbled output.

Example: `─` (U+2500) → UTF-8 bytes `E2 94 80` → `atob()` produces three Latin-1 chars: `â` + `\x94` + `\x80`.

## Evidence
- `Terminal.svelte:151` — `const text = atob(payload);`
- The garbled pattern (`â` repeated) is the telltale signature of UTF-8 bytes decoded as Latin-1
- The notifications module (`notifications.ts:105-113`) already has a `urlBase64ToUint8Array` helper that correctly handles base64 → Uint8Array conversion, confirming the team knows about this pattern

## Impact Assessment
- All text copied via tmux's OSC 52 clipboard integration that contains non-ASCII characters is corrupted
- Affects box-drawing characters, Unicode symbols, emoji, accented characters, CJK text, etc.
- Desktop non-tmux copy and mobile selection copy are unaffected (they use proper Unicode string APIs)

## Recommended Fix Direction
Replace `atob()` with proper UTF-8 decoding:

```ts
const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
const text = new TextDecoder('utf-8').decode(bytes);
```

This is a one-line change in the OSC 52 handler. No architectural changes needed.
