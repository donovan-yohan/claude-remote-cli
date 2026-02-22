import type { IPty } from 'node-pty';

export interface Session {
  id: string;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  displayName: string;
  pty: IPty;
  createdAt: string;
  lastActivity: string;
  scrollback: string[];
}

export interface WorktreeMetadata {
  worktreePath: string;
  displayName: string;
  lastActivity: string;
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

export type Platform = 'macos' | 'linux';

export interface InstallOpts {
  configPath?: string | undefined;
  port?: string | undefined;
  host?: string | undefined;
}
