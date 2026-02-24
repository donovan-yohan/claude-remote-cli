# Deployment & Publishing

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for release workflow guidance.

## Release Flow

Publishing is fully automated via GitHub Actions. To release a new version:

1. Bump the version and create a tag
2. Push to `master` with the tag
3. CI runs tests and publishes to npm

```bash
npm test                      # verify tests pass locally
npm version <type>            # bump version, commit, and tag
git push && git push --tags   # push to master → CI publishes
```

That's it. The GitHub Actions workflow (`.github/workflows/publish.yml`) triggers on any `v*` tag push and handles the rest.

## Version Bumping

Use `npm version <type>` to bump the version in `package.json`, create a git commit, and create a git tag:

```bash
npm version patch   # 1.2.0 → 1.2.1  — bug fixes, typos, dependency updates
npm version minor   # 1.2.0 → 1.3.0  — new features, backwards-compatible additions
npm version major   # 1.2.0 → 2.0.0  — breaking changes (CLI flags, config format, API)
```

| Type | When | Examples |
|------|------|---------|
| `patch` | Bug fixes, documentation corrections, dependency patches | Fix scrollback overflow, fix PIN reset, update express |
| `minor` | New features that don't break existing usage | Add background service, add new CLI flag, add API endpoint |
| `major` | Breaking changes to CLI, config, or API | Rename CLI flags, change config schema, remove endpoints |

## What CI Does

The workflow (`.github/workflows/publish.yml`) runs on every `v*` tag push:

1. Checks out the tagged commit
2. Sets up Node.js from `.nvmrc`
3. Installs dependencies with `npm ci`
4. Runs `npm test`
5. Publishes with `npm publish --provenance --access public`

### CI Setup (one-time)

1. Create a GitHub environment called `release` in the repo (Settings → Environments)
2. On npmjs.com, configure **trusted publishing** for `claude-remote-cli` with:
   - Workflow filename: `publish.yml`
   - Environment name: `release`

## Pre-Release Checklist

1. All tests pass: `npm test`
2. Build succeeds: `npm run build`
3. No uncommitted changes: `git status` is clean
4. You are on `master` — tags must be pushed from the main branch
5. `files` field in `package.json` includes all needed directories

## What Gets Published

Controlled by the `files` field in `package.json`:

- `dist/bin/` — Compiled CLI entry point
- `dist/server/` — Compiled server modules
- `public/` — Frontend SPA + vendor libs
- `config.example.json`

TypeScript source, test files, docs, and local config are excluded from the published package.

## Verifying a Release

```bash
npm pack --dry-run           # preview what will be included
npm info claude-remote-cli   # check published version on registry
```
