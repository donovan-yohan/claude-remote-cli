import type { IPty } from 'node-pty';

export type SessionType = 'repo' | 'worktree' | 'terminal';
export type AgentType = 'claude' | 'codex';
export type SessionStatus = 'active' | 'disconnected';
export type SessionMode = 'sdk' | 'pty';

// SDK event types for structured agent communication
export type SdkEventType = 'agent_message' | 'file_change' | 'tool_call' | 'reasoning' | 'error' | 'turn_started' | 'turn_completed' | 'session_started';

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
}

export interface PtySession extends BaseSession {
  mode: 'pty';
  pty: IPty;
  scrollback: string[];
  useTmux: boolean;
  tmuxSessionName: string;
  onPtyReplacedCallbacks: Array<(newPty: IPty) => void>;
  restored: boolean;
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
  defaultAgent: AgentType;
  defaultContinue: boolean;
  defaultYolo: boolean;
  launchInTmux: boolean;
  defaultNotifications: boolean;
  pinHash?: string | undefined;
  rootDirs?: string[] | undefined;
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
