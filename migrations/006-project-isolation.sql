-- Migration 006: Project-level isolation
-- Date: May 5, 2026
-- Purpose: Scope all data (missions, insights, recommendations, checks) to a specific
--          project (channel + niche), preventing data bleed between channels/niches.
--
-- A "project" = one channel + one niche + one production context.
-- Everything hangs off project_id so queries stay clean and isolated.

-- ── Projects Table ───────────────────────────────────────────────────────────
-- Top-level container. One row per channel/niche you're working on.

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL UNIQUE,          -- slug: e.g. "fried-plantain", "research-horror"
  name        TEXT NOT NULL,                 -- display name: e.g. "Fried Plantain Channel"
  niche       TEXT NOT NULL,                 -- e.g. "mystery_comedy", "cooking", "horror"
  channel_id  TEXT,                          -- YouTube channel ID (nullable for research projects)
  type        TEXT NOT NULL DEFAULT 'production'
              CHECK(type IN ('production', 'research', 'competitor', 'test')),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK(status IN ('active', 'paused', 'archived')),
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE INDEX IF NOT EXISTS idx_projects_niche  ON projects(niche);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_type   ON projects(type);

-- ── Add project_id to mission_post_mortem ────────────────────────────────────
ALTER TABLE mission_post_mortem ADD COLUMN project_id TEXT;
ALTER TABLE mission_post_mortem ADD COLUMN niche TEXT;

CREATE INDEX IF NOT EXISTS idx_mission_pm_project ON mission_post_mortem(project_id);
CREATE INDEX IF NOT EXISTS idx_mission_pm_niche   ON mission_post_mortem(niche);

-- ── Add project_id to youtube_insights ───────────────────────────────────────
ALTER TABLE youtube_insights ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_yt_insights_project ON youtube_insights(project_id);

-- ── Add project_id to originality_checks ─────────────────────────────────────
ALTER TABLE originality_checks ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orig_checks_project ON originality_checks(project_id);

-- ── Add project_id to recommendations ────────────────────────────────────────
-- recommendations already has niche, just add project_id for tighter scoping
ALTER TABLE recommendations ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_recommendations_project ON recommendations(project_id);

-- ── Add project_id to standing_queries ───────────────────────────────────────
ALTER TABLE standing_queries ADD COLUMN project_id TEXT;

-- ── Add project_id to video_outcomes ─────────────────────────────────────────
ALTER TABLE video_outcomes ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_video_outcomes_project ON video_outcomes(project_id);

-- ── Views: Per-Project Summaries ─────────────────────────────────────────────

-- Project overview: cost, missions, quality stats per project
CREATE VIEW IF NOT EXISTS project_overview AS
SELECT
  p.project_id,
  p.name,
  p.niche,
  p.type,
  p.status,
  COUNT(DISTINCT m.mission_id)                              AS total_missions,
  ROUND(SUM(m.total_cost_usd), 2)                          AS total_cost_usd,
  ROUND(AVG(m.total_cost_usd), 2)                          AS avg_cost_per_mission,
  SUM(m.num_outputs_produced)                              AS total_outputs,
  ROUND(AVG(CAST(m.outputs_approved_first_pass AS FLOAT)
        / NULLIF(m.num_outputs_produced, 0) * 100), 1)    AS first_pass_approval_rate,
  SUM(m.escalations_to_ava)                                AS total_escalations,
  MAX(m.created_at)                                        AS last_mission_at
FROM projects p
LEFT JOIN mission_post_mortem m ON m.project_id = p.project_id
GROUP BY p.project_id;

-- Per-project recommendation effectiveness
CREATE VIEW IF NOT EXISTS project_recommendations AS
SELECT
  p.project_id,
  p.name,
  p.niche,
  r.technique,
  r.description,
  r.confidence_after,
  r.times_recommended,
  r.times_succeeded,
  ROUND(CAST(r.times_succeeded AS FLOAT)
        / NULLIF(r.times_recommended, 0) * 100, 1)        AS success_rate_percent
FROM projects p
JOIN recommendations r ON r.project_id = p.project_id
ORDER BY r.confidence_after DESC;

-- ── Seed: Default Project ────────────────────────────────────────────────────
-- Add a default test project so Phase 1B test has a project to log against

INSERT OR IGNORE INTO projects (project_id, name, niche, type, status, description)
VALUES
  ('test-phase1b',     'Phase 1B Test',         'mystery_comedy', 'test',       'active', 'Phase 1B pipeline validation'),
  ('research-default', 'General Research',       'general',        'research',   'active', 'General niche research, not tied to a channel');
