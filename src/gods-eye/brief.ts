/**
 * Gods Eye — Brief Generation (Orchestrator)
 * Connects all analysis modules. generateGodsEyeBrief(), getOutlierVideos().
 * No analysis logic lives here.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../config.js';
import type {
  YouTubeChannel, YouTubeVideo, GodsEyeBrief,
  EmotionalArc, KeyVisualMoment, VisualPacingRecommendations, Recommendation,
} from './types.js';
import { analyzeHook } from './hook.js';
import { analyzeEmotionalArc } from './emotional-arc.js';
import { detectPatterns, calculateMovingAverages, NICHE_DECAY_HALF_LIFE } from './patterns.js';
import { analyzeCompetitorGaps } from './competitor-gaps.js';
import { applySelfCritiqueGate } from './quality-gate.js';

// ── Visual & Pacing Analysis ──

function analyzeVisualPacing(videos: YouTubeVideo[], emotionalArc: EmotionalArc): VisualPacingRecommendations {
  const sortedByEngagement = [...videos].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const top20pct = sortedByEngagement.slice(0, Math.max(1, Math.floor(videos.length * 0.20)));

  const avgDuration = top20pct.reduce((sum, v) => sum + (v.duration_seconds || 480), 0) / top20pct.length;
  const isLongForm = avgDuration >= 480;

  const paceProfile = isLongForm
    ? 'Fast-open, mid-build, explosive peak'
    : 'Rapid-fire open, tight storytelling, punchy close';

  const cutFrequency = isLongForm
    ? '2.8s average in first 60s, then 5-7s during storytelling sections'
    : '1.5-2s average throughout \u2014 short-form demands constant visual stimulation';

  const keyVisualMoments: KeyVisualMoment[] = [
    { timestamp: '0:00-0:08', description: 'Fast cuts + text overlay \u2014 repeat hook phrase for retention', purpose: 'Hook retention \u2014 viewer decides to stay or leave in first 8 seconds' },
    { timestamp: emotionalArc.peak.emotion.includes('schadenfreude') ? '2:30' : '3:00', description: `Slow push-in on avatar face during ${emotionalArc.peak.emotion} moment`, purpose: 'Amplify emotional peak \u2014 let the moment breathe' },
    { timestamp: isLongForm ? '7:00' : '1:30', description: 'Quick cut montage or pattern interrupt before close', purpose: 'Re-engage any viewers who dropped off before the CTA' },
  ];

  const brollCues: string[] = [
    `Text overlay + zoom on key quote at ${isLongForm ? '0:47' : '0:22'}`,
    `Avatar reaction shot (${emotionalArc.middle.emotion}) at story midpoint`,
    'Slow push-in on avatar face during peak revelation',
    'Fast zoom-out + background shift to signal tonal change',
  ];

  const topVideo = top20pct[0];
  const thumbnailText = topVideo?.title
    ? topVideo.title.substring(0, 40).replace(/[\ud83c-\udfff\u2600-\u27bf#].*/g, '').trim()
    : 'THE REAL STORY';

  const thumbnailStrategy =
    `Extreme close-up of avatar's ${emotionalArc.peak.emotion} expression + ` +
    `high-contrast arrow/shape pointing inward + bold text: "${thumbnailText.toUpperCase()}"`;

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

// ── Recommendations Generation ──

