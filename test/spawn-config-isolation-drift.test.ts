import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type Finding = { file: string; line: number; message: string };

function listTestFiles(root: string): string[] {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'e2e') continue;
        if (entry.name === 'manual') continue;
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.test.ts')) continue;
      out.push(full);
    }
  }
  return out.sort();
}

function isHubOrCliSpawnTarget(line: string): boolean {
  return (
    line.includes('dist/server/index.js') ||
    line.includes('dist/bin/relay-ide.js') ||
    line.includes('dist/bin/relay-ide.js') ||
    // common fixture constant name
    /\bSERVER_SCRIPT\b/.test(line)
  );
}

function looksLikeChildProcessCall(line: string): boolean {
  // Avoid false positives on local method names like `spawn(command, args)`.
  return (
    /\bspawn\s*\(\s*(process\.execPath|SERVER_SCRIPT|['"]node['"])/.test(
      line
    ) ||
    /\bexecFile(?:Sync)?\s*\(\s*(process\.execPath|['"]node['"])/.test(line) ||
    /\bexecSync\s*\(\s*['"]node['"]/.test(line)
  );
}

function snippetHasSafeEnv(snippet: string): boolean {
  // Negative-lane fixture tests intentionally delete config env; drift guard
  // should not fight the harness' own assertions.
  if (snippet.includes('E2E_FIXTURE_ENV_VAR')) return true;
  // Either inherit parent env explicitly, or set at least one isolation var.
  // This is intentionally simple: the goal is to prevent tests from drifting
  // into ad-hoc child env objects that omit config isolation entirely.
  if (!snippet.includes('env:')) return false;
  if (snippet.includes('...process.env')) return true;
  return (
    snippet.includes('RELAY_IDE_CONFIG') ||
    snippet.includes('CONFIG_PATH_ENV_VAR') ||
    snippet.includes('XDG_CONFIG_HOME')
  );
}

describe('spawn config isolation drift guard (#1587)', () => {
  it('flags hub/CLI child spawns that do not pass an isolated env', () => {
    const testRoot = path.resolve(import.meta.dirname);
    const files = listTestFiles(testRoot);
    const findings: Finding[] = [];

    for (const file of files) {
      const rel = path.relative(path.resolve(testRoot, '..'), file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!isHubOrCliSpawnTarget(line)) continue;

        // Find the closest child-process call above this reference.
        let callLine = -1;
        for (let j = i; j >= 0 && j >= i - 40; j--) {
          if (looksLikeChildProcessCall(lines[j] ?? '')) {
            callLine = j;
            break;
          }
        }
        if (callLine === -1) continue;

        const snippet = lines
          .slice(
            Math.max(0, callLine - 40),
            Math.min(callLine + 80, lines.length)
          )
          .join('\n');
        if (!snippetHasSafeEnv(snippet)) {
          findings.push({
            file: rel,
            line: callLine + 1,
            message:
              'hub/CLI spawn must pass env with RELAY_IDE_CONFIG/XDG_CONFIG_HOME or inherit ...process.env',
          });
        }
      }
    }

    if (findings.length > 0) {
      const rendered = findings
        .map((f) => `${f.file}:${f.line} ${f.message}`)
        .join('\n');
      expect(rendered).toBe('');
    }
  });
});
