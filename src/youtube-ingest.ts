/**
 * youtube-ingest.ts
 * Fetches YouTube channel + video data via the Data API v3 and persists to the local DB.
 *
 * Ported from scripts/youtube-fetch.js into a proper TypeScript module with:
 * - Typed returns
 * - DB persistence via upsertYouTubeVideo
 * - Channel resolution (@handle, URL, raw ID)
 * - Staleness checks (skip re-fetch if data < 7 days old)
 */

import https from 'https';
import Database from 'better-sqlite3';
import path from 'path';
import { YOUTUBE_API_KEY, STORE_DIR } from './config.js';

// ── Types ────────────────────────────────────────────────────────

export interface IngestedChannel {
  channel_id: string;
  title: string;
  description: string;
  custom_url: string | null;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  fetched_at: string;
}

export interface IngestedVideo {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  duration: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string;
  thumbnail_url: string | null;
}

export interface IngestResult {
  channel: IngestedChannel;
  videos: IngestedVideo[];
  fromCache: boolean;
  videosStored: number;
}

// ── YouTube API helpers ──────────────────────────────────────────

function getApiKey(): string {
  if (!YOUTUBE_API_KEY) {
    throw new Error('YOUTUBE_API_KEY not set in .env — required for YouTube Data API v3');
  }
  return YOUTUBE_API_KEY;
}

function httpsGet<T = any>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse YouTube API response: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function ytUrl(endpoint: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `https://www.googleapis.com/youtube/v3/${endpoint}?${query}`;
}

// ── Channel ID resolution ────────────────────────────────────────

/**
 * Resolve a channel input to a YouTube channel ID.
 * Accepts:
 * - Raw channel ID: UCxxxxxx
 * - Handle: @MrBeast
 * - URL: youtube.com/@MrBeast, youtube.com/channel/UCxxxxxx
 */
export async function resolveChannelId(input: string): Promise<string> {
  const trimmed = input.trim();

  // Already a channel ID
  if (trimmed.startsWith('UC') && trimmed.length >= 20) {
    return trimmed;
  }

  // Extract from URL
  const channelMatch = trimmed.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (channelMatch) return channelMatch[1];

  // Handle: @username or extract from URL
  let handle = trimmed;
  const handleMatch = trimmed.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
  if (handleMatch) handle = '@' + handleMatch[1];
  if (!handle.startsWith('@')) handle = '@' + handle;

  // Resolve handle to channel ID via search
  const apiKey = getApiKey();
  const data = await httpsGet<any>(ytUrl('search', {
    part: 'snippet',
    q: handle,
    type: 'channel',
    maxResults: '1',
    key: apiKey,
  }));

  if (!data.items || data.items.length === 0) {
    throw new Error(`Could not resolve YouTube channel: ${input}`);
  }

  return data.items[0].snippet.channelId;
}

// ── Fetch functions ──────────────────────────────────────────────

async function fetchChannelMeta(channelId: string): Promise<IngestedChannel> {
  const apiKey = getApiKey();
  const data = await httpsGet<any>(ytUrl('channels', {
    part: 'snippet,statistics',
    id: channelId,
    key: apiKey,
  }));

  if (!data.items || data.items.length === 0) {
    throw new Error(`YouTube channel not found: ${channelId}`);
  }

  const ch = data.items[0];
  return {
    channel_id: ch.id,
    title: ch.snippet.title,
    description: ch.snippet.description || '',
    custom_url: ch.snippet.customUrl || null,
    subscriber_count: parseInt(ch.statistics.subscriberCount || '0'),
    video_count: parseInt(ch.statistics.videoCount || '0'),
    view_count: parseInt(ch.statistics.viewCount || '0'),
    fetched_at: new Date().toISOString(),
  };
}

async function fetchChannelVideos(channelId: string, maxResults: number = 50): Promise<IngestedVideo[]> {
  const apiKey = getApiKey();

  // Get uploads playlist ID
  const chData = await httpsGet<any>(ytUrl('channels', {
    part: 'contentDetails',
    id: channelId,
    key: apiKey,
  }));
  if (!chData.items || chData.items.length === 0) {
    throw new Error(`Channel not found: ${channelId}`);
  }
  const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

  // Paginate through playlist items
  const videos: IngestedVideo[] = [];
  let pageToken: string | null = null;
  let fetched = 0;

  while (fetched < maxResults) {
    const params: Record<string, string> = {
      part: 'snippet',
      playlistId: uploadsId,
      maxResults: String(Math.min(50, maxResults - fetched)),
      key: apiKey,
    };
    if (pageToken) params.pageToken = pageToken;

    const plData = await httpsGet<any>(ytUrl('playlistItems', params));
    if (!plData.items || plData.items.length === 0) break;

    // Fetch detailed stats
    const videoIds = plData.items.map((i: any) => i.snippet.resourceId.videoId).join(',');
    const statsData = await httpsGet<any>(ytUrl('videos', {
      part: 'snippet,statistics,contentDetails',
      id: videoIds,
      key: apiKey,
    }));

    for (const v of (statsData.items || [])) {
      videos.push({
        video_id: v.id,
        channel_id: channelId,
        title: v.snippet.title,
        description: v.snippet.description || '',
        duration: v.contentDetails.duration,
        view_count: parseInt(v.statistics.viewCount || '0'),
        like_count: parseInt(v.statistics.likeCount || '0'),
        comment_count: parseInt(v.statistics.commentCount || '0'),
        published_at: v.snippet.publishedAt,
        thumbnail_url: v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || null,
      });
    }

    fetched += plData.items.length;
    pageToken = plData.nextPageToken || null;
    if (!pageToken) break;
  }

  return videos;
}

