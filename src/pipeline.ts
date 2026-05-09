/**
 * pipeline.ts
 * Single entry point for the God's Eye content pipeline.
 *
 * Connects: YouTube ingest → God's Eye brief → (optional) Scriptwriter → pre-production score
 *
 * Usage:
 *   analyzeChannel('@MrBeast', 'entertainment')  → brief with confidence scores
 *   analyzeAndScript('@MrBeast', 'entertainment') → brief + script + production readiness
 *   scoreBeforeProduction(brief, { title, hook })  → 0-100 pre-production confidence
 */

import { ingestChannel, resolveChannelId } from './youtube-ingest.js';
import {
  generateGodsEyeBrief,
  getChannelDataFromHiveMind,
  preProductionScore,
  type PreProductionScoreResult,
} from './gods-eye/index.js';
import { generateScript, type ScriptOutput } from './scriptwriter.js';
import { toHumanReadable } from './utils/bayesian-confidence.js';
import { produce, type ProductionOutput } from './skinwalker.js';
import {
  isYouTubeAnalyticsConfigured,
  fetchReturningViewerRate,
  type ViewerTypeResult,
} from './youtube-analytics.js';
import { upsertChannelSnapshot } from './db.js';

// ── Types ────────────────────────────────────────────────────────

export interface AnalysisResult {
  channel_id: string;
  channel_name: string;
  niche: string;
  brief: ReturnType<typeof generateGodsEyeBrief>;
  from_cache: boolean;
  videos_analyzed: number;
  human_summary: string;
  returning_viewers?: ViewerTypeResult;
}

export interface FullPipelineResult {
  analysis: AnalysisResult;
  script: ScriptOutput;
  pre_production_score: PreProductionScoreResult;
}

// ── Core Pipeline Functions ──────────────────────────────────────

/**
 * Analyze any YouTube channel: fetch data (if needed) → run God's Eye brief.
 *
 * Accepts @handle, channel URL, or raw channel ID.
 * Skips YouTube API fetch if data is <7 days old.
 */
export async function analyzeChannel(
  channelInput: string,
  niche: string = 'general',
  opts: { maxVideos?: number; force?: boolean } = {}
): Promise<AnalysisResult> {
  const { maxVideos = 50, force = false } = opts;

  // Step 1: Ingest (fetch + persist if stale)
  console.log(`[PIPELINE] Ingesting channel: ${channelInput}`);
  const ingestResult = await ingestChannel(channelInput, {
    maxVideos,
    force,
    niche,
  });

  const channelId = ingestResult.channel.channel_id;

  // Step 2: Load from DB with engagement rates computed
  console.log(`[PIPELINE] Running God's Eye analysis...`);
  const { channel, videos } = getChannelDataFromHiveMind(channelId, maxVideos);

  // Step 3: Generate brief
  const brief = generateGodsEyeBrief(channel, videos, niche);

  // Step 4: Human-readable summary
  const humanSummary = toHumanReadable(brief);

  console.log(`[PIPELINE] Analysis complete: ${brief.sample_size} videos, ${brief.confidence_level} confidence`);

  // Step 5: Fetch returning viewer rate if YouTube Analytics OAuth2 is configured
  let returningViewers: ViewerTypeResult | undefined;
  if (isYouTubeAnalyticsConfigured()) {
    try {
      returningViewers = await fetchReturningViewerRate(channelId);
      const today = new Date().toISOString().split('T')[0];
      upsertChannelSnapshot({
        channel_id: channelId,
        snapshot_date: today,
        subscriber_count: ingestResult.channel.subscriber_count,
        total_views: ingestResult.channel.view_count,
        returning_viewer_pct: returningViewers.returning_pct,
        new_viewer_pct: returningViewers.new_pct,
      });
      console.log(
        `[PIPELINE] Audience loyalty: ${returningViewers.returning_pct}% returning, ${returningViewers.new_pct}% new`,
      );
    } catch (err: any) {
      console.warn(`[PIPELINE] YouTube Analytics fetch failed (non-fatal): ${err.message}`);
    }
  }

  return {
    channel_id: channelId,
    channel_name: ingestResult.channel.title,
    niche,
    brief,
    from_cache: ingestResult.fromCache,
    videos_analyzed: brief.sample_size,
    human_summary: humanSummary,
    returning_viewers: returningViewers,
  };
}

