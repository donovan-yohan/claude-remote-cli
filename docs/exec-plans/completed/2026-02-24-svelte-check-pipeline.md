# Svelte Check Pipeline Implementation Plan

> **Status**: Completed | **Created**: 2026-02-24 | **Last Updated**: 2026-02-24
> **For Claude:** Use /harness:orchestrate to execute this plan.

**Goal:** Add `svelte-check` to build/test pipeline so type errors in `.svelte` files are caught at build time and in CI.

**Architecture:** Wire the existing `svelte-check` devDependency into npm scripts, tighten frontend tsconfig to match server strictness, update quality docs.

**Tech Stack:** svelte-check v4.4.3 (already installed), TypeScript strict mode

---

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-24 | Design | svelte-check only, no ESLint | Keep it simple, svelte-check catches the class of bug we hit |
| 2026-02-24 | Design | Add to both build and test scripts | CI runs both; ensures no merge without checks |
| 2026-02-24 | Design | Match server tsconfig strictness flags | Consistency across frontend and server |

## Progress

- [x] Task 1: Tighten frontend/tsconfig.json
- [x] Task 2: Wire svelte-check into npm scripts
- [x] Task 3: Update docs/QUALITY.md
- [x] Task 4: Verify — build and test pass, 7 type errors fixed

## Surprises & Discoveries

_None yet._

## Plan Drift

_None yet._

---

### Task 1: Tighten frontend/tsconfig.json

**Files:**
- Modify: `frontend/tsconfig.json`

**Step 1: Add strict flags**

Add `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, and `skipLibCheck` to compilerOptions:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "vite.config.ts"]
}
```

**Step 2: Run svelte-check to verify no new errors**

Run: `npx svelte-check --root frontend`
Expected: Warnings OK, no errors. Fix any errors before proceeding.

### Task 2: Wire svelte-check into npm scripts

**Files:**
- Modify: `package.json` (scripts section)

**Step 1: Update scripts**

```json
"scripts": {
  "check": "tsc --noEmit && svelte-check --root frontend",
  "check:svelte": "svelte-check --root frontend",
  "build": "tsc && svelte-check --root frontend && vite build --config frontend/vite.config.ts",
  "build:server": "tsc",
  "build:frontend": "svelte-check --root frontend && vite build --config frontend/vite.config.ts",
  "dev": "vite --config frontend/vite.config.ts",
  "start": "tsc && svelte-check --root frontend && vite build --config frontend/vite.config.ts && node dist/server/index.js",
  "test": "svelte-check --root frontend && tsc -p tsconfig.test.json && node --test dist/test/*.test.js",
  "prepublishOnly": "npm run build",
  "postinstall": "chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true"
}
```

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: tsc passes, svelte-check passes, vite build succeeds.

**Step 3: Verify test succeeds**

Run: `npm test`
Expected: svelte-check passes, tsc passes, all 61 tests pass.

### Task 3: Update docs/QUALITY.md

**Files:**
- Modify: `docs/QUALITY.md`

Add svelte-check documentation to the Commands section and a new Type Checking section.

### Task 4: Verify svelte-check catches errors

**Step 1: Introduce a deliberate type error in a .svelte file**

Temporarily add `undeclaredVar = 'test';` to a component, run `npm run check`, confirm it fails.

**Step 2: Revert the deliberate error**

Remove the test line, run `npm run check` again, confirm it passes.

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
