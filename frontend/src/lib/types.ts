export interface SessionSummary {
  id: string;
  type: 'repo' | 'worktree';
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
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
