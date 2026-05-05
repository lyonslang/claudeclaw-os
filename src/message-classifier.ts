/**
 * Tier-based message complexity classifier for smart model routing.
 *
 * Routes incoming messages to the appropriate tier (T1-T4) based on
 * content analysis. Each tier maps to a model:
 *   T1 (Core)      -> Haiku   (simple lookups, acks, casual chat)
 *   T2 (Equipped)  -> Haiku   (with Sonnet escalation on failure)
 *   T3 (Awakened)  -> Sonnet  (reasoning, creative, context-heavy)
 *   T4 (Legendary) -> Sonnet  (with Opus for final output)
 *
 * Pure string analysis, no external dependencies.
 */

export type Tier = 'T1' | 'T2' | 'T3' | 'T4';
export type LegacyComplexity = 'simple' | 'complex';

export interface TierResult {
  tier: Tier;
  model: string;
  reason: string;
}

// ── Tier model mapping ────────────────────────────────────────────────
const TIER_MODELS: Record<Tier, string> = {
  T1: 'claude-haiku-4-5',
  T2: 'claude-haiku-4-5',
  T3: 'claude-sonnet-4-6',
  T4: 'claude-sonnet-4-6',
};

// Allow override from config (set via setTierModels)
let tierModels = { ...TIER_MODELS };

export function setTierModels(overrides: Partial<Record<Tier, string>>): void {
  tierModels = { ...TIER_MODELS, ...overrides };
}

export function getTierModel(tier: Tier): string {
  return tierModels[tier];
}

// ── T1: Acknowledgments and simple casual messages ────────────────────
const ACK_PATTERNS = new Set([
  'ok', 'ok got it', 'got it', 'thanks', 'thank you', 'yes', 'no',
  'yep', 'nope', 'do it', 'send it', 'sounds good', 'perfect', 'cool',
  'nice', 'great', 'sure', 'lol', 'haha', 'done', 'agreed', 'fine',
  'k', 'kk', 'yea', 'yeah', 'nah', 'go ahead', 'go for it', 'ship it',
  'approved', 'looks good', 'lgtm', 'ty', 'thx', 'np', 'word',
  'bet', 'aight', 'alright', 'true', 'facts', 'my bad', 'all good',
  'good', 'same', 'right', 'exactly', 'for sure', 'definitely',
  'no worries', 'makes sense', 'fair enough', 'i see', 'interesting',
]);

