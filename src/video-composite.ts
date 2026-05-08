/**
 * video-composite.ts
 * FFmpeg-based video compositing for Skinwalker production pipeline.
 *
 * Handles:
 * - Avatar overlay on background/B-roll
 * - Branding (intro card, outro card, watermark)
 * - YouTube-ready encoding (H.264, 1080p, AAC audio)
 * - Thumbnail extraction from key frames
 *
 * All operations use FFmpeg via child_process — no native bindings needed.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────

export interface CompositeOptions {
  avatarPath: string;          // avatar video (with or without transparency)
  audioPath: string;           // voice audio track
  backgroundPath?: string;     // optional background video/image
  outputDir?: string;          // output directory
  resolution?: string;         // default '1920x1080'
  frameRate?: number;          // default 30
  avatarPosition?: 'center' | 'center-right' | 'left' | 'right';
  avatarScale?: number;        // 0-1, fraction of frame width. Default 0.4
  colorGrade?: 'warm_cinematic' | 'cool_modern' | 'neutral';
}

export interface CompositeResult {
  output_path: string;
  duration_seconds: number;
  file_size_mb: number;
  codec: string;
  resolution: string;
}

export interface ThumbnailResult {
  thumbnail_path: string;
  timestamp_seconds: number;
}

// ── FFmpeg Helpers ───────────────────────────────────────────────

/**
 * Check if FFmpeg is available.
 */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the duration of a media file in seconds.
 */
export async function getMediaDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

/**
 * Get video resolution as [width, height].
 */
export async function getVideoResolution(filePath: string): Promise<[number, number]> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    filePath,
  ]);
  const parts = stdout.trim().split('x');
  return [parseInt(parts[0]) || 1920, parseInt(parts[1]) || 1080];
}

// ── Compositing ──────────────────────────────────────────────────

/**
 * Composite avatar video over a background with audio.
 *
 * If no background is provided, uses a solid dark background.
 * Avatar is positioned according to avatarPosition setting.
 */
