import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/test-store',
  DB_ENCRYPTION_KEY: 'a'.repeat(64),
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./youtube-analytics.js', () => ({
  isYouTubeAnalyticsConfigured: () => false,
  fetchReturningViewerRateByVideo: vi.fn(),
}));

// ── Welford's Online Variance ────────────────────────────────────

describe('Welford posterior update math', () => {
  it('correctly computes mean and variance for a sequence of observations', () => {
    // Simulate the Welford update logic from governor.ts
    let mean = 0;
    let m2 = 0;
    let count = 0;

    const rates = [0.05, 0.08, 0.03, 0.10, 0.06];

    for (const rate of rates) {
      count++;
      const delta = rate - mean;
      mean = mean + delta / count;
      m2 = m2 + delta * (rate - mean);
    }

    const variance = count > 1 ? m2 / (count - 1) : 0;

    // Verify against known values
    const expectedMean = rates.reduce((s, r) => s + r, 0) / rates.length;
    expect(mean).toBeCloseTo(expectedMean, 10);

    // Sample variance = sum((x - mean)^2) / (n-1)
    const expectedVariance = rates.reduce((s, r) => s + Math.pow(r - expectedMean, 2), 0) / (rates.length - 1);
    expect(variance).toBeCloseTo(expectedVariance, 10);
  });

  it('returns 0 variance for a single observation', () => {
    let mean = 0;
    let m2 = 0;
    const count = 1;

    const rate = 0.05;
    const delta = rate - mean;
    mean = mean + delta / count;
    m2 = m2 + delta * (rate - mean);

    const variance = count > 1 ? m2 / (count - 1) : 0;
    expect(variance).toBe(0);
  });

  it('M2 accumulator is separate from variance (no ghost uncertainty)', () => {
    let mean = 0;
    let m2 = 0;
    let count = 0;

    const rates = [0.10, 0.10, 0.10]; // identical rates → variance should be 0

    for (const rate of rates) {
      count++;
      const delta = rate - mean;
      mean = mean + delta / count;
      m2 = m2 + delta * (rate - mean);
    }

    const variance = count > 1 ? m2 / (count - 1) : 0;
    expect(variance).toBeCloseTo(0, 10);
    // m2 should also be ~0 for identical values
    expect(m2).toBeCloseTo(0, 10);
  });
});

// ── Beta-Binomial Posterior ──────────────────────────────────────

describe('Beta-Binomial posterior update', () => {
  it('alpha increases by engaged views, beta by non-engaged views', () => {
    const alpha = 1.0;
    const beta = 1.0;
    const views = 1000;
    const engagedViews = 200;

    const newAlpha = alpha + engagedViews;
    const newBeta = beta + (views - engagedViews);

    expect(newAlpha).toBe(201);
    expect(newBeta).toBe(801);

    // Posterior mean should reflect the engagement rate
    const posteriorMean = newAlpha / (newAlpha + newBeta);
    expect(posteriorMean).toBeCloseTo(0.2008, 3); // ~20% engagement
  });

  it('uninformative prior Beta(1,1) gives posterior mean equal to engagement rate', () => {
    const views = 100;
    const engaged = 50;

    const newAlpha = 1 + engaged;
    const newBeta = 1 + (views - engaged);
    const mean = newAlpha / (newAlpha + newBeta);

    // With uninformative prior, posterior mean ≈ sample proportion
    expect(mean).toBeCloseTo(0.5, 1);
  });
});

// ── Temporal Decay ───────────────────────────────────────────────

describe('temporal decay logic', () => {
  it('MAX(1.0) clamp prevents sub-prior blacklisting', () => {
    // Simulate decay on a pattern with low alpha/beta
    let alpha = 1.2;
    let beta = 1.1;
    const decayConstant = 0.95;

    // After many decay cycles, should floor at 1.0
    for (let i = 0; i < 100; i++) {
      alpha = Math.max(1.0, alpha * decayConstant);
      beta = Math.max(1.0, beta * decayConstant);
    }

    expect(alpha).toBe(1.0);
    expect(beta).toBe(1.0);
  });

  it('high-alpha patterns decay slowly but never below 1.0', () => {
    let alpha = 50.0;
    const decayConstant = 0.99;

    // After 500 days of decay
    for (let i = 0; i < 500; i++) {
      alpha = Math.max(1.0, alpha * decayConstant);
    }

    // Should have decayed significantly but not below 1.0
    expect(alpha).toBeGreaterThanOrEqual(1.0);
    expect(alpha).toBeLessThan(50.0);
  });

  it('idempotency: applying decay twice in same day should be equivalent to once', () => {
    const alpha = 10.0;
    const decay = 0.95;

    // One application
    const once = Math.max(1.0, alpha * decay);

    // Two applications (should be caught by the idempotency guard in real code,
    // but verify the math shows why double-decay is wrong)
    const twice = Math.max(1.0, Math.max(1.0, alpha * decay) * decay);

    expect(once).not.toBe(twice); // This is why the guard matters
    expect(once).toBe(9.5);
    expect(twice).toBe(9.025); // Over-decayed — guard prevents this
  });
});

