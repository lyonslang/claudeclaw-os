/**
 * youtube-analytics.ts
 * YouTube Analytics API client for audience loyalty metrics.
 *
 * Uses OAuth2 (separate from the Data API v3 API-key auth) to access
 * the YouTube Analytics API, which provides the viewerType dimension
 * (new vs returning viewers).
 *
 * Setup:
 *   1. Create OAuth2 credentials in Google Cloud Console
 *   2. Enable "YouTube Analytics API" in your project
 *   3. Set YT_ANALYTICS_CLIENT_ID + YT_ANALYTICS_CLIENT_SECRET in .env
 *   4. Run: npx tsx scripts/yt-analytics-auth.ts
 */

import fs from 'fs';
import https from 'https';
import path from 'path';

import {
  YT_ANALYTICS_CLIENT_ID,
  YT_ANALYTICS_CLIENT_SECRET,
  YT_ANALYTICS_TOKEN_PATH,
} from './config.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────

export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number; // epoch ms
  scope: string;
}

export interface ViewerTypeResult {
  returning_pct: number; // 0-100
  new_pct: number;       // 0-100
  returning_views: number;
  new_views: number;
  total_views: number;
  start_date: string;
  end_date: string;
}

// ── Configuration check ──────────────────────────────────────────

let _configWarned = false;

/**
 * Returns true if YouTube Analytics OAuth2 is fully configured:
 * client ID, client secret, and a token file on disk.
 */
export function isYouTubeAnalyticsConfigured(): boolean {
  if (!YT_ANALYTICS_CLIENT_ID || !YT_ANALYTICS_CLIENT_SECRET) {
    if (!_configWarned) {
      logger.info('YouTube Analytics: OAuth2 credentials not set — skipping audience metrics');
      _configWarned = true;
    }
    return false;
  }
  if (!fs.existsSync(YT_ANALYTICS_TOKEN_PATH)) {
    if (!_configWarned) {
      logger.info(
        `YouTube Analytics: token file not found at ${YT_ANALYTICS_TOKEN_PATH} — run: npx tsx scripts/yt-analytics-auth.ts`,
      );
      _configWarned = true;
    }
    return false;
  }
  return true;
}

// ── Token Management ─────────────────────────────────────────────

let _cachedToken: OAuthToken | null = null;

/** Load the OAuth token from disk. */
export function loadToken(): OAuthToken {
  if (_cachedToken && _cachedToken.expiry_date > Date.now() + 60_000) {
    return _cachedToken;
  }
  const raw = fs.readFileSync(YT_ANALYTICS_TOKEN_PATH, 'utf8');
  _cachedToken = JSON.parse(raw) as OAuthToken;
  return _cachedToken;
}

/** Persist token to disk after a refresh. */
function saveToken(token: OAuthToken): void {
  const dir = path.dirname(YT_ANALYTICS_TOKEN_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(YT_ANALYTICS_TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
  // Restrict permissions (owner-only read/write)
  try { fs.chmodSync(YT_ANALYTICS_TOKEN_PATH, 0o600); } catch { /* non-fatal */ }
  _cachedToken = token;
}

/** HTTPS POST helper for token exchange/refresh. */
function httpsPost(url: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Token endpoint returned invalid JSON: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Refresh the access token using the stored refresh token.
 * Writes updated token back to disk. Returns the fresh access_token.
 */
export async function refreshAccessToken(): Promise<string> {
  const token = loadToken();
  if (!token.refresh_token) {
    throw new Error('YouTube Analytics: no refresh_token in stored token — re-run auth flow');
  }

  const body = new URLSearchParams({
    client_id: YT_ANALYTICS_CLIENT_ID,
    client_secret: YT_ANALYTICS_CLIENT_SECRET,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  }).toString();

  const resp = await httpsPost('https://oauth2.googleapis.com/token', body);

  if (resp.error) {
    throw new Error(`YouTube Analytics token refresh failed: ${resp.error} — ${resp.error_description || ''}`);
  }

  const updated: OAuthToken = {
    ...token,
    access_token: resp.access_token,
    expiry_date: Date.now() + (resp.expires_in ?? 3600) * 1000,
    ...(resp.refresh_token ? { refresh_token: resp.refresh_token } : {}),
  };

  saveToken(updated);
  logger.info('YouTube Analytics: access token refreshed');
  return updated.access_token;
}

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getAccessToken(): Promise<string> {
  const token = loadToken();
  // Refresh if token expires within 5 minutes
  if (token.expiry_date < Date.now() + 5 * 60_000) {
    return refreshAccessToken();
  }
  return token.access_token;
}

// ── HTTPS GET with auth ──────────────────────────────────────────

function httpsGetAuth<T = any>(url: string, accessToken: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https
      .get(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`YouTube Analytics API returned invalid JSON: ${data.slice(0, 300)}`));
            }
          });
        },
      )
      .on('error', reject);
  });
}

