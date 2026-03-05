import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Pipeline, PipelineConfig, PipelineState, TaskSpec } from './types.js';
import { VALID_TRANSITIONS } from './types.js';

const pipelines = new Map<string, Pipeline>();

let pipelinesDir = path.join(
  os.homedir(),
  '.config',
  'claude-remote-cli',
  'pipelines',
);

export function setPipelinesDir(dir: string): void {
  pipelinesDir = dir;
}

function ensureDir(): void {
  if (!fs.existsSync(pipelinesDir)) {
    fs.mkdirSync(pipelinesDir, { recursive: true });
  }
}

function persist(pipeline: Pipeline): void {
  ensureDir();
  const filePath = path.join(pipelinesDir, pipeline.id + '.json');
  fs.writeFileSync(filePath, JSON.stringify(pipeline, null, 2), 'utf8');
}

export function createPipeline(task: TaskSpec, config: PipelineConfig): Pipeline {
  const now = new Date().toISOString();
  const pipeline: Pipeline = {
    id: crypto.randomBytes(8).toString('hex'),
    state: 'intake',
    task,
    config,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    maxAttempts: config.maxAttempts,
    verdicts: [],
  };
  pipelines.set(pipeline.id, pipeline);
  persist(pipeline);
  return pipeline;
}

export function getPipeline(id: string): Pipeline | null {
  return pipelines.get(id) ?? null;
}

export function listPipelines(): Pipeline[] {
  return Array.from(pipelines.values()).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function transitionPipeline(id: string, newState: PipelineState): Pipeline {
  const pipeline = pipelines.get(id);
  if (!pipeline) throw new Error('Pipeline not found: ' + id);

  const allowed = VALID_TRANSITIONS[pipeline.state];
  if (!allowed || !allowed.includes(newState)) {
    throw new Error(`Invalid transition from ${pipeline.state} to ${newState}`);
  }

  pipeline.state = newState;
  pipeline.updatedAt = new Date().toISOString();

  if (newState === 'retry') {
    pipeline.attempts += 1;
  }

  pipelines.set(id, pipeline);
  persist(pipeline);
  return pipeline;
}

export function updatePipeline(id: string, updates: Partial<Omit<Pipeline, 'id' | 'state'>>): Pipeline {
  const pipeline = pipelines.get(id);
  if (!pipeline) throw new Error('Pipeline not found: ' + id);

  Object.assign(pipeline, updates);
  pipeline.updatedAt = new Date().toISOString();
  pipelines.set(id, pipeline);
  persist(pipeline);
  return pipeline;
}

export function deletePipeline(id: string): void {
  pipelines.delete(id);
  const filePath = path.join(pipelinesDir, id + '.json');
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }
}

export function clearPipelines(): void {
  pipelines.clear();
}

export function loadAllPipelines(): void {
  ensureDir();
  const files = fs.readdirSync(pipelinesDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(pipelinesDir, file), 'utf8');
      const pipeline = JSON.parse(raw) as Pipeline;
      pipelines.set(pipeline.id, pipeline);
    } catch {
      // Skip malformed files
    }
  }
}
