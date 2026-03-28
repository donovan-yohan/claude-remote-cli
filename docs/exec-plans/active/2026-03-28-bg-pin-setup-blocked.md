# Fix: --bg First-Run PIN Gate Blocks Server Startup

> **Status**: Active | **Created**: 2026-03-28 | **Last Updated**: 2026-03-28
> **Bug Analysis**: `docs/bug-analyses/2026-03-28-bg-pin-setup-blocked-bug-analysis.md`
> **Consulted Learnings**: L-20260328-startup-gate-web-setup, L-20260328-service-install-preconditions, L-20260327-express4-async-errors
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-28 | Bug Analysis | Remove non-TTY exit, let server start PIN-less | Web-based PinGate UI + POST /auth/setup already gate all access; the startup exit predates this flow |
| 2026-03-28 | Bug Analysis | Keep interactive CLI prompt as TTY convenience | Foreground users get faster setup; not the only path |
| 2026-03-28 | Plan | Skip systemic spread fixes (install/update commands) | The server-side fix resolves all paths — install/update don't need their own PIN checks since the service-spawned server will now start successfully |

## Progress

- [ ] Task 1: Remove non-TTY hard exit in server startup
- [ ] Task 2: Add server startup test for PIN-less non-TTY mode
- [ ] Task 3: Update README.md PIN documentation
- [ ] Task 4: Update DESIGN.md auth startup flow

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Remove non-TTY hard exit in server startup

**Files:**
- Modify: `server/index.ts:192-201`

**Goal:** Replace the hard `process.exit(1)` for non-TTY PIN-less startup with a log message, allowing the server to continue and serve the web-based PIN setup UI.

- [ ] **Step 1: Modify the PIN gate logic**

Replace the current block at `server/index.ts:192-201`:

```typescript
  if (!startupConfig.pinHash) {
    if (!process.stdin.isTTY) {
      console.error('No PIN configured. Run claude-remote-cli interactively first to set a PIN.');
      process.exit(1);
    }
    const pin = await promptPin('Set up a PIN for claude-remote-cli:');
    startupConfig.pinHash = await auth.hashPin(pin);
    saveConfig(CONFIG_PATH, startupConfig);
    console.log('PIN set successfully.');
  }
```

With:

```typescript
  if (!startupConfig.pinHash) {
    if (process.stdin.isTTY) {
      const pin = await promptPin('Set up a PIN for claude-remote-cli:');
      startupConfig.pinHash = await auth.hashPin(pin);
      saveConfig(CONFIG_PATH, startupConfig);
      console.log('PIN set successfully.');
    } else {
      console.log(`No PIN configured. Open http://localhost:${startupConfig.port} to set one.`);
    }
  }
```

Key changes:
- Flip the TTY check: `if (process.stdin.isTTY)` prompts interactively; `else` logs and continues
- Remove `process.exit(1)` — server proceeds to bind the HTTP port
- Log message includes the port so background service users know where to go

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no type errors.

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (this change only affects the startup flow, not any tested module).

---

### Task 2: Add server startup test for PIN-less non-TTY mode

**Files:**
- Create: `test/server-startup.test.ts`

**Goal:** Verify the server starts and serves `GET /auth/status` when no PIN is configured and stdin is not a TTY. This is an integration test that spawns the server as a child process.

- [ ] **Step 1: Write the test file**

Create `test/server-startup.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

test('server starts without PIN in non-TTY mode and serves /auth/status', async () => {
  // Create a temporary config with no pinHash
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-remote-test-'));
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ port: 0, host: '127.0.0.1' }));

  const serverScript = path.resolve(import.meta.dirname, '..', 'dist', 'server', 'index.js');

  // Spawn server as a non-TTY child process
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      CLAUDE_REMOTE_CONFIG: configPath,
      CLAUDE_REMOTE_PORT: '0', // Let OS pick a free port
    },
    stdio: ['pipe', 'pipe', 'pipe'], // non-TTY
  });

  try {
    // Wait for the server to print the listening port
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server did not start within 10s')), 10_000);
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/listening on .*:(\d+)/i) || text.match(/port\s+(\d+)/i);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}. stderr: ${stderr}`));
      });
    });

    // Hit GET /auth/status
    const res = await fetch(`http://127.0.0.1:${port}/auth/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as { hasPIN: boolean };
    assert.equal(body.hasPIN, false, 'Server should report no PIN configured');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Build and run the test**

Run: `npm run build && node --test dist/test/server-startup.test.js`

Expected: Test passes — server starts in non-TTY mode without a PIN, `GET /auth/status` returns `{ hasPIN: false }`.

