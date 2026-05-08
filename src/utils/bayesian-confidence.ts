/**
 * Bayesian Confidence Scoring for YouTube Patterns
 * ─────────────────────────────────────────────────
 *
 * Uses Beta distribution for confidence estimation.
 * Supports custom priors via priorAlpha/priorBeta for niche-validated patterns.
 * Credible intervals via Beta distribution approximation.
 * Recency decay for trend sensitivity (configurable half-life per niche).
 * Differential impact bonus for performance outliers.
 *
 * Ground truth: All inputs (successes, trials, performanceDelta) must come
 * from actual YouTube metrics (views, engagement, watch time). Never hallucinate.
 *
 * KNOWN GAP: performanceDelta should ideally be normalized against niche median,
 * not just channel average. When niche_median data is available in the Hive Mind
 * DB, update callers to pass (video_performance / niche_median) instead of
 * (video_performance / channel_average). Tracked in: BAYESIAN_INTEGRATION_GUIDE.md
 */

export interface ConfidenceInput {
  successes: number;          // Count: times pattern produced above-baseline result
  trials: number;             // Count: total times pattern was tested
  performanceDelta?: number;  // Observed uplift ratio: 1.5 = +50%, 3.0 = +200%
  recencyDays?: number;       // Days since pattern was last observed in the wild
  decayHalfLife?: number;     // Days until confidence halves from age (default 90)
  // Optional niche-aware prior. Defaults to Beta(3,3) = 0.5 neutral baseline.
  // Use when you have validated industry priors (e.g. curiosity-gap hooks
  // are known to work at ~0.70 in comedy — set priorAlpha=7, priorBeta=3).
  // Rule of thumb: priorAlpha + priorBeta should be ≤ 10 to stay "weak"
  // and allow real data to dominate once you have 10+ observations.
  priorAlpha?: number;        // Beta prior α (pseudo-successes). Default 2.
  priorBeta?: number;         // Beta prior β (pseudo-failures). Default 2.
}

export interface ConfidenceOutput {
  confidence: number;                   // 0.10 - 0.95
  credibleInterval: [number, number];   // 95% CI, narrows with sample size
  interpretation: string;              // Human label
  isDifferentiallyStronger: boolean;   // True if performanceDelta > 1.3
  adjustedForRecency: boolean;         // True if decay was applied
  isTentative: boolean;                // True if effective sample size < 5
  effectiveSampleSize: number;         // Trials + prior pseudo-observations
}

/**
 * Calculate Bayesian confidence using Beta distribution.
 *
 * Prior:
 *   Default Beta(3,3) = priorAlpha=2, priorBeta=2 pseudo-observations.
 *   Centered at 0.5, neutral. Requires ~5 real trials to meaningfully move.
 *   Override with priorAlpha/priorBeta for validated niche patterns.
 *
 * Differential impact:
 *   If performanceDelta > 1.3 (+30% uplift), confidence gets a scaled bonus.
 *   Bonus is capped at +0.15 to prevent over-inflation.
 *   Note: For rigorous niche comparison, normalize performanceDelta against
 *   niche median before passing in (see KNOWN GAP above).
 *
 * Recency decay:
 *   Exponential decay applied when recencyDays > decayHalfLife/2.
 *   Avoids penalizing fresh, recently-confirmed patterns.
 */
