/**
 * voice-synthesis.ts
 * Production-grade voice synthesis with emotional beat awareness.
 *
 * Extends the existing ElevenLabs integration in voice.ts with:
 * - Per-beat prosody control (speed, pitch, pauses)
 * - Script-to-audio pipeline (takes a full script, returns a single audio file)
 * - Cost tracking per synthesis call
 * - Voice consistency enforcement via voice registry
 *
 * Used by Skinwalker to produce the voice track for avatar videos.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { getVoiceForNiche } from './production-tracker.js';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────

export interface EmotionalBeat {
  text: string;
  emotion: 'hook' | 'intrigue' | 'recognition' | 'educational' | 'shock' | 'outro' | 'neutral';
  duration_hint_seconds?: number;
}

export interface ProsodySettings {
  stability: number;          // 0-1, higher = more consistent but robotic
  similarity_boost: number;   // 0-1, higher = closer to original voice
  style: number;              // 0-1, expressiveness
  speed: number;              // 0.5-2.0, playback speed multiplier
}

export interface SynthesisResult {
  audio_path: string;          // path to the output audio file
  duration_seconds: number;    // total audio duration
  cost_usd: number;            // estimated cost
  beats_synthesized: number;   // number of beats processed
}

// ── Prosody Rules ────────────────────────────────────────────────

/**
 * Map emotional beats to prosody parameters.
 * These follow the SKINWALKER_PROMPT.md prosody rules.
 */
const PROSODY_MAP: Record<EmotionalBeat['emotion'], ProsodySettings> = {
  hook: {
    stability: 0.65,
    similarity_boost: 0.85,
    style: 0.8,
    speed: 0.9,     // slightly slower — give mystery room to breathe
  },
  intrigue: {
    stability: 0.70,
    similarity_boost: 0.85,
    style: 0.7,
    speed: 0.90,    // measured, deliberate
  },
  recognition: {
    stability: 0.55,
    similarity_boost: 0.85,
    style: 0.9,
    speed: 1.15,    // faster — urgency, surprise
  },
  shock: {
    stability: 0.50,
    similarity_boost: 0.85,
    style: 1.0,
    speed: 1.15,    // sharp, staccato
  },
  educational: {
    stability: 0.80,
    similarity_boost: 0.80,
    style: 0.5,
    speed: 1.0,     // baseline — clarity is critical
  },
  outro: {
    stability: 0.75,
    similarity_boost: 0.85,
    style: 0.6,
    speed: 0.95,    // wind down
  },
  neutral: {
    stability: 0.75,
    similarity_boost: 0.80,
    style: 0.5,
    speed: 1.0,
  },
};

/**
 * Generate a silence pause between beats based on transition type.
 */
function getPauseDurationMs(fromEmotion: EmotionalBeat['emotion'], toEmotion: EmotionalBeat['emotion']): number {
  // Shock/recognition → anything: no pause (immediate impact)
  if (fromEmotion === 'shock' || fromEmotion === 'recognition') return 0;
  // Hook → anything: +200ms (anticipation)
  if (fromEmotion === 'hook' || fromEmotion === 'intrigue') return 200;
  // Educational → educational: +100ms (clarity)
  if (fromEmotion === 'educational' && toEmotion === 'educational') return 100;
  // Default
  return 150;
}

// ── ElevenLabs API ───────────────────────────────────────────────

function httpsRequest(url: string, options: https.RequestOptions, body?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`ElevenLabs HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 300)}`));
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

/**
 * Synthesize a single text segment with specific prosody settings.
 * Returns raw audio buffer (mp3).
 */
async function synthesizeBeat(
  text: string,
  voiceId: string,
  apiKey: string,
  prosody: ProsodySettings
): Promise<Buffer> {
  const payload = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: {
      stability: prosody.stability,
      similarity_boost: prosody.similarity_boost,
      style: prosody.style,
      use_speaker_boost: true,
    },
  });

  return await httpsRequest(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload).toString(),
      },
    },
    payload,
  );
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Synthesize a full script with per-beat prosody control.
 *
 * Takes an array of emotional beats, synthesizes each with appropriate
 * prosody settings, concatenates with inter-beat pauses, and returns
 * a single audio file ready for avatar lip-sync.
 *
 * @param beats - Script broken into emotional beats with text + emotion
 * @param niche - Content niche (used to look up consistent voice from registry)
 * @param outputDir - Directory to write the output audio file
 * @returns SynthesisResult with audio path, duration, and cost
 */
