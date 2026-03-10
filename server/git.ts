import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ExecFileAsyncResult = {
  stdout: string;
  stderr: string;
};

type ExecFileAsyncLike = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<ExecFileAsyncResult>;

function normalizeBranchNames(stdout: string): string[] {
  const branches = stdout
    .split('\n')
    .map((branch) => branch.trim())
    .filter((branch) => branch && !branch.includes('HEAD'))
    .map((branch) => branch.replace(/^origin\//, ''));

  return [...new Set(branches)].sort();
}

async function listBranches(
  repoPath: string,
  options: {
    refresh?: boolean;
    exec?: ExecFileAsyncLike;
  } = {},
): Promise<string[]> {
  const run: ExecFileAsyncLike = options.exec || execFileAsync as ExecFileAsyncLike;

  if (options.refresh) {
    try {
      await run('git', ['fetch', '--all', '--prune'], { cwd: repoPath });
    } catch {
      // Best effort — still return the locally-known refs below.
    }
  }

  try {
    const { stdout } = await run('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: repoPath });
    return normalizeBranchNames(stdout);
  } catch {
    return [];
  }
}

export { listBranches, normalizeBranchNames };
