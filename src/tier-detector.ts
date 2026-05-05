/**
 * tier-detector.ts
 * Automatically detects task tier (T1-T4) from mission prompts
 * Maps tasks to appropriate Claude models for cost optimization
 */

export type Tier = 'T1' | 'T2' | 'T3' | 'T4';
export type ModelName = 'haiku' | 'sonnet' | 'opus';

interface TierDetectionResult {
  tier: Tier;
  model: ModelName;
  estimatedCost: number; // in dollars
  reasoning: string;
  confidence: number; // 0-1
}

const T1_KEYWORDS = [
  'query', 'lookup', 'fetch', 'get', 'retrieve', 'find',
  'search', 'list', 'data', 'check', 'verify', 'confirm',
  'recent', 'latest', 'count', 'stats', 'metrics'
];

const T2_KEYWORDS = [
  'pattern', 'identify', 'detect', 'match', 'compare',
  'find similar', 'analyze', 'summary', 'brief', 'overview',
  'trend', 'theme', 'category', 'classify'
];

const T3_KEYWORDS = [
  'analyze', 'reasoning', 'reason', 'think', 'evaluate',
  'assess', 'decide', 'recommendation', 'recommend', 'feedback',
  'improve', 'refine', 'generate', 'create', 'write', 'compose',
  'emotional', 'beat', 'character', 'style', 'tone', 'originality',
  'strategy', 'approach', 'method', 'technique'
];

const T4_KEYWORDS = [
  'orchestr', 'coordinate', 'strategy', 'plan', 'architect',
  'full analysis', 'complete', 'comprehensive', 'final decision',
  'approve', 'launch', 'channel strategy', 'multi-agent', 'synthesis',
  'high-stakes', 'critical', 'important decision'
];

function countKeywordMatches(text: string, keywords: string[]): number {
  const lowerText = text.toLowerCase();
  return keywords.reduce((count, keyword) => {
    return count + (lowerText.includes(keyword) ? 1 : 0);
  }, 0);
}

function detectTierFromText(text: string): Tier {
  const t1Score = countKeywordMatches(text, T1_KEYWORDS);
  const t2Score = countKeywordMatches(text, T2_KEYWORDS);
  const t3Score = countKeywordMatches(text, T3_KEYWORDS);
  const t4Score = countKeywordMatches(text, T4_KEYWORDS);

  const scores = { T1: t1Score, T2: t2Score, T3: t3Score, T4: t4Score };
  const maxScore = Math.max(...Object.values(scores));

  // If T4 keywords present, it's likely T4
  if (t4Score > 0) return 'T4';
  if (t3Score > t2Score && t3Score > t1Score) return 'T3';
  if (t2Score > t1Score) return 'T2';
  return 'T1';
}

/**
 * Main function: detect tier from mission prompt
 */
export function detectTier(prompt: string): TierDetectionResult {
  const tier = detectTierFromText(prompt);

  const tierToModel: Record<Tier, ModelName> = {
    T1: 'haiku',
    T2: 'haiku', // start with Haiku, escalate if needed
    T3: 'sonnet',
    T4: 'sonnet', // Opus if truly high-stakes, but default to Sonnet
  };

  const tierToCost: Record<Tier, number> = {
    T1: 0.02, // rough estimate
    T2: 0.10,
    T3: 0.50,
    T4: 1.50,
  };

  const tierToReasoning: Record<Tier, string> = {
    T1: 'Simple data query - use Haiku (T1)',
    T2: 'Pattern matching / analysis - try Haiku, escalate if needed (T2)',
    T3: 'Reasoning / creativity required - use Sonnet (T3)',
    T4: 'Multi-agent orchestration / high-stakes decision - use Sonnet (T4)',
  };

  return {
    tier,
    model: tierToModel[tier],
    estimatedCost: tierToCost[tier],
    reasoning: tierToReasoning[tier],
    confidence: 0.75, // keyword-based detection is ~75% accurate
  };
}

/**
 * Format tier detection for API response
 */
export function formatTierDetection(detection: TierDetectionResult) {
  return {
    tier: detection.tier,
    model: detection.model,
    costEstimate: `$${detection.estimatedCost.toFixed(2)}`,
    reasoning: detection.reasoning,
    confidence: `${Math.round(detection.confidence * 100)}%`,
  };
}

/**
 * Tier routing instructions for agents
 */
export function getTierRoutingInstructions(tier: Tier): string {
  const instructions: Record<Tier, string> = {
    T1: `This is a T1 task (Haiku tier). Use Haiku for all operations.
Focus on: data queries, database lookups, simple retrievals.
Speed: ~1-2 seconds. Cost: ~$0.01-0.05.
If the task proves more complex than expected, escalate to T2/Sonnet.`,

    T2: `This is a T2 task (Haiku → Sonnet escalation). Start with Haiku.
Focus on: pattern matching, basic analysis, trend detection.
If Haiku hits complexity limits, escalate to Sonnet.
Cost: ~$0.05-0.50 depending on escalation.`,

    T3: `This is a T3 task (Sonnet tier). Use Sonnet.
Focus on: reasoning, analysis, recommendations, creative content generation.
This requires full reasoning capability.
Cost: ~$0.30-1.00 depending on prompt length.`,

    T4: `This is a T4 task (Sonnet/Opus tier). Use Sonnet by default, escalate to Opus for high-stakes final decisions.
Focus on: multi-agent orchestration, strategic planning, final approvals.
This requires full reasoning + context synthesis.
Cost: ~$1.00-3.00 per mission.`,
  };

  return instructions[tier];
}

/**
 * Suggest Opus escalation for truly critical decisions
 */
export function shouldEscalateToOpus(
  tier: Tier,
  prompt: string,
  riskLevel?: 'low' | 'medium' | 'high'
): boolean {
  if (tier !== 'T4') return false;

  const highRiskKeywords = [
    'approve for launch', 'final decision', 'critical',
    'high-stakes', 'major change', 'risky', 'dangerous'
  ];

  const hasHighRiskKeyword = highRiskKeywords.some(
    (keyword) => prompt.toLowerCase().includes(keyword)
  );

  return (riskLevel === 'high' || hasHighRiskKeyword);
}

export default {
  detectTier,
  formatTierDetection,
  getTierRoutingInstructions,
  shouldEscalateToOpus,
};
