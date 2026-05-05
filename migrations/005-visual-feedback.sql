-- Migration: Visual Feedback & Visual Director Integration
-- Date: May 5, 2026
-- Purpose: Track visual quality metrics for Phase 2 Visual Director implementation
--
-- TIMING: Applied during Phase 1B, but data collection starts in Phase 1B test
-- ACTIVATION: Visual Director agent implemented in Phase 2, using this data as baseline

-- ── Visual Feedback Table ──────────────────────────────────────────────
-- Tracks Visual Director recommendations and their outcomes
-- Links to mission_post_mortem to correlate visual quality with performance

CREATE TABLE IF NOT EXISTS visual_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  agent_id TEXT DEFAULT 'visual_director',

  -- Link to mission and video
  video_id TEXT,
  script_section TEXT, -- e.g., "intro_hook", "main_body", "outro"

  -- Visual Director recommendations (stored when agent runs)
  -- These are populated in Phase 2, but structure is defined now
  emotional_beat TEXT,           -- e.g., "intrigue", "recognition", "climax"
  beat_duration_seconds INTEGER,
  mood_description TEXT,         -- e.g., "dark, asymmetrical, slow zoom"

  b_roll_concept TEXT,           -- Selected B-roll concept
  b_roll_source TEXT,            -- "higgsfield_generate", "stock_footage", "personal_archive"
  b_roll_cost_estimate REAL,     -- Estimated cost ($0 for archive, $0.02-0.10 for generation)

  transition_type TEXT,          -- "cut", "crossfade", "zoom", "match_cut", etc.
  transition_duration_ms INTEGER,
  transition_reasoning TEXT,

  higgsfield_prompt TEXT,        -- Copy-paste ready prompt for generation

  -- Quality assessment (post-production feedback)
  visual_cohesion_score REAL,    -- 0-100: How well does this section blend with rest of video?
  mood_match_score REAL,         -- 0-100: Does the visual match the intended mood?
  slop_risk_level TEXT CHECK(slop_risk_level IN ('low', 'medium', 'high')),
  slop_risk_reasons TEXT,        -- JSON: reasons why slop was flagged (if any)

  -- Actual performance (after video is posted)
  actual_higgsfield_cost REAL,   -- Real cost (may differ from estimate)
  actual_render_time_seconds INTEGER,
  engagement_contribution REAL,  -- 0-1: How much did this section contribute to engagement?
  confidence_level REAL,         -- 0-100: How confident are we in this assessment?
  confidence_sample_size INTEGER, -- How many similar videos is this based on?

  -- Human feedback
  human_feedback TEXT,           -- Quick notes from review
  approved BOOLEAN DEFAULT FALSE,
  revision_rounds INTEGER DEFAULT 0,

  created_at INTEGER DEFAULT (CAST(strftime('%s') AS INTEGER)),
  updated_at INTEGER DEFAULT (CAST(strftime('%s') AS INTEGER)),

  FOREIGN KEY(mission_id) REFERENCES mission_post_mortem(mission_id),
  FOREIGN KEY(video_id) REFERENCES youtube_videos(video_id)
);

-- Indices
CREATE INDEX idx_visual_feedback_mission ON visual_feedback(mission_id);
CREATE INDEX idx_visual_feedback_video ON visual_feedback(video_id);
CREATE INDEX idx_visual_feedback_slop_risk ON visual_feedback(slop_risk_level);
CREATE INDEX idx_visual_feedback_score ON visual_feedback(visual_cohesion_score DESC);

-- ── Visual Reference Library ───────────────────────────────────────────
-- Tracks approved visual styles, compositions, and techniques
-- Used by Visual Director to maintain consistency and avoid repetition

