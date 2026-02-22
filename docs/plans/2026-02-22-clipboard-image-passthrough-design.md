# Clipboard Image Passthrough Design

> Allow users to paste images from their browser clipboard into a remote Claude Code CLI session.

## Problem

Claude Code CLI reads images from the **system clipboard** when the user presses Ctrl+V. In the remote CLI, Claude Code runs inside a server-side PTY, so its "system clipboard" is the server's — not the browser's. Images pasted in the browser never reach Claude Code.

## Solution

Bridge the gap with a two-stage approach:

1. **Primary (clipboard proxy):** Upload the image to the server, write it to the server's system clipboard using OS tools (`osascript` on macOS, `xclip` on Linux), then send `\x16` (Ctrl+V) to the PTY so Claude Code reads it natively.
2. **Fallback (file path):** If clipboard tools are unavailable, show the user a toast with the saved file path and an "Insert" button that types the path into the terminal.

## Data Flow

```
Browser paste event
  → detect image in clipboardData.items
  → read as base64
  → POST /sessions/:id/image (authenticated)
  → server saves to /tmp/claude-remote-cli/<sessionId>/paste-<timestamp>.<ext>
  → server tries clipboard proxy:
      ✓ success → write \x16 to PTY stdin → Claude Code reads clipboard
      ✗ failure → return path → browser shows toast with "Insert" button
```

## Components

### REST Endpoint: `POST /sessions/:id/image`

- **Auth:** Same cookie auth as other endpoints.
- **Body:** JSON `{ data: string (base64), mimeType: string }`.
- **Size limit:** 10MB max.
- **Accepted types:** `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- **Response:** `{ path: string, clipboardSet: boolean }`.
- **Temp files:** Saved to `/tmp/claude-remote-cli/<sessionId>/paste-<timestamp>.<ext>`.

### Server: Clipboard Proxy

- On first image upload, detect available clipboard tools (cached for process lifetime).
- **macOS:** `osascript -e 'set the clipboard to (read (POSIX file "<path>") as «class PNGf»)'` (class varies by MIME type).
- **Linux:** `xclip -selection clipboard -t <mimeType> -i <path>` (requires `DISPLAY` or `WAYLAND_DISPLAY`).
- After clipboard is set, write `\x16` to PTY stdin.
- Sequential execution ensures clipboard is set before Ctrl+V reaches Claude Code.

### Frontend: Paste Interception (public/app.js)

- `paste` event listener on terminal container, fires before xterm.js.
- Checks `clipboardData.items` for `image/*` MIME types.
- If image found: prevent default, read blob, convert to base64, POST to endpoint.
- If no image: let xterm.js handle normally (text paste).
- Drag-and-drop support via `drop` event (same upload flow).
- All vanilla JS, ES5 compatible per ADR-002.

### Frontend: Toast UI

- Small absolutely-positioned overlay at bottom of terminal area.
- States:
  - **Uploading:** "Pasting image..." (while request in flight).
  - **Success:** "Image pasted" (auto-dismiss after 2s).
  - **Fallback:** File path + "Insert" button (persists until dismissed).
  - **Error:** "Image upload failed" / "Image too large" (auto-dismiss after 4s).

## Edge Cases

- **Upload in progress:** Ignore subsequent image pastes until current resolves.
- **Image too large:** Rejected with 413, toast shows error.
- **Non-image paste:** Ignored by listener, xterm.js handles normally.
- **Session gone:** 404 from endpoint, toast shows error.
- **File type mapping:** PNG→`.png`/`PNGf`, JPEG→`.jpg`/`JPEG`, GIF→`.gif`, WebP→`.webp`.

## Cleanup

- Temp files deleted when PTY session exits (existing `onExit` hook in sessions.ts).
- Also cleaned up on server process exit.

## Non-Goals

- Headless server support (not a current use case).
- Image display/preview in the browser terminal.
- Persistent image storage beyond session lifetime.
