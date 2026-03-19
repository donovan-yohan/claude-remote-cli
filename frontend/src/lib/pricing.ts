// Cost per token (USD) — Claude Sonnet as default
const SONNET_INPUT_COST = 3 / 1_000_000;   // $3 per 1M input tokens
const SONNET_OUTPUT_COST = 15 / 1_000_000;  // $15 per 1M output tokens

const OPUS_INPUT_COST = 15 / 1_000_000;     // $15 per 1M input tokens
const OPUS_OUTPUT_COST = 75 / 1_000_000;    // $75 per 1M output tokens

type ModelTier = 'sonnet' | 'opus';

const PRICING: Record<ModelTier, { input: number; output: number }> = {
  sonnet: { input: SONNET_INPUT_COST, output: SONNET_OUTPUT_COST },
  opus: { input: OPUS_INPUT_COST, output: OPUS_OUTPUT_COST },
};

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelTier = 'sonnet',
): number {
  const p = PRICING[model];
  return inputTokens * p.input + outputTokens * p.output;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'k';
  return String(count);
}

export function formatCost(cost: number): string {
  if (cost < 0.005) return '<$0.01';
  return '$' + cost.toFixed(2);
}
