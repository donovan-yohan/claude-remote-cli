import fs from 'node:fs';
import path from 'node:path';

import {
  parseChannelDeliveryExpectation,
  type ChannelDeliveryExpectation,
} from '../shared/channel-delivery-contract.js';
import { safeRegexTest } from './safe-regex.js';

export type DeliveryContractProbeOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'unknown'; reason: string };

export interface DeliveryContractGitProbe {
  /** Symbolic branch name (no refs/ prefix), or null if detached/unborn. */
  currentBranch(): Promise<DeliveryContractProbeOutcome<string | null>>;
  /** Ahead count of HEAD vs an upstream/base reference (>=0). */
  aheadCount(): Promise<DeliveryContractProbeOutcome<number>>;
  /** Full sha of HEAD, or null if detached/unborn/unknown. Optional for legacy probes. */
  headSha?(): Promise<DeliveryContractProbeOutcome<string | null>>;
  /** Resolved upstream/base ref name for delta evaluation (#1578). Optional. */
  upstreamRef?(): Promise<DeliveryContractProbeOutcome<string | null>>;
  /** Full sha of the default upstream/base reference, or null if none. Optional. */
  upstreamSha?(): Promise<DeliveryContractProbeOutcome<string | null>>;
  /** Commit count of `base..head` (>=0). Optional for legacy probes. */
  commitsBetween?(
    base: string,
    head: string
  ): Promise<DeliveryContractProbeOutcome<number>>;
}

export interface DeliveryContractPrProbe {
  /** True when an open PR exists for this head branch. */
  hasOpenPrForBranch(
    branch: string
  ): Promise<DeliveryContractProbeOutcome<boolean>>;
  /**
   * Open PR details for delta evaluation (#1578). Optional: when absent the
   * evaluator falls back to the legacy boolean semantics.
   */
  getOpenPrForBranch?(branch: string): Promise<
    DeliveryContractProbeOutcome<{
      number: number;
      headSha: string | null;
    } | null>
  >;
}

export interface DeliveryContractFsProbe {
  /** Check existence of a path relative to the routing cwd. */
  exists(relPath: string): Promise<DeliveryContractProbeOutcome<boolean>>;
}

export interface EvaluateDeliveryContractInput {
  expect: readonly string[];
  /** Routing cwd for file existence and default git context. */
  cwd: string;
  /**
   * #1578: post-time baseline for delta semantics (commit/pr/push). When null
   * or undefined, legacy absolute semantics apply.
   */
  baseline?: {
    headSha: string;
    upstreamRef?: string | null;
    upstreamSha: string | null;
    prNumber: number | null;
    prHeadSha: string | null;
    capturedAt: string;
  } | null;
  /** Final assistant message text for this run/turn. */
  finalAssistantText: string;
  /**
   * #1585: `text:` expectations are evaluated ONLY against a "closing" principal
   * prose row — one emitted after the run's last tool/thought/card activity.
   *
   * If the last prose row precedes a later non-prose card row, the expectation
   * is treated as unmet even if the stored text happens to match.
   *
   * Omitted defaults to `true` for backwards compatibility with older callers.
   */
  finalAssistantTextIsClosing?: boolean;
}

export interface DeliveryContractResult {
  met: boolean;
  unmet: string[];
  unknown: Array<{ spec: string; reason: string }>;
}

const MAX_TEXT_BYTES = 64 * 1024;
const TEXT_REGEX_TIMEOUT_MS = 200;

