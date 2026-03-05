# Belayer — Autonomous Task Pipeline Design

> Date: 2026-03-05
> Status: Draft

## Problem

Today, the workflow for getting from "here's a task" to "here's a PR for you to review" requires a human to be present at every step: reading the issue, brainstorming a design, creating a plan, executing in a Claude session, validating, and opening a PR. The lead and harness plugins (from llm-agents) automate the execution phase, but their CLI-only nature limits them:

- **No external task intake** — lead only accepts text prompts; can't pull from Jira, Linear, or GitHub Issues
- **No persistent process** — plugins activate per-session; the lead-loop.sh bash script is fragile (tmux/nohup workarounds)
- **No UI for human gates** — PRD approval and plan review happen in a terminal, not a rich interface
- **No pipeline visibility** — no way to see progress, retry status, or verdict results from a phone
- **No post-PR lifecycle** — no CI monitoring, no auto-fix on failure, no merge gate

claude-remote-cli already has a persistent server, PTY management, WebSocket infrastructure, and a mobile-friendly web UI — making it the natural home for a pipeline that wraps the lead/harness methodology in a proper application layer.

## Concept

Belayer is a server-side feature module that automates the path from task intake to PR creation. It builds on three proven systems:

| System | What belayer borrows |
|--------|---------------------|
| **Bosun** (virtengine/bosun) | Kanban adapter pattern (unified task source abstraction), status normalization, supervisor intervention concepts, retry + cooldown |
| **Lead** (llm-agents plugin) | PRD-as-shared-state, three-model architecture, independent reviewer with structured verdict, STUCK report generation |
| **Harness** (llm-agents plugin) | brainstorm → design doc → plan → orchestrate → complete pipeline, living plan format, micro-reflects |

The key insight: lead/harness define the *methodology* (what prompts to use, how to structure the work); belayer provides the *infrastructure* (persistence, UI, integrations, lifecycle management).

## Decisions

- **Server module, not plugin**: Belayer lives in `server/belayer/` as a first-class server module, not a Claude Code plugin. Plugins can't run persistent background processes, listen for webhooks, or render rich UI.
- **Reuse existing PTY infrastructure**: Agent sessions (execute, review) are PTY sessions managed by `sessions.ts` — same as user sessions but spawned programmatically with `claude -p --dangerously-skip-permissions`.
- **Pipeline state machine on disk**: Each pipeline is a JSON file in `~/.config/claude-remote-cli/pipelines/`. State transitions are atomic writes. Pipelines resume on server restart.
- **Human gates at PRD and plan**: Brainstorm and plan phases produce artifacts the user approves in the web UI before execution begins. Execution itself is autonomous.
- **Prompt templates from lead/harness**: The actual prompt content (PROMPT.md, REVIEW_PROMPT.md, STUCK_PROMPT.md) is adapted from lead's proven templates. No need to reinvent the prompt engineering.
- **TaskSource adapter pattern**: Inspired by bosun's kanban-adapter. A `TaskSource` interface normalizes issues from Jira, Linear, GitHub Issues, or free-text into a common `TaskSpec`.
- **Independent reviewer in separate PTY**: Review runs in a fresh Claude session with no access to execution context — same isolation principle as lead's reviewer.
- **Verdict-driven retry**: Structured `verdict.json` determines pass/fail. On fail, execution retries with verdict feedback injected into the prompt. Max retries configurable (default 3).
- **WebSocket pipeline events**: Pipeline state changes broadcast over the existing `/ws/events` channel. Frontend subscribes reactively.
- **No DAG engine**: Unlike bosun's workflow-engine.mjs, belayer uses a linear state machine. The pipeline is fundamentally sequential (intake → brainstorm → plan → execute → review → PR) with a single retry loop. A DAG engine is unnecessary complexity.

## Pipeline State Machine

