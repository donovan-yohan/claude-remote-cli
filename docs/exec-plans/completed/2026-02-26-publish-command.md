# /publish Slash Command Implementation Plan

> **Status**: Completed | **Created**: 2026-02-26 | **Completed**: 2026-02-26
> **Design Doc**: `docs/design-docs/2026-02-26-publish-command-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-26 | Design | Feature branch only — refuse to run on master | Enforces feature-branch-to-master flow; direct master versioning uses `npm version` |
| 2026-02-26 | Design | Analyze commits + confirm for version type | Auto-suggests from conventional commits but human confirms; version bumps are consequential |
| 2026-02-26 | Design | PR approval OR commit-message review evidence | Pragmatic for solo dev using Claude Code reviews; doesn't require formal GitHub approval |
| 2026-02-26 | Design | Reflect + explicit README check for docs | Reflect covers tier 2/3 docs; README is user-facing and needs explicit attention |
| 2026-02-26 | Design | No GitHub Releases or changelog | Tags + npm publish via CI is sufficient; YAGNI |
| 2026-02-26 | Design | Branch cleanup after merge | Keeps local and remote tidy automatically |
| 2026-02-26 | Design | Single markdown file, no TypeScript | Structured prompt template that Claude executes interactively |
| 2026-02-26 | Implementation | Add `.gitignore` exception for `.claude/commands/` | Repo ignores `.claude/` but slash commands need to be versioned |
| 2026-02-26 | Retrospective | Plan completed | 8/8 tasks, 1 surprise (gitignore), 1 drift (task batching) |

## Progress

- [x] Task 1: Directory setup + command skeleton _(completed 2026-02-26)_
- [x] Task 2: Pre-flight checks (Step 1) _(completed 2026-02-26)_
- [x] Task 3: Code review gate (Step 2) _(completed 2026-02-26)_
- [x] Task 4: Documentation review (Step 3) + commit stragglers (Step 4) _(completed 2026-02-26)_
- [x] Task 5: Merge to master (Step 5) _(completed 2026-02-26)_
- [x] Task 6: Version bump analysis (Step 6) _(completed 2026-02-26)_
- [x] Task 7: Tag, push, and branch cleanup (Steps 7-8) _(completed 2026-02-26)_
- [x] Task 8: Manual validation _(completed 2026-02-26)_

## Surprises & Discoveries

| Date | What | Impact | Resolution |
|------|------|--------|------------|
| 2026-02-26 | `.gitignore` blocks `.claude/` directory | Cannot commit `.claude/commands/publish.md` | Added `!.claude/commands/` exception to `.gitignore`; also refined ignore to `!.claude/settings.json` per worker |

## Plan Drift

| Task | Plan said | Actually did | Why |
|------|-----------|--------------|-----|
| 1-7 | 7 sequential tasks with individual commits | Batched into single worker, single commit | All tasks write sections of one file; batching eliminated overhead of 7 sequential agent dispatches |

---

# /publish Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `.claude/commands/publish.md` slash command that orchestrates the full release lifecycle from a feature branch: review gate, docs update, commit, merge to master, version bump, tag, push, and branch cleanup.

**Architecture:** A single markdown prompt template that Claude Code executes interactively. No TypeScript modules, no server changes, no dependencies. The command uses existing tools (`git`, `gh`, `npm`, `/harness:reflect`) and asks for user confirmation at every destructive step.

**Tech Stack:** Markdown prompt template, git, gh CLI, npm, `/harness:reflect` skill

---

### Task 1: Directory setup + command skeleton

**Files:**
- Create: `.claude/commands/publish.md`

**Step 1: Create directory structure**

```bash
mkdir -p .claude/commands
```

**Step 2: Write the command skeleton with preamble and abort pattern**

Create `.claude/commands/publish.md` with the overall structure — the intro paragraph, the 8-step outline, the abort/error handling instructions, and placeholder sections for each step.

```markdown
# /publish — Release from feature branch to production

You are executing an interactive release workflow. Follow each step in order. At every gate or destructive action, ask the user to confirm before proceeding. If the user says "abort" at any point, stop immediately and report what has already been done so the user knows the current state.

## Overview

This command orchestrates:
1. Pre-flight checks
2. Code review gate
3. Documentation review
4. Commit pending changes
5. Merge to master
6. Version bump (analyze → suggest → confirm)
7. Tag and push
8. Branch cleanup

Report each step as **"Step N/8: {name}"** before starting it.

---

<!-- Steps 1-8 will be added in subsequent tasks -->
```

**Step 3: Verify the file exists and is readable**

```bash
cat .claude/commands/publish.md | head -5
```

Expected: The first 5 lines of the skeleton file.

**Step 4: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: scaffold /publish command skeleton"
```

---

### Task 2: Pre-flight checks (Step 1)

**Files:**
- Modify: `.claude/commands/publish.md`

**Step 1: Add Step 1 section to publish.md**

Append below the `---` after the overview. This step verifies the branch, working tree, tests, and remote state.

