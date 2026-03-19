/**
 * PR Top Bar State Machine
 *
 * Pure function that derives the action button state from branch/PR/CI data.
 *
 *   INPUT (branch state)              ACTION BUTTON
 *   ─────────────────────────────────────────────────
 *   No commits ahead                  (none)
 *   Commits ahead, no PR              [Create PR]
 *   PR Draft                          [Ready for Review]
 *   PR Open + CI passing              [Code Review]
 *   PR Open + CI failing              [Fix Errors N/M]
 *   PR Open + CI pending              [Checks Running...]
 *   PR Merged                         [Archive]
 *   PR Closed                         [Archive]
 */

export type PrActionType =
  | 'none'
  | 'create-pr'
  | 'ready-for-review'
  | 'code-review'
  | 'fix-errors'
  | 'checks-running'
  | 'archive-merged'
  | 'archive-closed';

export type StatusColor =
  | 'accent'
  | 'success'
  | 'error'
  | 'warning'
  | 'merged'
  | 'muted'
  | 'none';

export interface PrAction {
  type: PrActionType;
  color: StatusColor;
  label: string;
}

export interface PrStateInput {
  commitsAhead: number;
  prState: 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT' | null;
  ciPassing: number;
  ciFailing: number;
  ciPending: number;
  ciTotal: number;
}

export function derivePrAction(input: PrStateInput): PrAction {
  const { commitsAhead, prState, ciFailing, ciPending, ciTotal } = input;

  // No commits ahead of base — nothing to do
  if (commitsAhead <= 0 && prState === null) {
    return { type: 'none', color: 'none', label: '' };
  }

  // No PR exists but there are commits — offer to create
  if (prState === null) {
    return { type: 'create-pr', color: 'accent', label: 'Create PR' };
  }

  // PR is a draft — offer to mark ready
  if (prState === 'DRAFT') {
    return { type: 'ready-for-review', color: 'muted', label: 'Ready for Review' };
  }

  // PR is merged — offer cleanup
  if (prState === 'MERGED') {
    return { type: 'archive-merged', color: 'merged', label: 'Archive' };
  }

  // PR is closed (not merged) — offer cleanup
  if (prState === 'CLOSED') {
    return { type: 'archive-closed', color: 'muted', label: 'Archive' };
  }

  // PR is open — check CI status
  if (prState === 'OPEN') {
    // CI checks are failing
    if (ciFailing > 0) {
      return {
        type: 'fix-errors',
        color: 'error',
        label: `Fix Errors ${ciFailing}/${ciTotal}`,
      };
    }

    // CI checks are still running (some pending, none failing)
    if (ciPending > 0) {
      return { type: 'checks-running', color: 'warning', label: 'Checks Running...' };
    }

    // All CI checks passing (or no checks configured)
    return { type: 'code-review', color: 'success', label: 'Code Review' };
  }

  // Fallback — should not reach here
  return { type: 'none', color: 'none', label: '' };
}

export function getActionPrompt(action: PrAction, branchName: string): string | null {
  switch (action.type) {
    case 'create-pr':
      return `Create a pull request for the branch "${branchName}". Write a clear title and description based on the changes.`;
    case 'ready-for-review':
      return `Mark the draft PR for branch "${branchName}" as ready for review using: gh pr ready`;
    case 'code-review':
      return `Review the code changes in the pull request for branch "${branchName}". Check for bugs, code quality, and suggest improvements.`;
    case 'fix-errors':
      return `The CI checks are failing on branch "${branchName}". Investigate the failing checks and fix the errors.`;
    case 'archive-merged':
    case 'archive-closed':
      return null; // Archive is a UI action (delete worktree), not a Claude prompt
    case 'checks-running':
    case 'none':
      return null;
  }
}

export function getStatusCssVar(color: StatusColor): string {
  switch (color) {
    case 'accent': return 'var(--accent)';
    case 'success': return 'var(--status-success)';
    case 'error': return 'var(--status-error)';
    case 'warning': return 'var(--status-warning)';
    case 'merged': return 'var(--status-merged)';
    case 'muted': return 'var(--border)';
    case 'none': return 'transparent';
  }
}

export function shouldUseDarkText(color: StatusColor): boolean {
  return color === 'success' || color === 'warning';
}
