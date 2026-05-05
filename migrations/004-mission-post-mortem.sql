-- Migration: Mission Post-Mortem Logging
-- Date: May 5, 2026
-- Purpose: Capture actual mission metrics for validation against assumptions
-- Grok's recommendation: post-mortem data is more valuable than predictions

CREATE TABLE IF NOT EXISTS mission_post_mortem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT UNIQUE NOT NULL,
  agent_id TEXT NOT NULL,
  mission_title TEXT,

  -- Execution timeline
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  duration_seconds INTEGER, -- Computed at insert time

  -- Resource usage
  god_s_eye_calls_total INTEGER DEFAULT 0,
  god_s_eye_calls_cached INTEGER DEFAULT 0,
  god_s_eye_calls_api INTEGER DEFAULT 0,
  god_s_eye_cost REAL DEFAULT 0.0,

  anti_slop_checks_total INTEGER DEFAULT 0,
  anti_slop_checks_cached INTEGER DEFAULT 0,
  anti_slop_rejections INTEGER DEFAULT 0, -- HIGH risk scores
  anti_slop_flags INTEGER DEFAULT 0,      -- MEDIUM risk scores

  total_cost_usd REAL DEFAULT 0.0,

  -- Context efficiency
  peak_context_tokens INTEGER DEFAULT 0,
  average_context_tokens INTEGER DEFAULT 0,
  context_window_pressure_percent INTEGER, -- (peak / 1_000_000) * 100

  -- Decision metrics
  autonomous_decisions_made INTEGER DEFAULT 0,
  escalations_to_ava INTEGER DEFAULT 0,
  escalations_accepted INTEGER DEFAULT 0,
  escalations_rejected INTEGER DEFAULT 0,

  -- Quality signals
  num_outputs_produced INTEGER DEFAULT 0, -- scripts, videos, etc.
  outputs_approved_first_pass INTEGER DEFAULT 0,
  outputs_rejected_total INTEGER DEFAULT 0,
  revision_rounds_total INTEGER DEFAULT 0,

  -- Friction points (freeform)
  friction_points TEXT, -- JSON list: [{ stage, issue, resolution_time_s }]
  loop_detections TEXT, -- JSON list: [{ agent, loop_type, iterations }]

  -- Thresholds (for validation)
  expected_cost REAL, -- Prior estimate
  expected_duration_seconds INTEGER, -- Prior estimate
  cost_variance_percent REAL, -- Computed at insert time
  duration_variance_percent REAL, -- Computed at insert time

  -- Summary
  status TEXT CHECK(status IN ('completed', 'failed', 'incomplete')),
  summary TEXT, -- 1-2 sentence summary
  created_at INTEGER DEFAULT (CAST(strftime('%s') AS INTEGER))
);

-- Indices for quick queries
CREATE INDEX idx_mission_post_mortem_agent ON mission_post_mortem(agent_id, completed_at DESC);
CREATE INDEX idx_mission_post_mortem_cost ON mission_post_mortem(total_cost_usd DESC);
CREATE INDEX idx_mission_post_mortem_duration ON mission_post_mortem(duration_seconds DESC);

-- View: Mission performance summary (for dashboard)
CREATE VIEW mission_performance_summary AS
SELECT
  agent_id,
  COUNT(*) as missions_completed,
  ROUND(AVG(total_cost_usd), 2) as avg_cost_per_mission,
  ROUND(AVG(duration_seconds), 0) as avg_duration_seconds,
  MAX(peak_context_tokens) as max_context_tokens_used,
  ROUND(AVG(peak_context_tokens), 0) as avg_context_tokens,
  ROUND(AVG(cost_variance_percent), 1) as avg_cost_variance_percent,
  ROUND(AVG(duration_variance_percent), 1) as avg_duration_variance_percent,
  SUM(CASE WHEN cost_variance_percent < 10 THEN 1 ELSE 0 END) as predictions_accurate,
  SUM(CASE WHEN cost_variance_percent >= 10 THEN 1 ELSE 0 END) as predictions_off
FROM mission_post_mortem
WHERE status = 'completed'
GROUP BY agent_id;

-- View: Escalation effectiveness (are escalations helping?)
CREATE VIEW escalation_effectiveness AS
SELECT
  agent_id,
  COUNT(*) as total_missions,
  SUM(escalations_to_ava) as escalations_total,
  SUM(escalations_accepted) as escalations_accepted_by_ava,
  SUM(escalations_rejected) as escalations_rejected_by_ava,
  ROUND(SUM(escalations_to_ava) * 100.0 / COUNT(*), 1) as escalation_rate_percent,
  ROUND(
    SUM(CASE WHEN escalations_accepted > 0 THEN revision_rounds_total ELSE 0 END) * 1.0 /
    NULLIF(SUM(CASE WHEN escalations_accepted > 0 THEN 1 ELSE 0 END), 0),
    1
  ) as avg_revisions_after_accepted_escalation
FROM mission_post_mortem
WHERE status = 'completed'
GROUP BY agent_id;

-- View: Caching effectiveness (is caching strategy working?)
CREATE VIEW caching_effectiveness AS
SELECT
  agent_id,
  COUNT(*) as missions,
  SUM(god_s_eye_calls_total) as total_god_s_eye_calls,
  SUM(god_s_eye_calls_cached) as cached_calls,
  SUM(god_s_eye_calls_api) as api_calls,
  ROUND(SUM(god_s_eye_calls_cached) * 100.0 / NULLIF(SUM(god_s_eye_calls_total), 0), 1) as cache_hit_rate_percent,
  ROUND(SUM(god_s_eye_cost), 2) as total_god_s_eye_cost,
  ROUND(AVG(god_s_eye_cost), 2) as avg_god_s_eye_cost_per_mission,
  SUM(anti_slop_checks_cached) as anti_slop_from_cache,
  ROUND(SUM(anti_slop_checks_cached) * 100.0 / NULLIF(SUM(anti_slop_checks_total), 0), 1) as anti_slop_cache_hit_rate_percent
FROM mission_post_mortem
WHERE status = 'completed'
GROUP BY agent_id;

-- Table: Friction points log (extracted from mission post-mortems)
CREATE TABLE IF NOT EXISTS friction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  stage TEXT, -- e.g., "scriptwriter_generation", "skinwalker_render"
  issue TEXT,
  resolution_action TEXT,
  resolution_time_seconds INTEGER,
  created_at INTEGER DEFAULT (CAST(strftime('%s') AS INTEGER)),
  FOREIGN KEY(mission_id) REFERENCES mission_post_mortem(mission_id)
);

CREATE INDEX idx_friction_log_stage ON friction_log(stage);
CREATE INDEX idx_friction_log_mission ON friction_log(mission_id);
