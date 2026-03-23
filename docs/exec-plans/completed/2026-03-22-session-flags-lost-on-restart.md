# Session Flags Lost on Restart — Fix Plan

> **Status**: Complete | **Created**: 2026-03-22 | **Last Updated**: 2026-03-22
> **Bug Analysis**: `docs/bug-analyses/2026-03-22-session-flags-lost-on-restart-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-22 | Design | Store semantic flags (yolo, claudeArgs) not raw args | Raw args include --settings path which is regenerated on restore; semantic flags can be cleanly reconstructed |
| 2026-03-22 | Design | Bump PendingSessionsFile version to 2 with backward compat | Old v1 files should still restore (without flags) — graceful degradation |
| 2026-03-22 | Design | Don't add flags to SessionSummary REST response | Frontend doesn't need to query session flags post-creation; this is a backend persistence concern only |

## Progress

- [x] Task 1: Add yolo and claudeArgs fields to PtySession and CreatePtyParams
- [x] Task 2: Store yolo/claudeArgs on session in createPtySession
- [x] Task 3: Add fields to SerializedPtySession and update serializeAll
- [x] Task 4: Update restoreFromDisk to reconstruct args from saved flags
- [x] Task 5: Pass yolo/claudeArgs through from all route handlers
- [x] Task 6: Add serialize/restore round-trip tests for flags
- [x] Task 7: Build and run full test suite

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Add yolo and claudeArgs fields to PtySession and CreatePtyParams

**Files:**
- Modify: `server/types.ts:49-66` (PtySession interface)
- Modify: `server/pty-handler.ts:60-82` (CreatePtyParams type)

- [ ] **Step 1: Add fields to PtySession**

In `server/types.ts`, add two fields to the `PtySession` interface after line 65 (`currentActivity`):

```ts
  yolo: boolean;
  claudeArgs: string[];
```

- [ ] **Step 2: Add fields to CreatePtyParams**

In `server/pty-handler.ts`, add to `CreatePtyParams` after `forceOutputParser`:

```ts
  yolo?: boolean | undefined;
  claudeArgs?: string[] | undefined;
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: Type errors in `createPtySession` (session object missing new required fields) — confirms the type system caught the gap.

---

### Task 2: Store yolo/claudeArgs on session in createPtySession

**Files:**
- Modify: `server/pty-handler.ts:86-196` (createPtySession function)

- [ ] **Step 1: Destructure new params**

In `server/pty-handler.ts`, add `yolo` and `claudeArgs` to the destructuring at line 93-115:

```ts
    yolo: paramYolo,
    claudeArgs: paramClaudeArgs,
```

- [ ] **Step 2: Store on session object**

In the session object literal (around line 166-196), add after `cleanedUp: false`:

```ts
    yolo: paramYolo ?? false,
    claudeArgs: paramClaudeArgs ?? [],
```

- [ ] **Step 3: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: Clean (no errors) — PtySession now has the fields populated.

---

### Task 3: Add fields to SerializedPtySession and update serializeAll

**Files:**
- Modify: `server/sessions.ts:15-37` (SerializedPtySession, PendingSessionsFile)
- Modify: `server/sessions.ts:275-312` (serializeAll)

- [ ] **Step 1: Add fields to SerializedPtySession**

In `server/sessions.ts`, add to `SerializedPtySession` after `cwd: string`:

```ts
  yolo: boolean;
  claudeArgs: string[];
```

- [ ] **Step 2: Bump PendingSessionsFile version**

In `serializeAll()`, change version from `1` to `2`:

```ts
  const pending: PendingSessionsFile = {
    version: 2,
    timestamp: new Date().toISOString(),
    sessions: serializedPty,
  };
```

- [ ] **Step 3: Write new fields in serializeAll**

In the `serializedPty.push({...})` block, add after `cwd: session.cwd`:

```ts
      yolo: session.yolo,
      claudeArgs: session.claudeArgs,
```

- [ ] **Step 4: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: Clean.

---

