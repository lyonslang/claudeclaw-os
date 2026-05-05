-- Migration 007: YouTube CPM & Revenue Tracking
-- Date: May 5, 2026
-- Purpose: Add revenue metrics to youtube_analytics for script→views→revenue correlation

-- Add CPM and revenue columns to youtube_analytics
ALTER TABLE youtube_analytics ADD COLUMN cpm_usd REAL DEFAULT 0.0;
ALTER TABLE youtube_analytics ADD COLUMN revenue_usd REAL DEFAULT 0.0;
ALTER TABLE youtube_analytics ADD COLUMN impressions INTEGER DEFAULT 0;

-- Create view: Script Performance → Revenue
-- Correlates script generation cost to actual revenue earned
CREATE VIEW IF NOT EXISTS script_to_revenue AS
SELECT
  m.mission_id,
  m.project_id,
  m.niche,
  m.total_cost_usd as script_cost,
  v.title as video_title,
  v.video_id,
  v.view_count,
  ya.impressions,
  ya.cpm_usd,
  ya.revenue_usd,
  CASE
    WHEN m.total_cost_usd > 0 THEN ROUND(ya.revenue_usd / m.total_cost_usd, 2)
    ELSE NULL
  END as roi_multiplier,
  ya.analytics_date,
  ROUND(AVG(ya.cpm_usd) OVER (PARTITION BY v.video_id ORDER BY ya.analytics_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) as cpm_7day_avg
FROM mission_post_mortem m
LEFT JOIN video_outcomes vo ON m.project_id = vo.project_id AND m.niche = vo.niche
LEFT JOIN youtube_videos v ON vo.video_id = v.video_id
LEFT JOIN youtube_analytics ya ON v.video_id = ya.video_id
WHERE ya.revenue_usd > 0 OR ya.cpm_usd > 0
ORDER BY m.created_at DESC, ya.analytics_date DESC;

-- Create view: Revenue Performance by Project & Niche
CREATE VIEW IF NOT EXISTS project_revenue_summary AS
SELECT
  p.project_id,
  p.name,
  p.niche,
  COUNT(DISTINCT v.video_id) as total_videos,
  SUM(v.view_count) as total_views,
  SUM(ya.impressions) as total_impressions,
  ROUND(AVG(ya.cpm_usd), 2) as avg_cpm_usd,
  ROUND(SUM(ya.revenue_usd), 2) as total_revenue_usd,
  ROUND(SUM(m.total_cost_usd), 2) as total_script_cost_usd,
  CASE
    WHEN SUM(m.total_cost_usd) > 0 THEN ROUND(SUM(ya.revenue_usd) / SUM(m.total_cost_usd), 2)
    ELSE NULL
  END as overall_roi,
  MAX(ya.analytics_date) as last_updated
FROM projects p
LEFT JOIN mission_post_mortem m ON m.project_id = p.project_id
LEFT JOIN video_outcomes vo ON m.project_id = vo.project_id AND m.niche = vo.niche
LEFT JOIN youtube_videos v ON vo.video_id = v.video_id
LEFT JOIN youtube_analytics ya ON v.video_id = ya.video_id
GROUP BY p.project_id
ORDER BY total_revenue_usd DESC NULLS LAST;

-- Index for fast CPM lookups
CREATE INDEX IF NOT EXISTS idx_youtube_analytics_cpm ON youtube_analytics(cpm_usd DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_analytics_revenue ON youtube_analytics(revenue_usd DESC);
