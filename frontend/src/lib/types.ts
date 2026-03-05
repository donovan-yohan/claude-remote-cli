export interface SessionSummary {
  id: string;
  type: 'repo' | 'worktree';
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  idle: boolean;
}

export interface WorktreeInfo {
  name: string;
  path: string;
  repoName: string;
  repoPath: string;
  root: string;
  displayName: string;
  lastActivity: string;
  branchName: string;
}

export interface RepoInfo {
  name: string;
  path: string;
  root: string;
}

export interface GitStatus {
  prState: 'open' | 'merged' | 'closed' | null;
  additions: number;
  deletions: number;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  author: string;
  role: 'author' | 'reviewer';
  updatedAt: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
}

export interface PullRequestsResponse {
  prs: PullRequest[];
  error?: string | undefined;
}

export type PipelineState =
  | 'intake'
  | 'brainstorming'
  | 'prd_review'
  | 'planning'
  | 'plan_review'
  | 'executing'
  | 'reviewing'
  | 'retry'
  | 'stuck'
  | 'pr_created'
  | 'ci_monitoring'
  | 'ready_for_review'
  | 'done'
  | 'failed';

export interface TaskSpec {
  source: 'jira' | 'linear' | 'github' | 'text';
  externalId?: string | undefined;
  externalUrl?: string | undefined;
  title: string;
  description: string;
  acceptanceCriteria?: string[] | undefined;
  labels?: string[] | undefined;
  priority?: 'low' | 'medium' | 'high' | 'critical' | undefined;
}

export interface Verdict {
  goalName: string;
  pass: boolean;
  criteriaResults: Array<{
    criterion: string;
    met: boolean;
    reason?: string | undefined;
  }>;
  summary: string;
  suggestions?: string[] | undefined;
  timestamp: string;
}

export interface PipelineSummary {
  id: string;
  state: PipelineState;
  task: TaskSpec;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  prUrl?: string | undefined;
  error?: string | undefined;
}

export interface PipelineDetail extends PipelineSummary {
  prdContent?: string | undefined;
  planContent?: string | undefined;
  verdicts: Verdict[];
  stuckReport?: string | undefined;
  branchName?: string | undefined;
  prNumber?: number | undefined;
}
