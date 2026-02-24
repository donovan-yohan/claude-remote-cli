import type { IPty } from 'node-pty';

export type SessionType = 'repo' | 'worktree';

export interface Session {
  id: string;
  type: SessionType;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  pty: IPty;
  createdAt: string;
  lastActivity: string;
  scrollback: string[];
  idle: boolean;
}

export interface WorktreeMetadata {
  worktreePath: string;
  displayName: string;
  lastActivity: string;
  branchName?: string;
}

export interface Config {
  host: string;
  port: number;
  cookieTTL: string;
  repos: string[];
  claudeCommand: string;
  claudeArgs: string[];
  pinHash?: string | undefined;
  rootDirs?: string[] | undefined;
}

export interface ServicePaths {
  servicePath: string;
  logDir: string | null;
  label: string;
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

export type Platform = 'macos' | 'linux';

export interface InstallOpts {
  configPath?: string | undefined;
  port?: string | undefined;
  host?: string | undefined;
}
