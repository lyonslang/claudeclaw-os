-- Migration 004: YouTube tables for God's Eye
-- Run: sqlite3 store/claudeclaw.db < migrations/004_youtube_tables.sql

CREATE TABLE IF NOT EXISTS youtube_channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  custom_url TEXT,
  country TEXT,
  subscriber_count INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  published_at TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  duration TEXT,
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  published_at TEXT,
  thumbnail_url TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES youtube_channels(channel_id)
);

CREATE TABLE IF NOT EXISTS youtube_comments (
  comment_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  author TEXT,
  text TEXT NOT NULL,
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id)
);

CREATE TABLE IF NOT EXISTS youtube_visual_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  pacing_notes TEXT,
  cut_frequency TEXT,
  avatar_quality TEXT,
  visual_complexity TEXT,
  editing_style TEXT,
  thumbnail_notes TEXT,
  hook_visual_score INTEGER,
  overall_score INTEGER,
  analyzed_at TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id)
);

CREATE TABLE IF NOT EXISTS youtube_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT,
  insight_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  patterns TEXT,
  recommendations TEXT,
  top_hooks TEXT,
  emotional_themes TEXT,
  created_at TEXT NOT NULL
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_yt_videos_channel ON youtube_videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_yt_videos_views ON youtube_videos(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_yt_comments_video ON youtube_comments(video_id);
CREATE INDEX IF NOT EXISTS idx_yt_visual_video ON youtube_visual_analysis(video_id);
CREATE INDEX IF NOT EXISTS idx_yt_insights_channel ON youtube_insights(channel_id);
CREATE INDEX IF NOT EXISTS idx_yt_insights_type ON youtube_insights(insight_type);
