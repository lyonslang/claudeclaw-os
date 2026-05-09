/**
 * avatar-render.ts
 * Avatar rendering client for Skinwalker production pipeline.
 *
 * Primary: HeyGen API (cloud, $0.50-0.80 per 2-min video)
 * Fallback: ComfyUI (local GPU, ~$0.10 per video — requires setup)
 *
 * Handles:
 * - Submit render job with audio + avatar ID
 * - Poll for completion (with timeout)
 * - Download rendered video
 * - Avatar consistency enforcement via production-tracker registry
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { getAvatarForNiche } from './production-tracker.js';

// ── Types ────────────────────────────────────────────────────────

export interface RenderRequest {
  audioPath: string;           // path to the synthesized voice audio
  avatarId: string;            // HeyGen avatar ID
  niche: string;               // for tracking + consistency
  scriptTitle: string;         // for naming
  backgroundUrl?: string;      // optional background image/video URL
}

export interface RenderResult {
  video_path: string;          // local path to downloaded avatar video
  duration_seconds: number;
  render_time_seconds: number;
  cost_usd: number;
  provider: 'heygen' | 'comfyui' | 'placeholder';
  render_id: string;           // provider's job ID
}

export interface HeyGenJobStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  video_url?: string;
  error?: string;
}

// ── HeyGen API ───────────────────────────────────────────────────

function httpsRequest(url: string, options: https.RequestOptions, body?: string | Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HeyGen HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getApiKey(): string {
  const env = readEnvFile(['HEYGEN_API_KEY']);
  const key = env.HEYGEN_API_KEY;
  if (!key) throw new Error('HEYGEN_API_KEY not set in .env — required for avatar rendering');
  return key;
}

/**
 * Submit a video generation job to HeyGen.
 * Returns the job ID for polling.
 */
async function submitHeyGenRender(
  audioPath: string,
  avatarId: string,
  apiKey: string,
  backgroundUrl?: string,
): Promise<string> {
  // Read audio file as base64
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBase64 = audioBuffer.toString('base64');

  const payload = JSON.stringify({
    video_inputs: [{
      character: {
        type: 'avatar',
        avatar_id: avatarId,
        avatar_style: 'normal',
      },
      voice: {
        type: 'audio',
        audio_data: audioBase64,
      },
      background: backgroundUrl
        ? { type: 'url', value: backgroundUrl }
        : { type: 'color', value: '#1a1a2e' },
    }],
    dimension: { width: 1920, height: 1080 },
    test: false,
  });

  const response = await httpsRequest(
    'https://api.heygen.com/v2/video/generate',
    {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload).toString(),
      },
    },
    payload,
  );

  const result = JSON.parse(response.toString('utf-8'));
  if (result.error) {
    throw new Error(`HeyGen submit error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const videoId = result.data?.video_id;
  if (!videoId) throw new Error('HeyGen did not return a video_id');

  logger.info({ videoId, avatarId }, 'HeyGen render submitted');
  return videoId;
}

/**
 * Poll HeyGen for render job status.
 */
async function pollHeyGenStatus(videoId: string, apiKey: string): Promise<HeyGenJobStatus> {
  const response = await httpsRequest(
    `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
    {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    },
  );

  const result = JSON.parse(response.toString('utf-8'));
  const data = result.data;

  return {
    id: videoId,
    status: data?.status === 'completed' ? 'completed'
      : data?.status === 'failed' ? 'failed'
      : data?.status === 'processing' ? 'processing'
      : 'pending',
    video_url: data?.video_url,
    error: data?.error?.message,
  };
}

/**
 * Download a video from URL to local file.
 */
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const response = await httpsRequest(url, { method: 'GET' });
  fs.writeFileSync(outputPath, response);
}

// ── Public API ───────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;  // check every 10s
const MAX_POLL_TIME_MS = 5 * 60_000; // timeout after 5 min

/**
 * Render an avatar video using the best available provider.
 *
 * Priority:
 * 1. HeyGen (if HEYGEN_API_KEY is set)
 * 2. Placeholder (generates a static frame + audio — for development/testing)
 *
 * @param request - Audio path, avatar ID, niche, title
 * @returns RenderResult with video path, duration, cost
 */
