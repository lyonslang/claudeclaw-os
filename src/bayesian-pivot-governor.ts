/**
 * bayesian-pivot-governor.ts
 * Governs pivot angle selection using Bayesian probability weighting with Laplace smoothing.
 *
 * Prevents premature convergence by maintaining exploration capability across all pivot angles
 * while allowing high-performing angles to guide exploitation.
 *
 * Formula: P(Angle) = (Success_Count + 1) / (Total_Trials + 3)
 * The +1 and +3 are Laplace smoothing constants that ensure no angle ever hits zero probability.
 */

import Database from 'better-sqlite3';
import path from 'path';

interface PivotAngleStats {
  angle: 'CONTRARIAN' | 'MICRO_FACT' | 'SYSTEMIC';
  success_count: number;        // outliers generated with this angle
  total_trials: number;         // total videos generated with this angle
  outlier_rate: number;         // success_count / total_trials (before smoothing)
  probability_weight: number;   // (success_count + 1) / (total_trials + 3) — smoothed
  rank: number;                 // 1 = highest weight, 3 = lowest
}

interface PivotGovernorState {
  angles: PivotAngleStats[];
  total_videos_analyzed: number;
  last_updated: number;
}

const ANGLES = ['CONTRARIAN', 'MICRO_FACT', 'SYSTEMIC'] as const;
const LAPLACE_ALPHA = 1;  // success_count pseudocount
const LAPLACE_BETA = 3;   // total_trials pseudocount

function getDb() {
  return new Database(path.join(process.cwd(), 'store', 'claudeclaw.db'));
}

/**
 * Calculate Bayesian probability weights for all pivot angles.
 * Returns angles sorted by probability (highest first).
 */
export function calculatePivotWeights(niche: string): PivotGovernorState {
  const db = getDb();

  // Query: for each pivot angle, count how many outliers were generated with it
  const angleStats = ANGLES.map(angle => {
    // This assumes a table that tracks which angle was used for each generated script
    // For now, we seed with equal trials (1 each, meaning 0 outliers = neutral state)
    const result = db.prepare(`
      SELECT
        COUNT(*) as total_trials,
        SUM(CASE WHEN is_outlier = 1 THEN 1 ELSE 0 END) as success_count
      FROM script_generation_log
      WHERE niche = ? AND pivot_angle = ?
    `).get(niche, angle) as { total_trials: number; success_count: number } | undefined;

    const total = result?.total_trials ?? 0;
    const successes = result?.success_count ?? 0;

    // Apply Laplace smoothing
    const smoothed_successes = successes + LAPLACE_ALPHA;
    const smoothed_total = total + LAPLACE_BETA;
    const probability_weight = smoothed_successes / smoothed_total;

    return {
      angle,
      success_count: successes,
      total_trials: total,
      outlier_rate: total > 0 ? successes / total : 0,
      probability_weight,
    };
  });

  db.close();

  // Sort by probability weight (highest first)
  const sorted = angleStats
    .sort((a, b) => b.probability_weight - a.probability_weight)
    .map((stat, idx) => ({
      ...stat,
      rank: idx + 1,
    }));

  return {
    angles: sorted,
    total_videos_analyzed: angleStats.reduce((sum, a) => sum + a.total_trials, 0),
    last_updated: Date.now(),
  };
}

/**
 * Sample the next pivot angle according to Bayesian weights.
 * Higher probability angles are more likely to be selected, but all have non-zero probability.
 */
export function sampleNextPivotAngle(niche: string): 'CONTRARIAN' | 'MICRO_FACT' | 'SYSTEMIC' {
  const governor = calculatePivotWeights(niche);
  const weights = governor.angles.map(a => a.probability_weight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Normalize to probabilities
  const probabilities = weights.map(w => w / totalWeight);

  // Cumulative distribution for sampling
  const cdf: number[] = [];
  let cumulative = 0;
  for (const p of probabilities) {
    cumulative += p;
    cdf.push(cumulative);
  }

  // Sample uniformly and find the corresponding angle
  const rand = Math.random();
  for (let i = 0; i < cdf.length; i++) {
    if (rand <= cdf[i]) {
      return governor.angles[i].angle;
    }
  }

  // Fallback (should never happen if probabilities sum to 1)
  return governor.angles[0].angle;
}

/**
 * Record a script generation event (called after Scriptwriter produces output).
 * This updates the success count for the pivot angle used.
 *
 * @param niche — the content niche
 * @param pivotAngle — which angle was used
 * @param isOutlier — whether the resulting video became an outlier (is_outlier == true)
 */
export function recordPivotGeneration(niche: string, pivotAngle: string, isOutlier: boolean): void {
  const db = getDb();

  // Ensure the table exists (create if not)
  db.exec(`
    CREATE TABLE IF NOT EXISTS script_generation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      niche TEXT NOT NULL,
      pivot_angle TEXT NOT NULL,
      is_outlier INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_script_gen_niche_angle ON script_generation_log(niche, pivot_angle);
  `);

  db.prepare(`
    INSERT INTO script_generation_log (niche, pivot_angle, is_outlier)
    VALUES (?, ?, ?)
  `).run(niche, pivotAngle, isOutlier ? 1 : 0);

  db.close();
}

/**
 * Get human-readable stats on pivot angle performance for a niche.
 */
export function getPivotStatsForNiche(niche: string): string {
  const governor = calculatePivotWeights(niche);

  const lines = [
    `Pivot Angle Governor — ${niche} niche (${governor.total_videos_analyzed} total videos)`,
    `────────────────────────────────────────`,
  ];

  for (const angle of governor.angles) {
    const pctStr = (angle.outlier_rate * 100).toFixed(1);
    const weightStr = (angle.probability_weight * 100).toFixed(1);
    lines.push(
      `${angle.rank}. ${angle.angle.padEnd(12)} | ` +
      `${angle.success_count}/${angle.total_trials} outliers (${pctStr}%) | ` +
      `Weight: ${weightStr}%`
    );
  }

  return lines.join('\n');
}

export default {
  calculatePivotWeights,
  sampleNextPivotAngle,
  recordPivotGeneration,
  getPivotStatsForNiche,
};