function generateRecommendations(
  patterns: import('./types.js').Pattern[],
  gaps: import('./types.js').CompetitorGap[],
  _channel: YouTubeChannel
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  patterns.slice(0, 3).forEach((pattern, idx) => {
    const priority = idx === 0 ? 'HIGH' : 'MEDIUM';
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

  gaps.slice(0, 2).forEach((gap) => {
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

// ── Main Brief Generation ──

export function generateGodsEyeBrief(
  channel: YouTubeChannel,
  videos: YouTubeVideo[],
  niche: string = 'general'
): GodsEyeBrief {
  if (!videos || videos.length === 0) {
    throw new Error('No video data available for analysis');
  }

  const sampleSize = videos.length;
  let confidenceLevel: 'high' | 'medium' | 'low' = 'low';
  if (sampleSize >= 10) confidenceLevel = 'high';
  else if (sampleSize >= 5) confidenceLevel = 'medium';

  const hookAnalysis = analyzeHook(videos, niche);
  const emotionalArc = analyzeEmotionalArc(videos);
  const visualPacing = analyzeVisualPacing(videos, emotionalArc);
  const topPatterns = detectPatterns(videos, niche);
  const gaps = analyzeCompetitorGaps(videos, niche);
  const recommendations = generateRecommendations(topPatterns, gaps, channel);
  const qualityGate = applySelfCritiqueGate(topPatterns, gaps, recommendations);

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
      confidence_model: 'Beta(\u03b1+successes, \u03b2+failures) + recency decay + differential impact bonus',
      decay_half_life_days: NICHE_DECAY_HALF_LIFE[niche] ?? 90,
      minimum_sample_for_confidence: 5,
    },
    caveats: {
      sample_size_note: `${sampleSize} videos is ${sampleSize >= 10 ? 'sufficient' : 'below optimal (10+)'} for confident generalization.`,
      survivorship_bias: 'Analyzing top videos only. Missing data on what fails. Patterns are "what works" but incomplete.',
      niche_specificity: `Patterns derived from "${niche}" niche. May not transfer to other categories (education, gaming, music).`,
    },
  };

  if (!qualityGate.passed) {
    console.warn('God\'s Eye brief quality gate warnings:', qualityGate.feedback);
  }

  return brief;
}

// ── Hive Mind Integration ──

export function logBriefToHiveMind(brief: GodsEyeBrief, db: Database.Database, chatId?: string): void {
  try {
    const summary = `God's Eye brief: ${brief.niche} niche, ${brief.sample_size} videos, ${brief.confidence_level} confidence. Top recommendation: ${brief.recommendations[0]?.technique || 'N/A'}.`;
    const id = chatId || 'api';
    db.prepare(`
      INSERT INTO hive_mind (chat_id, agent_id, action, summary, artifacts, niche, created_at)
      VALUES (?, 'god-s-eye', 'brief_generated', ?, ?, ?, datetime('now'))
    `).run(id, summary, JSON.stringify(brief), brief.niche);
  } catch {
    // Silently fail if Hive Mind logging unavailable
  }
}

// ── Query Hive Mind for Channel Data ──

export function getChannelDataFromHiveMind(
  channelId?: string,
  limit: number = 20
): { channel: YouTubeChannel; videos: YouTubeVideo[] } {
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));

  try {
    let channel: YouTubeChannel;
    if (channelId) {
      channel = db.prepare('SELECT * FROM youtube_channels WHERE channel_id = ?').get(channelId) as YouTubeChannel;
      if (!channel) throw new Error(`Channel ${channelId} not found in database`);
    } else {
      channel = db.prepare('SELECT * FROM youtube_channels LIMIT 1').get() as YouTubeChannel;
      if (!channel) throw new Error('No YouTube channel data found in database');
    }

    let query = `
      SELECT
        video_id, title, description, view_count, like_count, comment_count,
        published_at, duration_seconds,
        ROUND(CAST(like_count AS REAL) / NULLIF(view_count, 0) * 100, 2) AS engagement_rate
      FROM youtube_videos
    `;
    if (channelId) query += ` WHERE channel_id = ?`;
    query += ` ORDER BY published_at ASC LIMIT ?`;

    const rawVideos = channelId
      ? db.prepare(query).all(channelId, limit) as YouTubeVideo[]
      : db.prepare(query).all(limit) as YouTubeVideo[];

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

// ── Outlier Detection ──

export function getOutlierVideos(videos: YouTubeVideo[], topN = 5): YouTubeVideo[] {
  return calculateMovingAverages(videos)
    .filter(v => v.is_outlier)
    .sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0))
    .slice(0, topN);
}

// ── Convenience: Generate from Hive Mind ──

export function generateGodsEyeBriefFromHiveMind(niche: string = 'general', channelId?: string): GodsEyeBrief {
  const { channel, videos } = getChannelDataFromHiveMind(channelId, 50);
  const brief = generateGodsEyeBrief(channel, videos, niche);

  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  logBriefToHiveMind(brief, db);
  db.close();

  return brief;
}