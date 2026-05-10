/**
 * governor.ts — Sovereign Governor
 *
 * Multi-armed bandit pattern selection engine for the content pipeline.
 * Closes the learning loop: God's Eye recommends → Governor picks →
 * Video publishes → Analytics sync → Posterior update → Governor learns.
 *
 * Core algorithms:
 *   - Epsilon-greedy gate → Thompson Sampling (explore) or Bayesian LCB (exploit)
 *   - Beta-Binomial posterior update with Welford's online variance
 *   - Temporal decay with MAX(1.0) clamp (floor at uninformative prior)
 *   - Idempotency guard on decay (prevents double-decay on restart)
 *
 * No external dependencies (no jStat). Beta sampling uses the inverse CDF trick.
 */

import Database from 'better-sqlite3';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logger } from './logger.js';
import {
  isYouTubeAnalyticsConfigured,
  fetchReturningViewerRateByVideo,
} from './youtube-analytics.js';

// ── Types ────────────────────────────────────────────────────────

export interface HookPattern {
  pattern_id: string;
  platform: string;
  pattern_logic: string;
  alpha: number;
  beta: number;
  mean_engagement: number;
  m2: number;
  variance: number;
  observation_count: number;
  decay_constant: number;
  prior_source: string;
  trend_velocity: number;
  last_decay_at: number;
  last_observed_at: number;
  created_at: number;
}

export interface GovernorSelection extends HookPattern {
  lcb_score?: number;
  selection_method: 'thompson' | 'lcb';
}

export interface GovernorStatus {
  total_patterns: number;
  synthetic_patterns: number;
  observed_patterns: number;
  in_flight_pending: number;
  in_flight_processed: number;
  in_flight_stuck: number;
}

// ── Platform config defaults ─────────────────────────────────────
// Stored in dashboard_settings as JSON. Defaults here for fresh installs.

interface PlatformConfig {
  default_decay: number;
  risk_aversion_k: number;
  exploration_epsilon: number;
}

const DEFAULT_PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  youtube_shorts: { default_decay: 0.99, risk_aversion_k: 2.0, exploration_epsilon: 0.10 },
  tiktok:         { default_decay: 0.90, risk_aversion_k: 1.2, exploration_epsilon: 0.15 },
};

// ── DB access ────────────────────────────────────────────────────

function getDb(): Database.Database {
  return new Database(path.join(STORE_DIR, 'claudeclaw.db'));
}

function getPlatformConfig(db: Database.Database, platform: string): PlatformConfig {
  const row = db.prepare(
    `SELECT value FROM dashboard_settings WHERE key = ?`,
  ).get(`governor_config_${platform}`) as { value: string } | undefined;
  if (row) {
    try { return JSON.parse(row.value); } catch { /* fall through */ }
  }
  return DEFAULT_PLATFORM_CONFIG[platform] ?? DEFAULT_PLATFORM_CONFIG.youtube_shorts;
}

// ── Beta sampling (no jStat) ─────────────────────────────────────
// Uses the Gamma distribution trick: if X ~ Gamma(α,1) and Y ~ Gamma(β,1),
// then X/(X+Y) ~ Beta(α,β). Gamma samples via Marsaglia and Tsang's method.

