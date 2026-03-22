# Design Documents

| Document | Purpose | Created | Status |
|----------|---------|---------|--------|
| [core-beliefs.md](core-beliefs.md) | Agent-first operating principles | 2026-02-24 | current |
| [2026-02-21-background-service-design.md](2026-02-21-background-service-design.md) | Background service (launchd/systemd) design | 2026-02-21 | implemented |
| [2026-02-21-mobile-toolbar-redesign.md](2026-02-21-mobile-toolbar-redesign.md) | Mobile toolbar redesign | 2026-02-21 | implemented |
| [2026-02-21-realtime-worktree-watching.md](2026-02-21-realtime-worktree-watching.md) | Real-time worktree watching design | 2026-02-21 | implemented |
| [2026-02-21-session-sidebar-redesign.md](2026-02-21-session-sidebar-redesign.md) | Session sidebar redesign | 2026-02-21 | superseded |
| [2026-02-21-typescript-esm-migration-design.md](2026-02-21-typescript-esm-migration-design.md) | TypeScript + ESM migration design | 2026-02-21 | implemented |
| [2026-02-21-update-notification-design.md](2026-02-21-update-notification-design.md) | Update notification system design | 2026-02-21 | implemented |
| [2026-02-21-worktree-cleanup-design.md](2026-02-21-worktree-cleanup-design.md) | Worktree cleanup feature design | 2026-02-21 | implemented |
| [2026-02-21-yolo-mode-design.md](2026-02-21-yolo-mode-design.md) | Yolo mode (skip permissions) design | 2026-02-21 | implemented |
| [2026-02-22-clipboard-image-passthrough-design.md](2026-02-22-clipboard-image-passthrough-design.md) | Clipboard image passthrough design | 2026-02-22 | implemented |
| [2026-02-22-mobile-ux-enhancements-design.md](2026-02-22-mobile-ux-enhancements-design.md) | Mobile UX enhancements design | 2026-02-22 | implemented |
| [2026-02-23-branch-aware-sessions-design.md](2026-02-23-branch-aware-sessions-design.md) | Branch-aware session creation design | 2026-02-23 | implemented |
| [2026-02-23-repo-sessions-design.md](2026-02-23-repo-sessions-design.md) | Repo session type design | 2026-02-23 | implemented |
| [2026-02-23-svelte-migration-menu-ui-design.md](2026-02-23-svelte-migration-menu-ui-design.md) | Svelte migration for menu UI design | 2026-02-23 | superseded |
| [2026-02-23-worktree-sync-design.md](2026-02-23-worktree-sync-design.md) | Worktree sync design | 2026-02-23 | implemented |
| [2026-02-24-session-card-action-buttons-design.md](2026-02-24-session-card-action-buttons-design.md) | Inline pill buttons replacing context menu | 2026-02-24 | superseded |
| [2026-02-25-mobile-input-redesign-design.md](2026-02-25-mobile-input-redesign-design.md) | Event-intent architecture replacing value-diffing for mobile input | 2026-02-25 | implemented |
| [2026-02-25-mobile-scroll-ux-design.md](2026-02-25-mobile-scroll-ux-design.md) | Mobile scroll & touch UX improvements (6 patterns from claude-wormhole analysis) | 2026-02-25 | implemented |
| [2026-02-26-handle-existing-worktrees-design.md](2026-02-26-handle-existing-worktrees-design.md) | Auto-redirect to existing worktrees on branch conflict + git-based delete validation | 2026-02-26 | implemented |
| [2026-02-26-session-loading-shimmer-design.md](2026-02-26-session-loading-shimmer-design.md) | Loading shimmer overlay for session list items during async actions | 2026-02-26 | implemented |
| [2026-02-26-publish-command-design.md](2026-02-26-publish-command-design.md) | /publish slash command for full release lifecycle from feature branch | 2026-02-26 | implemented |
| [2026-03-05-multi-agent-cli-design.md](2026-03-05-multi-agent-cli-design.md) | Choose between Claude and Codex as the underlying coding agent per session | 2026-03-05 | implemented |
| [2026-03-06-context-menu-refactor-design.md](2026-03-06-context-menu-refactor-design.md) | Replace hover/longpress action pills with universal "..." context menu | 2026-03-06 | implemented |
| [2026-03-06-customize-session-flow-design.md](2026-03-06-customize-session-flow-design.md) | Pre-fill NewSessionDialog from context menu "Customize" action | 2026-03-06 | superseded |
| [2026-03-06-arbitrary-terminal-sessions-design.md](2026-03-06-arbitrary-terminal-sessions-design.md) | Bare shell terminal sessions without agent wrappers | 2026-03-06 | implemented |
| [2026-03-06-searchable-filter-dropdowns-design.md](2026-03-06-searchable-filter-dropdowns-design.md) | Replace native selects with searchable dropdown filters | 2026-03-06 | implemented |
| [2026-03-10-tmux-launch-setting-design.md](2026-03-10-tmux-launch-setting-design.md) | Settings-backed tmux wrapper for Claude/Codex launches | 2026-03-10 | implemented |
| [2026-03-11-tmux-clipboard-support-design.md](2026-03-11-tmux-clipboard-support-design.md) | OSC 52 clipboard passthrough + Shift+click selection bypass for tmux sessions | 2026-03-11 | implemented |
| [2026-03-13-push-notifications-design.md](2026-03-13-push-notifications-design.md) | Push notifications when sessions need user input (Browser Notification + Web Push PWA) | 2026-03-13 | implemented |
| [2026-03-16-mobile-keyboard-testing-design.md](2026-03-16-mobile-keyboard-testing-design.md) | Fixture-based testing for mobile virtual keyboard event-intent pipeline | 2026-03-16 | implemented |
| [2026-03-16-session-persistence-across-updates-design.md](2026-03-16-session-persistence-across-updates-design.md) | Persist and restore sessions across auto-updates | 2026-03-16 | implemented |
| [2026-03-17-mobile-ux-fixes-design.md](2026-03-17-mobile-ux-fixes-design.md) | Android keyboard blur, autocorrect suffix, debug tools, paste button | 2026-03-17 | implemented |
| [2026-03-19-filesystem-browser-api-design.md](2026-03-19-filesystem-browser-api-design.md) | File system browser API + tree UI for workspace selection with bulk import | 2026-03-19 | implemented |
| [2026-03-19-pr-lifecycle-top-bar-design.md](2026-03-19-pr-lifecycle-top-bar-design.md) | PR lifecycle top bar: session-end refresh, diff stats, conflicts, comments, archive flow | 2026-03-19 | implemented |
| [2026-03-19-enriched-sidebar-sessions-design.md](2026-03-19-enriched-sidebar-sessions-design.md) | Enriched sidebar: two-line rows with relative time, worktree name, PR#, diff stats, collapsible workspaces | 2026-03-19 | implemented |
| [2026-03-19-workspace-reorder-design.md](2026-03-19-workspace-reorder-design.md) | Drag-and-drop workspace reordering, sidebar header simplification, inactive session contrast | 2026-03-19 | implemented |
| [2026-03-20-local-analytics-design.md](2026-03-20-local-analytics-design.md) | Local analytics & user behavior tracking with SQLite for agent-queryable usage data | 2026-03-20 | implemented |
| [2026-03-21-new-tab-quick-create-design.md](2026-03-21-new-tab-quick-create-design.md) | Redesign tab bar "+" dropdown: instant agent/terminal creation, simplified Customize modal, auto-named tabs | 2026-03-21 | implemented |
| [2026-03-21-org-dashboard-phase4-design.md](2026-03-21-org-dashboard-phase4-design.md) | Jira + Linear integrations with native metadata and StatusMappingModal | 2026-03-21 | implemented |
| [2026-03-21-org-dashboard-phase5-design.md](2026-03-21-org-dashboard-phase5-design.md) | PR review automation: auto-checkout review requests, auto-review with code review prompt | 2026-03-21 | implemented |
