export type PipelineState =
  | 'intake'
  | 'brainstorming'
  | 'prd_review'
  | 'planning'
  | 'plan_review'
  | 'executing'
  | 'reviewing'
  | 'retry'
  | 'stuck'
  | 'pr_created'
  | 'ci_monitoring'
  | 'ready_for_review'
  | 'done'
  | 'failed';

export interface TaskSpec {
  source: 'jira' | 'linear' | 'github' | 'text';
  externalId?: string | undefined;
  externalUrl?: string | undefined;
  title: string;
  description: string;
  acceptanceCriteria?: string[] | undefined;
  labels?: string[] | undefined;
  priority?: 'low' | 'medium' | 'high' | 'critical' | undefined;
  assignee?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface PipelineConfig {
  models: {
    brainstorm: string;
    execute: string;
    review: string;
  };
  maxAttempts: number;
  autoPush: boolean;
  targetRepo: string;
  baseBranch: string;
}

export interface Verdict {
  goalName: string;
  pass: boolean;
  criteriaResults: Array<{
    criterion: string;
    met: boolean;
    reason?: string | undefined;
  }>;
  summary: string;
  suggestions?: string[] | undefined;
  timestamp: string;
}

export interface Pipeline {
  id: string;
  state: PipelineState;
  task: TaskSpec;
  config: PipelineConfig;
  createdAt: string;
  updatedAt: string;
  prdContent?: string | undefined;
  planContent?: string | undefined;
  worktreePath?: string | undefined;
  branchName?: string | undefined;
  prNumber?: number | undefined;
  prUrl?: string | undefined;
  attempts: number;
  maxAttempts: number;
  verdicts: Verdict[];
  stuckReport?: string | undefined;
  activeSessionId?: string | undefined;
  error?: string | undefined;
}

export interface TaskSource {
  readonly name: string;
  fetch(input: string): Promise<TaskSpec>;
  canHandle(input: string): boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  models: { brainstorm: 'opus', execute: 'opus', review: 'sonnet' },
  maxAttempts: 3,
  autoPush: true,
  targetRepo: '',
  baseBranch: 'main',
};

export const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  intake: ['brainstorming', 'failed'],
  brainstorming: ['prd_review', 'failed'],
  prd_review: ['planning', 'brainstorming', 'failed'],
  planning: ['plan_review', 'failed'],
  plan_review: ['executing', 'planning', 'failed'],
  executing: ['reviewing', 'failed'],
  reviewing: ['pr_created', 'retry', 'stuck', 'failed'],
  retry: ['executing', 'stuck', 'failed'],
  stuck: ['executing', 'failed'],
  pr_created: ['ci_monitoring', 'done', 'failed'],
  ci_monitoring: ['ready_for_review', 'failed'],
  ready_for_review: ['done', 'failed'],
  done: [],
  failed: ['intake'],
};
