-- Migration 008: Meta-Learning System
-- Technique registry with performance validation and confidence scoring.
-- Feeds back into Scriptwriter + anti-slop for data-grounded decisions.
-- Rule: never generalize from fewer than MIN_SAMPLES (30). Surface uncertainty always.

-- ── Technique Registry ─────────────────────────────────────────────────
-- Each row is a named, reusable content technique.
-- version bumps when the definition changes (so old evidence stays valid).
CREATE TABLE IF NOT EXISTS content_techniques (
  technique_id    TEXT NOT NULL,          -- slug, e.g. 'mystery-explanation-arc'
  version         INTEGER NOT NULL DEFAULT 1,
  category        TEXT NOT NULL,          -- hook | format | pacing | tone | emotional_beat | title | thumbnail
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,          -- what it is
  pattern         TEXT NOT NULL,          -- how to detect/apply it
  niche           TEXT,                   -- NULL = cross-niche
  source          TEXT NOT NULL DEFAULT 'inferred', -- inferred | manual | imported
  approved        INTEGER NOT NULL DEFAULT 0,       -- human-in-loop gate
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (technique_id, version)
);

-- ── Evidence Log ───────────────────────────────────────────────────────
-- Each row = one video either using or not using a technique.
-- This is the raw ground-truth that drives confidence scoring.
CREATE TABLE IF NOT EXISTS technique_evidence (
  evidence_id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  technique_id        TEXT NOT NULL,
  technique_version   INTEGER NOT NULL DEFAULT 1,
  video_id            TEXT NOT NULL,
  project_id          TEXT,
  applies             INTEGER NOT NULL,    -- 1 = video uses technique, 0 = control group
  view_count          INTEGER,
  engagement_rate     REAL,               -- (likes + comments) / views
  ctr                 REAL,               -- click-through rate if available
  watch_time_pct      REAL,               -- avg % watched if available
  measured_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id),
  FOREIGN KEY (technique_id, technique_version) REFERENCES content_techniques(technique_id, version)
);

CREATE INDEX IF NOT EXISTS idx_evidence_technique ON technique_evidence(technique_id, applies);
CREATE INDEX IF NOT EXISTS idx_evidence_video ON technique_evidence(video_id);

-- ── Performance Summary ────────────────────────────────────────────────
-- Rolled-up stats per technique. Recalculated by the meta-learning sweep.
-- effect_size = avg_metric_applied / avg_metric_baseline (multiplier).
CREATE TABLE IF NOT EXISTS technique_performance (
  technique_id            TEXT NOT NULL,
  technique_version       INTEGER NOT NULL DEFAULT 1,
  niche                   TEXT,           -- NULL = aggregate across niches
  sample_count            INTEGER NOT NULL DEFAULT 0,   -- videos where applies=1
  baseline_count          INTEGER NOT NULL DEFAULT 0,   -- videos where applies=0
  avg_views_applied       REAL,
  avg_views_baseline      REAL,
  avg_engagement_applied  REAL,
  avg_engagement_baseline REAL,
  effect_size_views       REAL,           -- multiplier vs baseline
  effect_size_engagement  REAL,
  confidence_score        REAL NOT NULL DEFAULT 0, -- 0.0-1.0
  -- low = <10 samples, medium = 10-29, high = 30+
  confidence_level        TEXT NOT NULL DEFAULT 'low' CHECK (confidence_level IN ('low','medium','high')),
  last_calculated         INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (technique_id, technique_version, niche),
  FOREIGN KEY (technique_id, technique_version) REFERENCES content_techniques(technique_id, version)
);

-- ── Meta Insights ──────────────────────────────────────────────────────
-- Cross-technique or cross-niche patterns discovered by the sweep.
-- Must be human-approved before they influence Scriptwriter decisions.
CREATE TABLE IF NOT EXISTS meta_insights (
  insight_id      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  technique_id    TEXT,                   -- NULL if cross-technique insight
  niche           TEXT,
  hypothesis      TEXT NOT NULL,          -- what we think is true
  evidence_count  INTEGER NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0,
  insight_text    TEXT NOT NULL,          -- human-readable summary
  actionable      TEXT,                   -- concrete recommendation for Scriptwriter
  generated_by    TEXT NOT NULL DEFAULT 'meta-sweep',
  approved        INTEGER NOT NULL DEFAULT 0,  -- human must approve before pipeline use
  dismissed       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  approved_at     INTEGER
);

-- ── Playbook ───────────────────────────────────────────────────────────
-- Approved, high-confidence techniques ready for Scriptwriter + anti-slop.
CREATE VIEW IF NOT EXISTS scriptwriter_playbook AS
SELECT
  ct.technique_id,
  ct.name,
  ct.category,
  ct.description,
  ct.pattern,
  ct.niche,
  tp.confidence_level,
  tp.confidence_score,
  tp.effect_size_views,
  tp.effect_size_engagement,
  tp.sample_count,
  tp.last_calculated
FROM content_techniques ct
JOIN technique_performance tp
  ON ct.technique_id = tp.technique_id
  AND ct.version = tp.technique_version
WHERE ct.approved = 1
  AND tp.confidence_level IN ('medium','high')
  AND tp.sample_count >= 10
ORDER BY tp.effect_size_views DESC;

-- ── Pending Review ─────────────────────────────────────────────────────
-- Surfaces newly discovered insights waiting for human approval.
CREATE VIEW IF NOT EXISTS pending_insights AS
SELECT
  mi.insight_id,
  mi.technique_id,
  mi.niche,
  mi.hypothesis,
  mi.confidence_score,
  mi.evidence_count,
  mi.insight_text,
  mi.actionable,
  mi.generated_by,
  mi.created_at
FROM meta_insights mi
WHERE mi.approved = 0
  AND mi.dismissed = 0
ORDER BY mi.confidence_score DESC, mi.evidence_count DESC;
