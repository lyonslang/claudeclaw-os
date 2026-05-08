import { describe, it, expect } from 'vitest';
import { calculateBayesianConfidence, formatConfidence } from './utils/bayesian-confidence.js';

// ── calculateBayesianConfidence ─────────────────────────────────────

describe('calculateBayesianConfidence', () => {

  // ── Prior-only (no data) ──────────────────────────────────────────

  it('returns 0.50 for zero trials (prior only)', () => {
    const result = calculateBayesianConfidence({
      successes: 0,
      trials: 0,
    });
    expect(result.confidence).toBe(0.50);
    expect(result.isTentative).toBe(true);
    expect(result.adjustedForRecency).toBe(false);
  });

  // ── Differential impact bonus ─────────────────────────────────────

  it('boosts confidence for strong performance deltas (>1.3x)', () => {
    const weak = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      performanceDelta: 1.1,
    });
    const strong = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      performanceDelta: 2.5,
    });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
    expect(strong.isDifferentiallyStronger).toBe(true);
    expect(weak.isDifferentiallyStronger).toBe(false);
  });

  it('caps the differential impact bonus at +0.15', () => {
    const extreme = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      performanceDelta: 10.0, // massive delta
    });
    // Should still be capped at 0.95 max
    expect(extreme.confidence).toBeLessThanOrEqual(0.95);
  });

  // ── Recency decay ─────────────────────────────────────────────────

  it('applies recency decay for old data', () => {
    const fresh = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      recencyDays: 30,
      decayHalfLife: 90,
    });
    const old = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      recencyDays: 180,
      decayHalfLife: 90,
    });
    expect(old.confidence).toBeLessThan(fresh.confidence);
    expect(old.adjustedForRecency).toBe(true);
  });

  it('does not apply recency decay for very recent data', () => {
    const result = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      recencyDays: 20,
      decayHalfLife: 90, // threshold = 45 days
    });
    expect(result.adjustedForRecency).toBe(false);
  });

  // ── Credible intervals ────────────────────────────────────────────

  it('returns credible interval within [0.10, 0.95]', () => {
    const result = calculateBayesianConfidence({
      successes: 5,
      trials: 10,
    });
    const [lower, upper] = result.credibleInterval;
    expect(lower).toBeGreaterThanOrEqual(0.10);
    expect(upper).toBeLessThanOrEqual(0.95);
    expect(lower).toBeLessThan(result.confidence);
    expect(upper).toBeGreaterThan(result.confidence);
  });

  it('narrows credible interval with more samples', () => {
    const small = calculateBayesianConfidence({
      successes: 5,
      trials: 10,
    });
    const large = calculateBayesianConfidence({
      successes: 50,
      trials: 100,
    });
    const smallWidth = small.credibleInterval[1] - small.credibleInterval[0];
    const largeWidth = large.credibleInterval[1] - large.credibleInterval[0];
    expect(largeWidth).toBeLessThan(smallWidth);
  });

  // ── Tentative flag ────────────────────────────────────────────────

  it('marks results as tentative when trials < 5', () => {
    const result = calculateBayesianConfidence({
      successes: 2,
      trials: 3,
    });
    expect(result.isTentative).toBe(true);
    expect(result.interpretation).toContain('tentative');
  });

  it('does not mark as tentative when trials >= 5', () => {
    const result = calculateBayesianConfidence({
      successes: 4,
      trials: 6,
    });
    expect(result.isTentative).toBe(false);
    expect(result.interpretation).not.toContain('tentative');
  });

  // ── Niche-aware priors ────────────────────────────────────────────

  it('accepts custom priors for niche-validated patterns', () => {
    const neutral = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
    });
    // Comedy niche: curiosity-gap hooks known to work at ~0.70
    const nicheAware = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      priorAlpha: 7,
      priorBeta: 3,
    });
    // When prior agrees with data, confidence should be at least as high
    expect(nicheAware.confidence).toBeGreaterThanOrEqual(neutral.confidence);
  });

  // ── Effective sample size ─────────────────────────────────────────

  it('returns correct effective sample size (trials + prior pseudo-obs)', () => {
    const result = calculateBayesianConfidence({
      successes: 5,
      trials: 10,
      priorAlpha: 2,
      priorBeta: 2,
    });
    // alpha = 2 + 5 = 7, beta = 2 + 5 = 7, effective = 14
    expect(result.effectiveSampleSize).toBe(14);
  });

  // ── Confidence bounds ─────────────────────────────────────────────

  it('never returns confidence below 0.10 or above 0.95', () => {
    // All successes
    const high = calculateBayesianConfidence({
      successes: 100,
      trials: 100,
      performanceDelta: 5.0,
    });
    expect(high.confidence).toBeLessThanOrEqual(0.95);

    // All failures + heavy decay
    const low = calculateBayesianConfidence({
      successes: 0,
      trials: 100,
      recencyDays: 365,
      decayHalfLife: 30,
    });
    expect(low.confidence).toBeGreaterThanOrEqual(0.10);
  });

  // ── Interpretation labels ─────────────────────────────────────────

  it('assigns correct interpretation tiers', () => {
    // High confidence
    const high = calculateBayesianConfidence({
      successes: 45,
      trials: 50,
      performanceDelta: 2.0,
    });
    expect(high.interpretation).toMatch(/strongly validated|well supported/i);

    // Low confidence
    const low = calculateBayesianConfidence({
      successes: 1,
      trials: 10,
    });
    expect(low.interpretation).toMatch(/speculative|possible/i);
  });
});

// ── formatConfidence ────────────────────────────────────────────────

describe('formatConfidence', () => {

  it('returns a human-readable string with percentage and CI', () => {
    const result = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      performanceDelta: 2.3,
    });
    const formatted = formatConfidence(result);

    // Should contain percentage
    expect(formatted).toMatch(/\d+%/);
    // Should contain CI range
    expect(formatted).toMatch(/\d+%-\d+%/);
    // Should contain interpretation
    expect(formatted.length).toBeGreaterThan(10);
  });

  it('includes "strong impact" tag for high deltas', () => {
    const result = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      performanceDelta: 2.5,
    });
    const formatted = formatConfidence(result);
    expect(formatted).toContain('strong impact');
  });

  it('includes "recency-adjusted" tag when decay is applied', () => {
    const result = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      recencyDays: 120,
      decayHalfLife: 90,
    });
    const formatted = formatConfidence(result);
    expect(formatted).toContain('recency-adjusted');
  });

  it('includes "tentative" tag for small samples', () => {
    const result = calculateBayesianConfidence({
      successes: 2,
      trials: 3,
    });
    const formatted = formatConfidence(result);
    expect(formatted).toContain('tentative');
  });

  it('produces no tags for a clean result', () => {
    const result = calculateBayesianConfidence({
      successes: 7,
      trials: 10,
      // no delta, no recency, not tentative
    });
    const formatted = formatConfidence(result);
    expect(formatted).not.toContain('[');
  });
});
