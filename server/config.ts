import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Config, WorkspaceSettings, WorktreeMetadata } from './types.js';

export const DEFAULTS: Omit<Config, 'pinHash' | 'rootDirs' | 'workspaceSettings' | 'vapidPublicKey' | 'vapidPrivateKey'> = {
  host: '0.0.0.0',
  port: 3456,
  cookieTTL: '24h',
  repos: [],
  claudeCommand: 'claude',
  claudeArgs: [],
  defaultAgent: 'claude',
  defaultContinue: true,
  defaultYolo: false,
  launchInTmux: false,
  defaultNotifications: true,
  workspaces: [],
};

export function loadConfig(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<Config>;
  return { ...DEFAULTS, ...parsed };
}

export function saveConfig(configPath: string, config: Config): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function metaDir(configPath: string): string {
  return path.join(path.dirname(configPath), 'worktree-meta');
}

function metaFilePath(configPath: string, worktreePath: string): string {
  const hash = crypto.createHash('sha256').update(worktreePath).digest('hex').slice(0, 16);
  return path.join(metaDir(configPath), hash + '.json');
}

export function ensureMetaDir(configPath: string): void {
  const dir = metaDir(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readMeta(configPath: string, worktreePath: string): WorktreeMetadata | null {
  const fp = metaFilePath(configPath, worktreePath);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as WorktreeMetadata;
  } catch (_) {
    return null;
  }
}

export function writeMeta(configPath: string, meta: WorktreeMetadata): void {
  const fp = metaFilePath(configPath, meta.worktreePath);
  ensureMetaDir(configPath);
  fs.writeFileSync(fp, JSON.stringify(meta, null, 2), 'utf8');
}

export function deleteMeta(configPath: string, worktreePath: string): void {
  const fp = metaFilePath(configPath, worktreePath);
  try {
    fs.unlinkSync(fp);
  } catch (_) {
    // File may not exist; ignore
  }
}

export function getWorkspaceSettings(config: Config, workspacePath: string): WorkspaceSettings {
  const globalDefaults: WorkspaceSettings = {
    defaultAgent: config.defaultAgent,
    defaultContinue: config.defaultContinue,
    defaultYolo: config.defaultYolo,
    launchInTmux: config.launchInTmux,
    claudeArgs: config.claudeArgs,
  };
  const perWorkspace = config.workspaceSettings?.[workspacePath] || {};
  // Per-workspace settings override global — only for defined keys
  return { ...globalDefaults, ...perWorkspace };
}

export function setWorkspaceSettings(
  configPath: string,
  config: Config,
  workspacePath: string,
  settings: Partial<WorkspaceSettings>,
): void {
  if (!config.workspaceSettings) config.workspaceSettings = {};
  config.workspaceSettings[workspacePath] = {
    ...config.workspaceSettings[workspacePath],
    ...settings,
  };
  saveConfig(configPath, config);
}