// ── DB persistence ───────────────────────────────────────────────

function getDb(): Database.Database {
  return new Database(path.join(STORE_DIR, 'claudeclaw.db'));
}

function upsertChannel(db: Database.Database, ch: IngestedChannel): void {
  // Ensure youtube_channels table exists (may not be in the main schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_channels (
      channel_id        TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      custom_url        TEXT,
      subscriber_count  INTEGER NOT NULL DEFAULT 0,
      video_count       INTEGER NOT NULL DEFAULT 0,
      view_count        INTEGER NOT NULL DEFAULT 0,
      fetched_at        TEXT NOT NULL,
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  const existing = db.prepare('SELECT channel_id FROM youtube_channels WHERE channel_id = ?').get(ch.channel_id);
  if (existing) {
    db.prepare(`
      UPDATE youtube_channels
      SET title = ?, description = ?, custom_url = ?, subscriber_count = ?,
          video_count = ?, view_count = ?, fetched_at = ?, updated_at = strftime('%s','now')
      WHERE channel_id = ?
    `).run(ch.title, ch.description, ch.custom_url, ch.subscriber_count,
           ch.video_count, ch.view_count, ch.fetched_at, ch.channel_id);
  } else {
    db.prepare(`
      INSERT INTO youtube_channels (channel_id, title, description, custom_url,
        subscriber_count, video_count, view_count, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ch.channel_id, ch.title, ch.description, ch.custom_url,
           ch.subscriber_count, ch.video_count, ch.view_count, ch.fetched_at);
  }
}

function upsertVideo(db: Database.Database, v: IngestedVideo): void {
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = Math.floor(new Date(v.published_at).getTime() / 1000);
  const existing = db.prepare('SELECT id FROM youtube_videos WHERE video_id = ?').get(v.video_id);

  if (existing) {
    db.prepare(`
      UPDATE youtube_videos
      SET title = ?, description = ?, view_count = ?, like_count = ?, comment_count = ?,
          duration_seconds = ?, last_synced_at = ?, updated_at = ?
      WHERE video_id = ?
    `).run(v.title, v.description, v.view_count, v.like_count, v.comment_count,
           v.duration, now, now, v.video_id);
  } else {
    db.prepare(`
      INSERT INTO youtube_videos
      (video_id, channel_id, title, description, published_at, duration_seconds,
       view_count, like_count, comment_count, last_synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(v.video_id, v.channel_id, v.title, v.description, publishedAt,
           v.duration, v.view_count, v.like_count, v.comment_count, now, now, now);
  }
}

/**
 * Check if channel data is fresh enough (< staleAfterDays old).
 */
function isChannelFresh(db: Database.Database, channelId: string, staleAfterDays: number = 7): boolean {
  const row = db.prepare(
    'SELECT fetched_at FROM youtube_channels WHERE channel_id = ?'
  ).get(channelId) as { fetched_at: string } | undefined;

  if (!row) return false;

  const fetchedAt = new Date(row.fetched_at).getTime();
  const ageMs = Date.now() - fetchedAt;
  return ageMs < staleAfterDays * 86_400_000;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Ingest a YouTube channel: fetch metadata + videos, persist to DB.
 * Skips fetch if data is < 7 days old (use force=true to override).
 */
export async function ingestChannel(
  channelIdOrInput: string,
  opts: { maxVideos?: number; force?: boolean; niche?: string } = {}
): Promise<IngestResult> {
  const { maxVideos = 50, force = false, niche } = opts;
  const channelId = await resolveChannelId(channelIdOrInput);
  const db = getDb();

  try {
    // Check staleness
    if (!force && isChannelFresh(db, channelId)) {
      const cached = db.prepare('SELECT * FROM youtube_channels WHERE channel_id = ?').get(channelId) as any;
      const videoCount = (db.prepare('SELECT COUNT(*) as cnt FROM youtube_videos WHERE channel_id = ?').get(channelId) as any).cnt;
      db.close();
      return {
        channel: cached,
        videos: [],
        fromCache: true,
        videosStored: videoCount,
      };
    }

    // Fetch from API
    console.log(`[INGEST] Fetching channel ${channelId}...`);
    const channel = await fetchChannelMeta(channelId);
    upsertChannel(db, channel);

    console.log(`[INGEST] Fetching up to ${maxVideos} videos...`);
    const videos = await fetchChannelVideos(channelId, maxVideos);

    let stored = 0;
    for (const v of videos) {
      upsertVideo(db, v);
      stored++;
    }
    console.log(`[INGEST] Stored ${stored} videos for ${channel.title}`);

    // Optionally track as competitor
    if (niche) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tracked_competitors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_id TEXT NOT NULL UNIQUE,
          channel_name TEXT NOT NULL,
          platform TEXT NOT NULL DEFAULT 'youtube',
          niche TEXT NOT NULL DEFAULT '',
          tracked_since INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          notes TEXT NOT NULL DEFAULT ''
        );
      `);
      db.prepare(`
        INSERT OR IGNORE INTO tracked_competitors (channel_id, channel_name, niche)
        VALUES (?, ?, ?)
      `).run(channelId, channel.title, niche);
    }

    db.close();
    return { channel, videos, fromCache: false, videosStored: stored };
  } catch (error) {
    db.close();
    throw error;
  }
}

export default { ingestChannel, resolveChannelId };
