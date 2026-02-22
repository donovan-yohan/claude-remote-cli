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
- Test files MUST be located in the `test/` directory with the naming convention `*.test.js`
- Tests MUST be runnable via `npm test`, which executes `node --test test/*.test.js`
- Individual test files MUST be runnable in isolation via `node --test test/<file>.test.js`

### Current Test Coverage
Three test files MUST exist:

| File | Coverage |
|------|----------|
| `test/auth.test.js` | PIN hashing, PIN verification, rate limiting (threshold and lockout), token generation |
| `test/config.test.js` | Config loading, default merging, missing file error, save format, default values |
| `test/sessions.test.js` | Session create/list/get/kill/resize lifecycle, PTY spawning with real processes |

### Test Isolation
- `auth.test.js` MUST clear the `require` cache before each test to get fresh module state (fresh rate-limit maps)
- `sessions.test.js` MUST clean up spawned PTY processes in `afterEach` hooks to prevent resource leaks
- `config.test.js` MUST use temporary directories and clean up files between tests

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
- Test isolation for `auth.test.js` requires manual `require` cache clearing, which is a workaround rather than a proper module reset

### Risks
- If test complexity grows (e.g., requiring extensive mocking of node-pty or Express middleware), the lack of a built-in mocking library may become a friction point that warrants reconsideration
