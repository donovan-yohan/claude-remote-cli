import type { IPty } from 'node-pty';

export type SessionType = 'repo' | 'worktree' | 'terminal';
export type AgentType = 'claude' | 'codex';
export type SessionStatus = 'active' | 'disconnected';

export interface Session {
  id: string;
  type: SessionType;
  agent: AgentType;
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
  useTmux: boolean;
  cwd: string;
  customCommand: string | null;
  tmuxSessionName: string;
  onPtyReplacedCallbacks: Array<(newPty: IPty) => void>;
  status: SessionStatus;
  restored: boolean;
  needsBranchRename?: boolean;
  branchRenamePrompt?: string;
}

export interface WorktreeMetadata {
  worktreePath: string;
  displayName: string;
  lastActivity: string;
  branchName?: string;
}

export interface WorkspaceSettings {
  // Session defaults
  defaultAgent?: AgentType;
  defaultContinue?: boolean;
  defaultYolo?: boolean;
  launchInTmux?: boolean;
  claudeArgs?: string[];

  // Git settings
  defaultBranch?: string;
  remote?: string;
  branchPrefix?: string;

  // Custom prompts (Conductor-style)
  promptCodeReview?: string;
  promptCreatePr?: string;
  promptBranchRename?: string;
  promptGeneral?: string;

  // Worktree naming — mountains theme
  nextMountainIndex?: number;
}

export const MOUNTAIN_NAMES = [
  'everest', 'kilimanjaro', 'denali', 'fuji', 'rainier', 'matterhorn',
  'elbrus', 'aconcagua', 'kangchenjunga', 'lhotse', 'makalu', 'cho-oyu',
  'dhaulagiri', 'manaslu', 'annapurna', 'nanga-parbat', 'olympus',
  'mont-blanc', 'k2', 'vinson', 'erebus', 'logan', 'puncak-jaya',
  'wilhelm', 'cook', 'ararat', 'etna', 'shasta', 'whitney', 'hood',
] as const;

export interface Config {
  host: string;
  port: number;
  cookieTTL: string;
  repos: string[];
  claudeCommand: string;
  claudeArgs: string[];
  defaultAgent: AgentType;
  defaultContinue: boolean;
  defaultYolo: boolean;
  launchInTmux: boolean;
  defaultNotifications: boolean;
  pinHash?: string | undefined;
  rootDirs?: string[] | undefined;
  workspaces?: string[] | undefined;
  workspaceSettings?: Record<string, WorkspaceSettings> | undefined;
  vapidPublicKey?: string | undefined;
  vapidPrivateKey?: string | undefined;
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
  mergeable: string | null;
}

export interface PullRequestsResponse {
  prs: PullRequest[];
  error?: string | undefined;
}

export interface ActivityEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timeAgo: string;
  branches: string[];
}

export interface CiStatus {
  total: number;
  passing: number;
  failing: number;
  pending: number;
}

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string | null;
}

export interface DashboardData {
  prs: PullRequest[];
  activity: ActivityEntry[];
  isGitRepo: boolean;
  defaultBranch: string | null;
  hasGhCli: boolean;
}

export interface Workspace {
  path: string;
  name: string;
  isGitRepo: boolean;
  defaultBranch: string | null;
}

export type Platform = 'macos' | 'linux';

export interface InstallOpts {
  configPath?: string | undefined;
  port?: string | undefined;
  host?: string | undefined;
}
