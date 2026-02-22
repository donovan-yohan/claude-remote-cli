# Deployment & Publishing

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for release workflow guidance.

## Version Bumping

Use `npm version <type>` to bump the version in `package.json`, create a git tag, and commit:

```bash
npm version patch   # 0.2.0 → 0.2.1  — bug fixes, typos, dependency updates
npm version minor   # 0.2.0 → 0.3.0  — new features, backwards-compatible additions
npm version major   # 0.2.0 → 1.0.0  — breaking changes (CLI flags, config format, API)
```

`npm version` automatically:
1. Updates `version` in `package.json`
2. Creates a git commit: `vX.Y.Z`
3. Creates a git tag: `vX.Y.Z`

## Publishing to npm

Publishing is automated via GitHub Actions. When you push a version tag, CI runs tests and publishes to npm.

```bash
npm test                      # verify all tests pass locally
npm version <type>            # bump version (see above)
git push && git push --tags   # push commit + tag → CI publishes
```

The workflow (`.github/workflows/publish.yml`) runs on every `v*` tag push:
1. Checks out the tagged commit
2. Installs dependencies with `npm ci`
3. Runs `npm test`
4. Publishes with `npm publish --provenance`

### CI Setup (one-time)

1. Create a GitHub environment called `release` in the repo (Settings → Environments)
2. On npmjs.com, configure **trusted publishing** for `claude-remote-cli` with:
   - Workflow filename: `publish.yml`
   - Environment name: `release`

## When to Use Each Version Type

| Type | When | Examples |
|------|------|---------|
| `patch` | Bug fixes, documentation corrections, dependency patches | Fix scrollback overflow, fix PIN reset, update express |
| `minor` | New features that don't break existing usage | Add background service, add new CLI flag, add API endpoint |
| `major` | Breaking changes to CLI, config, or API | Rename CLI flags, change config schema, remove endpoints |

## Pre-Publish Checklist

1. All tests pass: `npm test`
2. CLI syntax valid: `node -c bin/claude-remote-cli.js`
3. No uncommitted changes: `git status` is clean
4. README reflects current features and help output
5. `files` field in `package.json` includes all needed directories

## What Gets Published

Controlled by the `files` field in `package.json`:

- `bin/` — CLI entry point
- `server/` — All server modules
- `public/` — Frontend SPA + vendor libs
- `config.example.json`

Test files, docs, and config are excluded from the published package.

## Verifying a Publish

```bash
npm pack --dry-run        # preview what will be included
npm info claude-remote-cli   # check published version on registry
```
