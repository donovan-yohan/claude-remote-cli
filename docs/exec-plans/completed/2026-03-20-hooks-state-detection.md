# Hooks-Based Session State Detection

> **Status**: Completed | **Created**: 2026-03-20 | **Last Updated**: 2026-03-20
> **Design Doc**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/donovanyohan-nanga-parbat-design-20260320-162105.md`
> **CEO Plan**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/ceo-plans/2026-03-20-hooks-based-state-detection.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-20 | Design | HTTP hooks via --settings for state detection | Deterministic signals vs fragile regex parsing |
| 2026-03-20 | Design | claude -p for branch rename (not slug) | AI-generated descriptive names, triggered by UserPromptSubmit hook |
| 2026-03-20 | CEO | 6 cherry-picks accepted (SELECTIVE EXPANSION) | Activity context, deprecation logging, push triggers, ws cleanup, version check, agent guard |
| 2026-03-20 | Eng | 30s reconciliation timeout | Parser safety net when hooks go quiet |
| 2026-03-20 | Eng | Single retry on rename failure | Catch transient claude -p failures |
| 2026-03-20 | Eng | 5mb body limit on hooks router | PostToolUse payloads can be large |
| 2026-03-20 | Eng | Restored tmux sessions use parser | Known limitation — can't inject --settings into tmux attach |
| 2026-03-20 | Eng | Drop PostToolUse → keep both + limit | User chose belt-and-suspenders |

## Progress

- [x] Task 0: BLOCKER — Verify --settings flag _(passed: Claude Code 2.1.80 supports --settings)_
- [x] Task 1: Shared utilities extraction (utils.ts) _(completed)_
- [x] Task 2: Type system updates (types.ts + config.ts) _(completed)_
- [x] Task 3: Hook settings generation (pty-handler.ts) _(completed)_
- [x] Task 4: Hooks Express Router (hooks.ts) _(completed)_
- [x] Task 5: State arbitration + reconciliation (sessions.ts + pty-handler.ts) _(completed)_
- [x] Task 6: ws.ts cleanup (remove rename infra) _(completed)_
- [x] Task 7: Server wiring (index.ts) _(completed)_
- [x] Task 8: Push notification triggers _(completed — dedup added)_
- [x] Task 9: Tests (hooks.test.ts) _(completed — 21 new tests, 235 total pass)_
- [x] Task 10: Documentation updates _(completed — ARCHITECTURE, DESIGN, QUALITY updated)_

## Surprises & Discoveries

- Tasks 1, 2, 6 ran in parallel successfully; tasks 3+5 and 4 ran in parallel. Some intermediate type conflicts from parallel edits resolved quickly.
- `exactOptionalPropertyTypes: true` in the frontend tsconfig caused several type mismatches requiring `| undefined` handling on optional properties.
- The `sessions.create()` port/forceOutputParser threading was solved via a `configure()` function pattern (module-level defaults) rather than modifying all 5 call sites.

## Plan Drift

- Added `configure()` function to `sessions.ts` for module-level port/forceOutputParser defaults — not in original plan but cleaner than threading params through all 5 create() call sites.
- `fireStateChange` was both `export function` declared and in the export block — resolved by removing from export block since inline export suffices.

---

### Task 0: BLOCKER — Verify --settings flag

**Prerequisite:** Must pass before any other task begins.

**Steps:**

1. Run `claude --version` to get installed Claude Code version. Record the version.
2. Create a test settings file at `/tmp/hooks-test.json`:
   ```json
   { "hooks": { "Stop": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:9999/test-hook", "timeout": 5 }] }] } }
   ```
3. Run `claude --settings /tmp/hooks-test.json --help` (or a minimal invocation) to confirm:
   - (a) The `--settings` flag is recognized (no "unknown flag" error)
   - (b) The flag accepts a JSON file path
4. Test merge behavior: Run `claude --settings /tmp/hooks-test.json` in a session that has existing hooks configured. Verify `/hooks` command shows BOTH the test hook and existing hooks.
5. Record the minimum Claude Code version that supports `--settings` as a constant: `MIN_CLAUDE_HOOKS_VERSION`.
6. Clean up: `rm /tmp/hooks-test.json`

**If --settings doesn't work:** STOP the loop. Revisit injection strategy (settings.local.json fallback).

**Verify:** The --settings flag is accepted and hooks merge with existing settings.

---

### Task 1: Shared utilities extraction

**Files:** `server/utils.ts` (new), `server/output-parsers/claude-parser.ts` (modify), `server/index.ts` (modify)

Extract shared utilities to avoid DRY violations across hooks.ts, claude-parser.ts, and index.ts.

**Steps:**

1. Create `server/utils.ts`:
   ```typescript
   // ANSI escape sequence regex — shared by claude-parser.ts and hooks.ts
   export const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b\[\?[0-9;]*[hlm]|\x1b\[[0-9]*[ABCDJKH]/g;

   export function stripAnsi(text: string): string {
     return text.replace(ANSI_RE, '');
   }

   export function semverLessThan(a: string, b: string): boolean {
     const parse = (v: string) => v.split('-')[0].split('.').map(Number);
     const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
     const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
     if (aMaj !== bMaj) return aMaj < bMaj;
     if (aMin !== bMin) return aMin < bMin;
     return aPat < bPat;
   }

   /** Returns a copy of process.env with CLAUDECODE stripped (prevents nesting issues) */
   export function cleanEnv(): Record<string, string> {
     const env = Object.assign({}, process.env) as Record<string, string>;
     delete env.CLAUDECODE;
     return env;
   }
   ```

2. Update `server/output-parsers/claude-parser.ts`:
   - Remove the local `ANSI_RE` constant
   - Import `{ ANSI_RE }` from `../utils.js`

3. Update `server/index.ts`:
   - Remove the local `semverLessThan` function (lines 59-66)
   - Import `{ semverLessThan }` from `./utils.js`

**Verify:** `npm run build` compiles. `npm test` passes (existing output-parser tests + version tests still work).

---

### Task 2: Type system + config updates

**Files:** `server/types.ts` (modify), `server/config.ts` (modify)

Add hook-related fields to PtySession, SessionSummary, and Config.

**Steps:**

1. Update `PtySession` interface in `server/types.ts`:
   ```typescript
   // Add to PtySession interface (after outputParser field):
   hookToken: string;
   hooksActive: boolean;
   cleanedUp: boolean;
   currentActivity?: { tool: string; detail?: string } | undefined;
   ```

2. Update `SessionSummary` interface in `server/types.ts`:
   ```typescript
   // Add after agentState field:
   currentActivity?: { tool: string; detail?: string } | undefined;
   ```

3. Update `Config` interface in `server/types.ts`:
   ```typescript
   // Add after debugLog field:
   forceOutputParser?: boolean | undefined;
   ```

4. Update `DEFAULTS` in `server/config.ts` — no change needed (optional field, defaults to undefined/false).

**Verify:** `npm run build` compiles with new fields. Existing tests pass.

---

### Task 3: Hook settings generation in pty-handler.ts

**Files:** `server/pty-handler.ts` (modify)

Generate per-session temp settings JSON file with hook URLs, inject `--settings` flag into Claude spawn args, handle tmux inner args, retry args, and cleanup.

**Steps:**

1. Add imports at top of `server/pty-handler.ts`:
   ```typescript
   import crypto from 'node:crypto';
   import { cleanEnv } from './utils.js';
   ```

2. Add `generateHooksSettings` function:
   ```typescript
   function generateHooksSettings(sessionId: string, port: number, token: string): string {
     const dir = path.join(os.tmpdir(), 'claude-remote-cli', sessionId);
     fs.mkdirSync(dir, { recursive: true });
     const settings = {
       hooks: {
         Stop: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/stop?sessionId=${sessionId}&token=${token}`, timeout: 5 }] }],
         Notification: [
           { matcher: 'permission_prompt', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/notification?sessionId=${sessionId}&token=${token}&type=permission_prompt`, timeout: 5 }] },
           { matcher: 'idle_prompt', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/notification?sessionId=${sessionId}&token=${token}&type=idle_prompt`, timeout: 5 }] },
         ],
         UserPromptSubmit: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/prompt-submit?sessionId=${sessionId}&token=${token}`, timeout: 5 }] }],
         SessionEnd: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/session-end?sessionId=${sessionId}&token=${token}`, timeout: 5 }] }],
         PreToolUse: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/tool-use?sessionId=${sessionId}&token=${token}`, timeout: 5 }] }],
         PostToolUse: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/tool-result?sessionId=${sessionId}&token=${token}`, timeout: 5 }] }],
       },
     };
     const filePath = path.join(dir, 'hooks-settings.json');
     fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
     return filePath;
   }
   ```

