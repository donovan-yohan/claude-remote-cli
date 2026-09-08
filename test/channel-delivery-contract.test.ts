import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  ChannelDeliveryContractParseError,
  parseChannelDeliveryContract,
  parseChannelDeliveryExpectation,
} from '../shared/channel-delivery-contract.js';
import { evaluateDeliveryContract } from '../server/channel-delivery-contract-evaluator.js';

describe('channel delivery contract parsing (#1569)', () => {
  it('parses the supported kinds', () => {
    expect(parseChannelDeliveryExpectation('commit')).toEqual({
      kind: 'commit',
    });
    expect(parseChannelDeliveryExpectation('push')).toEqual({
      kind: 'push',
    });
    expect(parseChannelDeliveryExpectation('pr')).toEqual({ kind: 'pr' });
    expect(parseChannelDeliveryExpectation('pr:feat/x')).toEqual({
      kind: 'pr',
      branch: 'feat/x',
    });
    expect(parseChannelDeliveryExpectation('file:docs/README.md')).toEqual({
      kind: 'file',
      path: 'docs/README.md',
    });
    expect(parseChannelDeliveryExpectation('text:hello')).toEqual({
      kind: 'text',
      regex: 'hello',
    });
  });

  it('rejects unknown kinds and invalid regex', () => {
    expect(() => parseChannelDeliveryExpectation('nope')).toThrow(
      ChannelDeliveryContractParseError
    );
    expect(() => parseChannelDeliveryExpectation('text:(')).toThrow(
      ChannelDeliveryContractParseError
    );
    expect(() => parseChannelDeliveryExpectation('text:(a+)+$')).toThrow(
      ChannelDeliveryContractParseError
    );
    expect(() => parseChannelDeliveryExpectation('text:(a)\\1')).toThrow(
      ChannelDeliveryContractParseError
    );
  });

  it('rejects absolute file paths', () => {
    expect(() => parseChannelDeliveryExpectation('file:/etc/passwd')).toThrow(
      ChannelDeliveryContractParseError
    );
  });

  it('rejects file paths that escape the routing cwd', () => {
    expect(() =>
      parseChannelDeliveryExpectation('file:../../etc/passwd')
    ).toThrow(ChannelDeliveryContractParseError);
  });

  it('parses a full contract and trims specs', () => {
    const contract = parseChannelDeliveryContract([
      ' commit ',
      'file:README.md',
    ]);
    expect(contract?.expect).toEqual(['commit', 'file:README.md']);
    expect(contract?.parsed.map((p) => p.kind)).toEqual(['commit', 'file']);
  });
});

