# /publish Slash Command

**Created:** 2026-02-26

## Problem

The release workflow is manual and error-prone: bump version, push tags, hope you didn't forget to review docs or check for code review. No single entry point for shipping from a feature branch to production.

## Design

### Overview

A `.claude/commands/publish.md` slash command that orchestrates the full release lifecycle from a feature branch: review gate, docs update, commit, merge to master, version bump, tag, push, and branch cleanup. Runs interactively with user confirmations at key gates.

### Flow

```
1. Pre-flight checks
2. Code review gate
3. Documentation review (reflect + README)
4. Commit pending changes
5. Merge to master
6. Version bump (analyze → suggest → confirm)
7. Tag and push
8. Branch cleanup
```

### Step Details

**Step 1 — Pre-flight:**
- Verify on a feature branch (not `master`)
- Verify working tree is clean (or prompt to commit/stash)
- Run `npm test` to verify everything passes
- `git fetch` to ensure remote is current

**Step 2 — Review gate:**
- Check `gh pr view --json reviews` for an approved review on the current branch
- If no PR approval, scan commit messages for review evidence (messages containing "code review", "review findings", "address review")
- If neither found, warn user and require explicit "proceed anyway" confirmation or abort

**Step 3 — Documentation:**
- Run `/harness:reflect` to check tier 2/3 docs against recent changes
- Diff README.md against branch changes — check if new CLI flags, config changes, or user-facing features were added that README doesn't mention
- If README needs updates, propose changes and apply with user approval
- Commit any doc changes with `docs:` prefix

**Step 4 — Commit stragglers:**
- If any unstaged/uncommitted changes remain after Step 3, commit them

**Step 5 — Merge to master:**
- `git checkout master && git pull`
- Attempt fast-forward: `git merge --ff-only <branch>`
- If fast-forward fails, fall back to `git merge <branch>` (merge commit)
- If merge conflicts, abort with clear instructions to resolve manually

**Step 6 — Version bump:**
- Parse commits between last `v*` tag and HEAD using conventional commit prefixes
- Suggestion logic: any `BREAKING CHANGE` → major, any `feat:` → minor, otherwise → patch
- Present commit summary + suggested version type to user for confirmation or override
- If no previous tags exist, default to `patch` and note it's the first tagged release

**Step 7 — Tag and push:**
- `npm version <type>` (bumps package.json, commits, creates tag)
- `git push && git push --tags`
- Report: "Published v{version}. CI will handle npm publish."

**Step 8 — Branch cleanup:**
- Delete local feature branch: `git branch -d <branch>`
- Delete remote feature branch: `git push origin --delete <branch>`

### Error Handling

- Every confirmation prompt includes an "abort" option
- If aborted, report what was already done so the user knows the state
- Already on master → refuse to run (use `npm version` directly)
- No previous tags → default to `patch` suggestion
- Merge conflicts → abort with resolution instructions
- CI failure after push → out of scope; user monitors as usual

### Implementation

Single markdown file: `.claude/commands/publish.md`. A structured prompt template that Claude executes interactively. No TypeScript, no server modules, no new dependencies.

**Conventions:**
- Each step starts with "Step N/8: {name}"
- Gate steps (review, version confirm) require explicit user input
- All destructive operations (merge, tag, push, branch delete) get "Proceed? (y/n)" confirmation
- Doc changes committed before merge so they're included in the release
- Uses existing tools: `git`, `gh`, `npm`, `/harness:reflect`

**What it does NOT do:**
- No GitHub Releases or changelog files
- No npm publish (CI handles that via tag push)

## Decisions

- **Feature branch only:** Enforces the feature-branch-to-master flow; direct master versioning uses `npm version`
- **Analyze + confirm for version type:** Auto-suggests from commits but human confirms; version bumps are consequential
- **PR approval OR review evidence:** Pragmatic for solo dev using Claude Code reviews; doesn't require formal GitHub approval
- **Reflect + README check:** Reflect covers tier 2/3 docs; README is user-facing and needs explicit attention
- **No GitHub Releases:** Tags + npm publish via CI is sufficient; YAGNI
- **Branch cleanup after merge:** Keeps local and remote tidy automatically
