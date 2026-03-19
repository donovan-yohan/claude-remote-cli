# Bug Analyses

| File | Summary | Date |
|------|---------|------|
| [global-defaults-and-tmux-rendering-bug-analysis.md](2026-03-11-global-defaults-and-tmux-rendering-bug-analysis.md) | Stale global defaults on quick-start + missing Unicode in tmux | 2026-03-11 |
| [continue-flag-no-previous-session-bug-analysis.md](2026-03-11-continue-flag-no-previous-session-bug-analysis.md) | WebSocket disconnects when --continue retry replaces PTY | 2026-03-11 |
| [searchable-select-dropdown-bug-analysis.md](2026-03-11-searchable-select-dropdown-bug-analysis.md) | SearchableSelect dropdown opens+closes instantly due to detached DOM node in click-outside handler | 2026-03-11 |
| [mobile-touch-scroll-tmux-bug-analysis.md](2026-03-12-mobile-touch-scroll-tmux-bug-analysis.md) | Mobile touch scroll is no-op in tmux because alternate screen buffer has baseY=0 | 2026-03-12 |
| [mobile-autocorrect-and-selection-bug-analysis.md](2026-03-12-mobile-autocorrect-and-selection-bug-analysis.md) | Mobile autocorrect lost due to cursor-0 desync in hidden input; text selection selects all instead of specific text | 2026-03-12 |
| [status-indicator-oscillation-bug-analysis.md](2026-03-13-status-indicator-oscillation-bug-analysis.md) | Status indicator oscillates between attention/running due to PTY noise + no dismissed-state tracking | 2026-03-13 |
| [osc52-clipboard-utf8-bug-analysis.md](2026-03-13-osc52-clipboard-utf8-bug-analysis.md) | OSC 52 clipboard handler uses atob() which mangles UTF-8 multi-byte characters to Latin-1 | 2026-03-13 |
| [continue-retry-tmux-exit-code-bug-analysis.md](2026-03-14-continue-retry-tmux-exit-code-bug-analysis.md) | --continue retry never fires because tmux masks inner exit code to 0 | 2026-03-14 |
| [mobile-scroll-escape-sequences-bug-analysis.md](2026-03-16-mobile-scroll-escape-sequences-bug-analysis.md) | Mobile scroll sends SGR escape sequences to shell when mouse tracking not enabled | 2026-03-16 |
| [non-tmux-scroll-bug-analysis.md](2026-03-17-non-tmux-scroll-bug-analysis.md) | Touch scroll sends arrow keys instead of wheel events in non-tmux alternate screen sessions | 2026-03-17 |
| [session-persistence-across-updates-bug-analysis.md](2026-03-17-session-persistence-across-updates-bug-analysis.md) | Sessions lost after auto-update: tmux orphan cleanup race, no graceful shutdown serialization, PTY-coupled lifecycle | 2026-03-17 |
| [first-enter-duplicate-content-bug-analysis.md](2026-03-19-first-enter-duplicate-content-bug-analysis.md) | First Enter on new session duplicates terminal content — likely conditional rendering or PTY resize | 2026-03-19 |
