import { Router } from 'express';
import type { Request, Response } from 'express';

import type { LinearIssue, LinearIssuesResponse, LinearState } from './types.js';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const CACHE_TTL_MS = 60_000;

// Deps type

export interface IntegrationLinearDeps {
  configPath: string;
}

// In-memory cache (single key, not per-workspace)
interface IssuesCacheEntry {
  issues: LinearIssue[];
  fetchedAt: number;
}

/**
 * Creates and returns an Express Router that handles all /integration-linear routes.
 *
 * Caller is responsible for mounting and applying auth middleware:
 *   app.use('/integration-linear', requireAuth, createIntegrationLinearRouter({ configPath }));
 */
export function createIntegrationLinearRouter(_deps: IntegrationLinearDeps): Router {
  const router = Router();

  // Single 60s in-memory cache for assigned issues
  let issuesCache: IssuesCacheEntry | null = null;

// GET /integrations/linear/configured — check whether the API key is set
  router.get('/configured', (_req: Request, res: Response) => {
    const apiKey = process.env.LINEAR_API_KEY;
    res.json({ configured: Boolean(apiKey) });
  });

  // GET /integrations/linear/issues — fetch assigned issues (non-completed, non-canceled)
  router.get('/issues', async (_req: Request, res: Response) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      const response: LinearIssuesResponse = { issues: [], error: 'linear_not_configured' };
      res.json(response);
      return;
    }

    // Return cached result if still fresh
    const now = Date.now();
    if (issuesCache && now - issuesCache.fetchedAt < CACHE_TTL_MS) {
      const response: LinearIssuesResponse = { issues: issuesCache.issues };
      res.json(response);
      return;
    }

    const query = `
      query {
        viewer {
          assignedIssues(
            filter: { state: { type: { nin: ["completed", "canceled"] } } }
            first: 50
            orderBy: updatedAt
          ) {
            nodes {
              id
              identifier
              title
              url
              state { name }
              priority
              priorityLabel
              cycle { name }
              estimate
              assignee { name }
              updatedAt
              team { id }
            }
          }
        }
      }
    `;

    let data: unknown;
    try {
      const fetchRes = await fetch(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (fetchRes.status === 401 || fetchRes.status === 403) {
        const response: LinearIssuesResponse = { issues: [], error: 'linear_auth_failed' };
        res.json(response);
        return;
      }
      if (!fetchRes.ok) {
        const response: LinearIssuesResponse = { issues: [], error: 'linear_fetch_failed' };
        res.json(response);
        return;
      }

      data = await fetchRes.json();
    } catch {
      const response: LinearIssuesResponse = { issues: [], error: 'linear_fetch_failed' };
      res.json(response);
      return;
    }

    // Check for GraphQL-level auth errors
    const gqlData = data as {
      errors?: Array<{ extensions?: { type?: string } }>;
      data?: {
        viewer?: {
          assignedIssues?: {
            nodes?: Array<{
              id: string;
              identifier: string;
              title: string;
              url: string;
              state: { name: string } | null;
              priority: number;
              priorityLabel: string;
              cycle: { name: string } | null;
              estimate: number | null;
              assignee: { name: string } | null;
              updatedAt: string;
              team: { id: string } | null;
            }>;
          };
        };
      };
    };

    if (gqlData.errors && gqlData.errors.length > 0) {
      const errType = gqlData.errors[0]?.extensions?.type;
      if (errType === 'authentication' || errType === 'authorization') {
        const response: LinearIssuesResponse = { issues: [], error: 'linear_auth_failed' };
        res.json(response);
        return;
      }
      const response: LinearIssuesResponse = { issues: [], error: 'linear_fetch_failed' };
      res.json(response);
      return;
    }

    const nodes = gqlData.data?.viewer?.assignedIssues?.nodes ?? [];

    const issues: LinearIssue[] = nodes.map((node): LinearIssue => ({
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      url: node.url,
      state: node.state?.name ?? '',
      priority: node.priority,
      priorityLabel: node.priorityLabel,
      cycle: node.cycle?.name ?? null,
      estimate: node.estimate ?? null,
      assignee: node.assignee?.name ?? null,
      updatedAt: node.updatedAt,
      teamId: node.team?.id ?? '',
    }));

    // Update cache
    issuesCache = { issues, fetchedAt: now };

    const response: LinearIssuesResponse = { issues };
    res.json(response);
  });

  // GET /integrations/linear/states?teamId=X — fetch workflow states for a team
  router.get('/states', async (req: Request, res: Response) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      res.json({ states: [], error: 'linear_not_configured' });
      return;
    }

    const teamId = req.query['teamId'];
    if (typeof teamId !== 'string' || !teamId) {
      res.status(400).json({ states: [], error: 'missing_team_id' });
      return;
    }

    const query = `
      query($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name }
        }
      }
    `;

    let data: unknown;
    try {
      const fetchRes = await fetch(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables: { teamId } }),
      });

      if (fetchRes.status === 401 || fetchRes.status === 403) {
        res.json({ states: [], error: 'linear_auth_failed' });
        return;
      }
      if (!fetchRes.ok) {
        res.json({ states: [], error: 'linear_fetch_failed' });
        return;
      }

      data = await fetchRes.json();
    } catch {
      res.json({ states: [], error: 'linear_fetch_failed' });
      return;
    }

    const gqlData = data as {
      errors?: Array<unknown>;
      data?: {
        workflowStates?: {
          nodes?: Array<{ id: string; name: string }>;
        };
      };
    };

    if (gqlData.errors && gqlData.errors.length > 0) {
      res.json({ states: [], error: 'linear_fetch_failed' });
      return;
    }

    const nodes = gqlData.data?.workflowStates?.nodes ?? [];

    const states: LinearState[] = nodes.map((node) => ({
      id: node.id,
      name: node.name,
    }));

    res.json({ states });
  });

  return router;
}
