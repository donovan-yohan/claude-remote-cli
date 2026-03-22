import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Router } from 'express';

import { loadConfig } from './config.js';
import type { TicketContext, TransitionState, BranchLink } from './types.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 10_000;

export interface TicketTransitionsDeps {
  configPath: string;
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

/** Call a Jira transition by ID. Non-fatal on error. */
async function jiraTransition(ticketId: string, transitionId: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return;

  try {
    const res = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(ticketId)}/transitions`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(email + ':' + token).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    if (!res.ok) {
      console.error(`[ticket-transitions] Jira transition returned ${res.status} for ${ticketId}`);
    }
  } catch (err) {
    console.error(`[ticket-transitions] Jira transition failed for ${ticketId}:`, err);
  }
}

/** Update a Linear issue state. Non-fatal on error. */
async function linearStateUpdate(ticketIdentifier: string, stateId: string): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return;

  // Linear mutations need the issue ID, but we only have the identifier (e.g. "TEAM-123").
  // Resolve the issue ID by identifier, then update state.
  try {
    const searchRes = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($filter: IssueFilter) { issues(filter: $filter, first: 1) { nodes { id } } }`,
        variables: { filter: { identifier: { eq: ticketIdentifier } } },
      }),
    });
    if (!searchRes.ok) {
      console.error(`[ticket-transitions] Linear issue lookup returned ${searchRes.status} for ${ticketIdentifier}`);
      return;
    }
    const searchData = (await searchRes.json()) as { data?: { issues?: { nodes?: Array<{ id: string }> } } };
    const issueId = searchData.data?.issues?.nodes?.[0]?.id;
    if (!issueId) return;

    const updateRes = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`,
        variables: { id: issueId, stateId },
      }),
    });
    if (!updateRes.ok) {
      console.error(`[ticket-transitions] Linear state update returned ${updateRes.status} for ${ticketIdentifier}`);
    }
  } catch (err) {
    console.error(`[ticket-transitions] Linear state update failed for ${ticketIdentifier}:`, err);
  }
}

/**
 * Best-effort source detection from a ticket ID pattern.
 * Known limitation: when both Jira and Linear are configured, non-GH tickets
 * are matched by whichever env var is present. This is imperfect — a future
 * improvement would persist the source alongside branch links.
 */
function detectTicketSource(ticketId: string): 'github' | 'jira' | 'linear' {
  if (ticketId.startsWith('GH-')) return 'github';
  // Prefer Jira for PROJECT-style keys (>= 3 uppercase letters before dash)
  // since Jira project keys are typically longer than Linear team keys (2-3 chars).
  const prefix = ticketId.split('-')[0] ?? '';
  if (prefix.length >= 3 && process.env.JIRA_API_TOKEN) return 'jira';
  if (process.env.LINEAR_API_KEY) return 'linear';
  if (process.env.JIRA_API_TOKEN) return 'jira';
  return 'github'; // fallback
}

export function createTicketTransitionsRouter(deps: TicketTransitionsDeps) {
  // In-memory idempotency guard: ticketId -> last transitioned state
  const transitionMap = new Map<string, TransitionState>();
  const exec = deps.execAsync ?? execFileAsync;
  const { configPath } = deps;
  const router = Router();

  /** Get status mapping for a transition state from config */
  function getStatusMapping(source: 'jira' | 'linear', state: TransitionState): string | undefined {
    const config = loadConfig(configPath);
    if (source === 'jira') return config.integrations?.jira?.statusMappings?.[state];
    return config.integrations?.linear?.statusMappings?.[state];
  }

  async function transitionOnSessionCreate(ctx: TicketContext): Promise<void> {
    const current = transitionMap.get(ctx.ticketId);
    if (current && current !== 'none') return;

    transitionMap.set(ctx.ticketId, 'in-progress');

    if (ctx.source === 'github') {
      const issueNum = ghIssueNumber(ctx.ticketId);
      if (!issueNum) return;
      await addLabel(exec, ctx.repoPath, issueNum, 'in-progress');
    } else if (ctx.source === 'jira') {
      const transitionId = getStatusMapping('jira', 'in-progress');
      if (transitionId) await jiraTransition(ctx.ticketId, transitionId);
    } else if (ctx.source === 'linear') {
      const stateId = getStatusMapping('linear', 'in-progress');
      if (stateId) await linearStateUpdate(ctx.ticketId, stateId);
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
        const source = detectTicketSource(ticketId);

        if (pr.state === 'OPEN' && current !== 'code-review' && current !== 'ready-for-qa') {
          transitionMap.set(ticketId, 'code-review');

          if (source === 'github') {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'in-progress');
            await addLabel(exec, repoPath, issueNum, 'code-review');
          } else if (source === 'jira') {
            const transitionId = getStatusMapping('jira', 'code-review');
            if (transitionId) await jiraTransition(ticketId, transitionId);
          } else if (source === 'linear') {
            const stateId = getStatusMapping('linear', 'code-review');
            if (stateId) await linearStateUpdate(ticketId, stateId);
          }
        } else if (pr.state === 'MERGED' && current !== 'ready-for-qa') {
          transitionMap.set(ticketId, 'ready-for-qa');

          if (source === 'github') {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'code-review');
            await addLabel(exec, repoPath, issueNum, 'ready-for-qa');
          } else if (source === 'jira') {
            const transitionId = getStatusMapping('jira', 'ready-for-qa');
            if (transitionId) await jiraTransition(ticketId, transitionId);
          } else if (source === 'linear') {
            const stateId = getStatusMapping('linear', 'ready-for-qa');
            if (stateId) await linearStateUpdate(ticketId, stateId);
          }
        }
      }
    }
  }

  return { router, transitionOnSessionCreate, checkPrTransitions };
}
