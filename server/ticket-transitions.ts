import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Router } from 'express';

import type { TicketContext, TransitionState, BranchLink } from './types.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 10_000;

export interface TicketTransitionsDeps {
  execAsync?: typeof execFileAsync;
}

// Minimal PR shape needed for transition checks
interface PrForTransition {
  number: number;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  repoPath?: string | undefined;
}

function ghIssueNumber(ticketId: string): string | null {
  const match = ticketId.match(/^GH-(\d+)$/i);
  return match ? match[1]! : null;
}

async function addLabel(
  exec: typeof execFileAsync,
  repoPath: string,
  issueNumber: string,
  label: string,
): Promise<void> {
  try {
    await exec('gh', ['issue', 'edit', issueNumber, '--add-label', label], {
      cwd: repoPath,
      timeout: GH_TIMEOUT_MS,
    });
  } catch (err) {
    console.error(`[ticket-transitions] Failed to add label "${label}" to #${issueNumber}:`, err);
  }
}

async function removeLabel(
  exec: typeof execFileAsync,
  repoPath: string,
  issueNumber: string,
  label: string,
): Promise<void> {
  try {
    await exec('gh', ['issue', 'edit', issueNumber, '--remove-label', label], {
      cwd: repoPath,
      timeout: GH_TIMEOUT_MS,
    });
  } catch {
    // Label may not exist — non-fatal
  }
}

export function createTicketTransitionsRouter(deps: TicketTransitionsDeps) {
  // In-memory idempotency guard: ticketId -> last transitioned state
  const transitionMap = new Map<string, TransitionState>();
  const exec = deps.execAsync ?? execFileAsync;
  const router = Router();

  async function transitionOnSessionCreate(ctx: TicketContext): Promise<void> {
    const current = transitionMap.get(ctx.ticketId);
    if (current && current !== 'none') return;

    transitionMap.set(ctx.ticketId, 'in-progress');

    if (ctx.source === 'github') {
      const issueNum = ghIssueNumber(ctx.ticketId);
      if (!issueNum) return;
      await addLabel(exec, ctx.repoPath, issueNum, 'in-progress');
    }
  }

  async function checkPrTransitions(
    prs: PrForTransition[],
    branchLinks: Record<string, BranchLink[]>,
  ): Promise<void> {
    for (const pr of prs) {
      for (const [ticketId, links] of Object.entries(branchLinks)) {
        const linked = links.some((l) => l.branchName === pr.headRefName);
        if (!linked) continue;

        const current = transitionMap.get(ticketId);

        if (pr.state === 'OPEN' && current !== 'code-review' && current !== 'ready-for-qa') {
          transitionMap.set(ticketId, 'code-review');

          if (ticketId.startsWith('GH-')) {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'in-progress');
            await addLabel(exec, repoPath, issueNum, 'code-review');
          }
        } else if (pr.state === 'MERGED' && current !== 'ready-for-qa') {
          transitionMap.set(ticketId, 'ready-for-qa');

          if (ticketId.startsWith('GH-')) {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'code-review');
            await addLabel(exec, repoPath, issueNum, 'ready-for-qa');
          }
        }
      }
    }
  }

  return { router, transitionOnSessionCreate, checkPrTransitions };
}
