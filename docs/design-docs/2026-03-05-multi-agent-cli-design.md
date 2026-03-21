---
status: implemented
created: 2026-03-05
branch: master
supersedes:
implemented-by:
consulted-learnings: []
---

# Multi-Agent CLI Support

**Date:** 2026-03-05
**Status:** Approved

## Problem

claude-remote-cli is hardcoded to spawn `claude` as the underlying coding agent. Users want to choose between multiple coding agent CLIs (Claude, Codex) per session, with a configurable default.

## Design

### Agent Type

```typescript
type AgentType = 'claude' | 'codex';
```

Two agents supported. Simple select dropdown in UI — not extensible/free-text.

### Config Changes

Add `defaultAgent: AgentType` to `Config` (default: `'claude'`). Existing `claudeCommand` becomes a fallback — when `agent` is specified on a session, the command is derived from agent type.

```typescript
const AGENT_COMMANDS: Record<AgentType, string> = {
  claude: 'claude',
  codex: 'codex',
};
```

### Flag Mapping

Abstract UI concepts map to different CLI flags per agent:

| Concept | Claude | Codex |
|---------|--------|-------|
| Command | `claude` | `codex` |
| Continue/resume | `['--continue']` | `['resume', '--last']` |
| YOLO mode | `['--dangerously-skip-permissions']` | `['--full-auto']` |

The existing `claudeArgs` (config global) and per-session extra args still apply to whichever agent is selected. Users are responsible for passing valid args for their chosen agent.

### API Changes

Both `POST /sessions` and `POST /sessions/repo` accept an optional `agent?: AgentType` field. If omitted, falls back to `config.defaultAgent`.

The `agent` value is stored on the session so the frontend can display which agent is running.

### Frontend Changes

**Settings dialog:**
- Add "Default coding agent" select (Claude / Codex) below Root Directories
- Persisted to server config via existing config update mechanism

**New Session dialog (both tabs):**
- Add "Coding agent" select above existing options, defaults to config value
- YOLO checkbox label unchanged; maps to correct flag based on agent
- Continue checkbox visible for both agents; backend handles flag difference

### Environment Stripping

Only `CLAUDECODE` is stripped (existing behavior). Codex doesn't set this var, so no additional stripping needed.

### Retry Logic

Existing retry-without-continue logic (exit within 3s) applies to both agents. For Codex, retry strips the `resume --last` args just like Claude strips `--continue`.

### Settings Persistence

New `GET /config/defaultAgent` and `PATCH /config/defaultAgent` endpoints, or extend existing config API if one exists. The setting is stored in `config.json` alongside other server settings.
