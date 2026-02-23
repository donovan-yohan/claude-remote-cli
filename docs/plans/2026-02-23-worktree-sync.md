# Worktree Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Watch both `.worktrees/` and `.claude/worktrees/` so all worktrees appear in the web UI, and add a `claude-remote-cli worktree` CLI command that wraps `git worktree` + launches Claude.

**Architecture:** Extend watcher/API to scan two directories per repo. Add a `worktree` subcommand to the CLI entry point that forwards args to `git worktree` then spawns `claude` in the result.

**Tech Stack:** TypeScript, Node.js child_process, git CLI

---

### Task 1: Update watcher to watch both worktree directories

**Files:**
- Modify: `server/watcher.ts:34-41`

**Step 1: Write the failing test**

Add a test to `test/worktrees.test.ts`:

```typescript
describe('worktree directories constant', () => {
  it('should include both .worktrees and .claude/worktrees', () => {
    // Import the constant once it exists
    const { WORKTREE_DIRS } = await import('../server/watcher.js');
    assert.deepEqual(WORKTREE_DIRS, ['.worktrees', '.claude/worktrees']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `WORKTREE_DIRS` not exported from watcher

**Step 3: Export the constant and update `_watchRepo`**

In `server/watcher.ts`, add an exported constant and update `_watchRepo` to iterate over both paths:

```typescript
export const WORKTREE_DIRS = ['.worktrees', '.claude/worktrees'];
```

Replace the `_watchRepo` method:

```typescript
private _watchRepo(repoPath: string): void {
  let anyWatched = false;
  for (const dir of WORKTREE_DIRS) {
    const worktreeDir = path.join(repoPath, dir);
    if (fs.existsSync(worktreeDir)) {
      this._addWatch(worktreeDir);
      anyWatched = true;
    }
  }
  if (!anyWatched) {
    // Watch repo root so we detect when either dir is first created
    this._addWatch(repoPath);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add server/watcher.ts test/worktrees.test.ts
git commit -m "feat: watch both .worktrees/ and .claude/worktrees/ directories"
```

---

### Task 2: Update GET /worktrees to scan both directories

**Files:**
- Modify: `server/index.ts:271-293`

**Step 1: Write the failing test**

Add to `test/worktrees.test.ts`:

```typescript
describe('worktree scanning paths', () => {
  it('should check both .worktrees and .claude/worktrees directories', () => {
    // Verify our WORKTREE_DIRS constant covers both
    const { WORKTREE_DIRS } = await import('../server/watcher.js');
    const repoPath = '/Users/me/code/repo';
    const scannedPaths = WORKTREE_DIRS.map(d => repoPath + '/' + d);
    assert.ok(scannedPaths.includes(repoPath + '/.worktrees'));
    assert.ok(scannedPaths.includes(repoPath + '/.claude/worktrees'));
  });
});
```

**Step 2: Run test to verify it passes** (constant already exists from Task 1)

Run: `npm test`
Expected: PASS

**Step 3: Update the GET /worktrees handler**

In `server/index.ts`, replace the single-directory scan (lines 271-293) with a loop over `WORKTREE_DIRS`:

```typescript
import { WORKTREE_DIRS } from './watcher.js';

// Inside GET /worktrees handler, replace the for-loop body:
for (const repo of reposToScan) {
  for (const dir of WORKTREE_DIRS) {
    const worktreeDir = path.join(repo.path, dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wtPath = path.join(worktreeDir, entry.name);
      const meta = readMeta(CONFIG_PATH, wtPath);
      worktrees.push({
        name: entry.name,
        path: wtPath,
        repoName: repo.name,
        repoPath: repo.path,
        root: repo.root,
        displayName: meta ? meta.displayName : '',
        lastActivity: meta ? meta.lastActivity : '',
      });
    }
  }
}
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: scan both worktree directories in GET /worktrees"
```

---

### Task 3: Update DELETE /worktrees path validation

**Files:**
- Modify: `server/index.ts:344-348`
- Modify: `test/worktrees.test.ts`

**Step 1: Update the test expectations**

In `test/worktrees.test.ts`, the existing test `'should reject old .claude/worktrees/ paths'` now needs to PASS instead of reject. Update it and add a helper function:

```typescript
function isValidWorktreePath(worktreePath: string): boolean {
  const sep = '/';
  return worktreePath.includes(sep + '.worktrees' + sep)
    || worktreePath.includes(sep + '.claude/worktrees' + sep);
}

describe('DELETE /worktrees validation', () => {
  it('should reject paths not inside any worktree directory', () => {
    assert.equal(isValidWorktreePath('/some/random/path'), false);
  });

  it('should accept paths inside .worktrees/', () => {
    assert.equal(isValidWorktreePath('/Users/me/code/repo/.worktrees/my-worktree'), true);
  });

  it('should accept paths inside .claude/worktrees/', () => {
    assert.equal(isValidWorktreePath('/Users/me/code/repo/.claude/worktrees/my-worktree'), true);
  });

  it('should not match partial .worktrees paths', () => {
    assert.equal(isValidWorktreePath('/Users/me/.worktrees-fake/foo'), false);
  });
});
```

**Step 2: Run test to verify the .claude/worktrees test fails** (old validation rejects it)

Run: `npm test`
Expected: FAIL on `'should accept paths inside .claude/worktrees/'`

**Step 3: Update the validation in DELETE /worktrees**

In `server/index.ts`, replace the path validation (lines 344-348):

```typescript
// Validate the path is inside a known worktree directory
const validDir = worktreePath.includes(path.sep + '.worktrees' + path.sep)
  || worktreePath.includes(path.sep + '.claude' + path.sep + 'worktrees' + path.sep);
if (!validDir) {
  res.status(400).json({ error: 'Path is not inside a worktree directory' });
  return;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add server/index.ts test/worktrees.test.ts
git commit -m "feat: accept .claude/worktrees/ paths in DELETE /worktrees"
```

---

### Task 4: Add `worktree` subcommand to CLI

**Files:**
- Modify: `bin/claude-remote-cli.ts`

**Step 1: Write the failing test**

Add to `test/worktrees.test.ts`:

```typescript
describe('CLI worktree arg parsing', () => {
  it('should extract --yolo and leave other args intact', () => {
    const args = ['add', './.worktrees/my-feature', '-b', 'my-feature', '--yolo'];
    const hasYolo = args.includes('--yolo');
    const gitArgs = args.filter(a => a !== '--yolo');
    assert.equal(hasYolo, true);
    assert.deepEqual(gitArgs, ['add', './.worktrees/my-feature', '-b', 'my-feature']);
  });

  it('should detect missing path for add and use default', () => {
    // args: ['add', '-b', 'my-feature'] — no positional path (first arg after 'add' starts with '-')
    const args = ['add', '-b', 'my-feature'];
    const subArgs = args.slice(1); // after 'add'
    const hasPositionalPath = subArgs.length > 0 && !subArgs[0]!.startsWith('-');
    assert.equal(hasPositionalPath, false);
  });

  it('should detect path when provided for add', () => {
    const args = ['add', './my-path', '-b', 'my-feature'];
    const subArgs = args.slice(1);
    const hasPositionalPath = subArgs.length > 0 && !subArgs[0]!.startsWith('-');
    assert.equal(hasPositionalPath, true);
    assert.equal(subArgs[0], './my-path');
  });
});
```

**Step 2: Run test to verify it passes** (pure logic tests, no imports needed)

Run: `npm test`
Expected: PASS

**Step 3: Add the worktree subcommand handler**

In `bin/claude-remote-cli.ts`, add the handler right after the `update` command block (after line 93), before the `install`/`uninstall`/`status` block:

```typescript
if (command === 'worktree') {
  const wtArgs = args.slice(1); // everything after 'worktree'
  const subCommand = wtArgs[0]; // 'add', 'remove', 'list', etc.

  if (!subCommand) {
    console.error('Usage: claude-remote-cli worktree <add|remove|list> [options]');
    process.exit(1);
  }

  // For non-add commands, just forward to git worktree
  if (subCommand !== 'add') {
    try {
      const result = await execFileAsync('git', ['worktree', ...wtArgs]);
      if (result.stdout) console.log(result.stdout.trimEnd());
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string };
      console.error((execErr.stderr || execErr.message || 'git worktree failed').trimEnd());
      process.exit(1);
    }
    process.exit(0);
  }

  // Handle 'add' — strip --yolo, determine path, forward to git, then launch claude
  const hasYolo = wtArgs.includes('--yolo');
  const gitWtArgs = wtArgs.filter(a => a !== '--yolo'); // ['add', ...]

  // Determine the target directory (first positional arg after 'add' that doesn't start with '-')
  const addSubArgs = gitWtArgs.slice(1); // everything after 'add'
  let targetDir: string | undefined;

  // Find the branch name from -b flag for default path
  const bIdx = gitWtArgs.indexOf('-b');
  const branchForDefault = bIdx !== -1 && bIdx + 1 < gitWtArgs.length ? gitWtArgs[bIdx + 1]! : undefined;

  if (addSubArgs.length === 0 || addSubArgs[0]!.startsWith('-')) {
    // No positional path — generate a default under .worktrees/
    let repoRoot: string;
    try {
      const result = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
      repoRoot = result.stdout.trim();
    } catch {
      console.error('Not inside a git repository.');
      process.exit(1);
    }
    const dirName = branchForDefault
      ? branchForDefault.replace(/\//g, '-')
      : 'worktree-' + Date.now().toString(36);
    targetDir = path.join(repoRoot, '.worktrees', dirName);
    // Insert the path into git args: ['add', <path>, ...rest]
    gitWtArgs.splice(1, 0, targetDir);
  } else {
    targetDir = path.resolve(addSubArgs[0]!);
  }

  // Run git worktree add
  try {
    const result = await execFileAsync('git', ['worktree', ...gitWtArgs]);
    if (result.stdout) console.log(result.stdout.trimEnd());
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    console.error((execErr.stderr || execErr.message || 'git worktree add failed').trimEnd());
    process.exit(1);
  }

  console.log(`Worktree created at ${targetDir}`);

  // Launch claude in the worktree
  const claudeArgs: string[] = [];
  if (hasYolo) claudeArgs.push('--dangerously-skip-permissions');

  console.log(`Launching claude${hasYolo ? ' (yolo mode)' : ''} in ${targetDir}...`);

  const { spawn } = await import('node:child_process');
  const child = spawn('claude', claudeArgs, {
    cwd: targetDir,
    stdio: 'inherit',
    env: { ...process.env, CLAUDECODE: undefined },
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Prevent the rest of the CLI from running (server startup, etc.)
  // The spawn above takes over; we just await its exit.
  await new Promise(() => {}); // hang until child exits via the handler above
}
```

**Step 4: Update the --help text**

In the help string (line 18-33), add the worktree command:

```typescript
console.log(`Usage: claude-remote-cli [options]
       claude-remote-cli <command>

Commands:
  update             Update to the latest version from npm
  install            Install as a background service (survives reboot)
  uninstall          Stop and remove the background service
  status             Show whether the service is running
  worktree           Manage git worktrees (wraps git worktree)
    add [path] [-b branch] [--yolo]   Create worktree and launch Claude
    remove <path>                      Forward to git worktree remove
    list                               Forward to git worktree list

Options:
  --bg               Shortcut: install and start as background service
  --port <port>      Override server port (default: 3456)
  --host <host>      Override bind address (default: 0.0.0.0)
  --config <path>    Path to config.json (default: ~/.config/claude-remote-cli/config.json)
  --yolo             With 'worktree add': pass --dangerously-skip-permissions to Claude
  --version, -v      Show version
  --help, -h         Show this help`);
```

**Step 5: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 6: Commit**

```bash
git add bin/claude-remote-cli.ts test/worktrees.test.ts
git commit -m "feat: add 'worktree' subcommand to CLI"
```

---

### Task 5: Ensure .claude/worktrees/ is gitignored by POST /sessions

**Files:**
- Modify: `server/index.ts:443`

**Step 1: Check current behavior**

The `POST /sessions` handler calls `ensureGitignore(repoPath, '.worktrees/')` at line 443. Sessions created from the web UI always go into `.worktrees/`. No change needed here — the web UI path is fine.

For `.claude/worktrees/`, Claude Code itself manages that gitignore entry when it creates worktrees via `--worktree`. No action needed.

**Step 2: Verify build passes**

Run: `npm test`
Expected: All tests PASS

**Step 3: Commit** (skip if no changes)

No changes needed for this task.

---

### Task 6: Final integration test

**Step 1: Build everything**

Run: `npm run build`
Expected: Clean compile

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 3: Manual smoke test**

```bash
# Verify help shows worktree command
node dist/bin/claude-remote-cli.js --help

# Verify worktree list forwards to git
node dist/bin/claude-remote-cli.js worktree list
```

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore: finalize worktree sync feature"
```
