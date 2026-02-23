# Worktree Sync Design

> Created: 2026-02-23

## Problem

Claude Code's `--worktree` flag creates worktrees in `.claude/worktrees/`, but the server watches `.worktrees/`. This means worktrees created locally via `claude --worktree` don't appear in the web UI. Users want bidirectional sync: worktrees created from the web UI should be ready locally, and worktrees created locally should appear in the web UI.

## Solution

Two-part approach:

### Part 1: Watch both worktree directories

Extend the server to recognize worktrees in both `.worktrees/` (managed by the web UI) and `.claude/worktrees/` (created by Claude Code's native `--worktree` flag).

**Files affected:**
- `server/watcher.ts` — watch both dirs per repo
- `server/index.ts` — scan both dirs in `GET /worktrees`, accept both in `DELETE /worktrees` path validation

### Part 2: `claude-remote-cli worktree` CLI command

A convenience command that wraps `git worktree` and launches Claude in the result.

**Syntax:**
```
claude-remote-cli worktree add [<path>] [-b <branch>] [--yolo] [<git-worktree-flags>...]
claude-remote-cli worktree remove <path>
claude-remote-cli worktree list
```

**Behavior:**
- `add`: strips `--yolo`, forwards remaining args to `git worktree add`. If no `<path>`, defaults to `.worktrees/<branch>` relative to repo root. After creation, spawns `claude` in the new directory (with `--dangerously-skip-permissions` if `--yolo`).
- `remove`/`list`: forwards directly to `git worktree remove`/`git worktree list`.
- Agent-agnostic: the git step and agent launch are separate, making it easy to support other agents later.

**Entry point:** New subcommand handler in `bin/claude-remote-cli.ts`.

## Design Decisions

- **Passthrough to git**: no reinventing worktree syntax. We intercept only `--yolo`, forward everything else.
- **Default path**: `.worktrees/<name>` in repo root, which the server already watches.
- **Agent-agnostic**: worktree creation is decoupled from agent launch, supporting future agents (codex, gemini, etc.).
- **Both dirs watched**: covers both workflows without requiring users to change habits.
