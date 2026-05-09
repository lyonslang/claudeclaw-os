/**
 * skinwalker.ts
 * Avatar-based video production engine.
 *
 * Takes an approved script (from God's Eye → Scriptwriter pipeline) and produces
 * a publication-ready video with voice, avatar, branding, and metadata.
 *
 * Pipeline: Pre-flight → Voice Synthesis → Avatar Render → Composite → QA → Metadata → Archive
 *
 * Invoked by Ava as the Skinwalker skill. Works in cohesion with God's Eye
 * (which provides the analysis + script) to complete the full production loop.
 */

import fs from 'fs';
import path from 'path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';
import { synthesizeScript, scriptToBeats, type EmotionalBeat } from './voice-synthesis.js';
import { renderAvatar, type RenderResult } from './avatar-render.js';
import { compositeVideo, extractThumbnail, addBranding, getMediaDuration } from './video-composite.js';
import {
  createProductionEntry,
  updateProductionStatus,
  getAvatarForNiche,
  getVoiceForNiche,
  logProductionToHiveMind,
  type ProductionLogEntry,
} from './production-tracker.js';

// ── Types ────────────────────────────────────────────────────────

export interface ProductionInput {
  script: {
    hook: string;
    act_1: { beats: string[]; emotional_tone: string; sensory_details?: string[]; duration_seconds: number };
    act_2: { beats: string[]; emotional_tone: string; duration_seconds: number };
    peak: { revelation: string; emotional_payoff: string; duration_seconds: number };
    close: { call_to_action: string; duration_seconds: number };
  };
  niche: string;
  title: string;
  avatarId?: string;             // HeyGen avatar ID (optional — uses registry if not provided)
  backgroundPath?: string;       // optional background video/image
  colorGrade?: 'warm_cinematic' | 'cool_modern' | 'neutral';
  skipAvatar?: boolean;          // if true, produces audio + placeholder video (dev mode)
}

export interface ProductionOutput {
  production_id: number;
  status: 'complete' | 'failed';
  video_path: string | null;
  thumbnail_path: string | null;
  audio_path: string;
  duration_seconds: number;
  costs: {
    voice_usd: number;
    avatar_usd: number;
    composite_usd: number;
    total_usd: number;
  };
  render_time_seconds: number;
  quality_score: number;
  metadata: {
    title: string;
    description: string;
    tags: string[];
  };
  error: string | null;
}

// ── Pre-Flight Checks ────────────────────────────────────────────

interface PreFlightResult {
  passed: boolean;
  avatarId: string;
  voiceId: string;
  issues: string[];
}

function runPreFlight(input: ProductionInput): PreFlightResult {
  const issues: string[] = [];

  // Validate script structure
  if (!input.script.hook) issues.push('Script missing hook');
  if (!input.script.act_1?.beats?.length) issues.push('Script missing act_1 beats');
  if (!input.script.peak?.revelation) issues.push('Script missing peak revelation');
  if (!input.script.close?.call_to_action) issues.push('Script missing close CTA');

  // Check avatar consistency
  const registeredAvatar = getAvatarForNiche(input.niche);
  const avatarId = input.avatarId ?? registeredAvatar?.avatar_id ?? 'default';
  if (!registeredAvatar && !input.avatarId) {
    issues.push(`No avatar registered for "${input.niche}" niche — will use default or placeholder`);
  }

  // Check voice consistency
  const registeredVoice = getVoiceForNiche(input.niche);
  const voiceId = registeredVoice?.voice_id ?? '';
  if (!registeredVoice) {
    issues.push(`No voice registered for "${input.niche}" niche — will use ELEVENLABS_VOICE_ID default`);
  }

  return {
    passed: issues.filter(i => !i.includes('will use')).length === 0, // warnings don't block
    avatarId,
    voiceId,
    issues,
  };
}

// ── Quality Assurance ────────────────────────────────────────────

function calculateQualityScore(
  voiceResult: { beats_synthesized: number; duration_seconds: number },
  renderResult: RenderResult,
  videoDuration: number,
): number {
  let score = 100;

  // Penalize if voice synthesis produced very short audio
  if (voiceResult.duration_seconds < 30) score -= 15;

  // Penalize if render used placeholder
  if (renderResult.provider === 'placeholder') score -= 30;

  // Penalize if render was slow (>3 min)
  if (renderResult.render_time_seconds > 180) score -= 10;

  // Penalize if final video is very short or very long
  if (videoDuration < 60) score -= 10;
  if (videoDuration > 900) score -= 5; // >15 min is unusual

  // Bonus for HeyGen render (higher quality avatar)
  if (renderResult.provider === 'heygen') score += 5;

  return Math.max(0, Math.min(100, score));
}