export async function compositeVideo(opts: CompositeOptions): Promise<CompositeResult> {
  if (!(await hasFfmpeg())) {
    throw new Error('FFmpeg not installed — run: brew install ffmpeg');
  }

  const resolution = opts.resolution ?? '1920x1080';
  const [width, height] = resolution.split('x').map(Number);
  const frameRate = opts.frameRate ?? 30;
  const avatarScale = opts.avatarScale ?? 0.4;
  const dir = opts.outputDir ?? path.join(STORE_DIR, 'production', 'video');
  fs.mkdirSync(dir, { recursive: true });

  const outputPath = path.join(dir, `composite_${Date.now()}.mp4`);

  // Calculate avatar position
  const avatarWidth = Math.round(width * avatarScale);
  let overlayX: string;
  switch (opts.avatarPosition ?? 'center-right') {
    case 'center': overlayX = `(W-w)/2`; break;
    case 'center-right': overlayX = `W-w-${Math.round(width * 0.05)}`; break;
    case 'right': overlayX = `W-w-20`; break;
    case 'left': overlayX = '20'; break;
    default: overlayX = `W-w-${Math.round(width * 0.05)}`;
  }
  const overlayY = `H-h-20`; // bottom-aligned with small margin

  // Build FFmpeg filter chain
  const filterParts: string[] = [];

  if (opts.backgroundPath && fs.existsSync(opts.backgroundPath)) {
    // Background + avatar overlay
    filterParts.push(
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[bg]`,
      `[1:v]scale=${avatarWidth}:-1[avatar]`,
      `[bg][avatar]overlay=${overlayX}:${overlayY}[out]`
    );

    // Color grading
    if (opts.colorGrade === 'warm_cinematic') {
      filterParts[filterParts.length - 1] = filterParts[filterParts.length - 1].replace('[out]',
        ',colorbalance=rs=0.1:gs=-0.05:bs=-0.1,curves=preset=cross_process[out]');
    } else if (opts.colorGrade === 'cool_modern') {
      filterParts[filterParts.length - 1] = filterParts[filterParts.length - 1].replace('[out]',
        ',colorbalance=rs=-0.05:gs=0.0:bs=0.1[out]');
    }

    await execFileAsync('ffmpeg', [
      '-i', opts.backgroundPath,
      '-i', opts.avatarPath,
      '-i', opts.audioPath,
      '-filter_complex', filterParts.join(';'),
      '-map', '[out]',
      '-map', '2:a',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-r', String(frameRate),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', outputPath,
    ]);
  } else {
    // No background — avatar on solid dark background + audio
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', `color=c=0x1a1a2e:s=${resolution}:r=${frameRate}`,
      '-i', opts.avatarPath,
      '-i', opts.audioPath,
      '-filter_complex', [
        `[1:v]scale=${avatarWidth}:-1[avatar]`,
        `[0:v][avatar]overlay=${overlayX}:${overlayY}:shortest=1[out]`,
      ].join(';'),
      '-map', '[out]',
      '-map', '2:a',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-shortest',
      '-y', outputPath,
    ]);
  }

  // Get output metadata
  const duration = await getMediaDuration(outputPath);
  const stats = fs.statSync(outputPath);
  const fileSizeMb = Math.round(stats.size / (1024 * 1024) * 100) / 100;

  logger.info({
    outputPath,
    duration: Math.round(duration),
    fileSizeMb,
    resolution,
  }, 'Video composite complete');

  return {
    output_path: outputPath,
    duration_seconds: duration,
    file_size_mb: fileSizeMb,
    codec: 'h264',
    resolution,
  };
}

// ── YouTube Encoding ─────────────────────────────────────────────

/**
 * Re-encode a video to YouTube-recommended specs.
 * Use this for final QA if the composite output needs adjustment.
 */
export async function encodeForYouTube(
  inputPath: string,
  outputPath?: string
): Promise<string> {
  const out = outputPath ?? inputPath.replace(/\.\w+$/, '_yt.mp4');

  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-profile:v', 'high', '-level', '4.0',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y', out,
  ]);

  return out;
}

// ── Thumbnail Generation ─────────────────────────────────────────

/**
 * Extract a thumbnail from a video at a specific timestamp.
 * If no timestamp is given, extracts from the first third of the video
 * (where the hook/peak emotion usually lives).
 */
export async function extractThumbnail(
  videoPath: string,
  opts?: { timestampSeconds?: number; outputDir?: string }
): Promise<ThumbnailResult> {
  const duration = await getMediaDuration(videoPath);
  const timestamp = opts?.timestampSeconds ?? Math.round(duration * 0.3); // first third
  const dir = opts?.outputDir ?? path.join(STORE_DIR, 'production', 'thumbnails');
  fs.mkdirSync(dir, { recursive: true });

  const thumbnailPath = path.join(dir, `thumb_${Date.now()}.jpg`);

  await execFileAsync('ffmpeg', [
    '-ss', String(timestamp),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2', // high quality JPEG
    '-y', thumbnailPath,
  ]);

  logger.info({ thumbnailPath, timestamp }, 'Thumbnail extracted');

  return {
    thumbnail_path: thumbnailPath,
    timestamp_seconds: timestamp,
  };
}

// ── Branding ─────────────────────────────────────────────────────

/**
 * Add intro and outro cards to a video.
 * Intro: 3-second fade-in with optional logo.
 * Outro: 5-second subscribe prompt.
 */
export async function addBranding(
  videoPath: string,
  opts?: {
    introLogoPath?: string;     // optional channel logo for intro
    introDuration?: number;     // seconds, default 3
    outroDuration?: number;     // seconds, default 5
    outroText?: string;         // default "Subscribe for more"
    outputPath?: string;
  }
): Promise<string> {
  const introDur = opts?.introDuration ?? 3;
  const outroDur = opts?.outroDuration ?? 5;
  const outroText = opts?.outroText ?? 'Subscribe for more';
  const out = opts?.outputPath ?? videoPath.replace(/\.\w+$/, '_branded.mp4');

  // Simple approach: fade in at start, add text overlay at end
  const duration = await getMediaDuration(videoPath);

  const filterComplex = [
    // Fade in
    `fade=t=in:st=0:d=${introDur}`,
    // Fade out
    `fade=t=out:st=${Math.max(0, duration - outroDur)}:d=${outroDur}`,
    // Outro text overlay (last N seconds)
    `drawtext=text='${outroText}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-100:enable='between(t,${duration - outroDur},${duration})'`,
  ].join(',');

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vf', filterComplex,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'copy',
    '-y', out,
  ]);

  return out;
}

export default {
  hasFfmpeg,
  getMediaDuration,
  getVideoResolution,
  compositeVideo,
  encodeForYouTube,
  extractThumbnail,
  addBranding,
};
