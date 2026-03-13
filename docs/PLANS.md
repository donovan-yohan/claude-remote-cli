# Plans

Execution plans for active and completed work.

## Active Plans

| Plan | Created | Topic |
|------|---------|-------|
| `mobile-input-redesign` | 2026-02-25 | Event-intent architecture replacing value-diffing for mobile input |

## Tech Debt

No tech debt tracked yet.

## Completed Plans

See `docs/exec-plans/completed/` for historical plans (23 completed).

| Plan | Completed | Topic |
|------|-----------|-------|
| `push-notifications` | 2026-03-13 | Push notifications (Browser Notification + Web Push PWA) when sessions need input |
| `status-indicator-oscillation-fix` | 2026-03-13 | Fix attention status oscillation with cooldown-based suppression |
| `mobile-autocorrect-and-selection` | 2026-03-12 | Fix mobile autocorrect recovery + tmux copy-mode for text selection |
| `mobile-touch-scroll-tmux` | 2026-03-12 | Fix mobile touch scroll in tmux/alternate screen via SGR mouse wheel sequences |
| `continue-flag-pty-replacement` | 2026-03-11 | Fix --continue retry: WebSocket PTY reattachment + tmux name collision |
| `tmux-clipboard-support` | 2026-03-11 | OSC 52 clipboard passthrough + Shift+click selection bypass for tmux sessions |
| `fix-global-defaults-and-tmux-utf8` | 2026-03-11 | Fix stale config defaults on quick-start + tmux UTF-8 rendering |
| `global-session-defaults-tmux` | 2026-03-10 | Global session defaults (continue, yolo, tmux) + tmux launch wrapping |
| `mobile-scroll-fixes` | 2026-03-07 | Fix FAB keyboard flicker, scroll-to-top bug, add skip-to-bottom + swipe sidebar |
| `multi-agent-cli` | 2026-03-05 | Choose between Claude and Codex as the underlying coding agent per session |
| `handle-existing-worktrees` | 2026-02-26 | Auto-redirect to existing worktrees on branch conflict + git-based delete validation |
| `publish-command` | 2026-02-26 | /publish slash command for full release lifecycle from feature branch |
| `session-loading-shimmer` | 2026-02-26 | Loading shimmer overlay for session list items during async actions |

## See Also

- [Architecture](ARCHITECTURE.md) — module boundaries and invariants
- [Design](DESIGN.md) — patterns and conventions
- Design documents for brainstorm outputs: `design-docs/`
