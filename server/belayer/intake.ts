import type { TaskSource, TaskSpec } from './types.js';

export class TextSource implements TaskSource {
  readonly name = 'text';

  canHandle(input: string): boolean {
    return input.trim().length > 0;
  }

  async fetch(input: string): Promise<TaskSpec> {
    const lines = input.trim().split('\n').map((l) => l.trim());
    const title = lines[0] || '';
    const description = lines.length > 1 ? lines.slice(1).join('\n') : title;

    return {
      source: 'text',
      title,
      description,
    };
  }
}

const sources: TaskSource[] = [new TextSource()];

export function resolveTaskSource(input: string): TaskSource {
  if (!input.trim()) {
    throw new Error('No task source can handle empty input');
  }
  for (const source of sources) {
    if (source.canHandle(input)) return source;
  }
  throw new Error('No task source can handle this input');
}