// ── Analytics API calls ──────────────────────────────────────────

interface YTAnalyticsReportResponse {
  kind?: string;
  columnHeaders?: Array<{ name: string; columnType: string; dataType: string }>;
  rows?: Array<Array<string | number>>;
  error?: { code: number; message: string; errors: any[] };
}

/**
 * Format a Date as YYYY-MM-DD for the Analytics API.
 */
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Fetch return viewer rate for a channel over a date range.
 *
 * Uses the YouTube Analytics API viewerType dimension which splits
 * views into "RETURNING" and "NEW" viewer types.
 *
 * Default range: last 28 days (YouTube's standard reporting window).
 */
export async function fetchReturningViewerRate(
  channelId: string,
  startDate?: string,
  endDate?: string,
): Promise<ViewerTypeResult> {
  const accessToken = await getAccessToken();

  const end = endDate || formatDate(new Date());
  const start = startDate || formatDate(new Date(Date.now() - 28 * 86_400_000));

  const params = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate: start,
    endDate: end,
    metrics: 'views',
    dimensions: 'viewerType',
  });

  const url = `https://youtubeanalytics.googleapis.com/v2/reports?${params}`;
  const resp = await httpsGetAuth<YTAnalyticsReportResponse>(url, accessToken);

  if (resp.error) {
    throw new Error(
      `YouTube Analytics API error ${resp.error.code}: ${resp.error.message}`,
    );
  }

  // Parse response: rows are [[viewerType, views], ...]
  let returningViews = 0;
  let newViews = 0;

  for (const row of resp.rows || []) {
    const viewerType = String(row[0]).toUpperCase();
    const views = Number(row[1]) || 0;

    if (viewerType === 'RETURNING') {
      returningViews = views;
    } else if (viewerType === 'NEW') {
      newViews = views;
    }
  }

  const totalViews = returningViews + newViews;
  const returningPct = totalViews > 0 ? (returningViews / totalViews) * 100 : 0;
  const newPct = totalViews > 0 ? (newViews / totalViews) * 100 : 0;

  return {
    returning_pct: Math.round(returningPct * 100) / 100,
    new_pct: Math.round(newPct * 100) / 100,
    returning_views: returningViews,
    new_views: newViews,
    total_views: totalViews,
    start_date: start,
    end_date: end,
  };
}

/**
 * Fetch return viewer rate for a specific video.
 *
 * Note: per-video viewerType data may have limited availability
 * depending on video age and view count.
 */
export async function fetchReturningViewerRateByVideo(
  videoId: string,
  startDate?: string,
  endDate?: string,
): Promise<ViewerTypeResult> {
  const accessToken = await getAccessToken();

  const end = endDate || formatDate(new Date());
  const start = startDate || formatDate(new Date(Date.now() - 28 * 86_400_000));

  const params = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: start,
    endDate: end,
    metrics: 'views',
    dimensions: 'viewerType',
    filters: `video==${videoId}`,
  });

  const url = `https://youtubeanalytics.googleapis.com/v2/reports?${params}`;
  const resp = await httpsGetAuth<YTAnalyticsReportResponse>(url, accessToken);

  if (resp.error) {
    throw new Error(
      `YouTube Analytics API error ${resp.error.code}: ${resp.error.message}`,
    );
  }

  let returningViews = 0;
  let newViews = 0;

  for (const row of resp.rows || []) {
    const viewerType = String(row[0]).toUpperCase();
    const views = Number(row[1]) || 0;

    if (viewerType === 'RETURNING') {
      returningViews = views;
    } else if (viewerType === 'NEW') {
      newViews = views;
    }
  }

  const totalViews = returningViews + newViews;
  const returningPct = totalViews > 0 ? (returningViews / totalViews) * 100 : 0;
  const newPct = totalViews > 0 ? (newViews / totalViews) * 100 : 0;

  return {
    returning_pct: Math.round(returningPct * 100) / 100,
    new_pct: Math.round(newPct * 100) / 100,
    returning_views: returningViews,
    new_views: newViews,
    total_views: totalViews,
    start_date: start,
    end_date: end,
  };
}

export default {
  isYouTubeAnalyticsConfigured,
  fetchReturningViewerRate,
  fetchReturningViewerRateByVideo,
  getAccessToken,
  refreshAccessToken,
};