function gammaSample(shape: number): number {
  if (shape < 1) {
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = normalSample();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function normalSample(): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

// ── Governor: Pattern Selection ──────────────────────────────────

/**
 * Select the next hook pattern for a platform.
 *
 * Epsilon-greedy gate:
 *   - With probability ε → Thompson Sampling (explore)
 *   - Otherwise → Bayesian LCB (exploit)
 *
 * Synthetic patterns (from God's Eye) get a 0.7 trust weight until
 * they have real observations, then graduate to 1.0.
 */
export function getNextPattern(platform: string): GovernorSelection | null {
  const db = getDb();
  try {
    const config = getPlatformConfig(db, platform);
    const patterns = db.prepare(
      'SELECT * FROM hook_patterns WHERE platform = ?',
    ).all(platform) as HookPattern[];

    if (patterns.length === 0) return null;

    // Epsilon-greedy gate
    if (Math.random() < config.exploration_epsilon) {
      // Thompson Sampling: sample from each pattern's Beta posterior
      const untried = patterns.filter(p => p.observation_count === 0);
      const pool = untried.length > 0 ? untried : patterns;

      const sampled = pool
        .map(p => ({ ...p, sample: betaSample(p.alpha, p.beta) }))
        .sort((a, b) => b.sample - a.sample);

      return { ...sampled[0], selection_method: 'thompson' };
    }

    // LCB: exploit proven patterns
    const observed = patterns.filter(p => p.observation_count > 0);
    if (observed.length === 0) {
      // No observations yet — fall back to Thompson
      const sampled = patterns
        .map(p => ({ ...p, sample: betaSample(p.alpha, p.beta) }))
        .sort((a, b) => b.sample - a.sample);
      return { ...sampled[0], selection_method: 'thompson' };
    }

    const k = config.risk_aversion_k;
    const scored = observed.map(p => {
      const mu = p.alpha / (p.alpha + p.beta);
      const sigma = Math.sqrt(
        (p.alpha * p.beta) /
        (Math.pow(p.alpha + p.beta, 2) * (p.alpha + p.beta + 1)),
      );
      const trustWeight = (p.prior_source === 'observed' || p.observation_count > 0) ? 1.0 : 0.7;
      const lcb = trustWeight * (mu - k * sigma);
      return { ...p, lcb_score: lcb };
    }).sort((a, b) => (b.lcb_score ?? 0) - (a.lcb_score ?? 0));

    return { ...scored[0], selection_method: 'lcb' };
  } finally {
    db.close();
  }
}

// ── Posterior Update ─────────────────────────────────────────────

/**
 * Beta-Binomial posterior update + Welford's online variance.
 * M2 accumulator stored separately from derived sample variance.
 */
export function updatePatternPosterior(
  patternId: string,
  platform: string,
  views: number,
  engagedViews: number,
): void {
  const db = getDb();
  try {
    const current = db.prepare(
      'SELECT * FROM hook_patterns WHERE pattern_id = ? AND platform = ?',
    ).get(patternId, platform) as HookPattern | undefined;

    if (!current) {
      logger.warn({ patternId, platform }, 'Governor: pattern not found for posterior update');
      return;
    }

    const currentRate = engagedViews / Math.max(views, 1);
    const newCount    = current.observation_count + 1;
    const newAlpha    = current.alpha + engagedViews;
    const newBeta     = current.beta + (views - engagedViews);

    // Welford's online variance
    const delta       = currentRate - current.mean_engagement;
    const newMean     = current.mean_engagement + delta / newCount;
    const newM2       = (current.m2 || 0) + delta * (currentRate - newMean);
    const newVariance = newCount > 1 ? newM2 / (newCount - 1) : 0;

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE hook_patterns SET
        alpha = ?, beta = ?, mean_engagement = ?,
        m2 = ?, variance = ?, observation_count = ?,
        last_observed_at = ?
      WHERE pattern_id = ? AND platform = ?
    `).run(newAlpha, newBeta, newMean, newM2, newVariance, newCount, now, patternId, platform);

    logger.info(
      { patternId, platform, alpha: newAlpha.toFixed(2), beta: newBeta.toFixed(2), variance: newVariance.toFixed(4) },
      'Governor: posterior updated',
    );
  } finally {
    db.close();
  }
}

// ── In-Flight Video Tracking ─────────────────────────────────────

/**
 * Register a video for tracking after publish.
 * Maturity: youtube_shorts = 48h, tiktok = 6h.
 */
export function registerInFlightVideo(
  videoId: string,
  patternId: string,
  platform: string,
  maturityHours = 48,
): void {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO in_flight_videos
      (video_id, pattern_id, platform, maturity_hours)
      VALUES (?, ?, ?, ?)
    `).run(videoId, patternId, platform, maturityHours);
    logger.info({ videoId, patternId, platform, maturityHours }, 'Governor: video registered for tracking');
  } finally {
    db.close();
  }
}

/**
 * Sync mature in-flight videos: pull analytics and close the learning loop.
 * Uses YouTube Analytics API if configured, otherwise uses like/view ratio as proxy.
 */
export async function syncInFlightVideos(): Promise<{ synced: number; retried: number }> {
  const db = getDb();
  let synced = 0;
  let retried = 0;

  try {
    const now = Math.floor(Date.now() / 1000);
    const pending = db.prepare(`
      SELECT * FROM in_flight_videos
      WHERE is_processed = 0 AND retry_count < 5
        AND (? - published_at) / 3600 >= maturity_hours
    `).all(now) as any[];

    if (pending.length === 0) {
      logger.info('Governor sync: no mature videos to process');
      return { synced: 0, retried: 0 };
    }

    logger.info({ count: pending.length }, 'Governor sync: processing mature videos');

    for (const video of pending) {
      try {
        // Try YouTube Analytics API for engaged views
        if (isYouTubeAnalyticsConfigured() && video.platform.includes('youtube')) {
          const result = await fetchReturningViewerRateByVideo(video.video_id);
          if (result.total_views > 0) {
            // Use returning viewers as a proxy for engagement
            const engagedViews = result.returning_views;
            updatePatternPosterior(video.pattern_id, video.platform, result.total_views, engagedViews);
            db.prepare('UPDATE in_flight_videos SET is_processed = 1 WHERE video_id = ?').run(video.video_id);
            synced++;
            continue;
          }
        }

        // Fallback: check youtube_videos table for like/view ratio
        const videoData = db.prepare(
          'SELECT view_count, like_count FROM youtube_videos WHERE video_id = ?',
        ).get(video.video_id) as { view_count: number; like_count: number } | undefined;

        if (videoData && videoData.view_count > 0) {
          updatePatternPosterior(video.pattern_id, video.platform, videoData.view_count, videoData.like_count);
          db.prepare('UPDATE in_flight_videos SET is_processed = 1 WHERE video_id = ?').run(video.video_id);
          synced++;
        } else {
          const nextRetry = video.retry_count + 1;
          db.prepare(
            'UPDATE in_flight_videos SET retry_count = ?, last_attempted_at = ? WHERE video_id = ?',
          ).run(nextRetry, now, video.video_id);
          retried++;
          logger.warn({ videoId: video.video_id, retry: nextRetry }, 'Governor sync: no data yet, retrying');
        }
      } catch (err: any) {
        logger.error({ videoId: video.video_id, err: err.message }, 'Governor sync: error processing video');
        const nextRetry = video.retry_count + 1;
        db.prepare(
          'UPDATE in_flight_videos SET retry_count = ?, last_attempted_at = ? WHERE video_id = ?',
        ).run(nextRetry, now, video.video_id);
        retried++;
      }
    }
  } finally {
    db.close();
  }

  logger.info({ synced, retried }, 'Governor sync complete');
  return { synced, retried };
}

// ── Temporal Decay ───────────────────────────────────────────────

/**
 * Daily temporal aging of all hook patterns.
 * Clamp at MAX(1.0) — floor at uninformative prior Beta(1,1), not blacklist.
 * Idempotency guard: only decays patterns not decayed in the last 24h.
 */
export function processPatternDecay(): number {
  const db = getDb();
  try {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const now = Math.floor(Date.now() / 1000);

    const result = db.prepare(`
      UPDATE hook_patterns SET
        alpha = MAX(1.0, alpha * decay_constant),
        beta  = MAX(1.0, beta  * decay_constant),
        last_decay_at = ?
      WHERE last_decay_at < ?
    `).run(now, oneDayAgo);

    if (result.changes === 0) {
      logger.info('Governor decay: 0 patterns aged (idempotency guard or empty table)');
    } else {
      logger.info({ count: result.changes }, 'Governor decay: patterns aged');
    }
    return result.changes;
  } finally {
    db.close();
  }
}

// ── Status ───────────────────────────────────────────────────────

/**
 * Get Governor status for dashboard/CLI.
 */
export function getGovernorStatus(platform?: string): GovernorStatus {
  const db = getDb();
  try {
    const where = platform ? ' WHERE platform = ?' : '';
    const params = platform ? [platform] : [];

    const total = (db.prepare(`SELECT COUNT(*) as c FROM hook_patterns${where}`).get(...params) as any).c;
    const synthetic = (db.prepare(`SELECT COUNT(*) as c FROM hook_patterns${where ? where + " AND prior_source = 'synthetic'" : " WHERE prior_source = 'synthetic'"}`).get(...params) as any).c;
    const observed = total - synthetic;

    const inFlightWhere = platform ? ' WHERE platform = ?' : '';
    const pending = (db.prepare(`SELECT COUNT(*) as c FROM in_flight_videos${inFlightWhere} ${inFlightWhere ? 'AND' : 'WHERE'} is_processed = 0 AND retry_count < 5`).get(...params) as any).c;
    const processed = (db.prepare(`SELECT COUNT(*) as c FROM in_flight_videos${inFlightWhere} ${inFlightWhere ? 'AND' : 'WHERE'} is_processed = 1`).get(...params) as any).c;
    const stuck = (db.prepare(`SELECT COUNT(*) as c FROM in_flight_videos${inFlightWhere} ${inFlightWhere ? 'AND' : 'WHERE'} retry_count >= 5 AND is_processed = 0`).get(...params) as any).c;

    return {
      total_patterns: total,
      synthetic_patterns: synthetic,
      observed_patterns: observed,
      in_flight_pending: pending,
      in_flight_processed: processed,
      in_flight_stuck: stuck,
    };
  } finally {
    db.close();
  }
}

/**
 * Insert or update a hook pattern (used by God's Eye to seed synthetic priors).
 */
export function upsertHookPattern(data: {
  pattern_id: string;
  platform: string;
  pattern_logic: string;
  alpha?: number;
  beta?: number;
  decay_constant?: number;
  prior_source?: string;
}): void {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO hook_patterns (pattern_id, platform, pattern_logic, alpha, beta, decay_constant, prior_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id, platform) DO UPDATE SET
        pattern_logic = excluded.pattern_logic,
        decay_constant = COALESCE(excluded.decay_constant, decay_constant)
    `).run(
      data.pattern_id,
      data.platform,
      data.pattern_logic,
      data.alpha ?? 1.0,
      data.beta ?? 1.0,
      data.decay_constant ?? 0.95,
      data.prior_source ?? 'synthetic',
    );
  } finally {
    db.close();
  }
}

export default {
  getNextPattern,
  updatePatternPosterior,
  registerInFlightVideo,
  syncInFlightVideos,
  processPatternDecay,
  getGovernorStatus,
  upsertHookPattern,
};