// ── Metadata Generation ──────────────────────────────────────────

function generateMetadata(input: ProductionInput): {
  title: string;
  description: string;
  tags: string[];
} {
  const title = input.title;

  // Generate description from script structure
  const descParts = [
    input.script.hook,
    '',
    'In this video:',
    ...input.script.act_1.beats.slice(0, 2).map(b => `• ${b}`),
    '',
    input.script.close.call_to_action,
    '',
    `#${input.niche.replace(/[_\s]+/g, '')} #content #analysis`,
  ];

  // Extract tags from script content
  const allText = [
    input.title, input.script.hook,
    ...input.script.act_1.beats,
    ...input.script.act_2.beats,
    input.script.peak.revelation,
  ].join(' ');

  const tags = [...new Set(
    allText
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4 && w.length < 30)
      .slice(0, 15)
  )];
  tags.unshift(input.niche);

  return {
    title,
    description: descParts.join('\n'),
    tags,
  };
}

// ── Main Production Function ─────────────────────────────────────

/**
 * Produce a publication-ready video from an approved script.
 *
 * Pipeline:
 * 1. Pre-flight checks (script validation, avatar/voice consistency)
 * 2. Voice synthesis (ElevenLabs with per-beat prosody)
 * 3. Avatar rendering (HeyGen or placeholder)
 * 4. Video compositing (FFmpeg: avatar + audio + branding)
 * 5. Quality assurance (spot-check scoring)
 * 6. Metadata generation (title, description, tags, thumbnail)
 * 7. Archive + hive mind logging
 */