export async function synthesizeScript(
  beats: EmotionalBeat[],
  niche: string,
  outputDir?: string
): Promise<SynthesisResult> {
  if (beats.length === 0) {
    throw new Error('No beats to synthesize');
  }

  const env = readEnvFile(['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']);
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set — required for voice synthesis');

  // Check voice registry for niche-specific voice, fall back to default
  const registeredVoice = getVoiceForNiche(niche);
  const voiceId = registeredVoice?.voice_id ?? env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error('No voice ID available (no registry entry and ELEVENLABS_VOICE_ID not set)');

  const dir = outputDir ?? path.join(STORE_DIR, 'production', 'audio');
  fs.mkdirSync(dir, { recursive: true });

  const sessionId = `voice_${niche}_${Date.now()}`;
  const beatFiles: string[] = [];

  // Synthesize each beat individually
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const prosody = PROSODY_MAP[beat.emotion] ?? PROSODY_MAP.neutral;

    // Override with registered voice settings if available
    if (registeredVoice) {
      prosody.stability = registeredVoice.default_stability;
      prosody.similarity_boost = registeredVoice.default_similarity_boost;
    }

    logger.info({
      beat: i + 1,
      total: beats.length,
      emotion: beat.emotion,
      textLength: beat.text.length,
    }, 'Synthesizing beat');

    const audioBuffer = await synthesizeBeat(beat.text, voiceId, apiKey, prosody);
    const beatPath = path.join(dir, `${sessionId}_beat${i}.mp3`);
    fs.writeFileSync(beatPath, audioBuffer);
    beatFiles.push(beatPath);

    // Add silence file for inter-beat pause (if not last beat)
    if (i < beats.length - 1) {
      const pauseMs = getPauseDurationMs(beat.emotion, beats[i + 1].emotion);
      if (pauseMs > 0) {
        const silencePath = path.join(dir, `${sessionId}_silence${i}.mp3`);
        await execFileAsync('ffmpeg', [
          '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`,
          '-t', (pauseMs / 1000).toFixed(3),
          '-c:a', 'libmp3lame', '-b:a', '128k',
          '-y', silencePath,
        ]);
        beatFiles.push(silencePath);
      }
    }
  }

  // Concatenate all beat files + silences into one audio file
  const outputPath = path.join(dir, `${sessionId}_final.mp3`);
  const concatListPath = path.join(dir, `${sessionId}_concat.txt`);
  const concatContent = beatFiles.map(f => `file '${f}'`).join('\n');
  fs.writeFileSync(concatListPath, concatContent);

  await execFileAsync('ffmpeg', [
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-c', 'copy', '-y', outputPath,
  ]);

  // Get duration of final audio
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    outputPath,
  ]);
  const durationSeconds = parseFloat(stdout.trim()) || 0;

  // Clean up individual beat files
  for (const f of beatFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(concatListPath); } catch { /* ignore */ }

  // Cost estimate: ElevenLabs ~$0.015/min of speech
  const costUsd = Math.round((durationSeconds / 60) * 0.015 * 1000) / 1000;

  logger.info({
    outputPath,
    durationSeconds: Math.round(durationSeconds),
    beats: beats.length,
    costUsd,
  }, 'Voice synthesis complete');

  return {
    audio_path: outputPath,
    duration_seconds: durationSeconds,
    cost_usd: costUsd,
    beats_synthesized: beats.length,
  };
}

/**
 * Convert a ScriptJSON (from the scriptwriter) into EmotionalBeat[] for synthesis.
 */
export function scriptToBeats(script: {
  hook: string;
  act_1: { beats: string[]; emotional_tone: string };
  act_2: { beats: string[]; emotional_tone: string };
  peak: { revelation: string; emotional_payoff: string };
  close: { call_to_action: string };
}): EmotionalBeat[] {
  const beats: EmotionalBeat[] = [];

  // Hook
  beats.push({ text: script.hook, emotion: 'hook' });

  // Act 1 beats
  for (const beat of script.act_1.beats) {
    beats.push({ text: beat, emotion: 'intrigue' });
  }

  // Act 2 beats
  for (const beat of script.act_2.beats) {
    beats.push({ text: beat, emotion: 'recognition' });
  }

  // Peak
  beats.push({ text: script.peak.revelation, emotion: 'shock' });

  // Close
  beats.push({ text: script.close.call_to_action, emotion: 'outro' });

  return beats;
}

export default { synthesizeScript, scriptToBeats };
