# Testing

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed testing guidance.

## Test Runner

Uses Node.js built-in `node:test` module. No external test framework.

```bash
npm test                          # Run all tests
node --test test/auth.test.js     # Run a single test file
```

## Test Files

| File | Covers |
|------|--------|
| `test/auth.test.js` | PIN hashing, verification, rate limiting |
| `test/config.test.js` | Config loading/saving |
| `test/sessions.test.js` | PTY spawning, session lifecycle |

## E2E Testing

Playwright is installed as a dev dependency but no E2E test files exist yet.

```bash
npx playwright test               # Would run E2E tests
```