// Casual conversation patterns (still T1 -- Haiku handles these fine)
const CASUAL_PATTERNS = [
  /^(hey|hi|hello|sup|yo|what'?s up|good (morning|night|evening)|gm|gn)/i,
  /^how('s| is| are) (it going|things|you|everything|life)/i,
  /^(just|only) (checking|saying|letting|asking)/i,
  /^(never ?mind|nvm|forget it|ignore that)/i,
  /^(testing|test|just testing)/i,
  /^(what do you think|thoughts)\??$/i,
  /^(yes|no|yea|yeah|nah) .{0,30}$/i, // short responses starting with yes/no
];

// ── T2: Skill triggers (specialized but single-step) ──────────────────
const T2_TRIGGERS = [
  // Phantom (browser)
  /\b(browse|scrape|click|fill form|open .+ (page|site|url)|navigate to)\b/i,
  // Legion (parallel)
  /\b(in parallel|batch|bulk|scale|run (multiple|all|each))\b/i,
  // Clockwork (scheduling)
  /\b(schedule|cron|every (day|hour|week|monday|morning)|recurring|run (daily|hourly|weekly))\b/i,
  // Herald (delegation)
  /\b(delegate|have .+ (do|handle|look|check)|send to .+ agent|assign to)\b/i,
  // Courier (email - simple actions)
  /\b(send (an )?email|check (my )?inbox|reply to .+ email|forward)\b/i,
  // Timekeeper (calendar - simple actions)
  /\b(check (my )?calendar|what('s| is) on my schedule|book a|create (a )?meeting)\b/i,
];

// ── T3: Complex reasoning, creative, and context-heavy ────────────────
const T3_TRIGGERS = [
  // Lens (video/image analysis)
  /\b(analyze (this )?(video|image|photo|thumbnail)|break down (the )?visuals|watch this)\b/i,
  // Loresmith (creative writing)
  /\b(write (a |me (a )?)?((short |youtube |video )?(story|script|narrative|chapter|scene))|fiction|character (development|arc))\b/i,
  // Complex analysis
  /\b(explain (why|how)|analyze|compare .+ (vs|versus|and)|deep dive|break(down| down))\b/i,
  // Code generation (non-trivial)
  /\b(build|implement|refactor|architect|create .+ (system|app|pipeline|service|tool))\b/i,
  // Multi-step reasoning
  /\b(plan|design|strategy|think through|figure out how)\b/i,
];

// ── T4: Full pipeline triggers ────────────────────────────────────────
const T4_TRIGGERS = [
  // Panopticon (full YouTube pipeline)
  /\b(full (analysis|pipeline|breakdown)|content (intel|intelligence)|run (the )?pipeline)\b/i,
  /\b(analyze (the )?channel|competitor (analysis|breakdown)|what'?s working (in|for))\b/i,
  // Skinwalker (avatar/video production)
  /\b(produce (a )?video|full render|generate (the )?avatar|clone (my )?voice .+ render)\b/i,
  /\b(end.to.end|full (content|video) production)\b/i,
];

// ── Special commands that should stay on current model ─────────────────
const SPECIAL_COMMANDS = [
  /^convolife$/i,
  /^checkpoint$/i,
  /^\/(stop|lock|status|newchat|model)/i,
];

/**
 * Strip punctuation from edges and collapse whitespace.
 */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify a message into a tier with model recommendation.
 */
export function classifyMessageTier(message: string): TierResult {
  const trimmed = message.trim();

  // Empty messages
  if (trimmed.length === 0) {
    return { tier: 'T1', model: tierModels.T1, reason: 'empty' };
  }

  // Special commands: don't downgrade, keep on current model
  for (const pattern of SPECIAL_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { tier: 'T3', model: tierModels.T3, reason: 'special-command' };
    }
  }

  // T4 check first (most specific, highest priority)
  for (const pattern of T4_TRIGGERS) {
    if (pattern.test(trimmed)) {
      return { tier: 'T4', model: tierModels.T4, reason: 'pipeline-trigger' };
    }
  }

  // T3 check
  for (const pattern of T3_TRIGGERS) {
    if (pattern.test(trimmed)) {
      return { tier: 'T3', model: tierModels.T3, reason: 'complex-reasoning' };
    }
  }

  // T2 check
  for (const pattern of T2_TRIGGERS) {
    if (pattern.test(trimmed)) {
      return { tier: 'T2', model: tierModels.T2, reason: 'skill-trigger' };
    }
  }

  // T1: Acknowledgments (exact match after normalization)
  const normalized = normalize(trimmed);
  if (ACK_PATTERNS.has(normalized)) {
    return { tier: 'T1', model: tierModels.T1, reason: 'acknowledgment' };
  }

  // T1: Casual patterns
  for (const pattern of CASUAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: 'T1', model: tierModels.T1, reason: 'casual-chat' };
    }
  }

  // Structural signals that bump to T3 (check before length heuristics)
  if (trimmed.includes('```')) {
    return { tier: 'T3', model: tierModels.T3, reason: 'code-content' };
  }
  if (/https?:\/\//.test(trimmed)) {
    return { tier: 'T3', model: tierModels.T3, reason: 'url-reference' };
  }
  if (/(?:^|\s)[~/]/.test(trimmed)) {
    return { tier: 'T3', model: tierModels.T3, reason: 'file-path' };
  }
  if (trimmed.length > 200) {
    return { tier: 'T3', model: tierModels.T3, reason: 'long-message' };
  }

  // Heuristics for T1 vs T2:

  // Very short messages without questions are usually T1
  if (trimmed.length < 60 && !trimmed.includes('?')) {
    return { tier: 'T1', model: tierModels.T1, reason: 'short-statement' };
  }

  // Short questions (< 80 chars, single line) route to T2
  if (trimmed.length < 80 && trimmed.includes('?') && !trimmed.includes('\n')) {
    return { tier: 'T2', model: tierModels.T2, reason: 'simple-question' };
  }

  // Default: T2 (Haiku, but acknowledges it might need more)
  return { tier: 'T2', model: tierModels.T2, reason: 'default' };
}

/**
 * Legacy compatibility wrapper. Returns 'simple' for T1, 'complex' for T2+.
 * Kept for backward compat with existing SMART_ROUTING_ENABLED logic.
 */
export function classifyMessageComplexity(message: string): 'simple' | 'complex' {
  const result = classifyMessageTier(message);
  return result.tier === 'T1' ? 'simple' : 'complex';
}