```
INTAKE ──→ BRAINSTORMING ──→ PRD_REVIEW ──→ PLANNING ──→ PLAN_REVIEW
                                  ^               |              |
                                  └─── edit ──────┘              |
                                                                 v
PR_CREATED ←── REVIEWING ←── EXECUTING ←─────────────────────────┘
    |              |              ^
    |              └── fail ──→ RETRY (back to EXECUTING, up to N)
    |                             |
    |                             └── max retries ──→ STUCK
    v
CI_MONITORING ──→ READY_FOR_REVIEW ──→ DONE
```

### State Definitions

| State | Description | Human action required? |
|-------|-------------|----------------------|
| `intake` | Task fetched from source, normalized to TaskSpec | No |
| `brainstorming` | Claude session running brainstorm prompt | No (wait for output) |
| `prd_review` | PRD presented in UI for approval | **Yes** — approve/edit/reject |
| `planning` | Claude session running plan prompt with approved PRD | No |
| `plan_review` | Plan presented in UI for approval | **Yes** — approve/edit/reject |
| `executing` | Headless Claude session implementing the plan | No |
| `reviewing` | Independent Claude session checking acceptance criteria | No |
| `retry` | Review failed, re-executing with verdict feedback | No |
| `stuck` | Max retries exhausted, STUCK report generated | **Yes** — fix and resume, skip, or abort |
| `pr_created` | PR opened via `gh pr create` | No |
| `ci_monitoring` | Watching CI checks on the PR | No |
| `ready_for_review` | CI passed, PR ready for human review | **Yes** — merge/request changes |
| `done` | Pipeline completed | No |
| `failed` | Unrecoverable error | **Yes** — inspect and retry or discard |

## Data Model

### TaskSpec (normalized from any source)

```typescript
interface TaskSpec {
  source: 'jira' | 'linear' | 'github' | 'text';
  externalId?: string;      // e.g. "PROJ-123", "#456"
  externalUrl?: string;     // link back to source
  title: string;
  description: string;      // full body/description
  acceptanceCriteria?: string[];
  labels?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  metadata?: Record<string, unknown>;  // source-specific data
}
```

### Pipeline (persisted to disk)

```typescript
interface Pipeline {
  id: string;               // uuid
  state: PipelineState;
  task: TaskSpec;
  config: PipelineConfig;
  createdAt: string;
  updatedAt: string;

  // Artifacts produced during pipeline
  prdPath?: string;         // path to PRD markdown
  planPath?: string;        // path to living plan markdown
  worktreePath?: string;    // git worktree for execution
  branchName?: string;      // feature branch
  prNumber?: number;        // GitHub PR number
  prUrl?: string;

  // Execution tracking
  attempts: number;
  maxAttempts: number;
  verdicts: Verdict[];      // history of review verdicts
  stuckReport?: string;     // path to STUCK report if generated

  // Session references
  activeSessionId?: string; // current PTY session (if any)
  error?: string;           // last error message
}
```

### PipelineConfig

```typescript
interface PipelineConfig {
  models: {
    brainstorm: string;   // default: 'opus'
    execute: string;      // default: 'opus'
    review: string;       // default: 'sonnet'
  };
  maxAttempts: number;      // default: 3
  autoPush: boolean;        // default: true
  targetRepo: string;       // absolute path to repo
  baseBranch: string;       // default: 'main'
}
```

### Verdict (from independent reviewer)

```typescript
interface Verdict {
  goalName: string;
  pass: boolean;
  criteriaResults: Array<{
    criterion: string;
    met: boolean;
    reason?: string;
  }>;
  summary: string;
  suggestions?: string[];
  timestamp: string;
}
```

## Backend

### New module: `server/belayer/`

| File | Responsibility |
|------|----------------|
| `pipeline.ts` | State machine: transitions, persistence, resume-on-restart |
| `intake.ts` | TaskSource adapters: Jira, Linear, GitHub Issues, free-text |
| `executor.ts` | Spawn headless Claude PTY with execution prompt, monitor completion |
| `reviewer.ts` | Spawn independent review PTY, parse verdict.json |
| `pr-lifecycle.ts` | PR creation via `gh`, CI status polling |
| `prompts.ts` | Prompt templates adapted from lead/harness |
| `types.ts` | TypeScript interfaces |

