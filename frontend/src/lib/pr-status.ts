import type { PullRequest } from './types.js';

export type PrDotStatus = 'draft' | 'open' | 'approved' | 'changes-requested' |
  'review-requested' | 'merged' | 'closed' | 'unknown';

export function derivePrDotStatus(pr: PullRequest): PrDotStatus {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  return 'open';
}

export type JiraDotStatus = 'in-progress' | 'code-review' | 'ready-for-qa' | 'unmapped';

export function deriveJiraDotStatus(
  issueStatus: string,
  statusMappings?: Record<string, string>
): JiraDotStatus {
  if (!statusMappings) return 'unmapped';
  for (const [workflowState, mappedStatus] of Object.entries(statusMappings)) {
    if (mappedStatus === issueStatus) {
      if (workflowState === 'in-progress') return 'in-progress';
      if (workflowState === 'code-review') return 'code-review';
      if (workflowState === 'ready-for-qa') return 'ready-for-qa';
    }
  }
  return 'unmapped';
}
