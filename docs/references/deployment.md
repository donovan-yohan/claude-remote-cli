# Deployment & Publishing

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for release workflow guidance.

## Branch Model

| Branch | Purpose | Protection | npm tag |
|--------|---------|------------|---------|
| `master` | Stable releases only | PR required, no force push, no deletion, admin bypass | `latest` |
| `nightly` | Active development (default branch) | None | `nightly` |

PRs target `nightly` by default. Stable releases are promoted from `nightly` to `master` via PR.

## Install Channels

```bash
# Stable (recommended)
npm install -g claude-remote-cli

# Nightly (latest dev build)
npm install -g claude-remote-cli@nightly
```

## Three Release Paths

### 1. Normal Development (nightly)

Feature branches merge into `nightly`. Every push to `nightly` auto-publishes a nightly build.

```
feature-branch → PR → nightly → auto-publish as nightly
```

Nightly versions are stamped automatically: `3.18.1-nightly.20260328.42`

### 2. Stable Release

Promote `nightly` to `master` when ready for a stable release.

```bash
# Create a PR from nightly → master
gh pr create --base master --head nightly --title "Release v3.19.0"

# After PR is merged, tag the release on master
git checkout master && git pull
npm version <patch|minor|major>
git push && git push --tags     # CI publishes to npm @latest
```

### 3. Hotfix (skip nightly)

For critical bugfixes that need to ship immediately without going through nightly.

```bash
# Branch off master
git checkout master && git pull
git checkout -b hotfix/fix-description

# Fix, commit, push, PR directly to master
gh pr create --base master

# After merge, tag the release
git checkout master && git pull
npm version patch
git push && git push --tags     # CI publishes to npm @latest

# Sync the fix back to nightly
git checkout nightly && git pull
git merge master
git push
```

## What CI Does

### Stable (`publish.yml`)

Triggers on `v*` tag push. Verifies the tag is on `master`, then:

1. Checks out the tagged commit
2. Verifies tag is on `master` branch (fails otherwise)
3. Sets up Node.js from `.nvmrc`
4. Installs dependencies with `npm ci`
5. Builds and runs tests
6. Publishes with `npm publish --provenance --access public` (tag: `latest`)

### Nightly (`publish-nightly.yml`)

Triggers on every push to `nightly`:

1. Checks out the commit
2. Sets up Node.js from `.nvmrc`
3. Installs dependencies with `npm ci`
4. Stamps a prerelease version: `<base>-nightly.YYYYMMDD.<run>`
5. Builds and runs tests
6. Publishes with `npm publish --provenance --access public --tag nightly`

### CI Setup (one-time)

1. Create a GitHub environment called `release` in the repo (Settings > Environments)
2. On npmjs.com, configure **trusted publishing** for `claude-remote-cli` with:
   - Workflow filename: `publish.yml` (for stable)
   - Workflow filename: `publish-nightly.yml` (for nightly)
   - Environment name: `release`

## Pre-Release Checklist (stable only)

1. All tests pass: `npm test`
2. Build succeeds: `npm run build`
3. No uncommitted changes: `git status` is clean
4. Create PR from `nightly` to `master` and merge
5. Tag on `master` with `npm version`
6. `files` field in `package.json` includes all needed directories

## What Gets Published

Controlled by the `files` field in `package.json`:

- `dist/bin/` -- Compiled CLI entry point
- `dist/server/` -- Compiled server modules
- `dist/frontend/` -- Frontend SPA

TypeScript source, test files, docs, and local config are excluded from the published package.

## Verifying a Release

```bash
npm pack --dry-run                            # preview what will be included
npm info claude-remote-cli                    # check stable version
npm info claude-remote-cli dist-tags          # check all dist-tags (latest, nightly)
npm install -g claude-remote-cli@nightly      # test nightly install
```