3. Add `port` parameter to `CreatePtyParams`:
   ```typescript
   port?: number | undefined;
   forceOutputParser?: boolean | undefined;
   ```

4. In `createPtySession`, before PTY spawn:
   - Generate hook token: `const hookToken = crypto.randomBytes(32).toString('hex');`
   - Guard: only inject hooks for `agent === 'claude'` AND `!forceOutputParser`
   - Try `generateHooksSettings(id, port, hookToken)` — wrap in try/catch, set `hooksActive = false` on failure
   - If successful: append `'--settings', settingsPath` to the spawn args (before tmux wrapping)
   - For tmux: `--settings` goes in the inner claude args (the `args` array passed to `resolveTmuxSpawn`)
   - Set `session.hookToken = hookToken`, `session.hooksActive = true` (or false on failure)
   - Set `session.cleanedUp = false`

5. In the retry spawn path (inside `attachHandlers` → `onExit` → retry block):
   - Include `'--settings', settingsPath` in `retryArgs` (same file path — it persists)

6. In the normal exit cleanup (existing `fs.rm(tmpDir, ...)` call):
   - This already cleans up the temp directory including hooks-settings.json — no change needed

**Verify:** `npm run build` compiles. Manual test: spawn a session with `agent: 'claude'` and verify `/tmp/claude-remote-cli/<id>/hooks-settings.json` exists.

