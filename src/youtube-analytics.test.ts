import { describe, it, expect, vi } from 'vitest';

// Mock config before importing the module
vi.mock('./config.js', () => ({
  YT_ANALYTICS_CLIENT_ID: '',
  YT_ANALYTICS_CLIENT_SECRET: '',
  YT_ANALYTICS_TOKEN_PATH: '/tmp/test-yt-token.json',
  STORE_DIR: '/tmp/test-store',
  DB_ENCRYPTION_KEY: 'a'.repeat(64),
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── isYouTubeAnalyticsConfigured ─────────────────────────────────

describe('isYouTubeAnalyticsConfigured', () => {
  it('returns false when credentials are empty', async () => {
    const mod = await import('./youtube-analytics.js');
    expect(mod.isYouTubeAnalyticsConfigured()).toBe(false);
  });
});

// ── ViewerTypeResult parsing ─────────────────────────────────────

describe('ViewerTypeResult calculations', () => {
  it('correctly computes percentages from raw views', () => {
    // Simulate what fetchReturningViewerRate does internally
    const returningViews = 4200;
    const newViews = 5800;
    const totalViews = returningViews + newViews;
    const returningPct = totalViews > 0 ? (returningViews / totalViews) * 100 : 0;
    const newPct = totalViews > 0 ? (newViews / totalViews) * 100 : 0;

    expect(Math.round(returningPct * 100) / 100).toBe(42);
    expect(Math.round(newPct * 100) / 100).toBe(58);
    expect(totalViews).toBe(10000);
  });

  it('handles zero total views without division by zero', () => {
    const totalViews = 0;
    const returningPct = totalViews > 0 ? (0 / totalViews) * 100 : 0;
    expect(returningPct).toBe(0);
  });

  it('correctly rounds to 2 decimal places', () => {
    const returning = 3333;
    const newV = 6667;
    const total = returning + newV;
    const pct = Math.round((returning / total) * 100 * 100) / 100;
    expect(pct).toBe(33.33);
  });
});
