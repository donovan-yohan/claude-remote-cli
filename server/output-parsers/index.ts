import type { AgentType } from '../types.js';
import { ClaudeOutputParser } from './claude-parser.js';
import { CodexOutputParser } from './codex-parser.js';

/** Semantic states an agent can be in, derived from terminal output */
export type AgentState = 'initializing' | 'waiting-for-input' | 'processing' | 'permission-prompt' | 'error' | 'idle';

/** Result of parsing a chunk of terminal output */
export interface ParseResult {
  state: AgentState;
}

/** Per-vendor parser — each agent type implements this */
export interface OutputParser {
  /** Called on each new PTY output chunk. Returns state change or null if no change. */
  onData(chunk: string, recentScrollback: string[]): ParseResult | null;
  /** Reset internal state (e.g., on session restart) */
  reset(): void;
}

/** Registry: factory per agent type */
export const outputParsers: Record<AgentType, () => OutputParser> = {
  claude: () => new ClaudeOutputParser(),
  codex: () => new CodexOutputParser(),
};