export async function produce(input: ProductionInput): Promise<ProductionOutput> {
  const startTime = Date.now();
  const missionId = `skinwalker_${input.niche}_${Date.now()}`;

  logger.info({ missionId, niche: input.niche, title: input.title }, 'Skinwalker production starting');

  // Create production log entry
  const productionId = createProductionEntry({
    mission_id: missionId,
    niche: input.niche,
    script_title: input.title,
    status: 'pending',
    avatar_id: '',
    voice_id: '',
    voice_cost_usd: 0,
    avatar_cost_usd: 0,
    composite_cost_usd: 0,
    total_cost_usd: 0,
    render_time_seconds: 0,
    output_path: null,
    thumbnail_path: null,
    quality_score: 0,
    error: null,
  });

  try {
    // ── Step 1: Pre-flight ──
    console.log('[SKINWALKER] Running pre-flight checks...');
    const preflight = runPreFlight(input);
    if (preflight.issues.length > 0) {
      for (const issue of preflight.issues) {
        console.warn(`  [PRE-FLIGHT] ${issue}`);
      }
    }
    if (!preflight.passed) {
      throw new Error(`Pre-flight failed: ${preflight.issues.join('; ')}`);
    }

    // ── Step 2: Voice Synthesis ──
    console.log('[SKINWALKER] Synthesizing voice track...');
    updateProductionStatus(productionId, 'rendering');
    const beats: EmotionalBeat[] = scriptToBeats(input.script);
    const voiceResult = await synthesizeScript(beats, input.niche);
    console.log(`[SKINWALKER] Voice done: ${Math.round(voiceResult.duration_seconds)}s, $${voiceResult.cost_usd.toFixed(3)}`);

    // ── Step 3: Avatar Rendering ──
    console.log('[SKINWALKER] Rendering avatar...');
    const renderResult = await renderAvatar({
      audioPath: voiceResult.audio_path,
      avatarId: preflight.avatarId,
      niche: input.niche,
      scriptTitle: input.title,
      backgroundUrl: input.backgroundPath ? undefined : undefined, // HeyGen uses URL, not local path
    });
    console.log(`[SKINWALKER] Avatar done: ${renderResult.provider}, ${Math.round(renderResult.render_time_seconds)}s, $${renderResult.cost_usd.toFixed(2)}`);

    // ── Step 4: Composite ──
    console.log('[SKINWALKER] Compositing final video...');
    updateProductionStatus(productionId, 'compositing');
    const compositeResult = await compositeVideo({
      avatarPath: renderResult.video_path,
      audioPath: voiceResult.audio_path,
      backgroundPath: input.backgroundPath,
      colorGrade: input.colorGrade ?? 'warm_cinematic',
      avatarPosition: 'center-right',
    });

    // ── Step 5: Branding ──
    console.log('[SKINWALKER] Adding branding...');
    const brandedPath = await addBranding(compositeResult.output_path, {
      outroText: input.script.close.call_to_action,
    });

    // ── Step 6: QA ──
    console.log('[SKINWALKER] Running quality assurance...');
    updateProductionStatus(productionId, 'qa');
    const finalDuration = await getMediaDuration(brandedPath);
    const qualityScore = calculateQualityScore(voiceResult, renderResult, finalDuration);

    // ── Step 7: Thumbnail ──
    const thumbnail = await extractThumbnail(brandedPath);

    // ── Step 8: Metadata ──
    const metadata = generateMetadata(input);

    // ── Step 9: Archive ──
    const archiveDir = path.join(STORE_DIR, 'production', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const finalPath = path.join(archiveDir, `${missionId}.mp4`);
    fs.copyFileSync(brandedPath, finalPath);

    // Calculate costs
    const totalCost = voiceResult.cost_usd + renderResult.cost_usd + 0.02; // $0.02 for FFmpeg compute
    const renderTime = (Date.now() - startTime) / 1000;

    // Update production log
    updateProductionStatus(productionId, 'complete', {
      output_path: finalPath,
      thumbnail_path: thumbnail.thumbnail_path,
      quality_score: qualityScore,
      voice_cost_usd: voiceResult.cost_usd,
      avatar_cost_usd: renderResult.cost_usd,
      composite_cost_usd: 0.02,
      total_cost_usd: totalCost,
      render_time_seconds: renderTime,
    });

    // Log to hive mind
    const entry: ProductionLogEntry = {
      mission_id: missionId,
      niche: input.niche,
      script_title: input.title,
      status: 'complete',
      avatar_id: preflight.avatarId,
      voice_id: preflight.voiceId,
      voice_cost_usd: voiceResult.cost_usd,
      avatar_cost_usd: renderResult.cost_usd,
      composite_cost_usd: 0.02,
      total_cost_usd: totalCost,
      render_time_seconds: renderTime,
      output_path: finalPath,
      thumbnail_path: thumbnail.thumbnail_path,
      quality_score: qualityScore,
      error: null,
    };
    logProductionToHiveMind(entry);

    console.log(`[SKINWALKER] Production complete: ${finalPath}`);
    console.log(`  Quality: ${qualityScore}/100 | Cost: $${totalCost.toFixed(2)} | Time: ${Math.round(renderTime)}s`);

    return {
      production_id: productionId,
      status: 'complete',
      video_path: finalPath,
      thumbnail_path: thumbnail.thumbnail_path,
      audio_path: voiceResult.audio_path,
      duration_seconds: finalDuration,
      costs: {
        voice_usd: voiceResult.cost_usd,
        avatar_usd: renderResult.cost_usd,
        composite_usd: 0.02,
        total_usd: totalCost,
      },
      render_time_seconds: renderTime,
      quality_score: qualityScore,
      metadata,
      error: null,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const renderTime = (Date.now() - startTime) / 1000;

    logger.error({ error: errorMsg, missionId }, 'Skinwalker production failed');
    updateProductionStatus(productionId, 'failed', { error: errorMsg, render_time_seconds: renderTime });

    logProductionToHiveMind({
      mission_id: missionId,
      niche: input.niche,
      script_title: input.title,
      status: 'failed',
      avatar_id: '',
      voice_id: '',
      voice_cost_usd: 0,
      avatar_cost_usd: 0,
      composite_cost_usd: 0,
      total_cost_usd: 0,
      render_time_seconds: renderTime,
      output_path: null,
      thumbnail_path: null,
      quality_score: 0,
      error: errorMsg,
    });

    return {
      production_id: productionId,
      status: 'failed',
      video_path: null,
      thumbnail_path: null,
      audio_path: '',
      duration_seconds: 0,
      costs: { voice_usd: 0, avatar_usd: 0, composite_usd: 0, total_usd: 0 },
      render_time_seconds: renderTime,
      quality_score: 0,
      metadata: { title: input.title, description: '', tags: [] },
      error: errorMsg,
    };
  }
}

export default { produce };
