import { describe, it, expect, vi } from 'vitest';

// Mock the config + better-sqlite3 so we can test the pure analysis functions
// without needing a real database
vi.mock('./config.js', () => ({ STORE_DIR: '/tmp/test-store' }));
vi.mock('better-sqlite3', () => ({ default: vi.fn() }));

import { generateGodsEyeBrief } from './gods-eye/index.js';

// ── Test fixtures ───────────────────────────────────────────────

function makeVideo(overrides: Partial<{
  video_id: string; title: string; view_count: number; like_count: number;
  comment_count: number; engagement_rate: number; published_at: string;
  duration_seconds: number;
}> = {}) {
  return {
    video_id: overrides.video_id ?? `vid_${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? 'Default Video Title',
    view_count: overrides.view_count ?? 10000,
    like_count: overrides.like_count ?? 500,
    comment_count: overrides.comment_count ?? 50,
    engagement_rate: overrides.engagement_rate ?? 5.0,
    published_at: overrides.published_at ?? '2026-04-01T12:00:00Z',
    duration_seconds: overrides.duration_seconds ?? 600,
  };
}

const MOCK_CHANNEL = {
  title: 'Test Channel',
  subscriber_count: 50000,
  view_count: 1000000,
  video_count: 20,
};

// ── Emotional Arc (data-driven) ─────────────────────────────────

describe('analyzeEmotionalArc (via generateGodsEyeBrief)', () => {

  it('derives opening emotion from highest-performing sentiment cluster', () => {
    const videos = [
      // Curiosity pattern — high engagement
      makeVideo({ title: 'Why did this happen?', engagement_rate: 12.0 }),
      makeVideo({ title: 'How does this actually work?', engagement_rate: 11.0 }),
      // Controversy — medium engagement
      makeVideo({ title: 'Celebrity GOES OFF on Critics', engagement_rate: 6.0 }),
      makeVideo({ title: 'Star CALLS OUT Network', engagement_rate: 5.5 }),
      // Personal — low engagement
      makeVideo({ title: 'I tried this for 30 days', engagement_rate: 3.0 }),
      makeVideo({ title: 'My biggest mistake ever', engagement_rate: 2.5 }),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');

    // Curiosity cluster has highest avg engagement (11.5), so it should be the opening
    expect(brief.emotional_arc.opening.emotion).toBe('curiosity');
    expect(brief.emotional_arc.opening.technique).toBe('mystery');
    // Effectiveness should be > 1.0 since curiosity is above channel avg
    expect(brief.emotional_arc.opening.effectiveness).toBeGreaterThan(1.0);
  });

  it('computes effectiveness from real engagement data, not hardcoded values', () => {
    const videos = [
      makeVideo({ title: 'Why is this trending?', engagement_rate: 10.0 }),
      makeVideo({ title: 'How to fix this problem?', engagement_rate: 10.0 }),
      makeVideo({ title: 'Regular video about stuff', engagement_rate: 5.0 }),
      makeVideo({ title: 'Another normal video here', engagement_rate: 5.0 }),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');

    // Channel avg engagement = (10+10+5+5)/4 = 7.5
    // Curiosity cluster avg = 10.0, so effectiveness = 10.0 / 7.5 = 1.33
    const opening = brief.emotional_arc.opening;
    expect(opening.effectiveness).toBeCloseTo(1.33, 1);
    // No beat should have exactly 0.85, 0.70, 0.88, 0.65 — those were fabricated
    expect(opening.effectiveness).not.toBe(0.85);
  });

  it('detects missing sentiment beats not used in top performers', () => {
    // Only curiosity and personal — missing controversy, reveal, urgency, nostalgia
    const videos = [
      makeVideo({ title: 'Why did this happen?', engagement_rate: 10.0 }),
      makeVideo({ title: 'How does this work?', engagement_rate: 9.0 }),
      makeVideo({ title: 'I tried this myself', engagement_rate: 4.0 }),
      makeVideo({ title: 'My experience with it', engagement_rate: 3.0 }),
      makeVideo({ title: 'Basic video title', engagement_rate: 2.0 }),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');

    // Should flag missing patterns
    expect(brief.emotional_arc.missing_beats.length).toBeGreaterThan(0);
    // Should mention specific techniques not detected
    const missingText = brief.emotional_arc.missing_beats.join(' ');
    expect(missingText).toContain('controversy');
  });

  it('produces different arcs for different channel data', () => {
    const curiosityChannel = [
      makeVideo({ title: 'Why is everyone wrong about this?', engagement_rate: 12.0 }),
      makeVideo({ title: 'How this secret system works?', engagement_rate: 11.0 }),
      makeVideo({ title: 'Normal content here', engagement_rate: 3.0 }),
    ];

    const controversyChannel = [
      makeVideo({ title: 'Star GOES OFF on Network', engagement_rate: 12.0 }),
      makeVideo({ title: 'Artist CALLS OUT Industry', engagement_rate: 11.0 }),
      makeVideo({ title: 'Normal content here', engagement_rate: 3.0 }),
    ];

    const briefA = generateGodsEyeBrief(MOCK_CHANNEL, curiosityChannel, 'general');
    const briefB = generateGodsEyeBrief(MOCK_CHANNEL, controversyChannel, 'general');

    // The two channels should have different opening emotions
    expect(briefA.emotional_arc.opening.emotion).not.toBe(briefB.emotional_arc.opening.emotion);
  });
});

// ── Competitor Gaps (data-derived) ──────────────────────────────

describe('analyzeCompetitorGaps (via generateGodsEyeBrief)', () => {

  it('does not produce hardcoded nostalgia+schadenfreude gap', () => {
    const videos = Array.from({ length: 10 }, (_, i) =>
      makeVideo({ title: `Video ${i}`, engagement_rate: 5.0 + i * 0.5 })
    );

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');
    const gapTexts = brief.competitor_gaps.map(g => g.gap.toLowerCase());

    // The old hardcoded gap should be gone
    expect(gapTexts.some(g => g.includes('nostalgia') && g.includes('schadenfreude'))).toBe(false);
  });

  it('detects underused formats that outperform', () => {
    // 2 out of 10 videos use question marks, but they have much higher engagement
    const videos = [
      makeVideo({ title: 'Why is this so popular?', engagement_rate: 15.0 }),
      makeVideo({ title: 'How did they get away with it?', engagement_rate: 14.0 }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeVideo({ title: `Regular Video Title ${i}`, engagement_rate: 4.0 + i * 0.2 })
      ),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');
    const gapTexts = brief.competitor_gaps.map(g => g.gap.toLowerCase());

    // Should detect question format as underused but outperforming
    expect(gapTexts.some(g => g.includes('question') && g.includes('underused'))).toBe(true);
  });

  it('flags high engagement variance when present', () => {
    // Create highly variable engagement
    const videos = [
      makeVideo({ title: 'Viral Hit', engagement_rate: 20.0 }),
      makeVideo({ title: 'Another Viral', engagement_rate: 18.0 }),
      makeVideo({ title: 'Flop 1', engagement_rate: 0.5 }),
      makeVideo({ title: 'Flop 2', engagement_rate: 0.3 }),
      makeVideo({ title: 'Flop 3', engagement_rate: 0.4 }),
      makeVideo({ title: 'Average 1', engagement_rate: 3.0 }),
      makeVideo({ title: 'Average 2', engagement_rate: 2.5 }),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');
    const gapTexts = brief.competitor_gaps.map(g => g.gap.toLowerCase());

    // Should detect the high variance
    expect(gapTexts.some(g => g.includes('variance') || g.includes('cv='))).toBe(true);
  });

  it('detects recency gap when recent videos outperform older ones', () => {
    const videos = [
      // Recent — high engagement
      makeVideo({ title: 'New Style Video 1', engagement_rate: 12.0, published_at: '2026-04-15T12:00:00Z' }),
      makeVideo({ title: 'New Style Video 2', engagement_rate: 11.0, published_at: '2026-04-10T12:00:00Z' }),
      makeVideo({ title: 'New Style Video 3', engagement_rate: 10.0, published_at: '2026-04-05T12:00:00Z' }),
      // Older — low engagement
      makeVideo({ title: 'Old Style Video 1', engagement_rate: 3.0, published_at: '2026-01-15T12:00:00Z' }),
      makeVideo({ title: 'Old Style Video 2', engagement_rate: 2.5, published_at: '2026-01-10T12:00:00Z' }),
      makeVideo({ title: 'Old Style Video 3', engagement_rate: 2.0, published_at: '2026-01-05T12:00:00Z' }),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');
    const gapTexts = brief.competitor_gaps.map(g => g.gap.toLowerCase());

    // Should detect that recent content is improving
    expect(gapTexts.some(g => g.includes('recent') && g.includes('outperform'))).toBe(true);
  });

  it('uses Bayesian confidence for all gap scores (no hardcoded 0.65, 0.68, 0.72)', () => {
    const videos = [
      makeVideo({ title: 'Why is this trending?', engagement_rate: 15.0 }),
      makeVideo({ title: 'How does this work?', engagement_rate: 14.0 }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeVideo({ title: `Regular Title ${i}`, engagement_rate: 4.0 })
      ),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');
    const confidences = brief.competitor_gaps.map(g => g.confidence);

    // None of the old hardcoded values should appear
    for (const c of confidences) {
      expect(c).not.toBe(0.72);
      expect(c).not.toBe(0.68);
      expect(c).not.toBe(0.65);
    }
  });

  it('returns empty gaps for <3 videos', () => {
    const videos = [
      makeVideo({ title: 'Video 1', engagement_rate: 5.0 }),
      makeVideo({ title: 'Video 2', engagement_rate: 5.0 }),
    ];

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'general');
    expect(brief.competitor_gaps).toEqual([]);
  });
});

// ── Integration: generateGodsEyeBrief ───────────────────────────

describe('generateGodsEyeBrief', () => {

  it('produces a complete brief with all required fields', () => {
    const videos = Array.from({ length: 12 }, (_, i) =>
      makeVideo({
        title: i % 3 === 0 ? `Why is ${i} happening?` : `Video ${i}`,
        engagement_rate: 3.0 + i * 0.5,
        published_at: `2026-04-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
      })
    );

    const brief = generateGodsEyeBrief(MOCK_CHANNEL, videos, 'comedy');

    expect(brief.brief_id).toMatch(/^brief_comedy_/);
    expect(brief.niche).toBe('comedy');
    expect(brief.channel_name).toBe('Test Channel');
    expect(brief.sample_size).toBe(12);
    expect(brief.confidence_level).toBe('high');
    expect(brief.hook_analysis).toBeDefined();
    expect(brief.emotional_arc).toBeDefined();
    expect(brief.emotional_arc.opening.effectiveness).toBeGreaterThan(0);
    expect(brief.methodology.confidence_model).toContain('Beta');
    expect(brief.methodology.decay_half_life_days).toBe(90); // comedy = 90
  });

  it('throws on empty videos', () => {
    expect(() => generateGodsEyeBrief(MOCK_CHANNEL, [], 'general')).toThrow('No video data');
  });
});