describe('channel delivery contract evaluator (pure; injected probes)', () => {
  it('evaluates unmet items deterministically without touching network', async () => {
    const result = await evaluateDeliveryContract(
      {
        expect: ['commit', 'pr:feat/x', 'file:README.md', 'text:done'],
        cwd: '/tmp/repo',
        finalAssistantText: 'not yet',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/x' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual([
      'commit',
      'pr:feat/x',
      'file:README.md',
      'text:done',
    ]);
    expect(result.unknown).toEqual([]);
  });

  it('reports met when all expectations pass', async () => {
    const result = await evaluateDeliveryContract(
      {
        expect: ['commit', 'pr', 'file:out.txt', 'text:hello'],
        cwd: '/tmp/repo',
        finalAssistantText: 'hello world',
        finalAssistantTextIsClosing: true,
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 1 }),
        },
        pr: {
          hasOpenPrForBranch: async (branch) => ({
            kind: 'ok',
            value: branch === 'feat/y',
          }),
        },
        fs: {
          exists: async (p) => ({ kind: 'ok', value: p === 'out.txt' }),
        },
      }
    );
    expect(result).toEqual({ met: true, unmet: [], unknown: [] });
  });

  it('treats commit as met when HEAD moved past the post-time baseline, even if aheadCount is 0 (#1578)', async () => {
    const baselineHead = 'a'.repeat(40);
    const currentHead = 'b'.repeat(40);
    const result = await evaluateDeliveryContract(
      {
        expect: ['commit'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: baselineHead,
          upstreamSha: 'c'.repeat(40),
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          // Legacy semantics would fail here; baseline semantics should pass.
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          headSha: async () => ({ kind: 'ok', value: currentHead }),
          commitsBetween: async (base, head) => ({
            kind: 'ok',
            value: base === baselineHead && head === currentHead ? 1 : 0,
          }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result).toEqual({ met: true, unmet: [], unknown: [] });
  });

  it('treats commit as unknown when a baseline exists but the delta probe fails (#1578)', async () => {
    const baselineHead = 'a'.repeat(40);
    const currentHead = 'b'.repeat(40);
    const result = await evaluateDeliveryContract(
      {
        expect: ['commit'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: baselineHead,
          upstreamSha: null,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          // Legacy semantics would pass here; baseline semantics must return unknown.
          aheadCount: async () => ({ kind: 'ok', value: 1 }),
          headSha: async () => ({ kind: 'ok', value: currentHead }),
          commitsBetween: async () => ({
            kind: 'unknown',
            reason: 'boom: delta unavailable',
          }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual([]);
    expect(result.unknown).toEqual([
      { spec: 'commit', reason: 'boom: delta unavailable' },
    ]);
  });

  it('treats pr as unmet when the PR existed at baseline and its head did not move (#1578)', async () => {
    const prHead = 'a'.repeat(40);
    const result = await evaluateDeliveryContract(
      {
        expect: ['pr:feat/y'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: 'd'.repeat(40),
          upstreamSha: null,
          prNumber: 123,
          prHeadSha: prHead,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          commitsBetween: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: true }),
          getOpenPrForBranch: async () => ({
            kind: 'ok',
            value: { number: 123, headSha: prHead },
          }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual(['pr:feat/y']);
    expect(result.unknown).toEqual([]);
  });

  it('treats pr as met when the PR head moved past baseline (#1578)', async () => {
    const baselinePrHead = 'a'.repeat(40);
    const currentPrHead = 'b'.repeat(40);
    const result = await evaluateDeliveryContract(
      {
        expect: ['pr'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: 'd'.repeat(40),
          upstreamSha: null,
          prNumber: 123,
          prHeadSha: baselinePrHead,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          commitsBetween: async (base, head) => ({
            kind: 'ok',
            value: base === baselinePrHead && head === currentPrHead ? 2 : 0,
          }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: true }),
          getOpenPrForBranch: async () => ({
            kind: 'ok',
            value: { number: 123, headSha: currentPrHead },
          }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result).toEqual({ met: true, unmet: [], unknown: [] });
  });

  it('treats push as met when the upstream ref moved past baseline (#1578)', async () => {
    const baselineUpstream = 'a'.repeat(40);
    const currentUpstream = 'b'.repeat(40);
    const upstreamRef = 'origin/nightly';
    const result = await evaluateDeliveryContract(
      {
        expect: ['push'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: 'd'.repeat(40),
          upstreamRef,
          upstreamSha: baselineUpstream,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          upstreamRef: async () => ({ kind: 'ok', value: upstreamRef }),
          upstreamSha: async () => ({ kind: 'ok', value: currentUpstream }),
          commitsBetween: async (base, head) => ({
            kind: 'ok',
            value:
              base === baselineUpstream && head === currentUpstream ? 1 : 0,
          }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result).toEqual({ met: true, unmet: [], unknown: [] });
  });

  it('treats push as unmet when the upstream ref did not move past baseline (#1578)', async () => {
    const baselineUpstream = 'a'.repeat(40);
    const currentUpstream = baselineUpstream;
    const upstreamRef = 'origin/nightly';
    const result = await evaluateDeliveryContract(
      {
        expect: ['push'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: 'd'.repeat(40),
          upstreamRef,
          upstreamSha: baselineUpstream,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          upstreamRef: async () => ({ kind: 'ok', value: upstreamRef }),
          upstreamSha: async () => ({ kind: 'ok', value: currentUpstream }),
          commitsBetween: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual(['push']);
    expect(result.unknown).toEqual([]);
  });

  it('treats push as unknown when upstream ref differs from the baseline (#1578)', async () => {
    const baselineUpstream = 'a'.repeat(40);
    const currentUpstream = 'b'.repeat(40);
    const result = await evaluateDeliveryContract(
      {
        expect: ['push'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: 'd'.repeat(40),
          upstreamRef: 'origin/HEAD',
          upstreamSha: baselineUpstream,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          upstreamRef: async () => ({ kind: 'ok', value: 'origin/nightly' }),
          upstreamSha: async () => ({ kind: 'ok', value: currentUpstream }),
          commitsBetween: async () => ({ kind: 'ok', value: 1 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual([]);
    expect(result.unknown).toEqual([expect.objectContaining({ spec: 'push' })]);
  });

  it('treats push as unknown when the baseline upstream ref came from origin/HEAD fallback (#1578)', async () => {
    const baselineUpstream = 'a'.repeat(40);
    const currentUpstream = 'b'.repeat(40);
    const upstreamRef = 'origin/nightly';
    const result = await evaluateDeliveryContract(
      {
        expect: ['push'],
        cwd: '/tmp/repo',
        baseline: {
          headSha: 'd'.repeat(40),
          upstreamRef,
          upstreamRefSource: 'originHead',
          upstreamSha: baselineUpstream,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          upstreamRef: async () => ({ kind: 'ok', value: upstreamRef }),
          upstreamSha: async () => ({ kind: 'ok', value: currentUpstream }),
          commitsBetween: async () => ({ kind: 'ok', value: 1 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual([]);
    expect(result.unknown).toEqual([expect.objectContaining({ spec: 'push' })]);
  });

  it('falls back to legacy semantics when baseline is null (#1578)', async () => {
    const result = await evaluateDeliveryContract(
      {
        expect: ['commit'],
        cwd: '/tmp/repo',
        baseline: null,
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'feat/y' }),
          // Legacy semantics: aheadCount=0 => unmet.
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          // Even if a probe could claim HEAD moved, baseline=null must ignore it.
          headSha: async () => ({ kind: 'ok', value: 'b'.repeat(40) }),
          commitsBetween: async () => ({ kind: 'ok', value: 1 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual(['commit']);
    expect(result.unknown).toEqual([]);
  });

  it('treats a text expectation as unmet when the final prose is not closing (#1585)', async () => {
    const result = await evaluateDeliveryContract(
      {
        expect: ['text:^DONE$'],
        cwd: '/tmp/repo',
        finalAssistantText: 'DONE',
        finalAssistantTextIsClosing: false,
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: null }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.met).toBe(false);
    expect(result.unmet).toEqual(['text:^DONE$']);
    expect(result.unknown).toEqual([]);
  });

  it('matches text expectations against a closing final prose row (#1585)', async () => {
    const result = await evaluateDeliveryContract(
      {
        expect: ['text:^DONE$'],
        cwd: '/tmp/repo',
        finalAssistantText: 'DONE',
        finalAssistantTextIsClosing: true,
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: null }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result).toEqual({ met: true, unmet: [], unknown: [] });
  });

  it('caps text matching at 64KiB', async () => {
    const text = `${'a'.repeat(64 * 1024)}Z`;
    const result = await evaluateDeliveryContract(
      {
        expect: ['text:Z$'],
        cwd: '/tmp/repo',
        finalAssistantText: text,
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: null }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(result.unmet).toEqual(['text:Z$']);
  });

  it('returns promptly for a pathological pattern under the match budget', async () => {
    const start = Date.now();
    const result = await evaluateDeliveryContract(
      {
        expect: ['text:^(a|aa)+$'],
        cwd: '/tmp/repo',
        finalAssistantText: 'a'.repeat(50_000),
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: null }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
        fs: {
          exists: async () => ({ kind: 'ok', value: false }),
        },
      }
    );
    expect(Date.now() - start).toBeLessThan(1000);
    expect(typeof result.met).toBe('boolean');
  });

  it('treats push as met when upstream moved past the post-time baseline (real git; #1578)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-push-met-'));
    const remoteBare = path.join(root, 'remote.git');
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo, { recursive: true });

    execFileSync('git', ['init', '--bare', remoteBare], { cwd: root });
    execFileSync('git', ['init'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repo,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', remoteBare], { cwd: repo });

    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });
    execFileSync('git', ['branch', '-M', 'main'], { cwd: repo });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: repo });

    const baselineUpstreamRef = execFileSync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { cwd: repo, encoding: 'utf8' }
    ).trim();
    const baselineUpstreamSha = execFileSync(
      'git',
      ['rev-parse', '--verify', baselineUpstreamRef],
      { cwd: repo, encoding: 'utf8' }
    ).trim();

    // New commit + push advances upstream.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'push-1'], { cwd: repo });
    execFileSync('git', ['push'], { cwd: repo });

    const result = await evaluateDeliveryContract(
      {
        expect: ['push'],
        cwd: repo,
        baseline: {
          headSha: baselineUpstreamSha,
          upstreamRef: baselineUpstreamRef,
          upstreamRefSource: 'upstream',
          upstreamSha: baselineUpstreamSha,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'main' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          upstreamRef: async () => ({ kind: 'ok', value: baselineUpstreamRef }),
          upstreamSha: async () => ({
            kind: 'ok',
            value: execFileSync('git', ['rev-parse', '--verify', '@{u}'], {
              cwd: repo,
              encoding: 'utf8',
            }).trim(),
          }),
          commitsBetween: async (base, head) => ({
            kind: 'ok',
            value: Number(
              execFileSync('git', ['rev-list', '--count', `${base}..${head}`], {
                cwd: repo,
                encoding: 'utf8',
              }).trim()
            ),
          }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
      }
    );

    expect(result).toEqual({ met: true, unmet: [], unknown: [] });
  });

  it('treats push as unknown when the baseline came from origin/HEAD fallback (real git; #1578 review)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-push-unknown-'));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo, { recursive: true });

    execFileSync('git', ['init'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repo,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });

    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });

    const result = await evaluateDeliveryContract(
      {
        expect: ['push'],
        cwd: repo,
        baseline: {
          headSha: execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: repo,
            encoding: 'utf8',
          }).trim(),
          upstreamRef: null,
          upstreamRefSource: 'originHead',
          upstreamSha: null,
          prNumber: null,
          prHeadSha: null,
          capturedAt: '2026-09-07T00:00:00.000Z',
        },
        finalAssistantText: '',
      },
      {
        git: {
          currentBranch: async () => ({ kind: 'ok', value: 'main' }),
          aheadCount: async () => ({ kind: 'ok', value: 0 }),
          upstreamRef: async () => ({ kind: 'ok', value: null }),
          upstreamSha: async () => ({ kind: 'ok', value: null }),
          commitsBetween: async () => ({ kind: 'ok', value: 0 }),
        },
        pr: {
          hasOpenPrForBranch: async () => ({ kind: 'ok', value: false }),
        },
      }
    );

    expect(result.met).toBe(false);
    expect(result.unmet).toEqual([]);
    expect(result.unknown).toEqual([
      {
        spec: 'push',
        reason:
          'push delta unavailable when upstream ref came from origin/HEAD fallback',
      },
    ]);
  });
});
