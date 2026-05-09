/**
 * production-tracker.ts
 * Tracks production costs, render times, avatar/voice consistency, and archives.
 *
 * Ensures:
 * - Same avatar per niche (consistency across videos)
 * - Same voice per niche (identity consistency)
 * - Cost tracking per render step (voice, avatar, composite)
 * - Hive mind logging so all agents see production events
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────

export interface ProductionLogEntry {
  id?: number;
  mission_id: string;
  niche: string;
  script_title: string;
  status: 'pending' | 'rendering' | 'compositing' | 'qa' | 'complete' | 'failed';
  avatar_id: string;
  voice_id: string;
  voice_cost_usd: number;
  avatar_cost_usd: number;
  composite_cost_usd: number;
  total_cost_usd: number;
  render_time_seconds: number;
  output_path: string | null;
  thumbnail_path: string | null;
  quality_score: number;       // 0-100
  error: string | null;
  created_at?: number;
  completed_at?: number;
}

export interface AvatarRegistryEntry {
  id?: number;
  niche: string;
  avatar_id: string;           // external ID (HeyGen avatar ID or ComfyUI model)
  avatar_name: string;
  provider: 'heygen' | 'comfyui' | 'local';
  style: string;               // e.g. "expressive_young_female"
  created_at?: number;
}

export interface VoiceRegistryEntry {
  id?: number;
  niche: string;
  voice_id: string;            // ElevenLabs voice ID
  voice_name: string;
  provider: 'elevenlabs' | 'gradium' | 'kokoro' | 'local';
  default_stability: number;
  default_similarity_boost: number;
  created_at?: number;
}

// ── DB Setup ─────────────────────────────────────────────────────

function getDb(): Database.Database {
  return new Database(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Ensure production tables exist. Called on first use.
 */
export function ensureProductionSchema(db?: Database.Database): void {
  const d = db ?? getDb();
  const shouldClose = !db;

  d.exec(`
    CREATE TABLE IF NOT EXISTS production_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id          TEXT NOT NULL,
      niche               TEXT NOT NULL,
      script_title        TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      avatar_id           TEXT NOT NULL DEFAULT '',
      voice_id            TEXT NOT NULL DEFAULT '',
      voice_cost_usd      REAL NOT NULL DEFAULT 0,
      avatar_cost_usd     REAL NOT NULL DEFAULT 0,
      composite_cost_usd  REAL NOT NULL DEFAULT 0,
      total_cost_usd      REAL NOT NULL DEFAULT 0,
      render_time_seconds REAL NOT NULL DEFAULT 0,
      output_path         TEXT,
      thumbnail_path      TEXT,
      quality_score       INTEGER NOT NULL DEFAULT 0,
      error               TEXT,
      created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      completed_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_production_log_mission ON production_log(mission_id);
    CREATE INDEX IF NOT EXISTS idx_production_log_niche ON production_log(niche, created_at DESC);

    CREATE TABLE IF NOT EXISTS avatar_registry (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      niche       TEXT NOT NULL,
      avatar_id   TEXT NOT NULL,
      avatar_name TEXT NOT NULL,
      provider    TEXT NOT NULL DEFAULT 'heygen',
      style       TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(niche, provider)
    );

    CREATE TABLE IF NOT EXISTS voice_registry (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      niche                     TEXT NOT NULL,
      voice_id                  TEXT NOT NULL,
      voice_name                TEXT NOT NULL,
      provider                  TEXT NOT NULL DEFAULT 'elevenlabs',
      default_stability         REAL NOT NULL DEFAULT 0.75,
      default_similarity_boost  REAL NOT NULL DEFAULT 0.85,
      created_at                INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(niche, provider)
    );
  `);

  if (shouldClose) d.close();
}

// ── Production Log ───────────────────────────────────────────────