export function calculateBayesianConfidence({
  successes,
  trials,
  performanceDelta = 1.0,
  recencyDays = 0,
  decayHalfLife = 90,
  priorAlpha = 2,
  priorBeta = 2,
}: ConfidenceInput): ConfidenceOutput {

  // ─────────────────────────────────────────────────────────────
  // Step 1: Beta distribution posterior mean
  // posterior_mean = (α + successes) / (α + β + trials)
  // ─────────────────────────────────────────────────────────────

  const alpha = priorAlpha + successes;
  const beta  = priorBeta  + (trials - successes);
  const effectiveSampleSize = alpha + beta;
  let confidence = alpha / effectiveSampleSize;

  // ─────────────────────────────────────────────────────────────
  // Step 2: Differential impact bonus
  // ─────────────────────────────────────────────────────────────

  let isDifferentiallyStronger = false;

  if (performanceDelta > 1.3) {
    // Scales: 1.3x → +0.018, 2.0x → +0.060, 3.0x → +0.120, 4x → +0.150 (cap)
    const impactBonus = Math.min(0.15, (performanceDelta - 1.0) * 0.06);
    confidence = Math.min(confidence + impactBonus, 0.92);
    isDifferentiallyStronger = true;
  }

  // ─────────────────────────────────────────────────────────────
  // Step 3: Recency decay
  // Only fires when data is older than half-life / 2
  // ─────────────────────────────────────────────────────────────

  let adjustedForRecency = false;

  if (recencyDays > decayHalfLife / 2) {
    const decayFactor = Math.exp((-recencyDays * Math.LN2) / decayHalfLife);
    confidence = confidence * decayFactor;
    adjustedForRecency = true;
  }

  // ─────────────────────────────────────────────────────────────
  // Step 4: 95% credible interval — Beta distribution approximation
  // stderr = sqrt(p*(1-p)/n), z=1.96 for 95%
  // Narrows properly as effectiveSampleSize grows.
  // ─────────────────────────────────────────────────────────────

  const variance = (confidence * (1 - confidence)) / effectiveSampleSize;
  const stderr   = Math.sqrt(variance);
  const lower    = Math.max(0.10, confidence - 1.96 * stderr);
  const upper    = Math.min(0.95, confidence + 1.96 * stderr);

  // ─────────────────────────────────────────────────────────────
  // Step 5: Cap, round, interpret
  // ─────────────────────────────────────────────────────────────

  confidence = Math.max(0.10, Math.min(0.95, Math.round(confidence * 100) / 100));

  const isTentative = trials < 5;

  let interpretation: string;
  if (confidence >= 0.80)      interpretation = "Strongly validated";
  else if (confidence >= 0.70) interpretation = "Well supported";
  else if (confidence >= 0.60) interpretation = "Solid pattern";
  else if (confidence >= 0.50) interpretation = "Promising, needs more data";
  else if (confidence >= 0.40) interpretation = "Possible, still speculative";
  else                         interpretation = "Speculative / table-stakes";

  if (isTentative) interpretation += " (tentative — <5 trials)";

  return {
    confidence,
    credibleInterval: [
      Math.round(lower * 100) / 100,
      Math.round(upper * 100) / 100,
    ],
    interpretation,
    isDifferentiallyStronger,
    adjustedForRecency,
    isTentative,
    effectiveSampleSize,
  };
}

/**
 * Format confidence as a compact human string.
 * Example: "82% (71%-91%, well supported) [strong impact]"
 */
export function formatConfidence(result: ConfidenceOutput): string {
  const pct      = Math.round(result.confidence * 100);
  const [lo, hi] = result.credibleInterval;
  const loPct    = Math.round(lo * 100);
  const hiPct    = Math.round(hi * 100);

  const tags: string[] = [];
  if (result.isDifferentiallyStronger) tags.push("strong impact");
  if (result.adjustedForRecency)       tags.push("recency-adjusted");
  if (result.isTentative)              tags.push("tentative");

  const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
  return `${pct}% (${loPct}%-${hiPct}%, ${result.interpretation})${tagStr}`;
}

/**
 * Turn a full God's Eye brief into a one-paragraph Jobs-level memo
 * + bullet leverage points. For human creators who won't read JSON.
 *
 * Usage: toHumanReadable(brief) → string
 */
