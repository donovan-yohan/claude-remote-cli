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
| [sidenav-active-session-indicator-bug-analysis.md](2026-03-18-sidenav-active-session-indicator-bug-analysis.md) | No clear visual indicator for the currently active session in the sidenav | 2026-03-18 |
| [branch-auto-rename-not-implemented-bug-analysis.md](2026-03-18-branch-auto-rename-not-implemented-bug-analysis.md) | Branch auto-rename on first message was designed but never implemented — no per-repo settings, no prompt prepending, no first-message tracking | 2026-03-18 |
| [first-enter-duplicate-content-bug-analysis.md](2026-03-19-first-enter-duplicate-content-bug-analysis.md) | **CONFIRMED**: Branch rename interception sends chars to PTY twice; Ctrl+U unreliable in Claude Code TUI | 2026-03-19 |
| [sdk-chat-ui-remnant-bug-analysis.md](2026-03-19-sdk-chat-ui-remnant-bug-analysis.md) | SDK chat UI still renders for sessions — entire SDK/chat path should be removed after PTY-only pivot | 2026-03-19 |
| [pr-dashboard-usability-bug-analysis.md](2026-03-19-pr-dashboard-usability-bug-analysis.md) | PR dashboard: no scroll, Code Review links to GitHub, no per-PR session button, no search | 2026-03-19 |
| [tmux-underscore-rendering-bug-analysis.md](2026-03-19-tmux-underscore-rendering-bug-analysis.md) | tmux Unicode status icons render as underscores — likely caused by term.reset() wiping terminal state | 2026-03-19 |
| [sidebar-session-model-mismatch-bug-analysis.md](2026-03-19-sidebar-session-model-mismatch-bug-analysis.md) | Sidebar shows 1 row per session instead of 1 row per folder — duplicates, no persistent repo entry, architectural mismatch | 2026-03-19 |
| [repo-root-click-dashboard-bug-analysis.md](2026-03-19-repo-root-click-dashboard-bug-analysis.md) | Clicking inactive repo root goes to dashboard instead of creating a session — wrong click handler in persistent entry | 2026-03-19 |
| [missing-loading-feedback-bug-analysis.md](2026-03-19-missing-loading-feedback-bug-analysis.md) | No loading feedback on worktree/session creation — button stays clickable, no spinner or disabled state | 2026-03-19 |
| [closed-pr-shown-in-sidebar-bug-analysis.md](2026-03-19-closed-pr-shown-in-sidebar-bug-analysis.md) | Closed/merged PRs still shown in sidebar — `gh pr view` returns all states, no filtering applied | 2026-03-19 |
| [pr-topbar-stale-merged-pr-bug-analysis.md](2026-03-19-pr-topbar-stale-merged-pr-bug-analysis.md) | PrTopBar shows stale merged PR data for reused branch names — sidebar was fixed but top bar was not | 2026-03-19 |
| [branch-rename-pty-injection-bug-analysis.md](2026-03-19-branch-rename-pty-injection-bug-analysis.md) | PTY injection for branch rename is architecturally broken — vendor-extensible output parser + sideband rename needed | 2026-03-19 |
| [default-repo-session-sidebar-bug-analysis.md](2026-03-19-default-repo-session-sidebar-bug-analysis.md) | Default repo entry: hidden when empty, wrong name, click creates worktree, missing secondary row, wrong item order, dots not right-aligned | 2026-03-19 |
| [sidebar-ux-and-branch-pr-bugs-bug-analysis.md](2026-03-19-sidebar-ux-and-branch-pr-bugs-bug-analysis.md) | 7 issues: menu transparency, triple-dots UX, branch listener escape sequences, PR DRY violations, grab dots, bottom buttons, missing branch/activity display | 2026-03-19 |
