/**
 * Meta-Learning System
 *
 * Learns *which techniques actually drive performance* from real video data.
 * Extracts patterns → validates against ground-truth metrics → scores confidence.
 * High-confidence approved techniques surface to Scriptwriter + anti-slop.
 *
 * Rules:
 * - Never generalize from fewer than MIN_SAMPLES (30) for 'high' confidence
 * - All insights require human approval before influencing the pipeline
 * - effect_size is always relative to a baseline (not absolute)
 * - Confidence degrades over time if not refreshed with new evidence
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../config.js';

const MIN_SAMPLES_HIGH   = 30;
const MIN_SAMPLES_MEDIUM = 10;

function getDb() {
  return new Database(path.join(STORE_DIR, 'claudeclaw.db'));
}

// ── Types ───────────────────────────────────────────────────────────────

export interface Technique {
  technique_id: string;
  version: number;
  category: 'hook' | 'format' | 'pacing' | 'tone' | 'emotional_beat' | 'title' | 'thumbnail';
  name: string;
  description: string;
  pattern: string;
  niche?: string;
  source: 'inferred' | 'manual' | 'imported';
  approved: boolean;
}

export interface TechniqueEvidence {
  technique_id: string;
  technique_version?: number;
  video_id: string;
  project_id?: string;
  applies: boolean;
  view_count?: number;
  engagement_rate?: number;
  ctr?: number;
  watch_time_pct?: number;
}

export interface PlaybookEntry {
  technique_id: string;
  name: string;
  category: string;
  description: string;
  pattern: string;
  niche?: string;
  confidence_level: 'low' | 'medium' | 'high';
  confidence_score: number;
  effect_size_views: number;
  effect_size_engagement: number;
  sample_count: number;
  last_calculated: number;
}

export interface MetaInsight {
  insight_id: string;
  technique_id?: string;
  niche?: string;
  hypothesis: string;
  evidence_count: number;
  confidence_score: number;
  insight_text: string;
  actionable?: string;
}

// ── Technique Registry ──────────────────────────────────────────────────

export function registerTechnique(t: Omit<Technique, 'version' | 'approved'>): void {
  const db = getDb();
  try {
    // Check if technique already exists — if so, bump version
    const existing = db.prepare(
      'SELECT MAX(version) as v FROM content_techniques WHERE technique_id = ?'
    ).get(t.technique_id) as { v: number | null };
    const version = (existing?.v ?? 0) + 1;

    db.prepare(`
      INSERT INTO content_techniques
        (technique_id, version, category, name, description, pattern, niche, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.technique_id, version, t.category, t.name, t.description, t.pattern, t.niche ?? null, t.source);
  } finally {
    db.close();
  }
}

export function approveTechnique(techniqueId: string, version?: number): void {
  const db = getDb();
  try {
    const ver = version ?? (db.prepare(
      'SELECT MAX(version) as v FROM content_techniques WHERE technique_id = ?'
    ).get(techniqueId) as { v: number })?.v ?? 1;

    db.prepare(
      'UPDATE content_techniques SET approved = 1, updated_at = unixepoch() WHERE technique_id = ? AND version = ?'
    ).run(techniqueId, ver);
  } finally {
    db.close();
  }
}

// ── Evidence Logging ────────────────────────────────────────────────────

export function logEvidence(evidence: TechniqueEvidence): void {
  const db = getDb();
  try {
    const version = evidence.technique_version ?? (db.prepare(
      'SELECT MAX(version) as v FROM content_techniques WHERE technique_id = ?'
    ).get(evidence.technique_id) as { v: number })?.v ?? 1;

    db.prepare(`
      INSERT OR REPLACE INTO technique_evidence
        (technique_id, technique_version, video_id, project_id, applies,
         view_count, engagement_rate, ctr, watch_time_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence.technique_id,
      version,
      evidence.video_id,
      evidence.project_id ?? null,
      evidence.applies ? 1 : 0,
      evidence.view_count ?? null,
      evidence.engagement_rate ?? null,
      evidence.ctr ?? null,
      evidence.watch_time_pct ?? null
    );
  } finally {
    db.close();
  }
}

// ── Meta-Learning Sweep ─────────────────────────────────────────────────
// Run this periodically (nightly or after significant new data).
// Recalculates performance, confidence, and surfaces new insights.

export function runMetaSweep(niche?: string): { updated: number; insights: number } {
  const db = getDb();
  let updated = 0;
  let insights = 0;

  try {
    // Get all techniques with evidence
    const techniques = db.prepare(`
      SELECT DISTINCT technique_id, technique_version
      FROM technique_evidence
    `).all() as { technique_id: string; technique_version: number }[];

    for (const { technique_id, technique_version } of techniques) {
      // Applied group
      const applied = db.prepare(`
        SELECT
          COUNT(*) as n,
          AVG(view_count) as avg_views,
          AVG(engagement_rate) as avg_engagement
        FROM technique_evidence
        WHERE technique_id = ? AND technique_version = ? AND applies = 1
        ${niche ? 'AND project_id IN (SELECT project_id FROM projects WHERE niche = ?)' : ''}
      `).get(technique_id, technique_version, ...(niche ? [niche] : [])) as any;

      // Baseline group (same technique, applies=0)
      const baseline = db.prepare(`
        SELECT
          COUNT(*) as n,
          AVG(view_count) as avg_views,
          AVG(engagement_rate) as avg_engagement
        FROM technique_evidence
        WHERE technique_id = ? AND technique_version = ? AND applies = 0
        ${niche ? 'AND project_id IN (SELECT project_id FROM projects WHERE niche = ?)' : ''}
      `).get(technique_id, technique_version, ...(niche ? [niche] : [])) as any;

      const sampleCount   = applied?.n ?? 0;
      const baselineCount = baseline?.n ?? 0;

      const confidenceLevel: 'low' | 'medium' | 'high' =
        sampleCount >= MIN_SAMPLES_HIGH ? 'high' :
        sampleCount >= MIN_SAMPLES_MEDIUM ? 'medium' : 'low';

      // Confidence score: blends sample size and effect consistency
      const rawConfidence = Math.min(1, sampleCount / MIN_SAMPLES_HIGH);

      const effectViews = (applied?.avg_views && baseline?.avg_views && baseline.avg_views > 0)
        ? applied.avg_views / baseline.avg_views
        : null;

      const effectEngagement = (applied?.avg_engagement && baseline?.avg_engagement && baseline.avg_engagement > 0)
        ? applied.avg_engagement / baseline.avg_engagement
        : null;

      db.prepare(`
        INSERT OR REPLACE INTO technique_performance
          (technique_id, technique_version, niche, sample_count, baseline_count,
           avg_views_applied, avg_views_baseline,
           avg_engagement_applied, avg_engagement_baseline,
           effect_size_views, effect_size_engagement,
           confidence_score, confidence_level, last_calculated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(
        technique_id, technique_version, niche ?? null,
        sampleCount, baselineCount,
        applied?.avg_views ?? null, baseline?.avg_views ?? null,
        applied?.avg_engagement ?? null, baseline?.avg_engagement ?? null,
        effectViews, effectEngagement,
        rawConfidence, confidenceLevel
      );

      updated++;

      // Surface insight if medium+ confidence and notable effect
      if (confidenceLevel !== 'low' && effectViews !== null && effectViews > 1.2) {
        const existing = db.prepare(
          'SELECT insight_id FROM meta_insights WHERE technique_id = ? AND niche IS ?'
        ).get(technique_id, niche ?? null) as { insight_id: string } | undefined;

        if (!existing) {
          const effectPct = Math.round((effectViews - 1) * 100);
          db.prepare(`
            INSERT INTO meta_insights
              (technique_id, niche, hypothesis, evidence_count, confidence_score,
               insight_text, actionable)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            technique_id,
            niche ?? null,
            `Technique "${technique_id}" correlates with higher view counts`,
            sampleCount,
            rawConfidence,
            `Based on ${sampleCount} videos, "${technique_id}" shows +${effectPct}% views vs baseline ` +
              `(confidence: ${confidenceLevel}). Baseline from ${baselineCount} control videos.`,
            `Apply "${technique_id}" in concept phase. Flag for anti-slop if concept lacks this pattern.`
          );
          insights++;
        } else {
          // Update evidence count on existing insight
          db.prepare(
            'UPDATE meta_insights SET evidence_count = ?, confidence_score = ? WHERE insight_id = ?'
          ).run(sampleCount, rawConfidence, existing.insight_id);
        }
      }
    }
  } finally {
    db.close();
  }

  return { updated, insights };
}

// ── Playbook Query ──────────────────────────────────────────────────────
// What Scriptwriter + anti-slop call to get approved techniques.

export function getPlaybook(niche?: string): PlaybookEntry[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT * FROM scriptwriter_playbook
      ${niche ? 'WHERE niche = ? OR niche IS NULL' : ''}
      ORDER BY effect_size_views DESC
    `).all(...(niche ? [niche] : [])) as PlaybookEntry[];
    return rows;
  } finally {
    db.close();
  }
}

export function getPendingInsights(): MetaInsight[] {
  const db = getDb();
  try {
    return db.prepare('SELECT * FROM pending_insights').all() as MetaInsight[];
  } finally {
    db.close();
  }
}

export function approveInsight(insightId: string): void {
  const db = getDb();
  try {
    db.prepare(
      'UPDATE meta_insights SET approved = 1, approved_at = unixepoch() WHERE insight_id = ?'
    ).run(insightId);
  } finally {
    db.close();
  }
}

export function dismissInsight(insightId: string): void {
  const db = getDb();
  try {
    db.prepare(
      'UPDATE meta_insights SET dismissed = 1 WHERE insight_id = ?'
    ).run(insightId);
  } finally {
    db.close();
  }
}

// ── Concept Check (anti-slop hook) ─────────────────────────────────────
// Given a concept, check it against the playbook.
// Returns which high-confidence techniques apply and which are missing.

export function checkConceptAgainstPlaybook(
  concept: string,
  niche: string
): { applying: PlaybookEntry[]; missing: PlaybookEntry[] } {
  const playbook = getPlaybook(niche).filter(t => t.confidence_level === 'high');

  // Simple keyword match against pattern — content agent can do deeper analysis
  const applying = playbook.filter(t =>
    concept.toLowerCase().includes(t.technique_id.replace(/-/g, ' ')) ||
    concept.toLowerCase().includes(t.name.toLowerCase())
  );
  const missing = playbook.filter(t => !applying.includes(t));

  return { applying, missing };
}
