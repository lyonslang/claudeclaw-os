/**
 * Gods Eye — Competitor Gap Analysis
 * 6 format detectors. Flags patterns used in <30% of videos with >1.3x engagement.
 * Zero hardcoded floats.
 */

import { calculateBayesianConfidence } from '../utils/bayesian-confidence.js';
import type { YouTubeVideo, CompetitorGap } from './types.js';
import { NICHE_DECAY_HALF_LIFE } from './patterns.js';

const FORMAT_DETECTORS: Array<{
  name: string;
  label: string;
  test: (title: string) => boolean;
  exploit: string;
}> = [
  { name: 'ellipsis', label: 'Ellipsis/cliffhanger titles', test: t => t.includes('\u2026') || t.includes('...'), exploit: 'End titles at the tension point with "\u2026" to force click-through' },
  { name: 'question', label: 'Question-format titles', test: t => t.includes('?'), exploit: 'Lead with a specific question viewers want answered' },
  { name: 'caps_phrase', label: 'ALL-CAPS emphasis phrases', test: t => /[A-Z]{3,}/.test(t), exploit: 'Add one ALL-CAPS emotional phrase to signal intensity (e.g. "GOES OFF", "FINALLY")' },
  { name: 'listicle', label: 'Numbered/listicle titles', test: t => /^\d+\s|\b\d+\s+(things|reasons|ways|tips|facts)/i.test(t), exploit: 'Structure content as numbered lists for clear value proposition in title' },
  { name: 'personal', label: 'First-person framing ("I", "My")', test: t => /\bI\b|\bMy\b/.test(t), exploit: 'Add personal perspective to build parasocial connection' },
  { name: 'name_drop', label: 'Celebrity/name-drop titles', test: t => /[A-Z][a-z]+ [A-Z][a-z]+/.test(t), exploit: 'Lead with recognizable names to leverage search and curiosity' },
];

export function analyzeCompetitorGaps(videos: YouTubeVideo[], niche: string): CompetitorGap[] {
  const gaps: CompetitorGap[] = [];
  if (videos.length < 3) return gaps;

  const channelAvgEngagement = videos.reduce((sum, v) => sum + v.engagement_rate, 0) / videos.length;
  const decayHalfLife = NICHE_DECAY_HALF_LIFE[niche] ?? 90;

  // ── Format gaps: underused patterns that outperform when present ──
  for (const detector of FORMAT_DETECTORS) {
    const matching = videos.filter(v => detector.test(v.title || ''));
    const notMatching = videos.filter(v => !detector.test(v.title || ''));

    if (matching.length < 2 || matching.length >= videos.length * 0.3) continue;

    const matchAvg = matching.reduce((sum, v) => sum + v.engagement_rate, 0) / matching.length;
    const baseAvg = notMatching.length > 0
      ? notMatching.reduce((sum, v) => sum + v.engagement_rate, 0) / notMatching.length
      : channelAvgEngagement;

    if (matchAvg <= baseAvg * 1.3 || baseAvg <= 0) continue;

    const delta = matchAvg / baseAvg;
    const successes = matching.filter(v => v.engagement_rate > baseAvg).length;

    const bayesian = calculateBayesianConfidence({
      successes,
      trials: matching.length,
      performanceDelta: delta,
      decayHalfLife,
    });

    if (bayesian.confidence < 0.40) continue;

    gaps.push({
      gap: `${detector.label} underused (${matching.length}/${videos.length} videos) but outperform by +${((delta - 1) * 100).toFixed(0)}%`,
      why_it_matters: `Used in only ${Math.round(matching.length / videos.length * 100)}% of content but drives ${((delta - 1) * 100).toFixed(0)}% higher engagement when present`,
      how_to_exploit: detector.exploit,
      risk_level: bayesian.isTentative ? 'medium' : 'low',
      confidence: bayesian.confidence,
    });
  }

  // ── Engagement variance gap ──
  const engagementValues = videos.map(v => v.engagement_rate);
  const mean = channelAvgEngagement;
  const variance = engagementValues.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / engagementValues.length;
  const stddev = Math.sqrt(variance);
  const coeffOfVariation = mean > 0 ? stddev / mean : 0;

  if (coeffOfVariation > 0.8 && videos.length >= 5) {
    const aboveAvg = videos.filter(v => v.engagement_rate > mean);
    const belowAvg = videos.filter(v => v.engagement_rate <= mean);

    const bayesian = calculateBayesianConfidence({
      successes: aboveAvg.length,
      trials: videos.length,
      performanceDelta: aboveAvg.length > 0
        ? (aboveAvg.reduce((s, v) => s + v.engagement_rate, 0) / aboveAvg.length) / Math.max(mean, 0.01)
        : 1.0,
    });

    gaps.push({
      gap: `High engagement variance (CV=${coeffOfVariation.toFixed(2)}) \u2014 ${aboveAvg.length} videos above avg, ${belowAvg.length} below`,
      why_it_matters: `Engagement swings from ${Math.min(...engagementValues).toFixed(1)}% to ${Math.max(...engagementValues).toFixed(1)}% \u2014 some formats clearly trigger discussion while others don't`,
      how_to_exploit: 'Reverse-engineer the top-engagement videos for common patterns (hook style, title format, topic type) and double down on what works',
      risk_level: 'low',
      confidence: bayesian.confidence,
    });
  }

  // ── Recency gap ──
  const sortedByDate = [...videos].sort((a, b) => {
    const tsA = new Date(a.published_at || 0).getTime();
    const tsB = new Date(b.published_at || 0).getTime();
    return tsB - tsA;
  });

  const recentHalf = sortedByDate.slice(0, Math.floor(videos.length / 2));
  const olderHalf = sortedByDate.slice(Math.floor(videos.length / 2));

  if (recentHalf.length >= 2 && olderHalf.length >= 2) {
    const recentAvg = recentHalf.reduce((s, v) => s + v.engagement_rate, 0) / recentHalf.length;
    const olderAvg = olderHalf.reduce((s, v) => s + v.engagement_rate, 0) / olderHalf.length;
    const ratio = olderAvg > 0 ? recentAvg / olderAvg : 1.0;

    if (Math.abs(ratio - 1.0) > 0.3) {
      const improving = ratio > 1.0;
      const bayesian = calculateBayesianConfidence({
        successes: improving
          ? recentHalf.filter(v => v.engagement_rate > olderAvg).length
          : olderHalf.filter(v => v.engagement_rate > recentAvg).length,
        trials: Math.min(recentHalf.length, olderHalf.length),
        performanceDelta: improving ? ratio : 1 / ratio,
      });

      gaps.push({
        gap: improving
          ? `Recent content outperforms older by +${((ratio - 1) * 100).toFixed(0)}% \u2014 channel is improving`
          : `Recent content underperforms older by ${((1 - ratio) * 100).toFixed(0)}% \u2014 possible format fatigue`,
        why_it_matters: improving
          ? 'Recent format changes are working \u2014 identify what changed and accelerate'
          : 'Audience may be losing interest in current format \u2014 experiment with new approaches',
        how_to_exploit: improving
          ? 'Analyze what the last 5 videos did differently (hook, title style, topic) and codify it'
          : 'Test a new format for 3 videos: different hook style, title structure, or topic angle',
        risk_level: improving ? 'low' : 'medium',
        confidence: bayesian.confidence,
      });
    }
  }

  return gaps.sort((a, b) => b.confidence - a.confidence);
}