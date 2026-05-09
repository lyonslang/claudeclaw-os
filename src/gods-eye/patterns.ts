/**
 * Gods Eye — Pattern Detection
 * Bayesian pattern detection. 5 detectors. Vexian moving average baseline.
 * Drops patterns below 0.40 confidence.
 */

import { calculateBayesianConfidence } from '../utils/bayesian-confidence.js';
import type { YouTubeVideo, Pattern } from './types.js';

// Niche-aware decay half-lives (days). Trends cycle at different rates.
export const NICHE_DECAY_HALF_LIFE: Record<string, number> = {
  comedy:         90,
  entertainment:  60,
  celebrity:      45,
  education:     270,
  tutorial:      365,
  general:        90,
};

/**
 * Parse ISO 8601 duration string (e.g. "PT47S", "PT16M59S", "PT1H5M30S") to seconds.
 * YouTube API returns duration in this format. Fallback to 0 if unparseable.
 */
function parseISODuration(raw: string | number | undefined | null): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const s = String(raw);
  const match = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const sec = parseInt(match[3] || '0');
  return h * 3600 + m * 60 + sec;
}

/**
 * Attaches moving_avg_5 and outlier_score to each video.
 *
 * Uses a 5-video trailing moving average (chronological order) as the baseline.
 */
export function calculateMovingAverages(videos: YouTubeVideo[]): YouTubeVideo[] {
  const sorted = [...videos].sort((a, b) => {
    const tsA = typeof a.published_at === 'number'
      ? (a.published_at as number) * 1000
      : new Date(a.published_at || 0).getTime();
    const tsB = typeof b.published_at === 'number'
      ? (b.published_at as number) * 1000
      : new Date(b.published_at || 0).getTime();
    return tsA - tsB;
  });

  const WINDOW = 5;

  for (let i = 0; i < sorted.length; i++) {
    const windowStart = Math.max(0, i - WINDOW);
    const windowVideos = sorted.slice(windowStart, i);

    if (windowVideos.length === 0) {
      sorted[i].moving_avg_5 = sorted[i].view_count;
      sorted[i].outlier_score = 1.0;
      sorted[i].is_outlier = false;
    } else {
      const movingAvg = windowVideos.reduce((sum, v) => sum + v.view_count, 0) / windowVideos.length;
      const outlierScore = movingAvg > 0 ? sorted[i].view_count / movingAvg : 1.0;
      sorted[i].moving_avg_5 = Math.round(movingAvg);
      sorted[i].outlier_score = Math.round(outlierScore * 100) / 100;
      sorted[i].is_outlier = outlierScore >= 1.5;
    }
  }

  return sorted;
}