### TaskSource adapter interface

```typescript
interface TaskSource {
  readonly name: string;
  fetch(input: string): Promise<TaskSpec>;  // URL, ID, or free-text
  canHandle(input: string): boolean;        // URL pattern matching
}
```

Adapters:
- `JiraSource` — calls Jira REST API v3 (`/rest/api/3/issue/{key}`)
- `LinearSource` — calls Linear GraphQL API
- `GitHubIssueSource` — calls GitHub REST API (`/repos/{owner}/{repo}/issues/{number}`)
- `TextSource` — wraps free-text input as a TaskSpec with title = first line, description = rest

### REST API additions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pipelines` | List all pipelines (summary) |
| `GET` | `/pipelines/:id` | Full pipeline detail |
| `POST` | `/pipelines` | Create pipeline from task input (URL or text) |
| `POST` | `/pipelines/:id/approve-prd` | Approve PRD (with optional edits) |
| `POST` | `/pipelines/:id/approve-plan` | Approve plan (with optional edits) |
| `POST` | `/pipelines/:id/resume` | Resume from stuck/failed state |
| `POST` | `/pipelines/:id/abort` | Cancel pipeline |
| `DELETE` | `/pipelines/:id` | Delete pipeline and artifacts |

### WebSocket events (over existing `/ws/events`)

| Event | Payload | When |
|-------|---------|------|
| `pipeline-state-changed` | `{ id, state, updatedAt }` | Any state transition |
| `pipeline-output` | `{ id, chunk }` | Agent PTY output (for live monitoring) |
| `pipeline-verdict` | `{ id, verdict }` | Review completed |
| `pipeline-pr-created` | `{ id, prNumber, prUrl }` | PR opened |

### Agent PTY spawning

Reuses `sessions.ts` with a programmatic interface:

```typescript
// In executor.ts
const sessionId = sessions.createHeadless({
  cwd: worktreePath,
  claudeArgs: ['-p', '--dangerously-skip-permissions', '--model', config.models.execute],
  stdin: promptContent,           // pipe prompt via stdin
  onExit: (code) => handleExecutionComplete(pipeline, code),
  onOutput: (chunk) => broadcastPipelineOutput(pipeline.id, chunk),
});
```

### Prompt templates

Adapted from lead's PROMPT.md, REVIEW_PROMPT.md, and STUCK_PROMPT.md. Key differences from lead:

- Task context injected from TaskSpec (not just PRD goals)
- Acceptance criteria from source issue (if available) supplement PRD criteria
- Previous verdict feedback injected on retry
- Prompt instructs agent to write signal files (`.belayer/verdict.json`, `.belayer/COMPLETE`)

### Pipeline persistence

```
~/.config/claude-remote-cli/pipelines/
  ├── {uuid}.json              # Pipeline state
  ├── {uuid}/                  # Pipeline artifacts
  │   ├── prd.md               # Generated PRD
  │   ├── plan.md              # Generated plan
  │   ├── verdict-1.json       # Review verdicts
  │   ├── verdict-2.json
  │   ├── stuck-report.md      # If max retries hit
  │   ├── execution.log        # Agent output log
  │   └── review.log           # Reviewer output log
```

## Frontend

### New tab: Pipelines

Add a fourth sidebar tab alongside Repos, Worktrees, and PRs.

### Components

| Component | Purpose |
|-----------|---------|
| `PipelineList.svelte` | List of all pipelines with state badges and progress indicators |
| `PipelineView.svelte` | Detail view: state machine visualization, artifacts, logs |
| `IntakeDialog.svelte` | Modal: paste Jira/Linear/GitHub URL or type a prompt |
| `PRDReview.svelte` | Rendered PRD markdown with approve/edit/reject actions |
| `PlanReview.svelte` | Rendered plan markdown with approve/edit/reject actions |
| `ExecutionMonitor.svelte` | Live agent output stream (like a read-only terminal) |
| `VerdictView.svelte` | Structured verdict display with criteria pass/fail breakdown |
| `StuckReport.svelte` | STUCK report display with resume/skip/abort actions |

