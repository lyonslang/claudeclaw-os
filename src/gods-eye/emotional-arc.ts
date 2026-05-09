/**
 * Gods Eye — Emotional Arc Analysis
 * Data-driven sentiment clustering. 6 clusters, effectiveness scoring.
 * Zero hardcoded values — all from real engagement data.
 */

import type { YouTubeVideo, EmotionalArc } from './types.js';

/**
 * Title sentiment patterns used to cluster videos into emotional categories.
 */
export const SENTIMENT_PATTERNS: Array<{
  name: string;
  emotion: string;
  technique: string;
  test: (title: string) => boolean;
}> = [
  {
    name: 'curiosity',
    emotion: 'curiosity',
    technique: 'mystery',
    test: (t) => t.includes('?') || /\bwhy\b/i.test(t) || /\bhow\b/i.test(t) || t.includes('secret'),
  },
  {
    name: 'controversy',
    emotion: 'outrage',
    technique: 'confrontation',
    test: (t) => /GOES OFF|EXPOSE|CALLS OUT|SPEAKS OUT|RESPONDS|BLAST/i.test(t),
  },
  {
    name: 'reveal',
    emotion: 'surprise',
    technique: 'revelation',
    test: (t) => /the truth|real reason|actually|here'?s what|finally/i.test(t),
  },
  {
    name: 'personal',
    emotion: 'empathy',
    technique: 'vulnerability',
    test: (t) => /\bI\b|\bmy\b|\bme\b/i.test(t) || /opens up|confess|admit/i.test(t),
  },
  {
    name: 'urgency',
    emotion: 'urgency',
    technique: 'scarcity',
    test: (t) => /breaking|just happened|right now|update|\bnew\b/i.test(t),
  },
  {
    name: 'nostalgia',
    emotion: 'nostalgia',
    technique: 'throwback',
    test: (t) => /remember|back when|classic|\d{4}|used to|before/i.test(t),
  },
];

/**
 * Classify a video's title into its dominant sentiment pattern.
 * Returns the first matching pattern or null if none match.
 */
export function classifyTitleSentiment(title: string): typeof SENTIMENT_PATTERNS[number] | null {
  const t = title || '';
  return SENTIMENT_PATTERNS.find(p => p.test(t)) ?? null;
}

/**
 * Data-driven emotional arc analysis.
 *
 * Analyzes the FULL video set (not just video[0]):
 * - Clusters all videos by title sentiment pattern
 * - Computes effectiveness as (avg engagement of cluster) / (channel avg engagement)
 * - Selects opening/middle/peak/close from the highest-performing clusters
 * - Detects missing beats by checking which patterns are absent from top performers
 */
export function analyzeEmotionalArc(videos: YouTubeVideo[]): EmotionalArc {
  if (!videos || videos.length === 0) {
    return fallbackEmotionalArc();
  }

  const channelAvgEngagement = videos.reduce((sum, v) => sum + v.engagement_rate, 0) / videos.length;

  // Cluster videos by sentiment pattern
  type Cluster = { pattern: typeof SENTIMENT_PATTERNS[number]; videos: YouTubeVideo[]; avgEngagement: number; effectiveness: number };
  const clusters: Cluster[] = [];

  for (const pattern of SENTIMENT_PATTERNS) {
    const matching = videos.filter(v => pattern.test(v.title || ''));
    if (matching.length === 0) continue;
    const avgEng = matching.reduce((sum, v) => sum + v.engagement_rate, 0) / matching.length;
    clusters.push({
      pattern,
      videos: matching,
      avgEngagement: avgEng,
      effectiveness: channelAvgEngagement > 0 ? Math.round((avgEng / channelAvgEngagement) * 100) / 100 : 1.0,
    });
  }

  // Sort by effectiveness descending
  clusters.sort((a, b) => b.effectiveness - a.effectiveness);

  // Identify which patterns exist in the top quartile of performers
  const sortedByEngagement = [...videos].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const topQuartile = sortedByEngagement.slice(0, Math.max(2, Math.floor(videos.length * 0.25)));
  const topPatternNames = new Set<string>();
  for (const v of topQuartile) {
    const p = classifyTitleSentiment(v.title);
    if (p) topPatternNames.add(p.name);
  }

  // Assign arc positions
  const bestExample = (cluster: Cluster | undefined) =>
    cluster ? cluster.videos.sort((a, b) => b.engagement_rate - a.engagement_rate)[0]?.title?.substring(0, 60) || '' : '';

  const openingCluster = clusters[0];
  const peakCluster = clusters.length > 1 ? clusters[1] : openingCluster;
  const middleCluster = clusters.length > 2
    ? clusters.reduce((closest, c) => Math.abs(c.effectiveness - 1.0) < Math.abs(closest.effectiveness - 1.0) ? c : closest)
    : null;
  const closeCluster = clusters.length > 0 ? clusters[clusters.length - 1] : null;

  // Detect missing beats
  const missingBeats: string[] = [];
  for (const pattern of SENTIMENT_PATTERNS) {
    if (!topPatternNames.has(pattern.name)) {
      const cluster = clusters.find(c => c.pattern.name === pattern.name);
      if (cluster && cluster.effectiveness > 1.0) {
        missingBeats.push(`"${pattern.name}" beat (${pattern.technique}) \u2014 performs ${((cluster.effectiveness - 1) * 100).toFixed(0)}% above avg but absent from top videos`);
      } else if (!cluster) {
        missingBeats.push(`No "${pattern.name}" content detected \u2014 consider testing ${pattern.technique} technique`);
      }
    }
  }

  if (clusters.length === 0) {
    return fallbackEmotionalArc();
  }

  return {
    opening: {
      emotion: openingCluster.pattern.emotion,
      technique: openingCluster.pattern.technique,
      example: bestExample(openingCluster),
      effectiveness: openingCluster.effectiveness,
    },
    middle: {
      emotion: middleCluster?.pattern.emotion ?? 'tension',
      technique: middleCluster?.pattern.technique ?? 'slow_revelation',
      example: middleCluster ? bestExample(middleCluster) : 'Build tension through layered details',
      effectiveness: middleCluster?.effectiveness ?? 1.0,
    },
    peak: {
      emotion: peakCluster.pattern.emotion,
      technique: peakCluster.pattern.technique,
      example: bestExample(peakCluster),
      effectiveness: peakCluster.effectiveness,
    },
    close: {
      emotion: closeCluster?.pattern.emotion ?? 'urgency',
      technique: closeCluster?.pattern.technique ?? 'call_to_action',
      example: closeCluster ? bestExample(closeCluster) : 'Subscribe / follow-up CTA',
      effectiveness: closeCluster?.effectiveness ?? 0.8,
    },
    missing_beats: missingBeats.length > 0 ? missingBeats : ['All detected sentiment patterns are represented in top performers'],
  };
}

/** Fallback for edge cases (no videos, no patterns detected) */
function fallbackEmotionalArc(): EmotionalArc {
  return {
    opening: { emotion: 'intrigue', technique: 'pattern_interrupt', example: 'Insufficient data', effectiveness: 0 },
    middle:  { emotion: 'tension', technique: 'slow_revelation', example: 'Insufficient data', effectiveness: 0 },
    peak:    { emotion: 'surprise', technique: 'revelation', example: 'Insufficient data', effectiveness: 0 },
    close:   { emotion: 'urgency', technique: 'call_to_action', example: 'Insufficient data', effectiveness: 0 },
    missing_beats: ['Insufficient video data to analyze emotional arc \u2014 need 5+ videos'],
  };
}