export async function renderAvatar(request: RenderRequest): Promise<RenderResult> {
  const startTime = Date.now();
  const outputDir = path.join(STORE_DIR, 'production', 'avatar');
  fs.mkdirSync(outputDir, { recursive: true });

  // Resolve avatar: check registry for niche consistency
  const registeredAvatar = getAvatarForNiche(request.niche);
  const avatarId = registeredAvatar?.avatar_id ?? request.avatarId;

  if (registeredAvatar) {
    logger.info({ niche: request.niche, avatarId: registeredAvatar.avatar_id },
      'Using registered avatar for niche consistency');
  }

  // Try HeyGen first
  let apiKey: string | null = null;
  try {
    apiKey = getApiKey();
  } catch {
    // No HeyGen key — fall through to placeholder
  }

  if (apiKey) {
    return await renderWithHeyGen(request, avatarId, apiKey, outputDir, startTime);
  }

  // Fallback: placeholder render (static image + audio for development)
  logger.warn('No HEYGEN_API_KEY — generating placeholder render');
  return await renderPlaceholder(request, outputDir, startTime);
}

async function renderWithHeyGen(
  request: RenderRequest,
  avatarId: string,
  apiKey: string,
  outputDir: string,
  startTime: number,
): Promise<RenderResult> {
  // Submit render
  const videoId = await submitHeyGenRender(
    request.audioPath,
    avatarId,
    apiKey,
    request.backgroundUrl,
  );

  // Poll for completion
  let elapsed = 0;
  while (elapsed < MAX_POLL_TIME_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    elapsed += POLL_INTERVAL_MS;

    const status = await pollHeyGenStatus(videoId, apiKey);
    logger.info({ videoId, status: status.status, elapsed: Math.round(elapsed / 1000) }, 'HeyGen poll');

    if (status.status === 'completed' && status.video_url) {
      // Download the rendered video
      const videoPath = path.join(outputDir, `avatar_${videoId}.mp4`);
      await downloadVideo(status.video_url, videoPath);

      const renderTime = (Date.now() - startTime) / 1000;
      // HeyGen pricing: ~$0.50-0.80 per 2-min video
      const costEstimate = 0.65;

      logger.info({ videoId, videoPath, renderTime }, 'HeyGen render complete');

      return {
        video_path: videoPath,
        duration_seconds: 0, // will be measured by composite step
        render_time_seconds: renderTime,
        cost_usd: costEstimate,
        provider: 'heygen',
        render_id: videoId,
      };
    }

    if (status.status === 'failed') {
      throw new Error(`HeyGen render failed: ${status.error ?? 'unknown error'}`);
    }
  }

  throw new Error(`HeyGen render timed out after ${MAX_POLL_TIME_MS / 1000}s`);
}

/**
 * Placeholder render: generates a static dark frame video with the audio track.
 * Used for development/testing when HeyGen is not configured.
 */
async function renderPlaceholder(
  request: RenderRequest,
  outputDir: string,
  startTime: number,
): Promise<RenderResult> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const videoPath = path.join(outputDir, `placeholder_${Date.now()}.mp4`);

  // Get audio duration
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    request.audioPath,
  ]);
  const duration = parseFloat(stdout.trim()) || 60;

  // Generate a dark frame video with the audio
  await execFileAsync('ffmpeg', [
    '-f', 'lavfi', '-i', `color=c=0x1a1a2e:s=1920x1080:r=30:d=${duration}`,
    '-i', request.audioPath,
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-pix_fmt', 'yuv420p',
    '-y', videoPath,
  ]);

  const renderTime = (Date.now() - startTime) / 1000;

  return {
    video_path: videoPath,
    duration_seconds: duration,
    render_time_seconds: renderTime,
    cost_usd: 0,
    provider: 'placeholder',
    render_id: `placeholder_${Date.now()}`,
  };
}

/**
 * List available HeyGen avatars. Useful for initial avatar selection.
 */
export async function listHeyGenAvatars(): Promise<Array<{ avatar_id: string; avatar_name: string }>> {
  const apiKey = getApiKey();

  const response = await httpsRequest(
    'https://api.heygen.com/v2/avatars',
    {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    },
  );

  const result = JSON.parse(response.toString('utf-8'));
  return (result.data?.avatars || []).map((a: any) => ({
    avatar_id: a.avatar_id,
    avatar_name: a.avatar_name,
  }));
}

export default { renderAvatar, listHeyGenAvatars };