```markdown
## Step 1/8: Pre-flight checks

Run these checks in order. If any fail, report the failure and stop.

1. **Verify branch:** Run `git branch --show-current`. If the result is `master`, refuse to continue — tell the user: "You're already on master. Use `npm version <type>` directly for versioning." and stop.

2. **Save the branch name** for use in later steps. Refer to it as `<branch>` throughout.

3. **Check working tree:** Run `git status --porcelain`. If there are uncommitted changes, tell the user what's dirty and ask: "Commit these changes now, stash them, or abort?" Act on their choice.

4. **Run tests:** Run `npm test`. If tests fail, show the output and stop. Do not proceed with a failing test suite.

5. **Fetch remote:** Run `git fetch origin` to ensure refs are current.

Report: "Pre-flight checks passed. On branch `<branch>`."
```

**Step 2: Verify the section was added correctly**

Read `.claude/commands/publish.md` and confirm the Step 1 section is present and properly formatted.

**Step 3: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: add pre-flight checks to /publish command"
```

---

### Task 3: Code review gate (Step 2)

**Files:**
- Modify: `.claude/commands/publish.md`

**Step 1: Add Step 2 section to publish.md**

Append after Step 1. This step checks for review approval before allowing the release to proceed.

```markdown
## Step 2/8: Code review gate

Check for evidence that this branch's changes have been reviewed:

1. **Check GitHub PR:** Run `gh pr view --json reviews,state` for the current branch.
   - If a PR exists with at least one `APPROVED` review, report "PR approved by {reviewer}" and proceed.
   - If `gh` fails or no PR exists, continue to step 2.

2. **Check commit messages:** Run `git log master..<branch> --oneline` and scan for messages containing "code review", "review findings", or "address review" (case-insensitive).
   - If found, report "Review evidence found in commit history" and proceed.

3. **No review found:** Warn the user:
   > ⚠️ No code review approval or review evidence found for this branch.
   > Proceed without review? (yes/abort)

   If the user says "abort", stop and report current state. Only proceed on explicit "yes".
```

**Step 2: Verify the section was added correctly**

Read `.claude/commands/publish.md` and confirm Step 2 follows Step 1.

**Step 3: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: add code review gate to /publish command"
```

---

### Task 4: Documentation review (Step 3) + commit stragglers (Step 4)

**Files:**
- Modify: `.claude/commands/publish.md`

**Step 1: Add Steps 3 and 4 to publish.md**

These two steps are closely related — review docs, then commit any resulting changes.

```markdown
## Step 3/8: Documentation review

1. **Run reflect:** Execute `/harness:reflect` to check tier 2/3 documentation against recent changes. Report any findings to the user.

2. **Check README:** Run `git diff master..<branch> -- README.md` to see if README was already updated.
   - Then review the branch changes (`git diff master..<branch> --stat`) for new CLI flags, config changes, or user-facing features.
   - If the branch adds user-facing changes that README doesn't mention, propose specific README updates and ask the user to approve or skip.
   - If approved, apply the changes.

3. **Commit doc changes:** If any documentation was updated in this step, commit them:
   ```
   git add -A
   git commit -m "docs: update documentation for release"
   ```

Report what was reviewed and any changes made.

## Step 4/8: Commit stragglers

Check for any remaining uncommitted changes:

1. Run `git status --porcelain`.
2. If there are unstaged or uncommitted changes, show them to the user and ask: "Commit these remaining changes before merge? (yes/abort)"
3. If yes, stage and commit:
   ```
   git add -A
   git commit -m "chore: pre-release cleanup"
   ```
4. If no changes, report "Working tree clean, ready to merge."
```

**Step 2: Verify both sections were added correctly**

Read `.claude/commands/publish.md` and confirm Steps 3 and 4 follow Step 2.

**Step 3: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: add documentation review and commit steps to /publish command"
```

---

### Task 5: Merge to master (Step 5)

**Files:**
- Modify: `.claude/commands/publish.md`

**Step 1: Add Step 5 section to publish.md**

This is a destructive operation — merge the feature branch into master.

```markdown
## Step 5/8: Merge to master

This is a destructive operation. Confirm before proceeding.

1. Show the user what will be merged:
   ```
   git log master..<branch> --oneline
   ```
   Ask: "Merge these commits to master? (yes/abort)"

2. If confirmed, switch to master and pull:
   ```
   git checkout master
   git pull origin master
   ```

3. Attempt fast-forward merge first:
   ```
   git merge --ff-only <branch>
   ```

4. If fast-forward fails, fall back to merge commit:
   ```
   git merge <branch>
   ```

5. If merge conflicts occur, abort the merge and stop:
   ```
   git merge --abort
   ```
   Report: "Merge conflicts detected. Resolve manually, then re-run /publish."
   Stop here — do not continue to Step 6.

