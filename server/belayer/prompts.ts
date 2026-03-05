import type { TaskSpec, Verdict } from './types.js';

export function buildBrainstormPrompt(task: TaskSpec): string {
  let prompt = `You are a product engineer. Your goal is to brainstorm a design for the following task and produce a PRD (Product Requirements Document).

## Task

**Title:** ${task.title}

**Description:**
${task.description}
`;

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    prompt += `\n**Acceptance Criteria:**\n${task.acceptanceCriteria.map((c) => '- ' + c).join('\n')}\n`;
  }

  prompt += `
## Instructions

1. Analyze the task requirements
2. Brainstorm the design approach — consider trade-offs, alternatives, and edge cases
3. Produce a PRD with:
   - **Goal** (one sentence)
   - **Background** (context and motivation)
   - **Requirements** (numbered list of specific requirements)
   - **Acceptance Criteria** (testable criteria for each requirement)
   - **Technical Approach** (high-level architecture decisions)
   - **Non-Goals** (what this does NOT include)

Output the PRD as a markdown document.`;

  return prompt;
}

export function buildPlanPrompt(task: TaskSpec, prdContent: string): string {
  return `You are a senior engineer creating an implementation plan. You have a PRD to implement.

## Task

**Title:** ${task.title}

## PRD

${prdContent}

## Instructions

Create a detailed implementation plan with bite-sized tasks. For each task:
1. List exact files to create or modify
2. Describe the changes in detail
3. Include test requirements
4. Keep each task small enough to complete in one commit

Use the \`/harness:plan\` format: numbered tasks with file paths, step-by-step instructions, and commit messages.

Output the plan as a markdown document.`;
}

export function buildExecutionPrompt(task: TaskSpec, planContent: string, previousVerdicts?: Verdict[]): string {
  let prompt = `You are implementing a feature according to a plan. Follow the plan exactly, task by task. Use TDD where applicable. Commit after each task.

## Task

**Title:** ${task.title}

## Plan

${planContent}
`;

  if (previousVerdicts && previousVerdicts.length > 0) {
    prompt += `\n## PREVIOUS REVIEW FEEDBACK\n\nThe following review(s) found issues that must be fixed:\n\n`;
    for (const verdict of previousVerdicts) {
      prompt += `### Review: ${verdict.goalName}\n`;
      prompt += `**Result:** ${verdict.pass ? 'PASS' : 'FAIL'}\n`;
      prompt += `**Summary:** ${verdict.summary}\n`;
      for (const cr of verdict.criteriaResults) {
        if (!cr.met) {
          prompt += `- **FAILED:** ${cr.criterion}${cr.reason ? ' — ' + cr.reason : ''}\n`;
        }
      }
      if (verdict.suggestions && verdict.suggestions.length > 0) {
        prompt += `**Suggestions:** ${verdict.suggestions.join('; ')}\n`;
      }
      prompt += '\n';
    }
    prompt += `Fix ALL failed criteria before marking the work as complete.\n`;
  }

  prompt += `\n## Completion

When all tasks are done:
1. Run all tests and ensure they pass
2. Create a file \`.belayer/COMPLETE\` containing "done"
`;

  return prompt;
}

export function buildReviewPrompt(task: TaskSpec, worktreePath: string): string {
  let prompt = `You are an independent code reviewer. Review the implementation in this worktree against the task requirements.

## Task

**Title:** ${task.title}
**Description:** ${task.description}
`;

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    prompt += `\n**Acceptance Criteria:**\n${task.acceptanceCriteria.map((c) => '- ' + c).join('\n')}\n`;
  }

  prompt += `
## Instructions

1. Read the code changes (check git diff against the base branch)
2. Run the tests
3. Evaluate each acceptance criterion
4. Write a structured verdict

## Output

Write the verdict to \`.belayer/verdict.json\` with this exact shape:

\`\`\`json
{
  "goalName": "${task.title}",
  "pass": true or false,
  "criteriaResults": [
    { "criterion": "description", "met": true or false, "reason": "explanation" }
  ],
  "summary": "overall assessment",
  "suggestions": ["optional improvement suggestions"],
  "timestamp": "ISO 8601 timestamp"
}
\`\`\`

Be thorough but fair. Only fail criteria that are clearly not met.`;

  return prompt;
}

export function buildStuckPrompt(task: TaskSpec, verdicts: Verdict[], attempts: number): string {
  let prompt = `## STUCK REPORT

The pipeline for "${task.title}" is stuck after ${attempts} failed attempt(s).

## Verdict History

`;

  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]!;
    prompt += `### Attempt ${i + 1}: ${v.pass ? 'PASS' : 'FAIL'}\n`;
    prompt += `${v.summary}\n`;
    for (const cr of v.criteriaResults) {
      prompt += `- ${cr.met ? '\u2713' : '\u2717'} ${cr.criterion}${cr.reason ? ': ' + cr.reason : ''}\n`;
    }
    prompt += '\n';
  }

  prompt += `## Action Required

A human must review and decide:
1. **Fix and resume** — address the issues manually, then resume the pipeline
2. **Skip review** — force the pipeline to proceed to PR creation
3. **Abort** — cancel this pipeline
`;

  return prompt;
}