### Task 4: Update restoreFromDisk to reconstruct args from saved flags

**Files:**
- Modify: `server/sessions.ts:314-419` (restoreFromDisk)

- [ ] **Step 1: Include saved flags when reconstructing args**

In `restoreFromDisk`, update the three branches that build `args` (around lines 348-375).

For the `customCommand` branch (terminal sessions) — no change needed (terminals don't use agent flags).

For the tmux-alive branch (line 367) — no change needed (attaching to existing tmux, flags already active in the running session).

For the tmux-dead fallback (line 370) and the non-tmux fallback (line 374), change from:

```ts
args = [...AGENT_CONTINUE_ARGS[s.agent]];
```

to:

```ts
args = [
  ...(s.claudeArgs ?? []),
  ...(s.yolo ? AGENT_YOLO_ARGS[s.agent] : []),
  ...AGENT_CONTINUE_ARGS[s.agent],
];
```

- [ ] **Step 2: Pass yolo and claudeArgs through to create()**

In the `createParams` object (lines 378-393), add after `restored: true`:

```ts
        yolo: s.yolo ?? false,
        claudeArgs: s.claudeArgs ?? [],
```

The `?? false` / `?? []` handles backward compatibility with v1 pending files that lack these fields.

- [ ] **Step 3: Import AGENT_YOLO_ARGS**

Verify that `AGENT_YOLO_ARGS` is already imported in `sessions.ts`. Check line 7:

```ts
import { AGENT_COMMANDS, AGENT_CONTINUE_ARGS, AGENT_YOLO_ARGS } from './types.js';
```

It's already imported. No change needed.

- [ ] **Step 4: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: Clean.

---

### Task 5: Pass yolo/claudeArgs through from all route handlers

**Files:**
- Modify: `server/index.ts` (POST /sessions — 3 create calls, POST /sessions/repo, review-poller createSession)

**IMPORTANT:** The `POST /sessions` handler has THREE `sessions.create()` calls — the main one at line 1040, plus two early-return paths at lines 955 (branch in main worktree → repo session) and 986 (branch in another worktree → worktree session). All three must be updated.

- [ ] **Step 1: Update POST /sessions — main create (line 1040)**

Add `yolo` and `claudeArgs` to the `sessions.create()` call at line 1040:

```ts
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
```

- [ ] **Step 2: Update POST /sessions — branch-in-main-worktree path (line 955)**

Add `yolo` and `claudeArgs` to the `sessions.create()` call at line 955 (the `existingWt.isMain` branch):

```ts
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
```

- [ ] **Step 3: Update POST /sessions — branch-in-other-worktree path (line 986)**

Add `yolo` and `claudeArgs` to the `sessions.create()` call at line 986 (the existing worktree redirect):

```ts
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
```

- [ ] **Step 4: Update POST /sessions/repo handler (line 1122)**

Add `yolo` and `claudeArgs` to the `sessions.create()` call at line 1122:

```ts
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
```

- [ ] **Step 5: Update review-poller createSession (line 359)**

In `buildPollerDeps()`, the `sessions.create()` at line 359 already uses `resolved.yolo` and `resolved.claudeArgs` to build the `args` array for PTY spawn. Add the semantic fields for persistence (the `args` field is unchanged — it handles spawn):

```ts
      yolo: resolved.yolo,
      claudeArgs: resolved.claudeArgs,
```

- [ ] **Step 6: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: Clean.

---

### Task 6: Add serialize/restore round-trip tests for flags

**Files:**
- Modify: `test/sessions.test.ts`

- [ ] **Step 0: Update existing version assertion**

The existing test `serializeAll writes pending-sessions.json` at line 586 asserts `pending.version === 1`. Update it to `2`:

```ts
    assert.strictEqual(pending.version, 2);
```

- [ ] **Step 1: Write test for yolo flag preservation**

Add to the `session persistence` describe block:

```ts
  it('serialize/restore preserves yolo flag', async () => {
    const configDir = createTmpDir();

    const s = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/cat',
      args: [],
      yolo: true,
    });

    const session = sessions.get(s.id);
    assert.ok(session);
    assert.strictEqual((session as PtySession).yolo, true);

    serializeAll(configDir);
    sessions.kill(s.id);

    // Verify yolo is in the serialized JSON
    const pending = JSON.parse(fs.readFileSync(path.join(configDir, 'pending-sessions.json'), 'utf-8'));
    assert.strictEqual(pending.version, 2);
    assert.strictEqual(pending.sessions[0].yolo, true);

    await restoreFromDisk(configDir);
    const restored = sessions.get(s.id);
    assert.ok(restored);
    assert.strictEqual((restored as PtySession).yolo, true);
  });
```

- [ ] **Step 2: Write test for claudeArgs preservation**

```ts
  it('serialize/restore preserves claudeArgs', async () => {
    const configDir = createTmpDir();

    const s = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/cat',
      args: [],
      claudeArgs: ['--model', 'opus', '--verbose'],
    });

    const session = sessions.get(s.id);
    assert.ok(session);
    assert.deepStrictEqual((session as PtySession).claudeArgs, ['--model', 'opus', '--verbose']);

    serializeAll(configDir);
    sessions.kill(s.id);

    await restoreFromDisk(configDir);
    const restored = sessions.get(s.id);
    assert.ok(restored);
    assert.deepStrictEqual((restored as PtySession).claudeArgs, ['--model', 'opus', '--verbose']);
  });
```

- [ ] **Step 3: Write test for backward compatibility with v1 pending files**

```ts
  it('restoreFromDisk handles v1 pending files without yolo/claudeArgs', async () => {
    const configDir = createTmpDir();

    // Write a v1 pending file (no yolo/claudeArgs fields)
    const pending = {
      version: 1,
      timestamp: new Date().toISOString(),
      sessions: [{
        id: 'v1-compat-test',
        type: 'worktree' as const,
        agent: 'claude' as const,
        root: '',
        repoName: 'test-repo',
        repoPath: '/tmp',
        worktreeName: 'my-wt',
        branchName: 'my-branch',
        displayName: 'v1-session',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        useTmux: false,
        tmuxSessionName: '',
        customCommand: '/bin/cat',
        cwd: '/tmp',
      }],
    };
    fs.writeFileSync(path.join(configDir, 'pending-sessions.json'), JSON.stringify(pending));

    const restored = await restoreFromDisk(configDir);
    assert.strictEqual(restored, 1);

    const session = sessions.get('v1-compat-test');
    assert.ok(session);
    assert.strictEqual((session as PtySession).yolo, false);
    assert.deepStrictEqual((session as PtySession).claudeArgs, []);
  });
```

- [ ] **Step 4: Run the new tests**

Run: `npm test`
Expected: All tests pass.

---

### Task 7: Build and run full test suite

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All existing and new tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/types.ts server/pty-handler.ts server/sessions.ts server/index.ts test/sessions.test.ts
git commit -m "fix: preserve yolo and claudeArgs flags across auto-update restart

Session creation flags (yolo mode, custom claudeArgs) were consumed once
to spawn the PTY process and never stored on the Session object. This
meant serializeAll/restoreFromDisk could not preserve them — restored
sessions always lost these flags.

Changes:
- Add yolo/claudeArgs fields to PtySession and CreatePtyParams
- Store flags on session object in createPtySession
- Serialize flags in SerializedPtySession (version 2)
- Reconstruct full args (including yolo flags) in restoreFromDisk
- Pass flags through from all route handlers
- Add round-trip tests for flag preservation and v1 backward compat"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Storing semantic flags (yolo, claudeArgs) rather than raw args — clean reconstruction on restore
- Plan reviewer caught 2 blocking issues (missing create() sites, version assertion) before execution
- v1 backward compat via `??` defaults — no migration needed

**What didn't:**
- Nothing significant — focused bug fix with no surprises

**Learnings to codify:**
- L-010 already captured: session creation params must be stored on the session object if they need to survive restarts