**Note:** This test spawns a real server process. It uses port 0 (OS-assigned) to avoid conflicts. The test may need adjustment based on the exact log message format the server uses when it starts listening — check `server/index.ts` for the listen callback message and update the regex in the port-detection logic if needed.

---

### Task 3: Update README.md PIN documentation

**Files:**
- Modify: `README.md`

**Goal:** Document the web-based PIN setup flow, the `pin reset` subcommand, and simplify the first-time getting-started flow so `--bg` can be the very first command.

- [ ] **Step 1: Update the Getting Started section**

Replace the current "Getting Started" steps 2-4 in `README.md` (lines 22-52):

**Current:**
```markdown
### 2. Start the server

\`\`\`bash
claude-remote-cli
\`\`\`

On first launch you'll be prompted to set a PIN. This PIN protects access to your Claude sessions.

Open `http://localhost:3456` in your browser and enter your PIN.

### 3. Add your project directories
...

### 4. Run as a background service (recommended)
...
```

**Replace with:**
```markdown
### 2. Start the server

\`\`\`bash
claude-remote-cli --bg
\`\`\`

This installs a persistent background service (launchd on macOS, systemd on Linux) that starts on login and restarts on crash. See [Background Service](#background-service) for more options.

Or run in the foreground:

\`\`\`bash
claude-remote-cli
\`\`\`

### 3. Set your PIN

Open `http://localhost:3456` in your browser. On first visit, you'll be prompted to create a PIN that protects access to your Claude sessions.

If you started the server in the foreground, you'll be prompted to set a PIN in the terminal instead.

### 4. Add your project directories
```

Key changes:
- Lead with `--bg` as the primary start method (it now works on first run)
- Separate PIN setup into its own step that covers both web and CLI flows
- Remove the assumption that users must run interactively first

- [ ] **Step 2: Update the PIN Management section**

Replace the current PIN Management section in `README.md` (lines 151-157):

**Current:**
```markdown
### PIN Management

The PIN hash is stored in config under `pinHash`. To reset:

1. Delete the `pinHash` field from your config file
2. Restart the server
3. You'll be prompted to set a new PIN
```

**Replace with:**
```markdown
### PIN Management

The PIN hash is stored in config under `pinHash`.

**Reset via CLI** (recommended):

\`\`\`bash
claude-remote-cli pin reset
\`\`\`

This requires an interactive terminal. You'll be asked to verify your current PIN (if set), then enter a new one.

**Reset manually:**

1. Delete the `pinHash` field from `~/.config/claude-remote-cli/config.json`
2. Restart the server (`claude-remote-cli uninstall && claude-remote-cli --bg`)
3. Open the web UI and set a new PIN
```

- [ ] **Step 3: Update the CLI Usage block**

Add the `pin` subcommand to the CLI Usage block at line 83. After the `worktree` entries, add:

```
  pin                Manage authentication PIN
    reset              Reset the PIN (interactive, requires TTY)
```

- [ ] **Step 4: Verify README renders correctly**

Visually scan the README for broken markdown (unclosed code blocks, misaligned tables, orphaned headings).

---

### Task 4: Update DESIGN.md auth startup flow

**Files:**
- Modify: `docs/DESIGN.md:11`

**Goal:** Document the auth/PIN startup flow so future developers understand the dual-path PIN setup (CLI prompt for TTY, web UI for non-TTY/background).

- [ ] **Step 1: Update the Key Decisions table**

In `docs/DESIGN.md`, replace the `bcrypt + cookie tokens` row (line 11):

**Current:**
```markdown
| bcrypt + cookie tokens | Simple, secure auth without external dependencies | ADR-004 |
```

**Replace with:**
```markdown
| scrypt + cookie tokens | PIN hashed with scrypt (migrated from bcrypt), cookie-based session auth, rate limiting | ADR-004 |
| Dual-path PIN setup | TTY: interactive CLI prompt at startup. Non-TTY (background service): server starts PIN-less, PinGate frontend gates all access until PIN set via `POST /auth/setup` | Bug fix 2026-03-28 |
```

- [ ] **Step 2: Build to verify no docs-related issues**

Run: `npm run build && npm test`
Expected: All tests pass. This task only modifies docs.

---

## Deliverable Traceability

| Bug Analysis Deliverable | Plan Task |
|-------------------------|-----------|
| Remove non-TTY hard exit in server/index.ts:193-196 | Task 1 |
| Keep interactive CLI prompt as TTY convenience | Task 1 (preserved in else branch) |
| Update README: web-based PIN setup flow | Task 3 Step 1 |
| Update README: `pin reset` subcommand | Task 3 Step 2-3 |
| Update README: simplified first-time flow (--bg first) | Task 3 Step 1 |
| Integration test for PIN-less startup | Task 2 |
| Update DESIGN.md auth flow | Task 4 |

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
