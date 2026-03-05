import fs from 'node:fs';
import path from 'node:path';
import * as sessions from '../sessions.js';
import type { Pipeline, Verdict } from './types.js';
import { transitionPipeline, updatePipeline, getPipeline } from './pipeline.js';
import { buildBrainstormPrompt, buildPlanPrompt, buildExecutionPrompt, buildReviewPrompt, buildStuckPrompt } from './prompts.js';

export function buildClaudeArgs(model: string): string[] {
  return ['-p', '--dangerously-skip-permissions', '--model', model];
}

export function parseVerdictFile(content: string): Verdict | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      typeof parsed.goalName !== 'string' ||
      typeof parsed.pass !== 'boolean' ||
      !Array.isArray(parsed.criteriaResults) ||
      typeof parsed.summary !== 'string'
    ) {
      return null;
    }
    return parsed as unknown as Verdict;
  } catch {
    return null;
  }
}

type PipelineEventCallback = (pipelineId: string, event: string, data?: Record<string, unknown>) => void;

let eventCallback: PipelineEventCallback | null = null;

export function onPipelineEvent(cb: PipelineEventCallback): void {
  eventCallback = cb;
}

function emitEvent(pipelineId: string, event: string, data?: Record<string, unknown>): void {
  if (eventCallback) eventCallback(pipelineId, event, data);
}

export async function startPipeline(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  // Move from intake to brainstorming
  transitionPipeline(pipelineId, 'brainstorming');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'brainstorming' });

  const prompt = buildBrainstormPrompt(pipeline.task);
  await runAgentPhase(pipelineId, prompt, pipeline.config.models.brainstorm, pipeline.config.targetRepo, (output) => {
    // Store brainstorm output as PRD
    updatePipeline(pipelineId, { prdContent: output });
    transitionPipeline(pipelineId, 'prd_review');
    emitEvent(pipelineId, 'pipeline-state-changed', { state: 'prd_review' });
  });
}

export async function approvePrd(pipelineId: string, editedContent?: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);
  if (pipeline.state !== 'prd_review') throw new Error('Pipeline not in prd_review state');

  if (editedContent) {
    updatePipeline(pipelineId, { prdContent: editedContent });
  }

  transitionPipeline(pipelineId, 'planning');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'planning' });

  const updatedPipeline = getPipeline(pipelineId)!;
  const prompt = buildPlanPrompt(updatedPipeline.task, updatedPipeline.prdContent || '');
  await runAgentPhase(pipelineId, prompt, updatedPipeline.config.models.brainstorm, updatedPipeline.config.targetRepo, (output) => {
    updatePipeline(pipelineId, { planContent: output });
    transitionPipeline(pipelineId, 'plan_review');
    emitEvent(pipelineId, 'pipeline-state-changed', { state: 'plan_review' });
  });
}

export async function approvePlan(pipelineId: string, editedContent?: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);
  if (pipeline.state !== 'plan_review') throw new Error('Pipeline not in plan_review state');

  if (editedContent) {
    updatePipeline(pipelineId, { planContent: editedContent });
  }

  await startExecution(pipelineId);
}

export async function startExecution(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  transitionPipeline(pipelineId, 'executing');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'executing' });

  const failedVerdicts = pipeline.verdicts.filter((v) => !v.pass);
  const prompt = buildExecutionPrompt(pipeline.task, pipeline.planContent || '', failedVerdicts.length > 0 ? failedVerdicts : undefined);

  // TODO: Create git worktree for execution if not already created
  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;

  await runAgentPhase(pipelineId, prompt, pipeline.config.models.execute, cwd, () => {
    startReview(pipelineId);
  });
}

export async function startReview(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  transitionPipeline(pipelineId, 'reviewing');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'reviewing' });

  const cwd = pipeline.worktreePath || pipeline.config.targetRepo;
  const prompt = buildReviewPrompt(pipeline.task, cwd);

  await runAgentPhase(pipelineId, prompt, pipeline.config.models.review, cwd, () => {
    // Try to read verdict file
    const verdictPath = path.join(cwd, '.belayer', 'verdict.json');
    let verdict: Verdict | null = null;
    try {
      const content = fs.readFileSync(verdictPath, 'utf8');
      verdict = parseVerdictFile(content);
    } catch {
      // No verdict file
    }

    if (verdict) {
      const updatedPipeline = getPipeline(pipelineId)!;
      const verdicts = [...updatedPipeline.verdicts, verdict];
      updatePipeline(pipelineId, { verdicts });
      emitEvent(pipelineId, 'pipeline-verdict', { verdict });

      if (verdict.pass) {
        transitionPipeline(pipelineId, 'pr_created');
        emitEvent(pipelineId, 'pipeline-state-changed', { state: 'pr_created' });
        // TODO: create PR
      } else if (updatedPipeline.attempts >= updatedPipeline.maxAttempts) {
        const stuckReport = buildStuckPrompt(updatedPipeline.task, verdicts, updatedPipeline.attempts);
        updatePipeline(pipelineId, { stuckReport });
        transitionPipeline(pipelineId, 'stuck');
        emitEvent(pipelineId, 'pipeline-state-changed', { state: 'stuck' });
      } else {
        transitionPipeline(pipelineId, 'retry');
        emitEvent(pipelineId, 'pipeline-state-changed', { state: 'retry' });
        // Re-execute with feedback
        startExecution(pipelineId);
      }
    } else {
      // No verdict — treat as failure
      transitionPipeline(pipelineId, 'failed');
      updatePipeline(pipelineId, { error: 'Review did not produce a verdict.json file' });
      emitEvent(pipelineId, 'pipeline-state-changed', { state: 'failed' });
    }
  });
}

export async function resumeFromStuck(pipelineId: string): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);
  if (pipeline.state !== 'stuck') throw new Error('Pipeline not in stuck state');

  transitionPipeline(pipelineId, 'executing');
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'executing' });
  await startExecution(pipelineId);
}

export function abortPipeline(pipelineId: string): void {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found: ' + pipelineId);

  // Kill active session if any
  if (pipeline.activeSessionId) {
    try {
      sessions.kill(pipeline.activeSessionId);
    } catch {
      // Session may already be gone
    }
    updatePipeline(pipelineId, { activeSessionId: undefined });
  }

  transitionPipeline(pipelineId, 'failed');
  updatePipeline(pipelineId, { error: 'Aborted by user' });
  emitEvent(pipelineId, 'pipeline-state-changed', { state: 'failed' });
}

async function runAgentPhase(
  pipelineId: string,
  prompt: string,
  model: string,
  cwd: string,
  onComplete: (output: string) => void,
): Promise<void> {
  const args = buildClaudeArgs(model);
  let output = '';

  const session = sessions.create({
    type: 'repo',
    repoPath: cwd,
    cwd,
    command: 'claude',
    args,
    displayName: `belayer-${pipelineId.slice(0, 8)}`,
  });

  updatePipeline(pipelineId, { activeSessionId: session.id });

  // Write prompt to the PTY's stdin
  sessions.write(session.id, prompt + '\n');

  // Monitor for completion via PTY exit
  const ptySession = sessions.get(session.id);
  if (ptySession) {
    // Collect output
    const dataDisposable = ptySession.pty.onData((data) => {
      output += data;
      emitEvent(pipelineId, 'pipeline-output', { chunk: data });
    });

    ptySession.pty.onExit(() => {
      dataDisposable.dispose();
      updatePipeline(pipelineId, { activeSessionId: undefined });
      onComplete(output);
    });
  }
}
