import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HubLockRecord = {
  pid: number;
  port: number | null;
  host: string | null;
  startedAt: string;
  hostname: string;
};

export class HubConfigDirLockedError extends Error {
  readonly configDir: string;
  readonly lockPath: string;
  readonly owner: HubLockRecord;

  constructor(configDir: string, owner: HubLockRecord) {
    const lockPath = hubLockPath(configDir);
    super(
      [
        `Refusing to open Relay hub config dir because it is owned by a live hub: ${configDir}`,
        `hub.lock: ${lockPath}`,
        `owner: pid=${owner.pid} host=${owner.host ?? 'unknown'} port=${owner.port ?? 'unknown'} hostname=${owner.hostname} startedAt=${owner.startedAt}`,
        `Stop the owning hub or pass an isolated config path via --config /path/to/config.json. (#1587)`,
      ].join('\n')
    );
    this.name = 'HubConfigDirLockedError';
    this.configDir = configDir;
    this.lockPath = lockPath;
    this.owner = owner;
  }
}

export function hubLockPath(configDir: string): string {
  return path.join(configDir, 'hub.lock');
}

function isPidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // EPERM means the process exists but we lack permission to signal it.
    if (e?.code === 'EPERM') return true;
    return false;
  }
}

export function readHubLock(configDir: string): HubLockRecord | null {
  const lockPath = hubLockPath(configDir);
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<HubLockRecord>;
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.hostname !== 'string'
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      port:
        typeof parsed.port === 'number' && Number.isFinite(parsed.port)
          ? parsed.port
          : null,
      host: typeof parsed.host === 'string' ? parsed.host : null,
      startedAt: parsed.startedAt,
      hostname: parsed.hostname,
    };
  } catch {
    return null;
  }
}

export function assertConfigDirNotOwnedByAnotherLiveHub(
  configDir: string
): void {
  const lock = readHubLock(configDir);
  if (!lock) return;
  if (!isPidAlive(lock.pid)) return;
  if (lock.pid === process.pid) return;
  throw new HubConfigDirLockedError(configDir, lock);
}

function writeHubLockSync(configDir: string, record: HubLockRecord): void {
  const lockPath = hubLockPath(configDir);
  const tmp = lockPath + `.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, lockPath);
}

export function acquireHubLockOrThrow(
  configDir: string,
  record: Omit<HubLockRecord, 'pid' | 'hostname' | 'startedAt'> & {
    pid?: number | undefined;
    hostname?: string | undefined;
    startedAt?: string | undefined;
  } = { port: null, host: null }
): HubLockRecord {
  assertConfigDirNotOwnedByAnotherLiveHub(configDir);
  fs.mkdirSync(configDir, { recursive: true });
  const resolved: HubLockRecord = {
    pid: record.pid ?? process.pid,
    port: record.port ?? null,
    host: record.host ?? null,
    startedAt: record.startedAt ?? new Date().toISOString(),
    hostname: record.hostname ?? os.hostname(),
  };
  writeHubLockSync(configDir, resolved);
  return resolved;
}

export function updateHubLockBestEffort(
  configDir: string,
  patch: Partial<Omit<HubLockRecord, 'pid' | 'hostname' | 'startedAt'>> & {
    expectedPid?: number | undefined;
  }
): void {
  const current = readHubLock(configDir);
  if (!current) return;
  const expectedPid = patch.expectedPid ?? process.pid;
  if (current.pid !== expectedPid) return;
  try {
    writeHubLockSync(configDir, {
      ...current,
      ...(patch.port !== undefined ? { port: patch.port } : {}),
      ...(patch.host !== undefined ? { host: patch.host } : {}),
    });
  } catch {
    /* best effort */
  }
}

export function releaseHubLockBestEffort(
  configDir: string,
  expectedPid: number = process.pid
): void {
  const lockPath = hubLockPath(configDir);
  const current = readHubLock(configDir);
  if (!current || current.pid !== expectedPid) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* best effort */
  }
}
