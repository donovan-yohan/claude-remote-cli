import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Router } from 'express';

import { loadConfig } from './config.js';
import type { Config, TicketContext, TransitionState, BranchLink } from './types.js';

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
): Promise<boolean> {
  try {
    await exec('gh', ['issue', 'edit', issueNumber, '--add-label', label], {
      cwd: repoPath,
      timeout: GH_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    console.error(`[ticket-transitions] Failed to add label "${label}" to #${issueNumber}:`, err);
    return false;
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

/** Returns true if the URL is safe to use as a Jira base URL. */
function isValidJiraUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

/** Call a Jira transition by ID. Returns true on success, false on failure. */
async function jiraTransition(ticketId: string, transitionId: string): Promise<boolean> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return false;

  if (!isValidJiraUrl(baseUrl)) {
    console.warn(`[ticket-transitions] JIRA_BASE_URL failed validation, skipping transition for ${ticketId}`);
    return false;
  }

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
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[ticket-transitions] Jira transition failed for ${ticketId}:`, err);
    return false;
  }
}

/** Update a Linear issue state. Returns true on success, false on failure. */
async function linearStateUpdate(ticketIdentifier: string, stateId: string): Promise<boolean> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return false;

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
      return false;
    }
    const searchData = (await searchRes.json()) as { data?: { issues?: { nodes?: Array<{ id: string }> } } };
    const issueId = searchData.data?.issues?.nodes?.[0]?.id;
    if (!issueId) return false;

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
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[ticket-transitions] Linear state update failed for ${ticketIdentifier}:`, err);
    return false;
  }
}

/**
 * Best-effort source detection from a ticket ID pattern.
 * Known limitation: when both Jira and Linear are configured, non-GH tickets
 * are matched by whichever env var is present. This is imperfect — a future
 * improvement would persist the source alongside branch links.
 */
function detectTicketSource(ticketId: string, links?: BranchLink[]): 'github' | 'jira' | 'linear' {
  // Use explicit source from branch link if available
  if (links) {
    const linkWithSource = links.find((l) => l.source);
    if (linkWithSource?.source) return linkWithSource.source;
  }
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
  function getStatusMapping(config: Config, source: 'jira' | 'linear', state: TransitionState): string | undefined {
    if (source === 'jira') return config.integrations?.jira?.statusMappings?.[state];
    return config.integrations?.linear?.statusMappings?.[state];
  }

  async function transitionOnSessionCreate(ctx: TicketContext): Promise<void> {
    const current = transitionMap.get(ctx.ticketId);
    if (current && current !== 'none') return;

    if (ctx.source === 'github') {
      const issueNum = ghIssueNumber(ctx.ticketId);
      if (!issueNum) return;
      const ok = await addLabel(exec, ctx.repoPath, issueNum, 'in-progress');
      if (ok) transitionMap.set(ctx.ticketId, 'in-progress');
    } else if (ctx.source === 'jira') {
      const config = loadConfig(configPath);
      const transitionId = getStatusMapping(config, 'jira', 'in-progress');
      if (transitionId) {
        const ok = await jiraTransition(ctx.ticketId, transitionId);
        if (ok) transitionMap.set(ctx.ticketId, 'in-progress');
      }
    } else if (ctx.source === 'linear') {
      const config = loadConfig(configPath);
      const stateId = getStatusMapping(config, 'linear', 'in-progress');
      if (stateId) {
        const ok = await linearStateUpdate(ctx.ticketId, stateId);
        if (ok) transitionMap.set(ctx.ticketId, 'in-progress');
      }
    }
  }

  async function checkPrTransitions(
    prs: PrForTransition[],
    branchLinks: Record<string, BranchLink[]>,
  ): Promise<void> {
    const config = loadConfig(configPath);
    for (const pr of prs) {
      for (const [ticketId, links] of Object.entries(branchLinks)) {
        const linked = links.some((l) => l.branchName === pr.headRefName);
        if (!linked) continue;

        const current = transitionMap.get(ticketId);
        const source = detectTicketSource(ticketId, links);

        if (pr.state === 'OPEN' && current !== 'code-review' && current !== 'ready-for-qa') {
          if (source === 'github') {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'in-progress');
            const ok = await addLabel(exec, repoPath, issueNum, 'code-review');
            if (ok) transitionMap.set(ticketId, 'code-review');
          } else if (source === 'jira') {
            const transitionId = getStatusMapping(config, 'jira', 'code-review');
            if (transitionId) {
              const ok = await jiraTransition(ticketId, transitionId);
              if (ok) transitionMap.set(ticketId, 'code-review');
            }
          } else if (source === 'linear') {
            const stateId = getStatusMapping(config, 'linear', 'code-review');
            if (stateId) {
              const ok = await linearStateUpdate(ticketId, stateId);
              if (ok) transitionMap.set(ticketId, 'code-review');
            }
          }
        } else if (pr.state === 'MERGED' && current !== 'ready-for-qa') {
          if (source === 'github') {
            const issueNum = ghIssueNumber(ticketId);
            if (!issueNum) continue;
            const repoPath = links[0]?.repoPath;
            if (!repoPath) continue;
            await removeLabel(exec, repoPath, issueNum, 'code-review');
            const ok = await addLabel(exec, repoPath, issueNum, 'ready-for-qa');
            if (ok) transitionMap.set(ticketId, 'ready-for-qa');
          } else if (source === 'jira') {
            const transitionId = getStatusMapping(config, 'jira', 'ready-for-qa');
            if (transitionId) {
              const ok = await jiraTransition(ticketId, transitionId);
              if (ok) transitionMap.set(ticketId, 'ready-for-qa');
            }
          } else if (source === 'linear') {
            const stateId = getStatusMapping(config, 'linear', 'ready-for-qa');
            if (stateId) {
              const ok = await linearStateUpdate(ticketId, stateId);
              if (ok) transitionMap.set(ticketId, 'ready-for-qa');
            }
          }
        }
      }
    }
  }

  return { router, transitionOnSessionCreate, checkPrTransitions };
}