CREATE TABLE IF NOT EXISTS visual_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,                -- "transition_style", "mood", "composition", "color_grade"
  name TEXT NOT NULL,           -- e.g., "match_cut_fast", "dark_mysterious", "rule_of_thirds"
  description TEXT,
  example_video_id TEXT,        -- Reference video that demonstrates this style
  performance_data JSON,        -- { "avg_engagement": 0.005, "usage_count": 3, "user_approval": true }
  higgsfield_prompt_template TEXT, -- Template for generating variations
  created_at INTEGER DEFAULT (CAST(strftime('%s') AS INTEGER)),
  FOREIGN KEY(example_video_id) REFERENCES youtube_videos(video_id)
);

CREATE INDEX idx_visual_references_category ON visual_references(category);

-- ── Visual Style Variants (A/B Testing) ────────────────────────────────
-- Tracks different visual treatments for same script/concept
-- Used in Phase 2+ to compare which visual styles perform best

CREATE TABLE IF NOT EXISTS visual_style_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  video_id TEXT,
  style_name TEXT,              -- e.g., "dark_cinematic", "bright_energetic", "documentary"
  style_description TEXT,
  key_characteristics JSON,     -- { "color_grade": "warm", "pacing": "fast", "composition": "off_center" }
  performance_score REAL,       -- 0-100, calculated from engagement + user feedback
  engagement_rate REAL,
  viewer_retention REAL,
  human_rating REAL,            -- 0-5 stars from user
  created_at INTEGER DEFAULT (CAST(strftime('%s') AS INTEGER)),
  FOREIGN KEY(mission_id) REFERENCES mission_post_mortem(mission_id),
  FOREIGN KEY(video_id) REFERENCES youtube_videos(video_id)
);

CREATE INDEX idx_visual_style_variants_mission ON visual_style_variants(mission_id);
CREATE INDEX idx_visual_style_variants_performance ON visual_style_variants(performance_score DESC);

-- ── View: Visual Quality Baseline (Phase 1B Data) ──────────────────────
-- Summary of visual quality metrics for Phase 1B test videos
-- Used in Phase 2 to calibrate Visual Director recommendations

CREATE VIEW visual_quality_baseline AS
SELECT
  vf.emotional_beat,
  COUNT(*) as samples,
  ROUND(AVG(vf.visual_cohesion_score), 1) as avg_cohesion,
  ROUND(AVG(vf.mood_match_score), 1) as avg_mood_match,
  ROUND(AVG(vf.engagement_contribution), 2) as avg_engagement_contribution,
  ROUND(AVG(vf.actual_higgsfield_cost), 2) as avg_cost,
  ROUND(AVG(vf.actual_render_time_seconds), 0) as avg_render_time,
  SUM(CASE WHEN vf.slop_risk_level = 'low' THEN 1 ELSE 0 END) as low_risk_count,
  SUM(CASE WHEN vf.slop_risk_level = 'medium' THEN 1 ELSE 0 END) as medium_risk_count,
  SUM(CASE WHEN vf.slop_risk_level = 'high' THEN 1 ELSE 0 END) as high_risk_count
FROM visual_feedback vf
WHERE vf.confidence_sample_size >= 2 -- Only include well-sampled beats
GROUP BY vf.emotional_beat
ORDER BY avg_engagement_contribution DESC;

-- ── View: Visual Director Effectiveness ────────────────────────────────
-- How accurate were Visual Director recommendations vs actual outcomes?
-- Used to calibrate confidence scores in Phase 2+

CREATE VIEW visual_director_effectiveness AS
SELECT
  COUNT(*) as total_recommendations,
  ROUND(AVG(CASE WHEN vf.approved = TRUE THEN 1 ELSE 0 END) * 100, 1) as approval_rate_percent,
  ROUND(AVG(ABS(vf.visual_cohesion_score - 75) / 25), 2) as avg_prediction_error, -- 75 is baseline quality
  ROUND(AVG(vf.revision_rounds), 1) as avg_revisions,
  SUM(CASE WHEN vf.actual_higgsfield_cost <= vf.b_roll_cost_estimate * 1.1 THEN 1 ELSE 0 END) as accurate_cost_predictions,
  COUNT(*) as total_cost_predictions
FROM visual_feedback vf;
