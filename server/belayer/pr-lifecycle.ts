import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TaskSpec } from './types.js';
import { updatePipeline, getPipeline } from './pipeline.js';

const execFileAsync = promisify(execFile);

export function buildPrTitle(task: TaskSpec): string {
  return `feat: ${task.title}`;
}

export function buildPrBody(task: TaskSpec, prdContent: string, attempts: number): string {
  return `## ${task.title}

${task.description}

**Automated by Belayer** — completed in ${attempts} attempt${attempts !== 1 ? 's' : ''}.

<details>
<summary>PRD</summary>

${prdContent}

</details>
`;
}

export async function createPullRequest(pipelineId: string): Promise<{ prNumber: number; prUrl: string }> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;
  const title = buildPrTitle(pipeline.task);
  const body = buildPrBody(pipeline.task, pipeline.prdContent || '', pipeline.attempts);

  // Push branch
  if (pipeline.config.autoPush && pipeline.branchName) {
    await execFileAsync('git', ['push', '-u', 'origin', pipeline.branchName], { cwd });
  }

  // Create PR via gh CLI
  const { stdout } = await execFileAsync('gh', [
    'pr', 'create',
    '--title', title,
    '--body', body,
    '--base', pipeline.config.baseBranch,
    '--json', 'number,url',
  ], { cwd });

  const parsed = JSON.parse(stdout) as { number: number; url: string };
  const result = { prNumber: parsed.number, prUrl: parsed.url };
  updatePipeline(pipelineId, result);

  return result;
}

export async function checkCiStatus(pipelineId: string): Promise<'pending' | 'success' | 'failure'> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline || !pipeline.prNumber) throw new Error('Pipeline has no PR');

  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;

  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'checks', String(pipeline.prNumber),
      '--json', 'name,bucket',
    ], { cwd });

    const checks = JSON.parse(stdout) as Array<{ name: string; bucket: string }>;
    if (checks.length === 0) return 'success'; // No CI configured
    if (checks.every((c) => c.bucket === 'pass')) return 'success';
    if (checks.some((c) => c.bucket === 'fail')) return 'failure';
    return 'pending';
  } catch {
    return 'pending';
  }
}
