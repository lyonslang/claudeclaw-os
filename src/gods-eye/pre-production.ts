/**
 * Gods Eye — Pre-Production Scoring
 * Scores a concept 0-100 against an existing brief.
 * 60% pattern match + 40% confidence-weighted. Arc alignment bonus.
 */

import type { GodsEyeBrief, PreProductionScoreResult } from './types.js';
import { classifyTitleSentiment } from './emotional-arc.js';

/**
 * Score a proposed video concept against a God's Eye brief BEFORE production.
 * Tells you how well aligned the concept is with what actually works on the channel.
 */
export function preProductionScore(
  brief: GodsEyeBrief,
  concept: { title: string; hook?: string; format?: string }
): PreProductionScoreResult {
  const title = concept.title || '';
  const hook = concept.hook || title;
  const combined = `${title} ${hook} ${concept.format || ''}`.toLowerCase();

  const matched: string[] = [];
  const missing: string[] = [];
  let confidenceSum = 0;
  let matchedConfidenceSum = 0;

  // Check each pattern from the brief
  for (const pattern of brief.top_patterns) {
    confidenceSum += pattern.confidence;

    const patternLower = pattern.pattern.toLowerCase();

    const isMatch =
      patternLower.split(/\s+/).filter(w => w.length > 4).some(w => combined.includes(w)) ||
      (patternLower.includes('question') && title.includes('?')) ||
      (patternLower.includes('ellipsis') && (title.includes('\u2026') || title.includes('...'))) ||
      (patternLower.includes('controversy') && /GOES OFF|EXPOSE|CALLS OUT|RESPONDS/i.test(title)) ||
      (patternLower.includes('explanation') && /here'?s why|the truth|real reason/i.test(title)) ||
      (patternLower.includes('short clip') && concept.format?.toLowerCase().includes('short')) ||
      (patternLower.includes('deep-dive') && concept.format?.toLowerCase().includes('long'));

    if (isMatch) {
      matched.push(pattern.pattern);
      matchedConfidenceSum += pattern.confidence;
    } else if (pattern.confidence >= 0.60) {
      missing.push(`${pattern.pattern} (${Math.round(pattern.confidence * 100)}%)`);
    }
  }

  // Pattern match score
  const patternScore = brief.top_patterns.length > 0
    ? (matched.length / brief.top_patterns.length) * 100
    : 50;

  // Confidence-weighted score
  const weightedScore = confidenceSum > 0
    ? (matchedConfidenceSum / confidenceSum) * 100
    : 50;

  // Arc alignment
  const sentiment = classifyTitleSentiment(title);
  let arcAlignment = 'neutral';
  if (sentiment) {
    if (sentiment.emotion === brief.emotional_arc.opening.emotion) arcAlignment = 'opening (hook)';
    else if (sentiment.emotion === brief.emotional_arc.peak.emotion) arcAlignment = 'peak (climax)';
    else if (sentiment.emotion === brief.emotional_arc.middle.emotion) arcAlignment = 'middle (build)';
    else arcAlignment = `${sentiment.emotion} (${sentiment.technique})`;
  }

  // Final score: 60% pattern match + 40% confidence-weighted
  const score = Math.round(patternScore * 0.6 + weightedScore * 0.4);

  const summary = matched.length > 0
    ? `Matches ${matched.length}/${brief.top_patterns.length} patterns (${score}/100). ` +
      `Strongest: ${matched[0]}.` +
      (missing.length > 0 ? ` Missing: ${missing[0]}.` : '')
    : `No pattern matches detected (${score}/100). Consider incorporating: ${missing.slice(0, 2).join(', ') || 'more data needed'}.`;

  return {
    score,
    matched_patterns: matched,
    missing_patterns: missing,
    arc_alignment: arcAlignment,
    confidence_weighted_score: Math.round(weightedScore),
    summary,
  };
}