export function createProductionEntry(entry: Omit<ProductionLogEntry, 'id' | 'created_at' | 'completed_at'>): number {
  const db = getDb();
  ensureProductionSchema(db);

  const result = db.prepare(`
    INSERT INTO production_log (mission_id, niche, script_title, status, avatar_id, voice_id,
      voice_cost_usd, avatar_cost_usd, composite_cost_usd, total_cost_usd,
      render_time_seconds, output_path, thumbnail_path, quality_score, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.mission_id, entry.niche, entry.script_title, entry.status,
    entry.avatar_id, entry.voice_id,
    entry.voice_cost_usd, entry.avatar_cost_usd, entry.composite_cost_usd, entry.total_cost_usd,
    entry.render_time_seconds, entry.output_path, entry.thumbnail_path,
    entry.quality_score, entry.error
  );

  db.close();
  return result.lastInsertRowid as number;
}

export function updateProductionStatus(
  id: number,
  status: ProductionLogEntry['status'],
  updates?: Partial<ProductionLogEntry>
): void {
  const db = getDb();
  const sets = ['status = ?'];
  const params: any[] = [status];

  if (updates?.output_path !== undefined) { sets.push('output_path = ?'); params.push(updates.output_path); }
  if (updates?.thumbnail_path !== undefined) { sets.push('thumbnail_path = ?'); params.push(updates.thumbnail_path); }
  if (updates?.quality_score !== undefined) { sets.push('quality_score = ?'); params.push(updates.quality_score); }
  if (updates?.total_cost_usd !== undefined) { sets.push('total_cost_usd = ?'); params.push(updates.total_cost_usd); }
  if (updates?.voice_cost_usd !== undefined) { sets.push('voice_cost_usd = ?'); params.push(updates.voice_cost_usd); }
  if (updates?.avatar_cost_usd !== undefined) { sets.push('avatar_cost_usd = ?'); params.push(updates.avatar_cost_usd); }
  if (updates?.composite_cost_usd !== undefined) { sets.push('composite_cost_usd = ?'); params.push(updates.composite_cost_usd); }
  if (updates?.render_time_seconds !== undefined) { sets.push('render_time_seconds = ?'); params.push(updates.render_time_seconds); }
  if (updates?.error !== undefined) { sets.push('error = ?'); params.push(updates.error); }
  if (status === 'complete' || status === 'failed') { sets.push('completed_at = strftime(\'%s\',\'now\')'); }

  params.push(id);
  db.prepare(`UPDATE production_log SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  db.close();
}

export function getProductionHistory(niche?: string, limit = 20): ProductionLogEntry[] {
  const db = getDb();
  ensureProductionSchema(db);

  const query = niche
    ? 'SELECT * FROM production_log WHERE niche = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM production_log ORDER BY created_at DESC LIMIT ?';
  const rows = niche
    ? db.prepare(query).all(niche, limit)
    : db.prepare(query).all(limit);

  db.close();
  return rows as ProductionLogEntry[];
}

// ── Avatar Registry ──────────────────────────────────────────────

/**
 * Get the avatar for a niche. Returns null if no avatar is registered.
 * Skinwalker MUST check this before rendering — avatar precedent is law.
 */
export function getAvatarForNiche(niche: string, provider = 'heygen'): AvatarRegistryEntry | null {
  const db = getDb();
  ensureProductionSchema(db);
  const row = db.prepare(
    'SELECT * FROM avatar_registry WHERE niche = ? AND provider = ? LIMIT 1'
  ).get(niche, provider) as AvatarRegistryEntry | undefined;
  db.close();
  return row ?? null;
}

export function registerAvatar(entry: Omit<AvatarRegistryEntry, 'id' | 'created_at'>): void {
  const db = getDb();
  ensureProductionSchema(db);
  db.prepare(`
    INSERT OR REPLACE INTO avatar_registry (niche, avatar_id, avatar_name, provider, style)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.niche, entry.avatar_id, entry.avatar_name, entry.provider, entry.style);
  db.close();
}

// ── Voice Registry ───────────────────────────────────────────────

/**
 * Get the voice for a niche. Returns null if no voice is registered.
 * Skinwalker uses this to ensure consistent voice across all videos in a niche.
 */
export function getVoiceForNiche(niche: string, provider = 'elevenlabs'): VoiceRegistryEntry | null {
  const db = getDb();
  ensureProductionSchema(db);
  const row = db.prepare(
    'SELECT * FROM voice_registry WHERE niche = ? AND provider = ? LIMIT 1'
  ).get(niche, provider) as VoiceRegistryEntry | undefined;
  db.close();
  return row ?? null;
}

export function registerVoice(entry: Omit<VoiceRegistryEntry, 'id' | 'created_at'>): void {
  const db = getDb();
  ensureProductionSchema(db);
  db.prepare(`
    INSERT OR REPLACE INTO voice_registry (niche, voice_id, voice_name, provider,
      default_stability, default_similarity_boost)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entry.niche, entry.voice_id, entry.voice_name, entry.provider,
         entry.default_stability, entry.default_similarity_boost);
  db.close();
}

// ── Cost Tracking ────────────────────────────────────────────────

export function getProductionCostSummary(niche?: string): {
  total_videos: number;
  total_cost: number;
  avg_cost_per_video: number;
  avg_render_time: number;
  avg_quality_score: number;
} {
  const db = getDb();
  ensureProductionSchema(db);

  const query = niche
    ? `SELECT COUNT(*) as total, COALESCE(SUM(total_cost_usd),0) as cost,
       COALESCE(AVG(total_cost_usd),0) as avg_cost, COALESCE(AVG(render_time_seconds),0) as avg_time,
       COALESCE(AVG(quality_score),0) as avg_quality
       FROM production_log WHERE niche = ? AND status = 'complete'`
    : `SELECT COUNT(*) as total, COALESCE(SUM(total_cost_usd),0) as cost,
       COALESCE(AVG(total_cost_usd),0) as avg_cost, COALESCE(AVG(render_time_seconds),0) as avg_time,
       COALESCE(AVG(quality_score),0) as avg_quality
       FROM production_log WHERE status = 'complete'`;

  const row = (niche ? db.prepare(query).get(niche) : db.prepare(query).get()) as any;
  db.close();

  return {
    total_videos: row.total,
    total_cost: row.cost,
    avg_cost_per_video: row.avg_cost,
    avg_render_time: row.avg_time,
    avg_quality_score: row.avg_quality,
  };
}

// ── Hive Mind Logging ────────────────────────────────────────────

export function logProductionToHiveMind(entry: ProductionLogEntry): void {
  const db = getDb();
  try {
    const summary = entry.status === 'complete'
      ? `Skinwalker produced "${entry.script_title}" (${entry.niche}). Cost: $${entry.total_cost_usd.toFixed(2)}, quality: ${entry.quality_score}/100, render: ${entry.render_time_seconds.toFixed(0)}s.`
      : `Skinwalker ${entry.status}: "${entry.script_title}" (${entry.niche}).${entry.error ? ' Error: ' + entry.error : ''}`;

    db.prepare(`
      INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, created_at)
      VALUES ('skinwalker', 'api', 'production_event', ?, ?, strftime('%s','now'))
    `).run(summary, JSON.stringify(entry));
  } catch (error) {
    logger.warn({ error }, 'Failed to log production event to hive mind');
  }
  db.close();
}

export default {
  ensureProductionSchema,
  createProductionEntry,
  updateProductionStatus,
  getProductionHistory,
  getAvatarForNiche,
  registerAvatar,
  getVoiceForNiche,
  registerVoice,
  getProductionCostSummary,
  logProductionToHiveMind,
};