### State management

```typescript
// frontend/src/lib/state/pipelines.svelte.ts
let pipelines = $state<Pipeline[]>([]);
let activePipeline = $state<Pipeline | null>(null);

// Fetch on mount, subscribe to WebSocket events for real-time updates
```

Uses existing `$state` pattern (not svelte-query) — consistent with sessions/worktrees state management.

### Pipeline card layout (in PipelineList)

```
Row 1: [state badge ●] [task title]              [source icon]
Row 2: [state label]    [attempt N/M]            [elapsed time]
Row 3: [progress bar showing state machine position]
```

### Pipeline detail view (in main content area)

```
┌─────────────────────────────────────────────────────────┐
│ Pipeline: PROJ-123 — Add expense export feature         │
│ State: EXECUTING (attempt 2/3)                          │
│                                                         │
│ ● intake → ● brainstorm → ● prd → ● plan → ◐ execute  │
│                                                         │
│ ┌─ PRD ──────────────────────────────────────────────┐  │
│ │ (collapsible, rendered markdown)                   │  │
│ └────────────────────────────────────────────────────┘  │
│ ┌─ Plan ─────────────────────────────────────────────┐  │
│ │ (collapsible, rendered markdown)                   │  │
│ └────────────────────────────────────────────────────┘  │
│ ┌─ Live Output ──────────────────────────────────────┐  │
│ │ (streaming agent output)                           │  │
│ └────────────────────────────────────────────────────┘  │
│ ┌─ Verdicts ─────────────────────────────────────────┐  │
│ │ Attempt 1: FAIL — 2/4 criteria met                │  │
│ │ Attempt 2: (in progress)                          │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## TaskSource Configuration

Credentials stored in the existing config file (`~/.config/claude-remote-cli/config.json`):

```json
{
  "belayer": {
    "jira": {
      "baseUrl": "https://acme.atlassian.net",
      "email": "bot@acme.com",
      "apiToken": "***"
    },
    "linear": {
      "apiKey": "***"
    },
    "github": {
      "token": "***"
    },
    "defaults": {
      "models": { "brainstorm": "opus", "execute": "opus", "review": "sonnet" },
      "maxAttempts": 3,
      "autoPush": true
    }
  }
}
```

GitHub source can also fall back to `gh` CLI auth (same pattern as existing PR tab).

## Phasing

### v1 — Core pipeline (MVP)

- `TextSource` only (paste text or URL, manually provide context)
- Brainstorm → PRD review → Plan → Plan review → Execute → Review → PR
- Single pipeline at a time
- File-based state persistence
- Basic pipeline list + detail UI

### v2 — External integrations

- `GitHubIssueSource` (auto-fetch from GitHub Issue URLs)
- `JiraSource` (auto-fetch from Jira ticket URLs)
- CI monitoring after PR creation
- Multiple concurrent pipelines
- Pipeline notifications (WebSocket toast)

### v3 — Advanced features

- `LinearSource`
- Webhook intake (Jira/GitHub webhooks trigger pipeline creation)
- Auto-fix on CI failure (re-execute with CI error context)
- Pipeline templates (different prompt strategies per task type)
- Pipeline history and analytics

## Non-Goals

- Replacing lead/harness plugins — they remain the portable CLI-only version
- Multi-executor support (Codex, Copilot, etc.) — Claude only for now
- Visual workflow builder (bosun-style DAG editor) — linear pipeline is sufficient
- Distributed multi-machine coordination — single server only
- Auto-merge without human approval — human always reviews the final PR

## References

- Bosun workflow architecture: `virtengine/bosun` — kanban-adapter.mjs, workflow-engine.mjs, task-executor.mjs
- Lead plugin: `llm-agents/plugins/lead/` — lead-loop.sh, PROMPT.md, REVIEW_PROMPT.md
- Harness plugin: `llm-agents/plugins/harness/` — brainstorm, plan, orchestrate, complete commands
- Existing claude-remote-cli architecture: `docs/ARCHITECTURE.md`
