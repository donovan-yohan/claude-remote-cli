export type AgentType = 'claude' | 'codex';

export type SdkEventType = 'user_message' | 'agent_message' | 'file_change' | 'tool_call' | 'reasoning' | 'error' | 'turn_started' | 'turn_completed' | 'session_started';

export interface SdkEvent {
  type: SdkEventType;
  id?: string | undefined;
  text?: string | undefined;
  path?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  toolName?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  status?: string | undefined;
  usage?: { input_tokens: number; output_tokens: number } | undefined;
  timestamp: string;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'timed_out';
}

export interface SessionInfo {
  type: 'session_info';
  mode: 'sdk' | 'pty';
  sessionId: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  estimatedCost: number;
}

export interface SessionSummary {
  id: string;
  type: 'repo' | 'worktree' | 'terminal';
  agent: AgentType;
  mode?: 'sdk' | 'pty' | undefined;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  idle: boolean;
  useTmux?: boolean | undefined;
  status?: 'active' | 'disconnected' | undefined;
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

export interface OpenSessionOptions {
  yolo?: boolean;
  tab?: 'repos' | 'worktrees';
  branchName?: string;
  agent?: AgentType;
  claudeArgs?: string;
  useTmux?: boolean;
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