Report: "Branch `<branch>` merged to master."
```

**Step 2: Verify the section was added correctly**

Read `.claude/commands/publish.md` and confirm Step 5 follows Step 4.

**Step 3: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: add merge-to-master step to /publish command"
```

---

### Task 6: Version bump analysis (Step 6)

**Files:**
- Modify: `.claude/commands/publish.md`

**Step 1: Add Step 6 section to publish.md**

This step analyzes commits and suggests a version type for the user to confirm.

```markdown
## Step 6/8: Version bump

1. **Find the last version tag:**
   ```
   git describe --tags --abbrev=0 --match "v*" 2>/dev/null
   ```
   If no tags exist, note "No previous version tags found — this will be the first tagged release." Default suggestion will be `patch`.

2. **Analyze commits since last tag** (or all commits if no tag):
   ```
   git log <last-tag>..HEAD --oneline
   ```

3. **Suggest version type** based on conventional commit prefixes:
   - Any commit containing `BREAKING CHANGE` (in message body or footer) → suggest **major**
   - Any commit starting with `feat:` or `feat(` → suggest **minor**
   - Otherwise → suggest **patch**

4. **Present to user:**
   > Commits since last release:
   > {commit list}
   >
   > Suggested version bump: **{type}** ({current} → {next})
   >
   > Accept suggested version type, or specify: major / minor / patch?

5. Wait for user confirmation or override. Use whatever type the user confirms.
```

**Step 2: Verify the section was added correctly**

Read `.claude/commands/publish.md` and confirm Step 6 follows Step 5.

**Step 3: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: add version bump analysis to /publish command"
```

---

### Task 7: Tag, push, and branch cleanup (Steps 7-8)

**Files:**
- Modify: `.claude/commands/publish.md`

**Step 1: Add Steps 7 and 8 to publish.md**

Both are destructive operations with confirmations.

```markdown
## Step 7/8: Tag and push

This is a destructive operation. Confirm before proceeding.

1. Bump version, create commit and tag:
   ```
   npm version <type>
   ```
   This updates `package.json`, creates a commit, and creates a `v{version}` tag.

2. Ask the user: "Push to origin (master + tags)? (yes/abort)"

3. If confirmed:
   ```
   git push origin master
   git push origin --tags
   ```

Report: "Published v{version}. CI will handle npm publish."

## Step 8/8: Branch cleanup

1. Ask the user: "Delete the feature branch `<branch>` locally and on remote? (yes/skip)"

2. If yes:
   ```
   git branch -d <branch>
   git push origin --delete <branch>
   ```
   If the remote delete fails (branch doesn't exist on remote), that's fine — just report it.

3. If skipped, report "Branch `<branch>` kept."

---

## Done

Report a summary:
- Version published: v{version}
- Branch merged: `<branch>` → `master`
- Branch cleanup: deleted / kept
- Next: CI will publish to npm when the tag push triggers the workflow
```

**Step 2: Verify both sections and the closing summary were added correctly**

Read `.claude/commands/publish.md` and confirm the full document is complete with all 8 steps.

**Step 3: Commit**

```bash
git add .claude/commands/publish.md
git commit -m "feat: complete /publish command with tag, push, and cleanup steps"
```

---

### Task 8: Manual validation

**Files:**
- Read: `.claude/commands/publish.md` (full review)

**Step 1: Read the complete command file**

Read `.claude/commands/publish.md` from top to bottom. Verify:

- [ ] Preamble includes abort instructions
- [ ] All 8 steps are present and numbered correctly
- [ ] Steps 1-4 happen before the merge (on feature branch)
- [ ] Steps 5-8 happen after merge (on master)
- [ ] Every destructive action (merge, push, branch delete) has a confirmation prompt
- [ ] The review gate checks both GitHub PR and commit messages
- [ ] Version bump uses conventional commit analysis
- [ ] Error cases are handled (merge conflicts, test failures, already on master)
- [ ] No references to GitHub Releases or changelog (per design: YAGNI)

**Step 2: Dry-run test**

From the current feature branch (`fix/loading-ux`), run `/publish` and verify:
- Step 1 correctly identifies the branch and runs pre-flight
- Step 2 checks for review evidence
- Abort at Step 3 to avoid actually merging (this is a validation, not a real release)

Confirm the command is interactive and prompts at each gate.

**Step 3: Final commit if any adjustments were needed**

If validation revealed issues and fixes were applied:
```bash
git add .claude/commands/publish.md
git commit -m "fix: address /publish command validation findings"
```

---

## Outcomes & Retrospective

**What worked:**
- Single-file scope made implementation fast and predictable
- Batching sequential tasks into one worker eliminated dispatch overhead
- Design doc was detailed enough that implementation was mechanical transcription
- `.gitignore` surprise caught early by worker, resolved cleanly

**What didn't:**
- Nothing significant — clean execution

**Learnings to codify:**
- `.claude/commands/` is now tracked in git; `.gitignore` uses specific subdirectory ignores instead of blanket `.claude/`
- Slash commands convention documented in DESIGN.md
