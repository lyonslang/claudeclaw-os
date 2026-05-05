/**
 * recommendation-tracker.ts
 * Handles recommendation tracking, outcome measurement, and confidence calibration
 */

import Database from 'better-sqlite3';
import path from 'path';

interface RecommendationConfidence {
  confidence: number;        // 0.10 - 0.95
  lowerBound: number;        // 90% credible interval
  upperBound: number;
  isTentative: boolean;      // true if sampleSize < 8
  sampleSize: number;
  effectiveSampleSize: number; // reserved for future decay
}

interface Recommendation {
  id: number;
  niche: string;
  technique: string;
  description?: string;
  confidence_before: number;
  confidence_after: number;
  times_recommended: number;
  times_succeeded: number;
  created_at: number;
}

interface VideoOutcome {
  video_id: string;
  channel_id: string;
  title: string;
  niche: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  click_through_rate: number;
  average_view_duration_seconds: number;
}

function getDb() {
  return new Database(path.join(process.cwd(), 'store', 'claudeclaw.db'));
}

/**
 * Update confidence scores using Bayesian Beta-Binomial model
 * Returns full confidence metadata including uncertainty bounds
 */
export function updateConfidence(
  successes: number,
  totalUses: number,
  newOutcome: boolean,
  initialConfidence: number = 0.70
): RecommendationConfidence {

  const priorStrength = 8; // higher = more stable, slower learning
  const priorAlpha = initialConfidence * priorStrength;
  const priorBeta = priorStrength - priorAlpha;

  const alpha = priorAlpha + successes + (newOutcome ? 1 : 0);
  const beta = priorBeta + (totalUses - successes) + (newOutcome ? 0 : 1);

  const total = alpha + beta;
  const mean = alpha / total;

  // 90% credible interval using normal approximation to Beta distribution
  const variance = (alpha * beta) / (total ** 2 * (total + 1));
  const stdDev = Math.sqrt(variance);

  const clamp = (v: number) => Math.max(0.10, Math.min(0.95, Number(v.toFixed(3))));

  const sampleSize = totalUses + (newOutcome !== undefined ? 1 : 0);

  return {
    confidence: clamp(mean),
    lowerBound: clamp(mean - 1.645 * stdDev),
    upperBound: clamp(mean + 1.645 * stdDev),
    isTentative: sampleSize < 8,
    sampleSize,
    effectiveSampleSize: sampleSize, // will be adjusted with decay later
  };
}

/**
 * Create a new recommendation to track
 */
export function createRecommendation(
  niche: string,
  technique: string,
  description?: string,
  initialConfidence = 0.5
): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO recommendations (niche, technique, description, confidence_before, confidence_after)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(niche, technique, description || '', initialConfidence, initialConfidence);
  db.close();
  return result.lastInsertRowid as number;
}

/**
 * Record that a recommendation was used in a video
 */
export function recordRecommendationUsage(recommendationId: number, videoId: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO recommendation_usage (recommendation_id, video_id)
    VALUES (?, ?)
  `).run(recommendationId, videoId);

  // Increment times_recommended counter
  db.prepare(`
    UPDATE recommendations
    SET times_recommended = times_recommended + 1, updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(recommendationId);

  db.close();
}

/**
 * Record video outcome metrics (after the video performs)
 */
export function recordVideoOutcome(outcome: VideoOutcome): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO video_outcomes
    (video_id, channel_id, title, niche, view_count, like_count, comment_count, click_through_rate, average_view_duration_seconds, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
  `).run(
    outcome.video_id,
    outcome.channel_id,
    outcome.title,
    outcome.niche,
    outcome.view_count,
    outcome.like_count,
    outcome.comment_count,
    outcome.click_through_rate,
    outcome.average_view_duration_seconds
  );
  db.close();
}

/**
 * Calculate median performance for a niche (for comparison)
 */
export function getNicheMedianPerformance(niche: string) {
  const db = getDb();
  const result = db.prepare(`
    SELECT
      COUNT(*) as sample_size,
      ROUND(AVG(view_count), 0) as median_views,
      ROUND(AVG(click_through_rate), 4) as median_ctr,
      ROUND(AVG(comment_count), 0) as median_comments,
      ROUND(AVG(average_view_duration_seconds), 1) as median_watch_seconds
    FROM video_outcomes
    WHERE niche = ?
  `).get(niche);
  db.close();
  return result;
}

/**
 * Update recommendation confidence based on actual performance
 * Succeeds if recommendation was measured as above-median for its niche
 */
export function measureRecommendationOutcome(
  recommendationId: number,
  videoId: string,
  aboveMedianPerformance: boolean
): RecommendationConfidence {
  const db = getDb();

  // Mark as outcome measured
  db.prepare(`
    UPDATE recommendation_usage
    SET outcome_measured = 1, outcome_success = ?
    WHERE recommendation_id = ? AND video_id = ?
  `).run(aboveMedianPerformance ? 1 : 0, recommendationId, videoId);

  // Get updated stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_uses,
      SUM(CAST(outcome_success AS INTEGER)) as successes,
      r.confidence_before
    FROM recommendation_usage ru
    JOIN recommendations r ON r.id = ru.recommendation_id
    WHERE ru.recommendation_id = ? AND ru.outcome_measured = 1
  `).get(recommendationId) as {
    total_uses: number;
    successes: number;
    confidence_before: number;
  };

  // Calculate new confidence with Bayesian updating
  const newConfidence = updateConfidence(
    stats.successes,
    stats.total_uses - 1, // minus the new outcome we just added
    aboveMedianPerformance,
    stats.confidence_before
  );

  // Store updated confidence in DB
  db.prepare(`
    UPDATE recommendations
    SET
      confidence_after = ?,
      times_succeeded = ?,
      updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(newConfidence.confidence, stats.successes, recommendationId);

  db.close();
  return newConfidence;
}

/**
 * Get top recommendations for a niche, ranked by confidence
 */
export function getTopRecommendations(niche: string, limit = 10): Recommendation[] {
  const db = getDb();
  const results = db.prepare(`
    SELECT * FROM recommendations
    WHERE niche = ?
    ORDER BY confidence_after DESC, times_recommended DESC
    LIMIT ?
  `).all(niche, limit) as Recommendation[];
  db.close();
  return results;
}

/**
 * Get recommendations with proven track records (>70% success rate)
 */
export function getValidatedRecommendations(niche: string, minSuccessRate = 0.7): Recommendation[] {
  const db = getDb();
  const results = db.prepare(`
    SELECT * FROM recommendations
    WHERE niche = ?
      AND times_recommended >= 3
      AND (CAST(times_succeeded AS FLOAT) / times_recommended) >= ?
    ORDER BY confidence_after DESC
  `).all(niche, minSuccessRate) as Recommendation[];
  db.close();
  return results;
}

/**
 * Get all recommendations currently being tested (< 3 uses)
 */
export function getEarlyStageRecommendations(niche: string): Recommendation[] {
  const db = getDb();
  const results = db.prepare(`
    SELECT * FROM recommendations
    WHERE niche = ?
      AND times_recommended < 3
    ORDER BY created_at DESC
  `).all(niche) as Recommendation[];
  db.close();
  return results;
}

export default {
  createRecommendation,
  recordRecommendationUsage,
  recordVideoOutcome,
  getNicheMedianPerformance,
  measureRecommendationOutcome,
  getTopRecommendations,
  getValidatedRecommendations,
  getEarlyStageRecommendations,
};
