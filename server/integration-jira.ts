import { Router } from 'express';
import type { Request, Response } from 'express';

import type { JiraIssue, JiraIssuesResponse, JiraStatus } from './types.js';

const CACHE_TTL_MS = 60_000;
const JIRA_ISSUES_CACHE_KEY = 'jira_issues';

// Deps type

export interface IntegrationJiraDeps {
  configPath: string;
}

// In-memory cache (single key since Jira is cross-workspace)
interface CacheEntry {
  issues: JiraIssue[];
  fetchedAt: number;
}

// Raw shape returned by Jira REST API /rest/api/3/search
interface JiraSearchResult {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      priority: { name: string } | null;
      customfield_10016: number | null; // story points
      customfield_10020: Array<{ name: string }> | null; // sprint
      assignee: { displayName: string } | null;
      updated: string;
    };
    self: string;
  }>;
}

/**
 * Creates and returns an Express Router that handles all /integration-jira routes.
 *
 * Caller is responsible for mounting and applying auth middleware:
 *   app.use('/integration-jira', requireAuth, createIntegrationJiraRouter({ configPath }));
 */
export function createIntegrationJiraRouter(_deps: IntegrationJiraDeps): Router {
  const router = Router();

  // Single 60s in-memory cache (Jira is cross-workspace, not per-repo)
  const issuesCache = new Map<string, CacheEntry>();

  function getEnvVars(): { token: string; email: string; baseUrl: string } | null {
    const token = process.env.JIRA_API_TOKEN;
    const email = process.env.JIRA_EMAIL;
    const baseUrl = process.env.JIRA_BASE_URL;
    if (!token || !email || !baseUrl) return null;
    return { token, email, baseUrl };
  }

  function buildAuthHeader(email: string, token: string): string {
    return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  // GET /integrations/jira/configured — returns whether env vars are set
  router.get('/configured', (_req: Request, res: Response) => {
    const env = getEnvVars();
    res.json({ configured: env !== null });
  });

  // GET /integrations/jira/issues — search issues assigned to currentUser
  router.get('/issues', async (_req: Request, res: Response) => {
    const env = getEnvVars();
    if (!env) {
      const response: JiraIssuesResponse = { issues: [], error: 'jira_not_configured' };
      res.json(response);
      return;
    }

    const now = Date.now();

    // Return cached result if still fresh
    const cached = issuesCache.get(JIRA_ISSUES_CACHE_KEY);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      const response: JiraIssuesResponse = { issues: cached.issues };
      res.json(response);
      return;
    }

    const jql = 'assignee=currentUser() AND status NOT IN (Done, Closed) ORDER BY updated DESC';
    const fields = 'summary,status,priority,customfield_10016,customfield_10020,assignee,updated';
    const url = `${env.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=50`;

    let data: JiraSearchResult;
    try {
      const fetchResult = await Promise.allSettled([
        fetch(url, {
          headers: {
            Authorization: buildAuthHeader(env.email, env.token),
            Accept: 'application/json',
          },
        }),
      ]);

      const settled = fetchResult[0];
      if (settled.status === 'rejected') {
        const response: JiraIssuesResponse = { issues: [], error: 'jira_fetch_failed' };
        res.json(response);
        return;
      }

      const httpRes = settled.value;
      if (httpRes.status === 401 || httpRes.status === 403) {
        const response: JiraIssuesResponse = { issues: [], error: 'jira_auth_failed' };
        res.json(response);
        return;
      }
      if (!httpRes.ok) {
        const response: JiraIssuesResponse = { issues: [], error: 'jira_fetch_failed' };
        res.json(response);
        return;
      }

      data = (await httpRes.json()) as JiraSearchResult;
    } catch {
      const response: JiraIssuesResponse = { issues: [], error: 'jira_fetch_failed' };
      res.json(response);
      return;
    }

    const issues: JiraIssue[] = data.issues.map((item) => {
      const projectKey = item.key.split('-')[0] ?? item.key;
      const sprint = item.fields.customfield_10020;
      const latestSprint = sprint && sprint.length > 0 ? sprint[sprint.length - 1]?.name ?? null : null;

      return {
        key: item.key,
        title: item.fields.summary,
        url: `${env.baseUrl}/browse/${item.key}`,
        status: item.fields.status.name,
        priority: item.fields.priority?.name ?? null,
        sprint: latestSprint,
        storyPoints: item.fields.customfield_10016,
        assignee: item.fields.assignee?.displayName ?? null,
        updatedAt: item.fields.updated,
        projectKey,
      };
    });

    // Sort by updatedAt descending
    issues.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Update cache
    issuesCache.set(JIRA_ISSUES_CACHE_KEY, { issues, fetchedAt: now });

    const response: JiraIssuesResponse = { issues };
    res.json(response);
  });

  // GET /integrations/jira/statuses?projectKey=X — fetch project statuses
  router.get('/statuses', async (req: Request, res: Response) => {
    const env = getEnvVars();
    if (!env) {
      res.json({ statuses: [], error: 'jira_not_configured' });
      return;
    }

    const projectKey = req.query['projectKey'];
    if (!projectKey || typeof projectKey !== 'string') {
      res.status(400).json({ statuses: [], error: 'missing_project_key' });
      return;
    }

    const url = `${env.baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`;

    let rawData: Array<{ statuses: Array<{ id: string; name: string }> }>;
    try {
      const fetchResults = await Promise.allSettled([
        fetch(url, {
          headers: {
            Authorization: buildAuthHeader(env.email, env.token),
            Accept: 'application/json',
          },
        }),
      ]);

      const settled = fetchResults[0];
      if (settled.status === 'rejected') {
        res.json({ statuses: [], error: 'jira_fetch_failed' });
        return;
      }

      const httpRes = settled.value;
      if (httpRes.status === 401 || httpRes.status === 403) {
        res.json({ statuses: [], error: 'jira_auth_failed' });
        return;
      }
      if (!httpRes.ok) {
        res.json({ statuses: [], error: 'jira_fetch_failed' });
        return;
      }

      rawData = (await httpRes.json()) as Array<{ statuses: Array<{ id: string; name: string }> }>;
    } catch {
      res.json({ statuses: [], error: 'jira_fetch_failed' });
      return;
    }

    // Flatten statuses across all issue types and deduplicate by id
    const seen = new Set<string>();
    const statuses: JiraStatus[] = [];
    for (const issueType of rawData) {
      for (const s of issueType.statuses) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          statuses.push({ id: s.id, name: s.name });
        }
      }
    }

    res.json({ statuses });
  });

  return router;
}