export function toHumanReadable(brief: {
  channel_name: string;
  niche: string;
  sample_size: number;
  confidence_level: string;
  hook_analysis: { score: number; psychology: string; weaknesses: string[] };
  top_patterns: Array<{
    pattern: string;
    confidence: number;
    performance_delta: string;
    actionable_form: string;
    credible_interval?: [number, number];
  }>;
  competitor_gaps: Array<{ gap: string; how_to_exploit: string }>;
  recommendations: Array<{ rank: number; technique: string; implementation: string; priority: string }>;
  visual_pacing?: {
    pace_profile: string;
    cut_frequency: string;
    thumbnail_strategy: string;
    broll_cues: string[];
    avatar_direction: { emotion_map: Record<string, string>; gesture_intensity: string };
  };
  caveats: { sample_size_note: string };
}): string {
  const { channel_name, niche, sample_size, hook_analysis, top_patterns, recommendations, visual_pacing, caveats } = brief;

  // One-paragraph summary
  const hookGrade = hook_analysis.score >= 8 ? "strong" : hook_analysis.score >= 6 ? "solid" : "weak";
  const topPattern = top_patterns[0];
  const topRec = recommendations.find(r => r.priority === "HIGH") ?? recommendations[0];

  const summary =
    `${channel_name} (${niche}, n=${sample_size}): Hook scoring ${hookGrade} ` +
    `[${hook_analysis.score}/10, ${hook_analysis.psychology}]. ` +
    `Highest-confidence pattern: "${topPattern?.pattern ?? "none"}" ` +
    `(${Math.round((topPattern?.confidence ?? 0) * 100)}%, ${topPattern?.performance_delta ?? "no delta"}). ` +
    `Top lever: ${topRec?.technique ?? "no clear lever"}.`;

  // Bullet leverage points — HIGH priority first, then MEDIUM
  const bullets = recommendations
    .filter(r => r.priority !== "LOW")
    .slice(0, 4)
    .map(r => `• [${r.priority}] ${r.technique}: ${r.implementation}`);

  // Hook weakness callout
  const hookIssues = hook_analysis.weaknesses.length
    ? `\nHook gap: ${hook_analysis.weaknesses[0]}`
    : "";

  // Visual & pacing section (production-ready for HeyGen/ComfyUI team)
  let visualSection = "";
  if (visual_pacing) {
    const emotionEntries = Object.entries(visual_pacing.avatar_direction.emotion_map)
      .slice(0, 3)
      .map(([ts, em]) => `  ${ts} → ${em}`)
      .join("\n");
    visualSection = [
      "\nVisual & Pacing:",
      `• Pace: ${visual_pacing.pace_profile}`,
      `• Cuts: ${visual_pacing.cut_frequency}`,
      `• Thumbnail: ${visual_pacing.thumbnail_strategy}`,
      `• Avatar arc:\n${emotionEntries}`,
    ].join("\n");
  }

  // Caveat footer
  const caveat = `\nNote: ${caveats.sample_size_note}`;

  return [summary, "", ...bullets, hookIssues, visualSection, caveat].filter(Boolean).join("\n");
}

/*
 * ─────────────────────────────────────────────────────────────
 * Usage examples
 * ─────────────────────────────────────────────────────────────
 *
 * DEFAULT PRIOR (neutral, unknown niche):
 * calculateBayesianConfidence({ successes: 7, trials: 10, performanceDelta: 2.3 })
 * → confidence ~0.82, "Well supported [strong impact]"
 *
 * NICHE-AWARE PRIOR (comedy, curiosity-gap hooks known to work at ~0.70):
 * calculateBayesianConfidence({
 *   successes: 7, trials: 10, performanceDelta: 2.3,
 *   priorAlpha: 7, priorBeta: 3   // encodes "we expect 70% base rate"
 * })
 * → confidence higher because prior and data agree
 *
 * LOW DATA + OLD (tentative, decayed):
 * calculateBayesianConfidence({
 *   successes: 2, trials: 3,
 *   recencyDays: 150, decayHalfLife: 60  // fast-moving trend niche
 * })
 * → confidence low, isTentative=true, adjustedForRecency=true
 *
 * NICHE decayHalfLife recommendations:
 *   Celebrity drama / meme trends:    30-45 days
 *   Comedy formats:                   60-90 days
 *   Evergreen (education, tutorials): 180-365 days
 */
