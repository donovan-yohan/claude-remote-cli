# TypeScript + ESM Migration Design

**Date:** 2026-02-21
**Status:** Approved

## Goal

Migrate claude-remote-cli from plain JavaScript (CommonJS) to TypeScript (ESM) for improved developer experience, faster error detection, and better tooling support.

## Decisions

| Decision | Choice |
|----------|--------|
| Approach | Big bang — all 12 server/bin/test files at once |
| TypeScript execution | `tsc` compile step to `dist/` |
| Module format | ESM (`"type": "module"`) |
| Node version | `>=24.0.0` |
| Strictness | Full strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Frontend | Unchanged — stays ES5 vanilla JS (ADR-002) |
| Types location | Shared interfaces in `server/types.ts`, module-local types stay in their file |
| Tests | `tsconfig.test.json` extends base; compile then `node --test dist/test/*.test.js` |

## Build & Project Setup

**tsconfig.json:**
- `target: "ES2024"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- `outDir: "dist/"`, `rootDir: "."`
- Include: `server/**/*.ts`, `bin/**/*.ts`
- Exclude: `public/`, `test/`, `node_modules/`, `dist/`

**tsconfig.test.json:** Extends base, adds `test/**/*.ts` to include.

**package.json changes:**
- `"type": "module"`
- `engines.node` → `">=24.0.0"`
- `scripts.build` → `"tsc"`
- `scripts.start` → `"tsc && node dist/server/index.js"`
- `scripts.test` → `"tsc -p tsconfig.test.json && node --test dist/test/*.test.js"`
- `bin` → `"dist/bin/claude-remote-cli.js"`
- `files` → `["dist/bin/", "dist/server/", "public/", "config.example.json"]`
- Add devDeps: `typescript`, `@types/express`, `@types/ws`, `@types/bcrypt`, `@types/cookie-parser`, `@types/node`

**Directory structure:**
```
├── bin/claude-remote-cli.ts     (source)
├── server/*.ts                   (source)
├── test/*.test.ts                (source)
├── public/                       (unchanged, plain JS)
├── dist/                         (compiled output, gitignored)
│   ├── bin/claude-remote-cli.js
│   ├── server/*.js
│   └── test/*.test.js
└── tsconfig.json
```

## ESM Migration

- `require()` / `module.exports` → `import` / `export`
- All relative imports use `.js` extension (NodeNext convention)
- `__dirname` / `__filename` → `fileURLToPath(import.meta.url)` + `path.dirname()`
- `require.cache` busting in auth tests → export `_resetForTesting()` function
- Dynamic `require()` in CLI → static `import` at top of file

## Type Definitions

**server/types.ts** (shared interfaces):

```typescript
interface Session {
  id: string;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  pty: IPty;
  createdAt: string;
  lastActivity: string;
  scrollback: string[];
}

interface Config {
  host: string;
  port: number;
  cookieTTL: string;
  repos: string[];
  claudeCommand: string;
  claudeArgs: string[];
  pinHash?: string;
}

interface ServicePaths {
  servicePath: string;
  logDir: string | null;
  label: string;
}

type Platform = 'macos' | 'linux';

interface InstallOpts {
  configPath?: string;
  port?: string;
  host?: string;
}
```

## CLI Entry Point

- Shebang preserved by TypeScript 5.5+ in compiled output
- `__dirname` replaced with `fileURLToPath(import.meta.url)` pattern
- `bin` field in package.json points to `dist/bin/claude-remote-cli.js`

## ADR Updates

- **ADR-001**: Server modules are `.ts`, compiled to `dist/`. Update module list.
- **ADR-005**: Test command includes compilation step. Tests are `.ts` files.
- **ADR-006**: `bin` → `dist/bin/`, `files` → `dist/` paths, `build` step added.
- **ADR-008** (new): Documents TypeScript + ESM migration decision.

## Out of Scope

- `public/` frontend — stays ES5 vanilla JS per ADR-002
- Test framework change — stays `node:test` per ADR-005
- Architectural restructuring — same flat module pattern, just typed