export async function evaluateDeliveryContract(
  input: EvaluateDeliveryContractInput,
  probes: {
    git: DeliveryContractGitProbe;
    pr: DeliveryContractPrProbe;
    fs?: DeliveryContractFsProbe;
  }
): Promise<DeliveryContractResult> {
  const unmet: string[] = [];
  const unknown: Array<{ spec: string; reason: string }> = [];
  const fsProbe: DeliveryContractFsProbe =
    probes.fs ??
    ({
      exists: async (rel) => {
        try {
          const cwd = path.resolve(input.cwd);
          const target = path.resolve(cwd, rel);
          const prefix = cwd.endsWith(path.sep) ? cwd : `${cwd}${path.sep}`;
          if (target !== cwd && !target.startsWith(prefix)) {
            return {
              kind: 'unknown',
              reason: 'file expectation escapes routing cwd',
            };
          }
          return { kind: 'ok', value: fs.existsSync(target) };
        } catch (err) {
          return {
            kind: 'unknown',
            reason: err instanceof Error ? err.message : String(err),
          };
        }
      },
    } satisfies DeliveryContractFsProbe);

  for (const raw of input.expect) {
    const spec = raw.trim();
    if (!spec) continue;
    let parsed: ChannelDeliveryExpectation;
    try {
      parsed = parseChannelDeliveryExpectation(spec);
    } catch {
      // Parsing is enforced at the gateway boundary; a malformed stored spec is
      // treated as unmet rather than crashing evaluation.
      unmet.push(spec);
      continue;
    }
    const outcome = await evaluateOne(parsed);
    if (outcome.kind === 'ok') {
      if (!outcome.value) unmet.push(spec);
    } else {
      unknown.push({ spec, reason: outcome.reason });
    }
  }
  return { met: unmet.length === 0 && unknown.length === 0, unmet, unknown };

  async function evalCommit(): Promise<DeliveryContractProbeOutcome<boolean>> {
    const baseline = input.baseline;
    if (
      baseline &&
      typeof probes.git.headSha === 'function' &&
      typeof probes.git.commitsBetween === 'function'
    ) {
      const head = await probes.git.headSha();
      if (head.kind === 'ok' && typeof head.value === 'string' && head.value) {
        const delta = await probes.git.commitsBetween(
          baseline.headSha,
          head.value
        );
        if (delta.kind === 'ok') {
          const n = delta.value;
          return { kind: 'ok', value: Number.isFinite(n) && n >= 1 };
        }
      }
      // Probe failure: fall back to legacy semantics below.
    }
    const ahead = await probes.git.aheadCount();
    if (ahead.kind === 'unknown') return ahead;
    const n = ahead.value;
    return { kind: 'ok', value: Number.isFinite(n) && n >= 1 };
  }

  async function evalPush(): Promise<DeliveryContractProbeOutcome<boolean>> {
    const baseline = input.baseline;
    if (!baseline) {
      return { kind: 'unknown', reason: 'baseline unavailable' };
    }
    if (!baseline.upstreamRef) {
      return { kind: 'unknown', reason: 'no upstream ref baseline available' };
    }
    if (!baseline.upstreamSha) {
      return { kind: 'unknown', reason: 'no upstream baseline available' };
    }
    if (
      typeof probes.git.upstreamRef !== 'function' ||
      typeof probes.git.upstreamSha !== 'function' ||
      typeof probes.git.commitsBetween !== 'function'
    ) {
      return {
        kind: 'unknown',
        reason: 'git probes missing for push delta evaluation',
      };
    }
    const currentRef = await probes.git.upstreamRef();
    if (currentRef.kind === 'unknown') return currentRef;
    if (!currentRef.value) {
      return {
        kind: 'unknown',
        reason: 'no upstream/base reference available',
      };
    }
    if (currentRef.value !== baseline.upstreamRef) {
      return {
        kind: 'unknown',
        reason: `upstream ref changed (${baseline.upstreamRef} -> ${currentRef.value})`,
      };
    }
    const current = await probes.git.upstreamSha();
    if (current.kind === 'unknown') return current;
    if (!current.value) {
      return {
        kind: 'unknown',
        reason: 'no upstream/base reference available',
      };
    }
    const delta = await probes.git.commitsBetween(
      baseline.upstreamSha,
      current.value
    );
    if (delta.kind === 'unknown') return delta;
    const n = delta.value;
    return { kind: 'ok', value: Number.isFinite(n) && n >= 1 };
  }

  async function resolvePrBranch(
    expectation: Extract<ChannelDeliveryExpectation, { kind: 'pr' }>
  ): Promise<DeliveryContractProbeOutcome<string>> {
    const branch = expectation.branch;
    if (branch && branch.trim()) return { kind: 'ok', value: branch.trim() };
    const current = await probes.git.currentBranch();
    if (current.kind === 'unknown') return current;
    const resolved = current.value ?? '';
    if (!resolved.trim()) {
      return { kind: 'unknown', reason: 'unable to resolve current branch' };
    }
    return { kind: 'ok', value: resolved.trim() };
  }

  async function evalPr(
    expectation: Extract<ChannelDeliveryExpectation, { kind: 'pr' }>
  ): Promise<DeliveryContractProbeOutcome<boolean>> {
    const resolvedBranch = await resolvePrBranch(expectation);
    if (resolvedBranch.kind === 'unknown') return resolvedBranch;

    const baseline = input.baseline;
    if (
      baseline &&
      typeof probes.pr.getOpenPrForBranch === 'function' &&
      typeof probes.git.commitsBetween === 'function'
    ) {
      const pr = await probes.pr.getOpenPrForBranch(resolvedBranch.value);
      if (pr.kind === 'unknown') return pr;
      if (!pr.value) return { kind: 'ok', value: false };
      if (baseline.prNumber === null) return { kind: 'ok', value: true };
      if (baseline.prNumber !== pr.value.number)
        return { kind: 'ok', value: true };
      if (!baseline.prHeadSha || !pr.value.headSha) {
        return {
          kind: 'unknown',
          reason: 'unable to resolve PR head sha for delta evaluation',
        };
      }
      const delta = await probes.git.commitsBetween(
        baseline.prHeadSha,
        pr.value.headSha
      );
      if (delta.kind === 'unknown') return delta;
      const n = delta.value;
      return { kind: 'ok', value: Number.isFinite(n) && n >= 1 };
    }

    // Legacy semantics: any open PR is sufficient.
    return probes.pr.hasOpenPrForBranch(resolvedBranch.value);
  }

  async function evaluateOne(
    expectation: ChannelDeliveryExpectation
  ): Promise<DeliveryContractProbeOutcome<boolean>> {
    switch (expectation.kind) {
      case 'commit': {
        return evalCommit();
      }
      case 'push': {
        return evalPush();
      }
      case 'file': {
        return fsProbe.exists(expectation.path);
      }
      case 'text': {
        if (input.finalAssistantTextIsClosing === false) {
          return { kind: 'ok', value: false };
        }
        const haystack = input.finalAssistantText.slice(0, MAX_TEXT_BYTES);
        const result = await safeRegexTest(expectation.regex, haystack, {
          timeoutMs: TEXT_REGEX_TIMEOUT_MS,
        });
        if (result.kind === 'unknown') return result;
        return { kind: 'ok', value: result.matched };
      }
      case 'pr': {
        return evalPr(expectation);
      }
      default: {
        const _exhaustive: never = expectation;
        void _exhaustive;
        // Unknown kind: unmet.
        return { kind: 'ok', value: false };
      }
    }
  }
}