---

### Task 4: Hooks Express Router

**Files:** `server/hooks.ts` (new)

Create the Express Router handling all 6 hook endpoints with IP allowlist, token verification, state updates, branch rename, and push notification triggers.

**Steps:**

1. Create `server/hooks.ts`:
   ```typescript
   import { Router } from 'express';
   import { execFile } from 'node:child_process';
   import { promisify } from 'node:util';
   import type { Session } from './types.js';
   import { stripAnsi, cleanEnv } from './utils.js';
   import { branchToDisplayName } from './git.js';
   import { writeMeta } from './config.js';

   const execFileAsync = promisify(execFile);

   // Hook → AgentState mapping:
   //   UserPromptSubmit → processing (+ branch rename on first msg)
   //   Stop             → idle
   //   Notification     → permission-prompt | waiting-for-input
   //   SessionEnd       → (cleanup)
   //   PreToolUse       → (set currentActivity)
   //   PostToolUse      → (clear currentActivity)
   //
   // Arbitration: hooks primary when hooksActive=true.
   // 30s no-hook timeout → parser reconciliation.

   const DEFAULT_RENAME_PROMPT = 'Output ONLY a short kebab-case git branch name (no explanation, no backticks, no prefix, just the name) that describes this task:';
   const RENAME_RETRY_DELAY_MS = 5000;
   const LOCALHOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

   type HookDeps = {
     getSession: (id: string) => Session | undefined;
     broadcastEvent: (type: string, data?: Record<string, unknown>) => void;
     fireStateChange: (sessionId: string, state: import('./output-parsers/index.js').AgentState) => void;
     notifySessionAttention: (sessionId: string, session: { displayName: string; type: string }) => void;
     configPath?: string;
   };

   export function createHooksRouter(deps: HookDeps): Router {
     const router = Router();

     // Middleware: JSON parsing with 5mb limit for PostToolUse payloads
     router.use(require('express').json({ limit: '5mb' }));

     // Middleware: IP allowlist — localhost only
     router.use((req, res, next) => {
       const addr = req.socket.remoteAddress || '';
       if (!LOCALHOST_ADDRS.has(addr)) {
         res.status(403).json({ error: 'Forbidden — localhost only' });
         return;
       }
       next();
     });

     // Middleware: Token verification
     router.use((req, res, next) => {
       const sessionId = req.query.sessionId as string;
       const token = req.query.token as string;
       if (!sessionId || !token) {
         res.status(400).json({ error: 'Missing sessionId or token' });
         return;
       }
       const session = deps.getSession(sessionId);
       if (!session) {
         res.status(404).json({ error: 'Session not found' });
         return;
       }
       if (session.hookToken !== token) {
         console.warn(`[hooks] Invalid token for session ${sessionId}`);
         res.status(403).json({ error: 'Invalid token' });
         return;
       }
       (req as any)._hookSession = session;
       next();
     });

     // POST /hooks/stop → idle
     router.post('/stop', (req, res) => {
       const session = (req as any)._hookSession as Session;
       updateState(session, 'idle');
       res.status(200).json({ ok: true });
     });

     // POST /hooks/notification → permission-prompt or waiting-for-input
     router.post('/notification', (req, res) => {
       const session = (req as any)._hookSession as Session;
       const type = req.query.type as string;
       if (type === 'permission_prompt') {
         updateState(session, 'permission-prompt');
         deps.notifySessionAttention(session.id, session);
       } else if (type === 'idle_prompt') {
         updateState(session, 'waiting-for-input');
         deps.notifySessionAttention(session.id, session);
       }
       res.status(200).json({ ok: true });
     });

     // POST /hooks/prompt-submit → processing + branch rename
     router.post('/prompt-submit', (req, res) => {
       const session = (req as any)._hookSession as Session;
       updateState(session, 'processing');

       // Branch rename on first message only
       if (session.needsBranchRename) {
         session.needsBranchRename = false; // Immediately, before async work
         const prompt = stripAnsi(req.body?.prompt || '').trim();
         if (prompt) {
           spawnBranchRename(session, prompt);
         }
       }
       res.status(200).json({ ok: true });
     });

     // POST /hooks/session-end → cleanup
     router.post('/session-end', (req, res) => {
       const session = (req as any)._hookSession as Session;
       if (!session.cleanedUp) {
         session.cleanedUp = true;
         // Cleanup handled by PTY onExit — this dedup prevents double cleanup
       }
       res.status(200).json({ ok: true });
     });

     // POST /hooks/tool-use → set currentActivity
     router.post('/tool-use', (req, res) => {
       const session = (req as any)._hookSession as Session;
       const toolName = req.body?.tool_name || 'unknown';
       const toolInput = req.body?.tool_input;
       session.currentActivity = {
         tool: toolName,
         detail: extractToolDetail(toolName, toolInput),
       };
       deps.broadcastEvent('session-activity-changed', {
         sessionId: session.id,
         currentActivity: session.currentActivity,
       });
       res.status(200).json({ ok: true });
     });

     // POST /hooks/tool-result → clear currentActivity
     router.post('/tool-result', (req, res) => {
       const session = (req as any)._hookSession as Session;
       session.currentActivity = undefined;
       deps.broadcastEvent('session-activity-changed', {
         sessionId: session.id,
         currentActivity: null,
       });
       res.status(200).json({ ok: true });
     });

     function updateState(session: Session, state: import('./output-parsers/index.js').AgentState): void {
       if (session.agentState !== state) {
         session.agentState = state;
         deps.fireStateChange(session.id, state);
       }
       // Reset reconciliation timer (tracked in sessions.ts)
       (session as any)._lastHookTime = Date.now();
     }

     function extractToolDetail(toolName: string, toolInput: unknown): string | undefined {
       if (!toolInput || typeof toolInput !== 'object') return undefined;
       const input = toolInput as Record<string, unknown>;
       // File operations: extract path
       if (input.file_path && typeof input.file_path === 'string') return input.file_path;
       if (input.path && typeof input.path === 'string') return input.path;
       // Bash: extract command (truncated)
       if (input.command && typeof input.command === 'string') return (input.command as string).slice(0, 80);
       return undefined;
     }

     async function spawnBranchRename(session: Session, promptText: string): Promise<void> {
       const basePrompt = session.branchRenamePrompt ?? DEFAULT_RENAME_PROMPT;
       const fullPrompt = `${basePrompt}\n\n${promptText.slice(0, 500)}`;
       const env = cleanEnv();

       for (let attempt = 0; attempt < 2; attempt++) {
         try {
           // Check session still exists before each attempt
           if (!deps.getSession(session.id)) return;

           const { stdout } = await execFileAsync('claude', ['-p', '--model', 'haiku', fullPrompt], {
             cwd: session.cwd,
             timeout: 30000,
             env,
           });
           const branchName = stdout.trim()
             .replace(/`/g, '')
             .replace(/[^a-z0-9-]/gi, '-')
             .replace(/-+/g, '-')
             .replace(/^-|-$/g, '')
             .toLowerCase()
             .slice(0, 60);
           if (!branchName) continue; // retry if empty

           // Check session still exists before git operation
           if (!deps.getSession(session.id)) return;

           await execFileAsync('git', ['branch', '-m', branchName], { cwd: session.cwd });

           const displayName = branchToDisplayName(branchName);
           session.branchName = branchName;
           session.displayName = displayName;
           deps.broadcastEvent('session-renamed', {
             sessionId: session.id,
             branchName,
             displayName,
           });

           if (deps.configPath) {
             writeMeta(deps.configPath, {
               worktreePath: session.repoPath,
               displayName,
               lastActivity: new Date().toISOString(),
               branchName,
             });
           }
           return; // Success — exit retry loop
         } catch {
           if (attempt === 0) {
             // Wait before retry
             await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
           } else {
             console.error(`[hooks] Branch rename failed after 2 attempts for session ${session.id}`);
           }
         }
       }
     }

     return router;
   }
   ```

2. Note: The `require('express')` in the router should be replaced with a proper import. Use `import express from 'express';` at the top and `express.json({ limit: '5mb' })`.

**Verify:** `npm run build` compiles. Router exports correctly.

---

### Task 5: State arbitration + reconciliation timeout

**Files:** `server/sessions.ts` (modify), `server/pty-handler.ts` (modify)

Wire `hooksActive` flag into the parser callback to suppress parser-driven state changes. Add 30s reconciliation timeout.

**Steps:**

1. In `server/pty-handler.ts`, in the `proc.onData` handler where the output parser runs (lines 198-203):
   ```typescript
   // Vendor-specific output parsing for semantic state detection
   const parseResult = session.outputParser.onData(data, scrollback.slice(-20));
   if (parseResult && parseResult.state !== session.agentState) {
     if (session.hooksActive) {
       // Hooks are authoritative — check reconciliation timeout
       const lastHook = (session as any)._lastHookTime as number | undefined;
       if (lastHook && Date.now() - lastHook > 30000) {
         // No hook for 30s and parser disagrees — parser overrides
         console.debug(`[hooks] Reconciliation: parser overriding stale hook state for ${session.id}: ${session.agentState} → ${parseResult.state}`);
         session.agentState = parseResult.state;
         for (const cb of stateChangeCallbacks) cb(session.id, parseResult.state);
       } else {
         // Suppress parser — hooks are still fresh
         console.debug(`[hooks] Parser suppressed for ${session.id}: parser=${parseResult.state}, hooks=${session.agentState}`);
       }
     } else {
       // No hooks — parser is primary (current behavior)
       session.agentState = parseResult.state;
       for (const cb of stateChangeCallbacks) cb(session.id, parseResult.state);
     }
   }
   ```

2. In `server/sessions.ts`, update the `list()` function to include `currentActivity`:
   ```typescript
   // Add to the map in list():
   currentActivity: s.currentActivity,
   ```

3. Add deprecation logging in `sessions.ts` — on server start, log hook-active vs parser-only session counts:
   ```typescript
   // Export a function to log deprecation status
   export function logHooksStatus(): void {
     let hooksCount = 0;
     let parserCount = 0;
     for (const s of sessions.values()) {
       if (s.hooksActive) hooksCount++;
       else parserCount++;
     }
     if (parserCount > 0) {
       console.log(`[hooks] ${hooksCount} sessions using hooks, ${parserCount} using output parser fallback`);
     }
   }
   ```

**Verify:** `npm run build`. Manual test: create a session, observe `hooksActive` is set. Parser should be suppressed in logs when hooks are active.

---

### Task 6: ws.ts cleanup

**Files:** `server/ws.ts` (modify)

Remove the branch rename infrastructure that hooks.ts now handles.

**Steps:**

1. Remove `startBranchWatcher` function (~lines 18-53)
2. Remove `spawnBranchRename` function (~lines 56-100)
3. Remove `BRANCH_POLL_INTERVAL_MS` and `BRANCH_POLL_MAX_ATTEMPTS` constants
4. Remove `execFile`, `promisify`, `execFileAsync` imports (no longer needed)
5. Remove `branchToDisplayName` import from `git.js` (no longer needed)
6. Remove `writeMeta` import from `config.js` (no longer needed)
7. In the `ws.on('message')` handler, remove the entire `needsBranchRename` interception block (~lines 221-243). The handler simplifies to just:
   ```typescript
   ws.on('message', (msg) => {
     const str = msg.toString();
     try {
       const parsed = JSON.parse(str);
       if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
         sessions.resize(ptySession.id, parsed.cols, parsed.rows);
         return;
       }
     } catch (_) {}
     ptySession.pty.write(str);
   });
   ```

**Verify:** `npm run build`. `npm test`. The WebSocket message handler should be dramatically simpler. ~95 lines removed.

---

### Task 7: Server wiring in index.ts

**Files:** `server/index.ts` (modify)

Mount the hooks router before auth middleware. Pass dependencies.

**Steps:**

1. Add import: `import { createHooksRouter } from './hooks.js';`

2. After `setupWebSocket` returns `broadcastEvent` (find the existing line), add:
   ```typescript
   // Mount hooks router BEFORE auth middleware — hooks come from localhost Claude Code
   const hooksRouter = createHooksRouter({
     getSession: sessions.get,
     broadcastEvent,
     fireStateChange: (sessionId, state) => {
       // Trigger the same callback chain as output parser
       // (handled by sessions.onStateChange subscribers)
     },
     notifySessionAttention: push.notifySessionIdle,
     configPath: CONFIG_PATH,
   });
   app.use('/hooks', hooksRouter);
   ```

3. Ensure this is placed BEFORE `app.use(requireAuth)` (the auth middleware).

4. Wire `fireStateChange`: Add to `sessions.ts`:
   ```typescript
   export function fireStateChange(sessionId: string, state: AgentState): void {
     for (const cb of stateChangeCallbacks) cb(sessionId, state);
   }
   ```
   Import and pass as `fireStateChange: sessions.fireStateChange` in the hooks deps.

5. Thread `port` to session creation: In `index.ts`, the `config.port` is available. Pass it to `sessions.create()` by adding `port` to `CreateParams` in sessions.ts. Then sessions.ts passes it to `createPtySession()` via `CreatePtyParams`.

5. Pass `port` and `forceOutputParser` config values to session creation calls so `pty-handler.ts` can use them.

**Verify:** `npm run build`. Start server. Verify `/hooks/stop` returns 403 from non-localhost and 400 without params.

---

### Task 8: Push notification triggers

**Files:** `server/hooks.ts` (already created in Task 4)

Push notification triggers are already wired in the hooks.ts Router created in Task 4:
- `notification` handler calls `deps.notifySessionAttention` on `permission_prompt` and `idle_prompt`
- The `notifySessionAttention` dep is bound to `push.notifySessionIdle` in index.ts

This task verifies the wiring and ensures no duplicate notifications:
1. The existing idle-based push notification (`sessions.onIdleChange` → `push.notifySessionIdle`) fires on raw idle (5s no output). With hooks active, the output parser is suppressed, so `onIdleChange` still fires from the raw idle timer. This means BOTH hooks AND idle timer could trigger push.
2. Fix: In `push.notifySessionIdle`, add a dedup check — if the session already has `agentState === 'waiting-for-input'` or `agentState === 'permission-prompt'`, skip the idle-based push (hooks already sent one).

**Verify:** Manual test: verify push notification fires once on permission-prompt, not twice.

---

### Task 9: Tests

**Files:** `test/hooks.test.ts` (new), `test/version.test.ts` (modify)

**Steps:**

1. Create `test/hooks.test.ts` with test cases:
   - **IP allowlist**: 127.0.0.1 passes, ::1 passes, ::ffff:127.0.0.1 passes, external IP → 403
   - **Token verification**: valid token passes, invalid → 403, missing → 400
   - **Stop endpoint**: session state → idle, broadcast fired
   - **Notification**: permission_prompt → permission-prompt state, idle_prompt → waiting-for-input
   - **Prompt-submit**: state → processing; first message with needsBranchRename → rename triggered; second message → no rename
   - **Session-end**: cleanedUp flag prevents double cleanup
   - **Tool-use**: currentActivity set with tool name + detail extraction
   - **Tool-result**: currentActivity cleared
   - **State arbitration**: hooksActive=true → parser suppressed; hooksActive=false → parser drives
   - **Reconciliation timeout**: 30s no-hook → parser can override
   - **Rename retry**: mock execFile to fail first time, succeed second
   - **Agent guard**: codex sessions don't get hook injection

2. Update `test/version.test.ts`:
   - Add test for pre-release version stripping: `semverLessThan('1.2.0-beta.1', '1.2.0')` → false

3. Test approach: use `node:test` with `describe`/`it`. Mock `execFile` for claude -p and git operations. Mock session registry for lookup. Use Express test utilities or direct Router invocation for endpoint tests.

**Verify:** `npm test` — all new tests pass alongside existing 10 test files.

---

### Task 10: Documentation updates

**Files:** `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/QUALITY.md`

**Steps:**

1. **ARCHITECTURE.md**: Add `hooks.ts` to the module table:
   ```
   | `hooks.ts` | Claude Code hook HTTP endpoints: state detection, branch rename, activity tracking. Localhost-only with per-session token auth. |
   ```
   Update module count from "Twelve" to "Thirteen". Add hook data flow diagram. Update REST API table with `/hooks/*` routes.

2. **DESIGN.md**: Add hooks architecture decisions:
   - Hook-based state detection (hooks primary, parser fallback with 30s reconciliation)
   - Branch rename via UserPromptSubmit hook → claude -p
   - `forceOutputParser` config escape hatch
   - Restored tmux session limitation

3. **QUALITY.md**: Add `test/hooks.test.ts` to the test files table.

4. **PLANS.md**: Will be updated in /harness:complete.

**Verify:** Docs are consistent with implementation.

---

## Outcomes & Retrospective

**What worked:**
- Parallel task execution (Tasks 1/2/6, then 3+5/4) maximized throughput — implementation completed in ~30 min
- CEO review + eng review + Codex review caught 50+ issues before any code was written
- The `configure()` pattern for module-level defaults (port, forceOutputParser) was a clean emergent solution
- 30s reconciliation timeout (from eng review) prevents stuck states — a real production safeguard
- ws.ts cleanup removed 120 lines of complex keystroke-capture code with a clean hook-based replacement

**What didn't:**
- `exactOptionalPropertyTypes: true` caused multiple type mismatches that required careful `| undefined` handling — not obvious from the plan
- The plan's code snippets had CJS `require('express')` that needed ESM correction
- `_lastHookTime` was initially untyped (`any` cast) — caught by review, should have been in types.ts from the start
- `cleanedUp` flag was initially dead code — the dedup wiring into PTY exit was missing

**Learnings to codify:**
- When adding optional fields to interfaces with `exactOptionalPropertyTypes: true`, always include `| undefined` in the type
- Module-level `configure()` pattern is cleaner than threading config through many call sites
- Hook payloads can be large (PostToolUse with tool_result) — always set explicit body limits on hook routes
- Timing-safe comparison for any token/secret, even on localhost
