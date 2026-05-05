#!/usr/bin/env node
/**
 * youtube-fetch.js — God's Eye data collector
 * Fetches channel stats, video details, and comments from YouTube Data API v3
 *
 * Usage:
 *   node youtube-fetch.js --channel <channelId>
 *   node youtube-fetch.js --video <videoId>
 *   node youtube-fetch.js --comments <videoId> [--max 100]
 *   node youtube-fetch.js --search <channelId> --query "keyword" [--max 20]
 *   node youtube-fetch.js --top <channelId> [--max 10]
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(JSON.stringify({ error: '.env file not found at ' + envPath }));
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse response: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function ytUrl(endpoint, params) {
  const base = 'https://www.googleapis.com/youtube/v3/';
  const query = new URLSearchParams(params).toString();
  return `${base}${endpoint}?${query}`;
}

async function fetchChannel(channelId, apiKey) {
  const url = ytUrl('channels', {
    part: 'snippet,statistics,brandingSettings',
    id: channelId,
    key: apiKey
  });
  const data = await httpsGet(url);
  if (!data.items || data.items.length === 0) {
    return { error: 'Channel not found: ' + channelId };
  }
  const ch = data.items[0];
  return {
    channel_id: ch.id,
    title: ch.snippet.title,
    description: ch.snippet.description,
    custom_url: ch.snippet.customUrl || null,
    published_at: ch.snippet.publishedAt,
    country: ch.snippet.country || null,
    subscriber_count: parseInt(ch.statistics.subscriberCount || 0),
    video_count: parseInt(ch.statistics.videoCount || 0),
    view_count: parseInt(ch.statistics.viewCount || 0),
    fetched_at: new Date().toISOString()
  };
}

async function fetchVideos(channelId, apiKey, maxResults = 50) {
  // First get the uploads playlist ID
  const chUrl = ytUrl('channels', {
    part: 'contentDetails',
    id: channelId,
    key: apiKey
  });
  const chData = await httpsGet(chUrl);
  if (!chData.items || chData.items.length === 0) {
    return { error: 'Channel not found: ' + channelId };
  }
  const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

  // Fetch playlist items
  const videos = [];
  let pageToken = null;
  let fetched = 0;

  while (fetched < maxResults) {
    const params = {
      part: 'snippet',
      playlistId: uploadsId,
      maxResults: Math.min(50, maxResults - fetched),
      key: apiKey
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await httpsGet(ytUrl('playlistItems', params));
    if (!data.items) break;

    const videoIds = data.items.map(i => i.snippet.resourceId.videoId).join(',');

    // Fetch detailed stats for these videos
    const statsData = await httpsGet(ytUrl('videos', {
      part: 'snippet,statistics,contentDetails',
      id: videoIds,
      key: apiKey
    }));

    for (const v of (statsData.items || [])) {
      videos.push({
        video_id: v.id,
        channel_id: channelId,
        title: v.snippet.title,
        description: v.snippet.description,
        tags: (v.snippet.tags || []).join(','),
        duration: v.contentDetails.duration,
        view_count: parseInt(v.statistics.viewCount || 0),
        like_count: parseInt(v.statistics.likeCount || 0),
        comment_count: parseInt(v.statistics.commentCount || 0),
        published_at: v.snippet.publishedAt,
        thumbnail_url: v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || null,
        fetched_at: new Date().toISOString()
      });
    }

    fetched += data.items.length;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return videos;
}

async function fetchVideoDetail(videoId, apiKey) {
  const data = await httpsGet(ytUrl('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoId,
    key: apiKey
  }));
  if (!data.items || data.items.length === 0) {
    return { error: 'Video not found: ' + videoId };
  }
  const v = data.items[0];
  return {
    video_id: v.id,
    channel_id: v.snippet.channelId,
    title: v.snippet.title,
    description: v.snippet.description,
    tags: (v.snippet.tags || []).join(','),
    duration: v.contentDetails.duration,
    view_count: parseInt(v.statistics.viewCount || 0),
    like_count: parseInt(v.statistics.likeCount || 0),
    comment_count: parseInt(v.statistics.commentCount || 0),
    published_at: v.snippet.publishedAt,
    thumbnail_url: v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || null,
    fetched_at: new Date().toISOString()
  };
}

async function fetchComments(videoId, apiKey, maxResults = 100) {
  const comments = [];
  let pageToken = null;
  let fetched = 0;

  while (fetched < maxResults) {
    const params = {
      part: 'snippet',
      videoId,
      maxResults: Math.min(100, maxResults - fetched),
      order: 'relevance',
      key: apiKey
    };
    if (pageToken) params.pageToken = pageToken;

    try {
      const data = await httpsGet(ytUrl('commentThreads', params));
      if (!data.items) break;

      for (const item of data.items) {
        const c = item.snippet.topLevelComment.snippet;
        comments.push({
          comment_id: item.id,
          video_id: videoId,
          author: c.authorDisplayName,
          text: c.textDisplay,
          like_count: parseInt(c.likeCount || 0),
          reply_count: parseInt(item.snippet.totalReplyCount || 0),
          published_at: c.publishedAt,
          fetched_at: new Date().toISOString()
        });
      }

      fetched += data.items.length;
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    } catch (e) {
      // Comments may be disabled
      break;
    }
  }

  return comments;
}

async function fetchTopVideos(channelId, apiKey, maxResults = 10) {
  const videos = await fetchVideos(channelId, apiKey, 50);
  if (videos.error) return videos;
  return videos
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, maxResults);
}

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const env = loadEnv();
const apiKey = env.YOUTUBE_API_KEY;

if (!apiKey) {
  console.error(JSON.stringify({ error: 'YOUTUBE_API_KEY not set in .env' }));
  process.exit(1);
}

(async () => {
  try {
    if (args.includes('--channel')) {
      const channelId = getArg('--channel');
      if (!channelId) throw new Error('--channel requires a channel ID');
      const result = await fetchChannel(channelId, apiKey);
      console.log(JSON.stringify(result, null, 2));

    } else if (args.includes('--videos')) {
      const channelId = getArg('--videos');
      const max = parseInt(getArg('--max') || '50');
      if (!channelId) throw new Error('--videos requires a channel ID');
      const result = await fetchVideos(channelId, apiKey, max);
      console.log(JSON.stringify(result, null, 2));

    } else if (args.includes('--video')) {
      const videoId = getArg('--video');
      if (!videoId) throw new Error('--video requires a video ID');
      const result = await fetchVideoDetail(videoId, apiKey);
      console.log(JSON.stringify(result, null, 2));

    } else if (args.includes('--comments')) {
      const videoId = getArg('--comments');
      const max = parseInt(getArg('--max') || '100');
      if (!videoId) throw new Error('--comments requires a video ID');
      const result = await fetchComments(videoId, apiKey, max);
      console.log(JSON.stringify(result, null, 2));

    } else if (args.includes('--top')) {
      const channelId = getArg('--top');
      const max = parseInt(getArg('--max') || '10');
      if (!channelId) throw new Error('--top requires a channel ID');
      const result = await fetchTopVideos(channelId, apiKey, max);
      console.log(JSON.stringify(result, null, 2));

    } else {
      console.log(JSON.stringify({
        usage: [
          'node youtube-fetch.js --channel <channelId>',
          'node youtube-fetch.js --videos <channelId> [--max 50]',
          'node youtube-fetch.js --video <videoId>',
          'node youtube-fetch.js --comments <videoId> [--max 100]',
          'node youtube-fetch.js --top <channelId> [--max 10]'
        ]
      }, null, 2));
    }
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
})();
