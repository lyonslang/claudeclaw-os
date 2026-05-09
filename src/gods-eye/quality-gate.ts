/**
 * Gods Eye — Self-Critique Quality Gate
 * Checks CI width, metric specificity, recommendation detail, gap confidence.
 * Returns pass/fail + feedback.
 */

import type { Pattern, CompetitorGap, Recommendation, QualityGateResult } from './types.js';

export function applySelfCritiqueGate(
  patterns: Pattern[],
  gaps: CompetitorGap[],
  recommendations: Recommendation[]
): QualityGateResult {
  const issues: string[] = [];
  let clarity = 10;
  let actionability = 10;
  let novelty = 10;

  // Clarity check: credible interval width + success metrics
  patterns.forEach(p => {
    if (p.credible_interval) {
      const [lower, upper] = p.credible_interval;
      const width = upper - lower;
      if (width > 0.5) {
        clarity -= 2;
        issues.push(`Pattern "${p.pattern}" has wide uncertainty (${(width * 100).toFixed(0)}%) \u2014 needs more samples`);
      }
    }
    if (!p.success_metric || p.success_metric.length < 10) {
      clarity -= 2;
      issues.push(`Pattern "${p.pattern}" missing specific success metric`);
    }
  });

  // Actionability check: do recommendations have implementation details?
  recommendations.forEach(r => {
    if (!r.implementation || r.implementation.length < 20) {
      actionability -= 2;
      issues.push(`Recommendation "${r.technique}" too vague \u2014 needs implementation steps`);
    }
  });

  // Novelty check: are gaps truly novel or are they obvious?
  gaps.forEach(g => {
    if (g.confidence < 0.60) {
      novelty -= 1;
      issues.push(`Gap "${g.gap}" below 0.60 confidence \u2014 may be speculative`);
    }
  });

  // Ensure minimum scores
  clarity = Math.max(clarity, 1);
  actionability = Math.max(actionability, 1);
  novelty = Math.max(novelty, 1);

  return {
    clarity: clarity / 10,
    actionability: actionability / 10,
    novelty: novelty / 10,
    passed: clarity >= 7 && actionability >= 7 && novelty >= 6,
    feedback: issues,
  };
}