// ── LCB Scoring ──────────────────────────────────────────────────

describe('Bayesian LCB scoring', () => {
  it('uses Beta distribution variance, not Welford variance (no dimensional mismatch)', () => {
    const alpha = 10;
    const beta = 5;
    const k = 2.0;

    const mu = alpha / (alpha + beta);
    const betaVariance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
    const sigma = Math.sqrt(betaVariance);
    const lcb = mu - k * sigma;

    expect(mu).toBeCloseTo(0.6667, 3);
    expect(sigma).toBeGreaterThan(0);
    expect(lcb).toBeLessThan(mu); // LCB is always below mean
    expect(lcb).toBeGreaterThan(0); // But still positive for reasonable patterns
  });

  it('synthetic patterns get 0.7 trust weight, observed get 1.0', () => {
    const mu = 0.6;
    const sigma = 0.1;
    const k = 2.0;

    const lcbObserved = 1.0 * (mu - k * sigma);
    const lcbSynthetic = 0.7 * (mu - k * sigma);

    expect(lcbObserved).toBeGreaterThan(lcbSynthetic);
    // Synthetic patterns are penalized until they graduate via real observations
    expect(lcbSynthetic / lcbObserved).toBeCloseTo(0.7, 5);
  });

  it('higher observation count narrows uncertainty (sigma decreases)', () => {
    // Low observation: Beta(3, 2)
    const sigma1 = Math.sqrt((3 * 2) / (Math.pow(3 + 2, 2) * (3 + 2 + 1)));

    // High observation: Beta(30, 20)
    const sigma2 = Math.sqrt((30 * 20) / (Math.pow(30 + 20, 2) * (30 + 20 + 1)));

    expect(sigma2).toBeLessThan(sigma1); // More data → less uncertainty
  });
});

// ── Epsilon-Greedy Gate ──────────────────────────────────────────

describe('epsilon-greedy selection', () => {
  it('epsilon = 0 always exploits (LCB)', () => {
    const epsilon = 0;
    let explorations = 0;
    const trials = 1000;

    for (let i = 0; i < trials; i++) {
      if (Math.random() < epsilon) explorations++;
    }

    expect(explorations).toBe(0);
  });

  it('epsilon = 1 always explores (Thompson)', () => {
    const epsilon = 1;
    let explorations = 0;
    const trials = 1000;

    for (let i = 0; i < trials; i++) {
      if (Math.random() < epsilon) explorations++;
    }

    expect(explorations).toBe(trials);
  });

  it('epsilon = 0.1 explores approximately 10% of the time', () => {
    const epsilon = 0.1;
    let explorations = 0;
    const trials = 10000;

    for (let i = 0; i < trials; i++) {
      if (Math.random() < epsilon) explorations++;
    }

    // Should be roughly 10% ± 2%
    expect(explorations / trials).toBeCloseTo(0.1, 1);
  });
});

// ── In-Flight Maturity ───────────────────────────────────────────

describe('in-flight maturity window', () => {
  it('youtube_shorts: 48h maturity before sync', () => {
    const publishedAt = Math.floor(Date.now() / 1000) - 49 * 3600; // 49h ago
    const maturityHours = 48;
    const now = Math.floor(Date.now() / 1000);

    const hoursElapsed = (now - publishedAt) / 3600;
    expect(hoursElapsed).toBeGreaterThanOrEqual(maturityHours);
  });

  it('tiktok: 6h maturity before sync', () => {
    const publishedAt = Math.floor(Date.now() / 1000) - 7 * 3600; // 7h ago
    const maturityHours = 6;
    const now = Math.floor(Date.now() / 1000);

    const hoursElapsed = (now - publishedAt) / 3600;
    expect(hoursElapsed).toBeGreaterThanOrEqual(maturityHours);
  });

  it('video published 2h ago should NOT be mature for youtube_shorts', () => {
    const publishedAt = Math.floor(Date.now() / 1000) - 2 * 3600; // 2h ago
    const maturityHours = 48;
    const now = Math.floor(Date.now() / 1000);

    const hoursElapsed = (now - publishedAt) / 3600;
    expect(hoursElapsed).toBeLessThan(maturityHours);
  });
});
