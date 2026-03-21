# Quality

Testing patterns and quality standards for claude-remote-cli.

## Current State

- Node.js built-in `node:test` + `node:assert` — no external test framework
- TypeScript test files in `test/`, compiled via `tsc -p tsconfig.test.json`
- Seventeen test files covering all server modules
- `svelte-check` runs in `build`, `test`, and standalone `check` — catches type errors in `.svelte` files
- E2E tests (Playwright) planned but not yet implemented

## Commands

```bash
npm test                                    # svelte-check + compile + run all tests
npm run check                               # Type check everything (server tsc + svelte-check)
npm run check:svelte                        # Type check frontend only (svelte-check)
node --test dist/test/auth.test.js          # Run a single compiled test
```

## Type Checking

Two type-checking tools cover the full codebase:

| Tool | Scope | Runs in |
|------|-------|---------|
| `tsc` | Server (`server/`, `bin/`) | `build`, `test`, `check` |
| `svelte-check` | Frontend (`frontend/src/`) | `build`, `test`, `check`, `check:svelte` |

Both `build` and `test` fail on type errors. CI runs both via `npm run build && npm test`, ensuring no code with type errors can be published.

`frontend/tsconfig.json` strict flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `skipLibCheck`.

## Test Files

| File | Covers |
|------|--------|
| `test/auth.test.ts` | PIN hashing, verification, rate limiting, token generation |
| `test/clipboard.test.ts` | Clipboard tool detection, unsupported MIME type rejection |
| `test/config.test.ts` | Config loading/saving, defaults merging, worktree metadata |
| `test/sessions.test.ts` | PTY spawning, session lifecycle, session types, `findRepoSession` |
| `test/service.test.ts` | Platform detection, service path generation, service file templates |
| `test/paths.test.ts` | Project root resolution, public/ directory, dist/ layout |
| `test/version.test.ts` | Semantic version comparison (`semverLessThan`) |
| `test/worktrees.test.ts` | Path validation, branch-to-directory conversion, repo session paths |
| `test/pull-requests.test.ts` | PR fetching, author/reviewer filtering, `gh` CLI integration |
| `test/output-parser.test.ts` | Claude output parser state transitions, Codex stub, parser registry |
| `test/hooks.test.ts` | stripAnsi utility, semverLessThan with pre-release, cleanEnv, fireStateChange callbacks |
| `test/analytics.test.ts` | Analytics DB init, trackEvent insertion, optional null fields, idempotency, DB size, Express router endpoints |
| `test/branch-rename.test.ts` | Branch auto-rename flow, sideband `claude -p` invocation, branch watcher polling |
| `test/fs-browse.test.ts` | Filesystem browser API: directory listing, git repo detection, denylist filtering |
| `test/git.test.ts` | Git operations: branch listing, activity feed, CI status parsing |
| `test/pr-state.test.ts` | PR lifecycle state machine: action derivation from PR state + CI + mergeable + comments |

## Test Isolation Patterns

- `auth.test.ts` uses `_resetForTesting()` export from `auth.ts` for fresh rate-limit state
- `sessions.test.ts` cleans up spawned PTY processes in `afterEach` hooks
- `config.test.ts` uses temporary directories (`fs.mkdtempSync`) and cleans up between tests
- `service.test.ts` `isInstalled` test is environment-dependent — may fail when launchd service is actually installed
- `pull-requests.test.ts` tests type construction only — no `gh` CLI calls or runtime dependencies

## E2E Testing

Playwright is a dev dependency but no E2E test files exist yet. E2E tests are separate from unit tests and not run by `npm test`.

## Mobile Input Testing

The mobile input event-intent pipeline is extracted into `server/mobile-input-pipeline.ts` and tested via JSON event fixtures.

**Test file:** `test/mobile-input.test.ts`
**Fixtures:** `test/fixtures/mobile-input/*.json`

**Workflow for mobile keyboard bug fixes:**
1. Create a fixture JSON in `test/fixtures/mobile-input/` reproducing the event sequence that triggers the bug
2. Run `npm test` — the new fixture should fail (TDD red)
3. Fix the pipeline logic in `server/mobile-input-pipeline.ts`
4. Run `npm test` — all fixtures should pass (TDD green)

**Fixture format:**
```json
{
  "name": "descriptive-name",
  "description": "What this tests",
  "device": "android-chrome-gboard",
  "events": [{
    "inputType": "insertText",
    "data": "the",
    "rangeStart": 0, "rangeEnd": 3,
    "valueBefore": "teh", "cursorBefore": 3,
    "valueAfter": "the"
  }],
  "expectedPayload": "\u007f\u007f\u007fthe"
}
```

**Critical invariant:** When an autocorrect event carries replacement text (`data` is non-null), the payload must always include that text — never only backspaces.

## See Also

- [Architecture](ARCHITECTURE.md) — module structure and invariants
- [Design](DESIGN.md) — backend patterns and conventions
