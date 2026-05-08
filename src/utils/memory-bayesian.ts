/**
 * memory-bayesian.ts
 * Bayesian confidence scoring for the memory system.
 *
 * Uses a Beta distribution to compute how "trustworthy" a memory is,
 * factoring in:
 * - Access frequency (successes = times the memory was surfaced and useful)
 * - Salience (current salience score, boosted by usage, penalized by irrelevance)
 * - Connections (how many other memories link to this one)
 * - Age (older memories with sustained access are more reliable)
 * - Importance (the initial LLM-assigned importance score)
 *
 * Used by:
 * - Consolidation: weight memories in the prompt so Gemini prioritizes high-confidence ones
 * - Decay: compute per-memory decay rate (frequently-accessed memories decay slower)
 * - Retrieval: re-rank search results by Bayesian confidence
 */

// ── Types ────────────────────────────────────────────────────────

export interface MemoryBayesianInput {
  importance: number;      // 0-1, from LLM extraction
  salience: number;        // 0-5+, decays daily, boosted by access
  connectionCount: number; // number of linked memories
  ageDays: number;         // days since creation
  accessCount: number;     // times accessed (derived from accessed_at vs created_at heuristic)
  pinned: boolean;         // pinned memories are always max confidence
}

export interface MemoryBayesianScore {
  confidence: number;      // 0-1, overall Bayesian confidence
  decayMultiplier: number; // 0.95-0.999, per-day decay rate (higher = slower decay)
  retrievalBoost: number;  // 0-2, multiplier for retrieval ranking
  tier: 'core' | 'established' | 'developing' | 'tentative';
}

// ── Scoring ──────────────────────────────────────────────────────

/**
 * Compute Bayesian confidence for a memory.
 *
 * Model:
 * - Prior: Beta(2, 2) = neutral 0.5 baseline
 * - Successes: access_count + connection_count (evidence the memory is useful)
 * - Trials: age_days / 7 (weeks of exposure — more time = more chances to prove useful)
 * - Importance acts as a prior weight (high importance = stronger initial belief)
 *
 * The result is a posterior mean that rises with evidence and falls with age
 * if the memory hasn't been accessed.
 */
export function computeMemoryConfidence(input: MemoryBayesianInput): MemoryBayesianScore {
  // Pinned memories are always max
  if (input.pinned) {
    return { confidence: 1.0, decayMultiplier: 1.0, retrievalBoost: 2.0, tier: 'core' };
  }

  // Prior strength scales with initial importance (higher importance = stronger prior belief)
  const priorAlpha = 2 + input.importance * 3; // 2-5 pseudo-successes
  const priorBeta = 2;                          // 2 pseudo-failures (symmetric weak prior)

  // Evidence: access count + connections = "successes" (proof of usefulness)
  const successes = input.accessCount + input.connectionCount * 0.5;

  // Trials: weeks of exposure (a memory that's 30 days old has had ~4 weeks to prove useful)
  // Minimum 1 week so brand-new memories aren't immediately penalized
  const trials = Math.max(1, input.ageDays / 7);

  // Beta posterior mean
  const alpha = priorAlpha + successes;
  const beta = priorBeta + Math.max(0, trials - successes);
  const posteriorMean = alpha / (alpha + beta);

  // Salience bonus: memories with high current salience get a small boost
  // (salience decays daily, so high salience = recently useful)
  const salienceBonus = Math.min(0.1, (input.salience - 1.0) * 0.05);

  // Final confidence: clamp to [0.05, 0.99]
  const confidence = Math.max(0.05, Math.min(0.99,
    posteriorMean + salienceBonus
  ));

  // Decay multiplier: higher confidence = slower decay
  // Range: 0.95 (fast decay, low confidence) to 0.999 (near-permanent, high confidence)
  const decayMultiplier = 0.95 + (confidence * 0.049);

  // Retrieval boost: 0-2 multiplier for re-ranking search results
  // Memories with high confidence should rank higher even if semantic similarity is equal
  const retrievalBoost = 0.5 + confidence * 1.5;

  // Tier classification
  let tier: MemoryBayesianScore['tier'];
  if (confidence >= 0.80) tier = 'core';
  else if (confidence >= 0.60) tier = 'established';
  else if (confidence >= 0.40) tier = 'developing';
  else tier = 'tentative';

  return {
    confidence: Math.round(confidence * 1000) / 1000,
    decayMultiplier: Math.round(decayMultiplier * 10000) / 10000,
    retrievalBoost: Math.round(retrievalBoost * 100) / 100,
    tier,
  };
}

/**
 * Estimate access count from memory timestamps.
 * Heuristic: if accessed_at > created_at, the memory was accessed at least once.
 * The ratio of (accessed_at - created_at) / age gives a rough access frequency.
 * This is imperfect but avoids adding a new column to the schema.
 */
export function estimateAccessCount(createdAt: number, accessedAt: number): number {
  if (accessedAt <= createdAt) return 0;
  // Each access bumps accessed_at. Rough estimate: time between last access and creation
  // divided by typical access interval (~1 day) gives approximate count.
  const daysBetween = (accessedAt - createdAt) / 86400;
  // Minimum 1 if there's any gap
  return Math.max(1, Math.round(daysBetween / 2));
}

/**
 * Batch-score a list of memories. Returns scores keyed by memory ID.
 */
export function scoreMemories(memories: Array<{
  id: number;
  importance: number;
  salience: number;
  connections: string; // JSON array
  created_at: number;
  accessed_at: number;
  pinned: number;
}>): Map<number, MemoryBayesianScore> {
  const now = Math.floor(Date.now() / 1000);
  const scores = new Map<number, MemoryBayesianScore>();

  for (const mem of memories) {
    let connectionCount = 0;
    try {
      const conns = JSON.parse(mem.connections || '[]');
      connectionCount = Array.isArray(conns) ? conns.length : 0;
    } catch { /* empty */ }

    const ageDays = Math.max(0, (now - mem.created_at) / 86400);
    const accessCount = estimateAccessCount(mem.created_at, mem.accessed_at);

    scores.set(mem.id, computeMemoryConfidence({
      importance: mem.importance,
      salience: mem.salience,
      connectionCount,
      ageDays,
      accessCount,
      pinned: mem.pinned === 1,
    }));
  }

  return scores;
}

export default { computeMemoryConfidence, estimateAccessCount, scoreMemories };