export function detectPatterns(videos: YouTubeVideo[], niche: string): Pattern[] {
  const patterns: Pattern[] = [];
  const decayHalfLife = NICHE_DECAY_HALF_LIFE[niche] ?? 90;

  const videosWithMovingAvg = calculateMovingAverages(videos);

  const movingAvgBaselines = videosWithMovingAvg
    .map(v => v.moving_avg_5 ?? v.view_count)
    .sort((a, b) => a - b);
  const channelAvgViews = movingAvgBaselines.length > 0
    ? movingAvgBaselines[Math.floor(movingAvgBaselines.length / 2)]
    : videos.reduce((sum, v) => sum + v.view_count, 0) / videos.length;

  const channelAvgEngagement = videos.reduce((sum, v) => sum + v.engagement_rate, 0) / videos.length;

  function daysSince(publishedAt?: string | number): number {
    if (!publishedAt) return 0;
    let timestamp: number;
    if (typeof publishedAt === 'number') {
      timestamp = publishedAt * 1000;
    } else if (publishedAt.includes('T') || publishedAt.includes('-')) {
      timestamp = new Date(publishedAt).getTime();
    } else {
      timestamp = parseInt(publishedAt, 10) * 1000;
    }
    return Math.floor((Date.now() - timestamp) / 86_400_000);
  }

  function tryPushPattern(
    label: string,
    patternVideos: YouTubeVideo[],
    baselineVideos: YouTubeVideo[],
    metric: 'view_count' | 'engagement_rate',
    opts: { actionable: string; successMetric: string; testCost?: 'Low'|'Medium'|'High' }
  ) {
    if (patternVideos.length < 2) return;

    const patternAvg  = patternVideos.reduce((sum, v) => sum + v[metric], 0) / patternVideos.length;
    const baselineAvg = baselineVideos.length > 0
      ? baselineVideos.reduce((sum, v) => sum + v[metric], 0) / baselineVideos.length
      : (metric === 'view_count' ? channelAvgViews : channelAvgEngagement);

    if (patternAvg <= baselineAvg || baselineAvg <= 0) return;

    const performanceDelta = patternAvg / baselineAvg;
    const successes        = patternVideos.filter(v => v[metric] > baselineAvg).length;
    const mostRecentDays   = Math.min(...patternVideos.map(v => daysSince(v.published_at)));

    const bayesian = calculateBayesianConfidence({
      successes,
      trials: patternVideos.length,
      performanceDelta,
      recencyDays: mostRecentDays,
      decayHalfLife,
      priorAlpha: niche === 'comedy' ? 3 : 2,
      priorBeta: 2,
    });

    if (bayesian.confidence < 0.40) return;

    patterns.push({
      pattern: label,
      confidence: bayesian.confidence,
      confidence_tier: bayesian.interpretation,
      credible_interval: bayesian.credibleInterval,
      is_tentative: bayesian.isTentative,
      recency_adjusted: bayesian.adjustedForRecency,
      sample_count: patternVideos.length,
      performance_delta: `+${((performanceDelta - 1) * 100).toFixed(0)}% ${metric === 'view_count' ? 'views' : 'engagement'}`,
      performance_baseline: Math.round(baselineAvg),
      performance_with_pattern: Math.round(patternAvg),
      evidence: [
        `${patternVideos.length} videos with pattern: avg ${patternAvg.toLocaleString(undefined, {maximumFractionDigits: 1})} ${metric === 'view_count' ? 'views' : '% engagement'}`,
        `${baselineVideos.length} videos without: avg ${baselineAvg.toLocaleString(undefined, {maximumFractionDigits: 1})}`,
        bayesian.isDifferentiallyStronger ? `Strong effect (+${((performanceDelta - 1) * 100).toFixed(0)}%)` : null,
      ].filter(Boolean) as string[],
      actionable_form: opts.actionable,
      test_cost: opts.testCost ?? 'Low',
      test_duration: 7,
      success_metric: opts.successMetric,
    });
  }

  // ── Pattern 1: Short clips (<120s) vs long-form ──
  const videosWithDuration = videos.map(v => ({
    ...v,
    duration_secs: parseISODuration(v.duration_seconds as any),
  }));

  const shortClips = videosWithDuration.filter(v => v.duration_secs > 0 && v.duration_secs < 120);
  const longFormVideos = videosWithDuration.filter(v => v.duration_secs >= 480);

  if (shortClips.length >= 1 && longFormVideos.length >= 2) {
    const shortAvg = shortClips.reduce((sum, v) => sum + v.view_count, 0) / shortClips.length;
    const longAvg  = longFormVideos.reduce((sum, v) => sum + v.view_count, 0) / longFormVideos.length;

    if (shortAvg > longAvg * 1.5) {
      const performanceDelta = shortAvg / Math.max(longAvg, 1);
      const successes = shortClips.filter(v => v.view_count > channelAvgViews).length;
      const bayesian = calculateBayesianConfidence({
        successes: Math.max(successes, 1),
        trials: shortClips.length + longFormVideos.length,
        performanceDelta,
        recencyDays: Math.min(...shortClips.map(v => daysSince(v.published_at))),
        decayHalfLife,
      });

      if (bayesian.confidence >= 0.40) {
        patterns.push({
          pattern: 'Short clips (<2min) dramatically outperform long-form',
          confidence: bayesian.confidence,
          confidence_tier: bayesian.interpretation,
          credible_interval: bayesian.credibleInterval,
          is_tentative: bayesian.isTentative,
          recency_adjusted: bayesian.adjustedForRecency,
          sample_count: shortClips.length,
          performance_delta: `+${((performanceDelta - 1) * 100).toFixed(0)}% views vs long-form avg`,
          performance_baseline: Math.round(longAvg),
          performance_with_pattern: Math.round(shortAvg),
          evidence: [
            `${shortClips.length} short clip(s): avg ${shortAvg.toLocaleString()} views`,
            `${longFormVideos.length} long-form videos: avg ${longAvg.toLocaleString()} views`,
            bayesian.isDifferentiallyStronger ? `Massive effect size \u2014 clips may be viral entry points` : null,
          ].filter(Boolean) as string[],
          actionable_form: 'Create 30-60s highlight clips from long-form videos as viral entry points. Link back to full video in description.',
          test_cost: 'Low',
          test_duration: 14,
          success_metric: 'Short clip gets >200K views within 14 days of publish',
        });
      }
    } else if (longAvg > shortAvg) {
      const performanceDelta = longAvg / Math.max(shortAvg, 1);
      const successes = longFormVideos.filter(v => v.view_count > channelAvgViews).length;
      const bayesian = calculateBayesianConfidence({
        successes,
        trials: longFormVideos.length,
        performanceDelta,
        recencyDays: Math.min(...longFormVideos.map(v => daysSince(v.published_at))),
        decayHalfLife,
      });

      if (bayesian.confidence >= 0.40) {
        patterns.push({
          pattern: '8-20 minute deep-dive format',
          confidence: bayesian.confidence,
          confidence_tier: bayesian.interpretation,
          credible_interval: bayesian.credibleInterval,
          is_tentative: bayesian.isTentative,
          recency_adjusted: bayesian.adjustedForRecency,
          sample_count: longFormVideos.length,
          performance_delta: `+${((performanceDelta - 1) * 100).toFixed(0)}% views vs short clips`,
          performance_baseline: Math.round(shortAvg),
          performance_with_pattern: Math.round(longAvg),
          evidence: [
            `${longFormVideos.length} long-form videos avg ${longAvg.toLocaleString()} views`,
            `${shortClips.length} short clips avg ${shortAvg.toLocaleString()} views`,
          ],
          actionable_form: 'Target 10-20 minute runtime for deep-dive commentary and analysis content',
          test_cost: 'Low',
          test_duration: 14,
          success_metric: 'Avg watch time >4 minutes on next 3 long-form videos',
        });
      }
    }
  }

  // ── Pattern 2: Controversy framing ──
  const controversyPhrases = ['GOES OFF', 'EXPOSE', 'CALLS OUT', 'SPEAKS OUT', 'RESPONDS', 'GOES IN', 'BLAST'];
  const controversyVideos = videos.filter(v =>
    controversyPhrases.some(p => (v.title || '').toUpperCase().includes(p))
  );
  const nonControversyVideos = videos.filter(v =>
    !controversyPhrases.some(p => (v.title || '').toUpperCase().includes(p))
  );
  tryPushPattern(
    'Controversy/reaction framing in title ("GOES OFF", "EXPOSES", "RESPONDS")',
    controversyVideos,
    nonControversyVideos,
    'engagement_rate',
    {
      actionable: 'Frame titles as reactions or callouts. Lead with the subject name, then the controversy verb: "[NAME] GOES OFF on [TARGET]"',
      successMetric: 'Comment rate >3.5% (channel avg: ' + channelAvgEngagement.toFixed(2) + '%)',
    }
  );

  // ── Pattern 3: Title length ──
  const sorted = [...videos].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const topQuartile = sorted.slice(0, Math.max(2, Math.floor(videos.length * 0.25)));
  const bottomQuartile = sorted.slice(-Math.max(2, Math.floor(videos.length * 0.25)));

  const topAvgTitleLen = topQuartile.reduce((sum, v) => sum + (v.title?.length || 0), 0) / topQuartile.length;
  const botAvgTitleLen = bottomQuartile.reduce((sum, v) => sum + (v.title?.length || 0), 0) / bottomQuartile.length;

  if (Math.abs(topAvgTitleLen - botAvgTitleLen) > 10) {
    const moreDescriptive = topAvgTitleLen > botAvgTitleLen;
    tryPushPattern(
      moreDescriptive ? 'Longer, descriptive titles outperform short titles' : 'Punchy short titles outperform verbose ones',
      topQuartile,
      bottomQuartile,
      'engagement_rate',
      {
        actionable: moreDescriptive
          ? `Use ${Math.round(topAvgTitleLen)}-character titles with full subject + context. Average top performer: "${topQuartile[0]?.title?.substring(0, 60)}..."`
          : `Keep titles under ${Math.round(topAvgTitleLen)} characters. Top performer: "${topQuartile[0]?.title?.substring(0, 50)}"`,
        successMetric: `Engagement rate >${(topQuartile.reduce((s, v) => s + v.engagement_rate, 0) / topQuartile.length).toFixed(1)}% (top quartile threshold)`,
      }
    );
  }

  // ── Pattern 4: Ellipsis/cliffhanger titles ──
  const ellipsisVideos = videos.filter(v => (v.title || '').includes('\u2026') || (v.title || '').includes('...'));
  const noEllipsisVideos = videos.filter(v => !(v.title || '').includes('\u2026') && !(v.title || '').includes('...'));
  tryPushPattern(
    'Ellipsis/cliffhanger title format ("\u2026")',
    ellipsisVideos,
    noEllipsisVideos,
    'view_count',
    {
      actionable: 'End title at the tension point with "\u2026" \u2014 forces viewer to click to resolve: "[NAME] Did Something\u2026 And Everyone\'s Talking"',
      successMetric: 'CTR increase vs non-ellipsis titles over next 30 days',
    }
  );

  // ── Pattern 5: Explanation/revelation framing ──
  const explanationPhrases = ["Here's Why", "The Truth", "Real Reason", "Actually", "Here's What", "The Real"];
  const explanationVideos = videos.filter(v =>
    explanationPhrases.some(p => (v.title || '').includes(p))
  );
  const nonExplanationVideos = videos.filter(v =>
    !explanationPhrases.some(p => (v.title || '').includes(p))
  );
  tryPushPattern(
    'Explanation/revelation framing ("Here\'s Why", "The Real Reason")',
    explanationVideos,
    nonExplanationVideos,
    'engagement_rate',
    {
      actionable: 'Promise a revelation in the title that most people don\'t know. Template: "Here\'s Why [NAME] Really [DID THING]"',
      successMetric: 'Comment rate increase 20%+ \u2014 explanation format drives more replies',
    }
  );

  return patterns.sort((a, b) => b.confidence - a.confidence);
}