/**
 * Full pipeline: analyze channel → generate script → score it.
 *
 * Returns the brief, the generated script, and a pre-production confidence score.
 */
export async function analyzeAndScript(
  channelInput: string,
  niche: string = 'general',
  insightMechanism: 'COUNTER_INTUITIVE_CAUSALITY' | 'NARRATIVE_VOID' | 'PERSPECTIVE_SHIFT' = 'COUNTER_INTUITIVE_CAUSALITY',
  opts: { maxVideos?: number; force?: boolean } = {}
): Promise<FullPipelineResult> {
  // Step 1-3: Analyze channel
  const analysis = await analyzeChannel(channelInput, niche, opts);

  // Step 4: Generate script from brief (pivot auto-selected by Bayesian governor)
  console.log(`[PIPELINE] Generating script with ${insightMechanism} mechanism...`);
  const briefForScriptwriter = {
    top_patterns: analysis.brief.top_patterns.map(p => ({
      pattern: p.pattern,
      actionable_form: p.actionable_form,
      confidence: p.confidence,
    })),
    hook_analysis: {
      recommended_hook: analysis.brief.hook_analysis.recommended_hook,
      hook_template: analysis.brief.hook_analysis.hook_template,
    },
    emotional_arc: {
      opening: { emotion: analysis.brief.emotional_arc.opening.emotion, technique: analysis.brief.emotional_arc.opening.technique },
      middle: { emotion: analysis.brief.emotional_arc.middle.emotion, technique: analysis.brief.emotional_arc.middle.technique },
      peak: { emotion: analysis.brief.emotional_arc.peak.emotion, technique: analysis.brief.emotional_arc.peak.technique },
      close: { emotion: analysis.brief.emotional_arc.close.emotion, technique: analysis.brief.emotional_arc.close.technique },
    },
  };

  const script = await generateScript(niche, briefForScriptwriter, insightMechanism);

  // Step 5: Score the generated script against the brief
  const preScore = preProductionScore(analysis.brief, {
    title: script.title,
    hook: script.script.hook,
    format: script.script.act_1.duration_seconds > 120 ? 'long-form' : 'short',
  });

  console.log(`[PIPELINE] Script generated. Pre-production score: ${preScore.score}/100`);

  return {
    analysis,
    script,
    pre_production_score: preScore,
  };
}

/**
 * Score a concept against a channel's brief WITHOUT generating a full script.
 * Use this to test multiple ideas quickly before committing to production.
 */
export async function scoreConceptForChannel(
  channelInput: string,
  concept: { title: string; hook?: string; format?: string },
  niche: string = 'general'
): Promise<{ analysis: AnalysisResult; score: PreProductionScoreResult }> {
  const analysis = await analyzeChannel(channelInput, niche);
  const score = preProductionScore(analysis.brief, concept);
  return { analysis, score };
}

/**
 * Full production pipeline: analyze channel → generate script → produce video.
 *
 * The complete loop: channel URL → published video with voice, avatar, and branding.
 */
export async function produceVideo(
  channelInput: string,
  niche: string = 'general',
  insightMechanism: 'COUNTER_INTUITIVE_CAUSALITY' | 'NARRATIVE_VOID' | 'PERSPECTIVE_SHIFT' = 'COUNTER_INTUITIVE_CAUSALITY',
  opts: { maxVideos?: number; force?: boolean; colorGrade?: 'warm_cinematic' | 'cool_modern' | 'neutral' } = {}
): Promise<{ analysis: AnalysisResult; script: ScriptOutput; production: ProductionOutput }> {
  // Steps 1-5: Analyze + script
  const pipelineResult = await analyzeAndScript(channelInput, niche, insightMechanism, opts);

  // Step 6: Produce video from script
  console.log(`[PIPELINE] Producing video with Skinwalker...`);
  const production = await produce({
    script: pipelineResult.script.script,
    niche,
    title: pipelineResult.script.title,
    colorGrade: opts.colorGrade ?? 'warm_cinematic',
  });

  console.log(`[PIPELINE] Production ${production.status}: ${production.video_path ?? 'no output'}`);

  return {
    analysis: pipelineResult.analysis,
    script: pipelineResult.script,
    production,
  };
}

export default {
  analyzeChannel,
  analyzeAndScript,
  scoreConceptForChannel,
  produceVideo,
};
