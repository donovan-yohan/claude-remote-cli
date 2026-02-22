# ADR-005: Node.js Built-in Test Runner

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
The project needs automated tests for its server modules (auth, config, sessions). Choosing a test framework involves tradeoffs between features, dependencies, and maintenance burden. Popular frameworks like Jest or Vitest add significant dependency trees and configuration. Since the project already requires Node.js >= 20.0.0, the built-in `node:test` module is available as a zero-dependency alternative that covers the project's current testing needs.

## Decision
All unit tests MUST use the `node:test` module and `node:assert` for assertions. No external test framework (Jest, Vitest, Mocha, etc.) SHOULD be installed for unit testing.

### Test Structure
- Test files MUST be TypeScript source files located in `test/` with the naming convention `*.test.ts`
- Tests MUST be compiled via `tsc -p tsconfig.test.json` before execution
- Tests MUST be runnable via `npm test`, which executes `tsc -p tsconfig.test.json && node --test dist/test/*.test.js`
- Individual compiled test files MUST be runnable via `node --test dist/test/<file>.test.js`

### Current Test Coverage
Five test files MUST exist:

| File | Coverage |
|------|----------|
| `test/auth.test.ts` | PIN hashing, PIN verification, rate limiting (threshold and lockout), token generation |
| `test/clipboard.test.ts` | Clipboard tool detection, unsupported MIME type rejection |
| `test/config.test.ts` | Config loading, default merging, missing file error, save format, default values |
| `test/sessions.test.ts` | Session create/list/get/kill/resize/write lifecycle, PTY spawning with real processes |
| `test/service.test.ts` | Platform detection, service path resolution, service file generation (plist/systemd) |

### Test Isolation
- `auth.test.ts` MUST call the `_resetForTesting()` export from `auth.ts` before each test to get fresh rate-limit state
- `sessions.test.ts` MUST clean up spawned PTY processes in `afterEach` hooks to prevent resource leaks
- `config.test.ts` MUST use temporary directories and clean up files between tests

### Future E2E Testing
- Playwright is installed as a dev dependency for future browser-level end-to-end tests
- E2E tests SHOULD be kept separate from unit tests and are not yet implemented

## Consequences

### Positive
- Zero additional test dependencies for unit tests; `node:test` ships with Node.js
- Test output integrates with Node.js TAP reporter and CI environments natively
- Tests run fast with no framework startup overhead
- Developers familiar with Node.js do not need to learn framework-specific APIs

### Negative
- `node:test` has fewer convenience features than Jest (no built-in mocking library, no snapshot testing, no parallel test file execution by default)
- No watch mode out of the box (Jest provides `--watch` for iterative development)
- Test compilation step adds latency to the test cycle (compile before run)

### Risks
- If test complexity grows (e.g., requiring extensive mocking of node-pty or Express middleware), the lack of a built-in mocking library may become a friction point that warrants reconsideration
