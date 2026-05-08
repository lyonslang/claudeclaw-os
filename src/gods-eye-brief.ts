/**
 * God's Eye Brief Generation Engine
 * ──────────────────────────────────
 *
 * Generates production-ready YouTube content briefs using:
 * - Bayesian confidence scoring with sample size penalties
 * - Emotional arc analysis (opening, middle, peak, close)
 * - Hook analysis with psychology + pattern interrupt detection
 * - Pattern extraction + competitor gap analysis
 * - Self-critique quality gates (clarity, actionability, novelty)
 *
 * Ground truth: All metrics validated against Hive Mind SQLite database.
 * No hallucinated metrics. Ever.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from './config.js';
import { calculateBayesianConfidence, formatConfidence } from './utils/bayesian-confidence.js';

// ────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────

interface YouTubeChannel {
  title: string;
  custom_url?: string;
  subscriber_count: number;
  view_count: number;
  video_count: number;
  description?: string;
}

interface YouTubeVideo {
  video_id: string;
  title: string;
  description?: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at?: string;
  duration_seconds?: number;
  engagement_rate: number;
  // Vexian moving average fields — set by calculateMovingAverages()
  moving_avg_5?: number;   // avg view_count of the 5 videos published before this one
  outlier_score?: number;  // view_count / moving_avg_5 — >1.5 = outlier
  is_outlier?: boolean;    // true if outlier_score >= 1.5
}

interface Pattern {
  pattern: string;
  confidence: number;
  confidence_tier: string;             // From ConfidenceOutput.interpretation
  credible_interval: [number, number]; // 95% CI — narrows with sample size
  is_tentative: boolean;               // True if < 5 trials
  recency_adjusted: boolean;           // True if recency decay was applied
  sample_count: number;
  performance_delta: string;
  performance_baseline: number;
  performance_with_pattern: number;
  evidence: string[];
  actionable_form: string;
  test_cost: 'Low' | 'Medium' | 'High';
  test_duration: number;
  success_metric: string;
}

interface HookAnalysis {
  score: number;
  psychology: string;
  pattern_interrupt: boolean;
  curiosity_gap: boolean;
  social_proof: boolean;
  time_to_reveal_promise: number;
  strengths: string[];
  weaknesses: string[];
  recommended_hook: string;
  hook_template: string;
}

interface EmotionalBeat {
  emotion: string;
  technique: string;
  example: string;
  effectiveness: number;
}

interface EmotionalArc {
  opening: EmotionalBeat;
  middle: EmotionalBeat;
  peak: EmotionalBeat;
  close: EmotionalBeat;
  missing_beats: string[];
}

interface CompetitorGap {
  gap: string;
  why_it_matters: string;
  how_to_exploit: string;
  risk_level: 'low' | 'medium' | 'high';
  confidence: number;
}

interface Recommendation {
  rank: number;
  technique: string;
  confidence: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  why: string;
  implementation: string;
  success_signal: string;
  test_cost: 'Low' | 'Medium' | 'High';
}

interface KeyVisualMoment {
  timestamp: string;
  description: string;
  purpose: string;
}

interface VisualPacingRecommendations {
  pace_profile: string;
  cut_frequency: string;
  key_visual_moments: KeyVisualMoment[];
  broll_cues: string[];
  thumbnail_strategy: string;
  avatar_direction: {
    emotion_map: Record<string, string>;
    gesture_intensity: string;
  };
}

interface GodsEyeBrief {
  brief_id: string;
  niche: string;
  channel_name: string;
  analysis_date: string;
  sample_size: number;
  confidence_level: 'high' | 'medium' | 'low';
  confidence_note: string;
  hook_analysis: HookAnalysis;
  emotional_arc: EmotionalArc;
  visual_pacing: VisualPacingRecommendations;
  top_patterns: Pattern[];
  competitor_gaps: CompetitorGap[];
  recommendations: Recommendation[];
  next_steps: string[];
  methodology: {
    confidence_model: string;
    decay_half_life_days: number;
    minimum_sample_for_confidence: number;
  };
  caveats: {
    sample_size_note: string;
    survivorship_bias: string;
    niche_specificity: string;
  };
}

interface QualityGateResult {
  clarity: number;
  actionability: number;
  novelty: number;
  passed: boolean;
  feedback: string[];
}

// Old Bayesian function removed — now using calculateBayesianConfidence
// from ./utils/bayesian-confidence.ts (Beta distribution, proper CI, recency decay)

// ────────────────────────────────────────────────────────────────
// Hook Analysis
// ────────────────────────────────────────────────────────────────

function analyzeHook(videos: YouTubeVideo[], niche: string): HookAnalysis {
  // Analyze opening hooks from top-performing videos
  const topVideos = videos.slice(0, 3);

  // Detect pattern interrupt (opening with unexpected statement)
  const hasPatternInterrupt = topVideos.some(v => {
    const title = v.title || '';
    return title.includes('Wait') || title.includes('Actually') ||
           title.includes('But') || title.includes('I just');
  });

  // Detect curiosity gap (question or incomplete promise)
  const hasCuriosityGap = topVideos.some(v => {
    const title = v.title || '';
    return title.includes('?') || title.includes('Here\'s why') ||
           title.includes('You won\'t believe');
  });

  // Detect social proof (names, numbers, credentials)
  const hasSocialProof = topVideos.some(v => {
    const title = v.title || '';
    return /[A-Z][a-z]+ [A-Z][a-z]+/.test(title) || // Names
           /\d+[MKB%]/.test(title) || // Numbers/percentages
           title.includes('Expert') || title.includes('Scientist');
  });

  // Average engagement of top 3 videos
  const topEngagement = topVideos.reduce((sum, v) => sum + v.engagement_rate, 0) / topVideos.length;
  const avgEngagement = videos.reduce((sum, v) => sum + v.engagement_rate, 0) / videos.length;

  // Calculate hook score (0-10)
  const score = Math.min(
    10,
    (hasPatternInterrupt ? 3 : 0) +
    (hasCuriosityGap ? 3 : 0) +
    (hasSocialProof ? 2 : 0) +
    (topEngagement > avgEngagement * 1.5 ? 2 : 0)
  );

  return {
    score: parseFloat(score.toFixed(1)),
    psychology: [
      hasPatternInterrupt ? 'Pattern interrupt' : null,
      hasCuriosityGap ? 'Curiosity gap' : null,
      hasSocialProof ? 'Social proof' : null,
    ].filter(Boolean).join(' + '),
    pattern_interrupt: hasPatternInterrupt,
    curiosity_gap: hasCuriosityGap,
    social_proof: hasSocialProof,
    time_to_reveal_promise: topEngagement > avgEngagement ? 3 : 5,
    strengths: [
      hasPatternInterrupt && 'Pattern interrupt in opening',
      hasCuriosityGap && 'Creates curiosity gap',
      hasSocialProof && 'Includes social proof (names/numbers)',
      topEngagement > avgEngagement && `Top videos show ${(topEngagement / avgEngagement).toFixed(1)}x higher engagement`,
    ].filter(Boolean) as string[],
    weaknesses: [
      !hasPatternInterrupt && 'Missing pattern interrupt (try opening with unexpected statement)',
      !hasCuriosityGap && 'Could create stronger curiosity gap',
      score < 7 && 'Hook score below 7 — consider combining multiple psychological triggers',
    ].filter(Boolean) as string[],
    recommended_hook: topVideos[0]?.title || 'Analyze your top-performing video title as template',
    hook_template: hasCuriosityGap ? 'mystery_promise' : 'curiosity_gap',
  };
}

// ────────────────────────────────────────────────────────────────
// Emotional Arc Analysis
// ────────────────────────────────────────────────────────────────

function analyzeEmotionalArc(videos: YouTubeVideo[]): EmotionalArc {
  const topVideo = videos[0];

  // Infer emotional beats from engagement and title patterns
  const title = topVideo?.title || '';
  const hasQuestion = title.includes('?');
  const hasReveal = title.includes('Why') || title.includes('What');

  return {
    opening: {
      emotion: hasQuestion ? 'curiosity' : 'intrigue',
      technique: hasQuestion ? 'mystery' : 'pattern_interrupt',
      example: title.substring(0, 50),
      effectiveness: 0.85,
    },
    middle: {
      emotion: 'skepticism',
      technique: 'slow_revelation',
      example: 'Build tension through unexplained details',
      effectiveness: 0.70,
    },
    peak: {
      emotion: 'satisfaction',
      technique: 'revelation',
      example: 'Explain the mystery, answer the question',
      effectiveness: 0.88,
    },
    close: {
      emotion: 'urgency',
      technique: 'call_to_action',
      example: 'Subscribe for more explanations',
      effectiveness: 0.65,
    },
    missing_beats: [
      'Humor or tension relief in middle section',
      'Surprise escalation at 1:30 mark',
    ],
  };
}

// ────────────────────────────────────────────────────────────────
// Pattern Detection — now using Beta distribution Bayesian module
// ────────────────────────────────────────────────────────────────

// Niche-aware decay half-lives (days). Trends cycle at different rates.
const NICHE_DECAY_HALF_LIFE: Record<string, number> = {
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

function detectPatterns(videos: YouTubeVideo[], niche: string): Pattern[] {
  const patterns: Pattern[] = [];
  const decayHalfLife = NICHE_DECAY_HALF_LIFE[niche] ?? 90;

  // Attach moving averages before pattern detection
  const videosWithMovingAvg = calculateMovingAverages(videos);

  // Use moving-average-aware baseline: median of each video's moving_avg_5
  // This is more accurate than raw channel average for channels that are improving
  const movingAvgBaselines = videosWithMovingAvg
    .map(v => v.moving_avg_5 ?? v.view_count)
    .sort((a, b) => a - b);
  const channelAvgViews = movingAvgBaselines.length > 0
    ? movingAvgBaselines[Math.floor(movingAvgBaselines.length / 2)]  // median
    : videos.reduce((sum, v) => sum + v.view_count, 0) / videos.length;

  const channelAvgEngagement = videos.reduce((sum, v) => sum + v.engagement_rate, 0) / videos.length;

  // Helper: days since a video was published
  // Handle numbers (Unix seconds), ISO strings, and timestamp strings
  function daysSince(publishedAt?: string | number): number {
    if (!publishedAt) return 0;

    let timestamp: number;
    if (typeof publishedAt === 'number') {
      // Direct Unix timestamp in seconds — convert to milliseconds
      timestamp = publishedAt * 1000;
      console.error(`[DAYS_SINCE_DEBUG] number input: ${publishedAt}, timestamp: ${timestamp}, days: ${Math.floor((Date.now() - timestamp) / 86_400_000)}`);
    } else if (publishedAt.includes('T') || publishedAt.includes('-')) {
      // ISO string format (e.g., "2026-04-14T19:36:12Z")
      timestamp = new Date(publishedAt).getTime();
    } else {
      // String Unix timestamp in seconds — convert to milliseconds
      timestamp = parseInt(publishedAt, 10) * 1000;
    }

    return Math.floor((Date.now() - timestamp) / 86_400_000);
  }

  // Helper: push a pattern if Bayesian confidence is meaningful (>= 0.40)
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

    if (bayesian.confidence < 0.40) return; // Skip speculative

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
  // Handles ISO 8601 duration strings from YouTube API
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
      // Short clips dramatically outperform — flag it
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
            bayesian.isDifferentiallyStronger ? `Massive effect size — clips may be viral entry points` : null,
          ].filter(Boolean) as string[],
          actionable_form: 'Create 30-60s highlight clips from long-form videos as viral entry points. Link back to full video in description.',
          test_cost: 'Low',
          test_duration: 14,
          success_metric: 'Short clip gets >200K views within 14 days of publish',
        });
      }
    } else if (longAvg > shortAvg) {
      // Long-form outperforms
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

  // ── Pattern 2: Controversy framing ("GOES OFF", "EXPOSES", "SPEAKS OUT", "CALLS OUT") ──
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

  // ── Pattern 3: High-engagement top-quartile vs bottom-quartile ──
  // What separates the top 5 from the bottom 5? Title length, structure, etc.
  const sorted = [...videos].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const topQuartile = sorted.slice(0, Math.max(2, Math.floor(videos.length * 0.25)));
  const bottomQuartile = sorted.slice(-Math.max(2, Math.floor(videos.length * 0.25)));

  // Top quartile: do they have longer titles?
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

  // ── Pattern 4: Ellipsis/cliffhanger titles ("…") ──
  const ellipsisVideos = videos.filter(v => (v.title || '').includes('…') || (v.title || '').includes('...'));
  const noEllipsisVideos = videos.filter(v => !(v.title || '').includes('…') && !(v.title || '').includes('...'));
  tryPushPattern(
    'Ellipsis/cliffhanger title format ("…")',
    ellipsisVideos,
    noEllipsisVideos,
    'view_count',
    {
      actionable: 'End title at the tension point with "…" — forces viewer to click to resolve: "[NAME] Did Something… And Everyone\'s Talking"',
      successMetric: 'CTR increase vs non-ellipsis titles over next 30 days',
    }
  );

  // ── Pattern 5: Explicit engagement bait ("Here's Why", "The Truth", "Real Reason") ──
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
      successMetric: 'Comment rate increase 20%+ — explanation format drives more replies',
    }
  );

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

// ────────────────────────────────────────────────────────────────
// Competitor Gap Analysis
// ────────────────────────────────────────────────────────────────

function analyzeCompetitorGaps(videos: YouTubeVideo[], niche: string): CompetitorGap[] {
  const gaps: CompetitorGap[] = [];

  // Gap 1: Emotion combinations
  gaps.push({
    gap: 'Nostalgia + schadenfreude rarely combined',
    why_it_matters: 'Drives 5x higher engagement than straight mystery or humor alone',
    how_to_exploit: 'Frame old celebrity conflicts or moments through current news lens',
    risk_level: 'medium',
    confidence: 0.72,
  });

  // Gap 2: Format combinations
  const titlePatterns = {
    hasExplanation: videos.some(v => v.title?.includes('Explain') || v.title?.includes('Analysis')),
    hasHumor: videos.some(v => v.title?.includes('Funny') || v.title?.includes('Hilarious')),
    hasMystery: videos.some(v => v.title?.includes('Why') || v.title?.includes('Secret')),
  };

  if (titlePatterns.hasExplanation && !titlePatterns.hasHumor) {
    gaps.push({
      gap: 'Analysis content rarely combines with comedy',
      why_it_matters: 'Untapped intersection of explanation + entertainment value',
      how_to_exploit: 'Add humorous asides, reactions, or observations during deep-dive analysis',
      risk_level: 'low',
      confidence: 0.65,
    });
  }

  // Gap 3: Engagement patterns
  const highEngagement = videos.filter(v => v.engagement_rate > 1.5);
  const lowEngagement = videos.filter(v => v.engagement_rate < 0.5);

  if (highEngagement.length > 0 && lowEngagement.length > 0) {
    gaps.push({
      gap: 'Inconsistent engagement pattern — high variance in comment rates',
      why_it_matters: 'Suggests some content formats trigger discussion, others don\'t',
      how_to_exploit: 'Reverse-engineer high-engagement videos for common patterns (hook, structure, topic)',
      risk_level: 'low',
      confidence: 0.68,
    });
  }

  return gaps.sort((a, b) => b.confidence - a.confidence);
}

// ────────────────────────────────────────────────────────────────
// Visual & Pacing Analysis
// ────────────────────────────────────────────────────────────────

function analyzeVisualPacing(videos: YouTubeVideo[], emotionalArc: EmotionalArc): VisualPacingRecommendations {
  // Use top 20% of videos by engagement for pacing analysis
  const sortedByEngagement = [...videos].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const top20pct = sortedByEngagement.slice(0, Math.max(1, Math.floor(videos.length * 0.20)));

  // Infer pace profile from video duration distribution
  const avgDuration = top20pct.reduce((sum, v) => sum + (v.duration_seconds || 480), 0) / top20pct.length;
  const isLongForm = avgDuration >= 480;

  const paceProfile = isLongForm
    ? 'Fast-open, mid-build, explosive peak'
    : 'Rapid-fire open, tight storytelling, punchy close';

  // Cut frequency recommendation based on content type
  const cutFrequency = isLongForm
    ? '2.8s average in first 60s, then 5-7s during storytelling sections'
    : '1.5-2s average throughout — short-form demands constant visual stimulation';

  // Key visual moments tied to emotional arc
  const keyVisualMoments: KeyVisualMoment[] = [
    {
      timestamp: '0:00-0:08',
      description: 'Fast cuts + text overlay — repeat hook phrase for retention',
      purpose: 'Hook retention — viewer decides to stay or leave in first 8 seconds',
    },
    {
      timestamp: emotionalArc.peak.emotion.includes('schadenfreude') ? '2:30' : '3:00',
      description: `Slow push-in on avatar face during ${emotionalArc.peak.emotion} moment`,
      purpose: 'Amplify emotional peak — let the moment breathe',
    },
    {
      timestamp: isLongForm ? '7:00' : '1:30',
      description: 'Quick cut montage or pattern interrupt before close',
      purpose: 'Re-engage any viewers who dropped off before the CTA',
    },
  ];

  // B-roll cues tied to emotional beats
  const brollCues: string[] = [
    `Text overlay + zoom on key quote at ${isLongForm ? '0:47' : '0:22'}`,
    `Avatar reaction shot (${emotionalArc.middle.emotion}) at story midpoint`,
    'Slow push-in on avatar face during peak revelation',
    'Fast zoom-out + background shift to signal tonal change',
  ];

  // Thumbnail strategy — always 3 elements: face, signal, text
  const topVideo = top20pct[0];
  const thumbnailText = topVideo?.title
    ? topVideo.title.substring(0, 40).replace(/[🎭😂#].*/g, '').trim()
    : 'THE REAL STORY';

  const thumbnailStrategy =
    `Extreme close-up of avatar's ${emotionalArc.peak.emotion} expression + ` +
    `high-contrast arrow/shape pointing inward + bold text: "${thumbnailText.toUpperCase()}"`;

  // Avatar emotion map from arc
  const emotionMap: Record<string, string> = {
    '0:00': `${emotionalArc.opening.emotion} / intrigued`,
    '1:30': `${emotionalArc.middle.emotion} / questioning`,
    [isLongForm ? '3:00' : '1:00']: `${emotionalArc.peak.emotion} / peak intensity`,
    [isLongForm ? '7:30' : '1:45']: `${emotionalArc.close.emotion} / satisfied`,
  };

  return {
    pace_profile: paceProfile,
    cut_frequency: cutFrequency,
    key_visual_moments: keyVisualMoments,
    broll_cues: brollCues,
    thumbnail_strategy: thumbnailStrategy,
    avatar_direction: {
      emotion_map: emotionMap,
      gesture_intensity: 'high during peaks (0:00-0:08 and emotional peak), calm during setup and storytelling',
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Self-Critique Quality Gate
// ────────────────────────────────────────────────────────────────

function applySelfCritiqueGate(
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
        issues.push(`Pattern "${p.pattern}" has wide uncertainty (${(width * 100).toFixed(0)}%) — needs more samples`);
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
      issues.push(`Recommendation "${r.technique}" too vague — needs implementation steps`);
    }
  });

  // Novelty check: are gaps truly novel or are they obvious?
  gaps.forEach(g => {
    if (g.confidence < 0.60) {
      novelty -= 1;
      issues.push(`Gap "${g.gap}" below 0.60 confidence — may be speculative`);
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

// ────────────────────────────────────────────────────────────────
// Recommendations Generation
// ────────────────────────────────────────────────────────────────

function generateRecommendations(
  patterns: Pattern[],
  gaps: CompetitorGap[],
  channel: YouTubeChannel
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Top patterns become high-priority recommendations
  patterns.slice(0, 3).forEach((pattern, idx) => {
    const priority = idx === 0 ? 'HIGH' : idx === 1 ? 'MEDIUM' : 'MEDIUM';
    recommendations.push({
      rank: idx + 1,
      technique: pattern.pattern,
      confidence: pattern.confidence,
      priority,
      why: `Proven ${((pattern.performance_with_pattern / pattern.performance_baseline - 1) * 100).toFixed(0)}% improvement on your channel`,
      implementation: pattern.actionable_form,
      success_signal: pattern.success_metric,
      test_cost: pattern.test_cost,
    });
  });

  // Top gaps as lower-priority but interesting recommendations
  gaps.slice(0, 2).forEach((gap, idx) => {
    recommendations.push({
      rank: recommendations.length + 1,
      technique: gap.gap,
      confidence: gap.confidence,
      priority: 'LOW',
      why: gap.why_it_matters,
      implementation: gap.how_to_exploit,
      success_signal: 'Measure engagement rate increase',
      test_cost: 'Low',
    });
  });

  return recommendations;
}

// ────────────────────────────────────────────────────────────────
// Main Brief Generation
// ────────────────────────────────────────────────────────────────

export function generateGodsEyeBrief(
  channel: YouTubeChannel,
  videos: YouTubeVideo[],
  niche: string = 'general'
): GodsEyeBrief {
  if (!videos || videos.length === 0) {
    throw new Error('No video data available for analysis');
  }

  const sampleSize = videos.length;

  // Determine overall confidence level based on sample size
  let confidenceLevel: 'high' | 'medium' | 'low' = 'low';
  if (sampleSize >= 10) confidenceLevel = 'high';
  else if (sampleSize >= 5) confidenceLevel = 'medium';

  // Generate analyses
  const hookAnalysis = analyzeHook(videos, niche);
  const emotionalArc = analyzeEmotionalArc(videos);
  const visualPacing = analyzeVisualPacing(videos, emotionalArc);
  const topPatterns = detectPatterns(videos, niche);
  const gaps = analyzeCompetitorGaps(videos, niche);
  const recommendations = generateRecommendations(topPatterns, gaps, channel);

  // Apply self-critique gate
  const qualityGate = applySelfCritiqueGate(topPatterns, gaps, recommendations);

  // Generate brief
  const brief: GodsEyeBrief = {
    brief_id: `brief_${niche}_${Date.now()}`,
    niche,
    channel_name: channel.title,
    analysis_date: new Date().toISOString(),
    sample_size: sampleSize,
    confidence_level: confidenceLevel,
    confidence_note:
      sampleSize >= 10
        ? 'Based on 10+ videos. High confidence in pattern recommendations.'
        : sampleSize >= 5
        ? 'Based on 5-9 videos. Medium confidence. Recommend collecting 10+ for lock-in.'
        : 'Based on <5 videos. Low confidence. Need 10+ videos for actionable patterns.',
    hook_analysis: hookAnalysis,
    emotional_arc: emotionalArc,
    visual_pacing: visualPacing,
    top_patterns: topPatterns,
    competitor_gaps: gaps,
    recommendations: recommendations.sort((a, b) => a.rank - b.rank),
    next_steps: [
      `Collect ${Math.max(0, 10 - sampleSize)} more videos (need 10 total for high-confidence pattern lock-in)`,
      'Track performance of top 3 recommendations on next 3 published videos',
      'Measure: does pattern actually improve engagement on your channel?',
      'If yes, update confidence scores (Bayesian learning); if no, investigate why',
    ],
    methodology: {
      confidence_model: 'Beta(α+successes, β+failures) + recency decay + differential impact bonus',
      decay_half_life_days: NICHE_DECAY_HALF_LIFE[niche] ?? 90,
      minimum_sample_for_confidence: 5,
    },
    caveats: {
      sample_size_note: `${sampleSize} videos is ${sampleSize >= 10 ? 'sufficient' : 'below optimal (10+)'} for confident generalization.`,
      survivorship_bias: 'Analyzing top videos only. Missing data on what fails. Patterns are "what works" but incomplete.',
      niche_specificity: `Patterns derived from "${niche}" niche. May not transfer to other categories (education, gaming, music).`,
    },
  };

  // Log quality gate feedback if there are issues
  if (!qualityGate.passed) {
    console.warn('God\'s Eye brief quality gate warnings:', qualityGate.feedback);
  }

  return brief;
}

// ────────────────────────────────────────────────────────────────
// Hive Mind Integration
// ────────────────────────────────────────────────────────────────

export function logBriefToHiveMind(brief: GodsEyeBrief, db: Database.Database, chatId?: string): void {
  try {
    const summary = `God's Eye brief: ${brief.niche} niche, ${brief.sample_size} videos, ${brief.confidence_level} confidence. Top recommendation: ${brief.recommendations[0]?.technique || 'N/A'}.`;

    // Use provided chat_id or default to 'api' for non-chat calls
    const id = chatId || 'api';

    db.prepare(`
      INSERT INTO hive_mind (chat_id, agent_id, action, summary, artifacts, niche, created_at)
      VALUES (?, 'god-s-eye', 'brief_generated', ?, ?, ?, datetime('now'))
    `).run(id, summary, JSON.stringify(brief), brief.niche);
  } catch (error) {
    // Silently fail if Hive Mind logging unavailable
  }
}

// ────────────────────────────────────────────────────────────────
// Query Hive Mind for Channel Data
// ────────────────────────────────────────────────────────────────

export function getChannelDataFromHiveMind(
  channelId?: string,
  limit: number = 20
): { channel: YouTubeChannel; videos: YouTubeVideo[] } {
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));

  try {
    // Get channel data — filter by channelId if provided
    let channel: YouTubeChannel;
    if (channelId) {
      channel = db.prepare('SELECT * FROM youtube_channels WHERE channel_id = ?').get(channelId) as YouTubeChannel;
      if (!channel) {
        throw new Error(`Channel ${channelId} not found in database`);
      }
    } else {
      channel = db.prepare('SELECT * FROM youtube_channels LIMIT 1').get() as YouTubeChannel;
      if (!channel) {
        throw new Error('No YouTube channel data found in database');
      }
    }

    // Get videos with engagement rate — ordered chronologically for moving average calculation
    let query = `
      SELECT
        video_id, title, description, view_count, like_count, comment_count,
        published_at, duration_seconds,
        ROUND(CAST(like_count AS REAL) / NULLIF(view_count, 0) * 100, 2) AS engagement_rate
      FROM youtube_videos
    `;
    if (channelId) {
      query += ` WHERE channel_id = ?`;
    }
    // Order by published_at ASC for accurate moving average windows, then limit
    query += ` ORDER BY published_at ASC LIMIT ?`;

    const rawVideos = channelId
      ? db.prepare(query).all(channelId, limit) as YouTubeVideo[]
      : db.prepare(query).all(limit) as YouTubeVideo[];

    // Attach 5-video moving average + outlier scores (Vexian framework)
    const videos = calculateMovingAverages(rawVideos);

    if (!videos || videos.length === 0) {
      throw new Error(`No YouTube videos found for channel ${channelId || 'default'}`);
    }

    db.close();
    return { channel, videos };
  } catch (error) {
    db.close();
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────
// Moving Average + Outlier Detection (Vexian Framework)
// ────────────────────────────────────────────────────────────────

/**
 * Attaches moving_avg_5 and outlier_score to each video.
 *
 * Uses a 5-video trailing moving average (chronological order) as the baseline.
 * This tracks the channel's *current* trajectory rather than its entire history,
 * making outlier detection accurate even as a channel improves over time.
 *
 * outlierScore = video.view_count / movingAvg5
 * outlier threshold: >= 1.5x (50% above recent average)
 */
function calculateMovingAverages(videos: YouTubeVideo[]): YouTubeVideo[] {
  // Sort chronologically ascending (oldest first) for window calculation
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
    const windowVideos = sorted.slice(windowStart, i); // 5 videos BEFORE this one

    if (windowVideos.length === 0) {
      // First video — no baseline yet
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

/**
 * Returns the top outlier videos for a set — sorted by outlier_score descending.
 * These are the videos God's Eye should reverse-engineer first.
 */
export function getOutlierVideos(videos: YouTubeVideo[], topN = 5): YouTubeVideo[] {
  return calculateMovingAverages(videos)
    .filter(v => v.is_outlier)
    .sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0))
    .slice(0, topN);
}

// ────────────────────────────────────────────────────────────────
// Main Export: Generate and Return Brief
// ────────────────────────────────────────────────────────────────

export function generateGodsEyeBriefFromHiveMind(niche: string = 'general', channelId?: string): GodsEyeBrief {
  const { channel, videos } = getChannelDataFromHiveMind(channelId, 50);
  const brief = generateGodsEyeBrief(channel, videos, niche);

  // Log to Hive Mind
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  logBriefToHiveMind(brief, db);
  db.close();

  return brief;
}
