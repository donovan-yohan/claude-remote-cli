# ADR-008: TypeScript + ESM Migration

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
The project was written in plain JavaScript with CommonJS modules (`require` / `module.exports`). As the codebase grew, the lack of static type checking led to subtle bugs that were only caught at runtime. IDE support (autocompletion, refactoring, go-to-definition) was limited without type information. Migrating to TypeScript with ESM provides compile-time error detection, better tooling support, and alignment with the modern Node.js ecosystem.

## Decision

### Module Format
- The project MUST use ESM (`"type": "module"` in `package.json`)
- All `require()` / `module.exports` MUST be replaced with `import` / `export`
- All relative imports MUST use `.js` extensions (NodeNext module resolution convention)
- Node.js built-in modules MUST use the `node:` prefix (e.g., `import fs from 'node:fs'`)
- `__dirname` / `__filename` MUST be replaced with `fileURLToPath(import.meta.url)` + `path.dirname()`

### TypeScript Configuration
- TypeScript compilation via `tsc` to `dist/` directory
- Target: `ES2024`, Module: `NodeNext`, Module Resolution: `NodeNext`
- Full strict mode: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- Source files remain in `server/`, `bin/`, `test/`; compiled output goes to `dist/`

### Shared Types
- Shared interfaces MUST live in `server/types.ts`
- Module-local types SHOULD stay in their own file

### Node.js Version
- Minimum Node.js version is `>=24.0.0` (up from `>=20.0.0`)
- An `.nvmrc` file specifies the target Node version

### Frontend
- The `public/` frontend MUST remain unchanged as ES5 vanilla JavaScript (per ADR-002)
- No TypeScript or build step for frontend code

### Test Isolation
- The `require.cache` busting pattern in auth tests MUST be replaced with a `_resetForTesting()` export that clears module-level state

## Consequences

### Positive
- Compile-time type checking catches errors before runtime
- IDE autocompletion and refactoring work across the entire codebase
- ESM aligns with the Node.js ecosystem direction and enables top-level `await`
- Strict TypeScript options (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) prevent common null/undefined bugs
- Shared `types.ts` provides a single source of truth for data shapes

### Negative
- Added build step (`tsc`) before running or testing; no more direct `node server/index.js`
- Developers must install TypeScript tooling and understand `.js` extension convention in imports
- `dist/` directory adds a layer of indirection when debugging (source maps help but add complexity)

### Risks
- If a dependency lacks TypeScript types, `@types/*` packages or manual declarations may be needed
- The `exactOptionalPropertyTypes` flag may require verbose type assertions when working with partial objects from JSON parsing
