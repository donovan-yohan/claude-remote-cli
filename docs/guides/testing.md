# Testing

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed testing guidance.

## Test Runner

Uses Node.js built-in `node:test` module. No external test framework. Tests are TypeScript source files compiled via `tsc -p tsconfig.test.json`.

```bash
npm test                                              # Compile + run all tests
node --test dist/test/auth.test.js                    # Run a single compiled test
```

## Test Files

| File | Covers |
|------|--------|
| `test/auth.test.ts` | PIN hashing, verification, rate limiting, token generation |
| `test/clipboard.test.ts` | Clipboard tool detection, unsupported MIME type rejection |
| `test/config.test.ts` | Config loading/saving, defaults merging, worktree metadata persistence |
| `test/sessions.test.ts` | PTY spawning, session lifecycle (create/get/list/kill/resize/write) |
| `test/service.test.ts` | Platform detection, service path generation, service file templates |
| `test/paths.test.ts` | Project root resolution, public/ directory accessibility, dist/ layout |
| `test/version.test.ts` | Semantic version comparison (`semverLessThan`) |
| `test/worktrees.test.ts` | DELETE /worktrees path validation (rejects paths outside `.worktrees/`), branch-to-directory name conversion |

## Test Isolation Patterns

- `auth.test.ts` uses the `_resetForTesting()` export from `auth.ts` to get fresh rate-limit state before each test
- `sessions.test.ts` cleans up spawned PTY processes in `afterEach` hooks to prevent resource leaks
- `config.test.ts` uses temporary directories (`fs.mkdtempSync`) and cleans up files between tests
- `service.test.ts` `isInstalled` test is environment-dependent — may fail when launchd service is actually installed on the machine

## E2E Testing

Playwright is installed as a dev dependency but no E2E test files exist yet. E2E tests are kept separate from unit tests and are not run as part of `npm test`.
