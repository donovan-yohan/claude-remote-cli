import type { IPty } from 'node-pty';

export type SessionType = 'repo' | 'worktree' | 'terminal';
export type AgentType = 'claude' | 'codex';
export type SessionStatus = 'active' | 'disconnected';
export type SessionMode = 'sdk' | 'pty';

// SDK event types for structured agent communication
export type SdkEventType = 'user_message' | 'agent_message' | 'file_change' | 'tool_call' | 'reasoning' | 'error' | 'turn_started' | 'turn_completed' | 'session_started';

export interface SdkEvent {
  type: SdkEventType;
  id?: string;
  text?: string;
  path?: string;
  additions?: number;
  deletions?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  status?: string;
  usage?: { input_tokens: number; output_tokens: number };
  timestamp: string;
}

// Agent command records (shared by PTY and SDK handlers)
export const AGENT_COMMANDS: Record<AgentType, string> = {
  claude: 'claude',
  codex: 'codex',
};

export const AGENT_CONTINUE_ARGS: Record<AgentType, string[]> = {
  claude: ['--continue'],
  codex: ['resume', '--last'],
};

export const AGENT_YOLO_ARGS: Record<AgentType, string[]> = {
  claude: ['--dangerously-skip-permissions'],
  codex: ['--full-auto'],
};

// Session types — discriminated union on `mode`
interface BaseSession {
  id: string;
  type: SessionType;
  agent: AgentType;
  mode: SessionMode;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  idle: boolean;
  cwd: string;
  customCommand: string | null;
  status: SessionStatus;
  needsBranchRename: boolean;
}

export interface PtySession extends BaseSession {
  mode: 'pty';
  pty: IPty;
  scrollback: string[];
  useTmux: boolean;
  tmuxSessionName: string;
  onPtyReplacedCallbacks: Array<(newPty: IPty) => void>;
  restored: boolean;
  branchRenamePrompt?: string;
}

export interface SdkSession extends BaseSession {
  mode: 'sdk';
  events: SdkEvent[];
  sdkSessionId: string | null;
  tokenUsage: { input: number; output: number };
  estimatedCost: number;
}

export type Session = PtySession | SdkSession;

// Summary type for REST API responses (no internal handles)
export interface SessionSummary {
  id: string;
  type: SessionType;
  agent: AgentType;
  mode: SessionMode;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  idle: boolean;
  cwd: string;
  customCommand: string | null;
  useTmux: boolean;
  tmuxSessionName: string;
  status: SessionStatus;
  needsBranchRename: boolean;
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
  promptFixConflicts?: string;

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
  debugLog?: boolean | undefined;
  nextMountainIndex?: number | undefined;
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
  baseRefName: string;
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
  additions: number;
  deletions: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  unresolvedCommentCount: number;
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
