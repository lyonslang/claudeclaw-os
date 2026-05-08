import { describe, it, expect } from 'vitest';
import { quickAdvertiserScan, reviewForAdvertiserSafety } from './advertiser-review.js';

// ── Test fixtures ───────────────────────────────────────────────

function makeScript(overrides: Partial<{
  hook: string;
  act_1_beats: string[];
  act_1_sensory: string[];
  act_2_beats: string[];
  peak_revelation: string;
  close_cta: string;
}> = {}) {
  return {
    hook: overrides.hook ?? 'Here is an interesting opening line',
    act_1: {
      duration_seconds: 120,
      beats: overrides.act_1_beats ?? ['First point about the topic', 'Second interesting detail'],
      emotional_tone: 'curiosity',
      sensory_details: overrides.act_1_sensory ?? ['bright lights', 'soft texture'],
    },
    act_2: {
      duration_seconds: 180,
      beats: overrides.act_2_beats ?? ['Building tension here', 'Escalating the stakes'],
      emotional_tone: 'tension',
      tension_escalation: 'Rising conflict',
    },
    peak: {
      duration_seconds: 60,
      revelation: overrides.peak_revelation ?? 'The surprising truth is revealed',
      emotional_payoff: 'satisfaction',
    },
    close: {
      duration_seconds: 30,
      call_to_action: overrides.close_cta ?? 'Subscribe for more analysis',
      final_emotional_beat: 'urgency',
    },
  };
}

// ── quickAdvertiserScan (local, no API) ─────────────────────────

describe('quickAdvertiserScan', () => {

  it('returns clean for an advertiser-safe script', () => {
    const script = makeScript();
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(true);
    expect(result.profanity).toEqual([]);
    expect(result.high_risk).toEqual([]);
  });

  it('detects profanity in script body', () => {
    const script = makeScript({
      act_1_beats: ['This is some damn good content', 'What the hell happened here'],
    });
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(false);
    expect(result.profanity).toContain('damn');
    expect(result.profanity).toContain('hell');
  });

  it('detects profanity in hook specifically', () => {
    const script = makeScript({
      hook: 'What the fuck is going on with this company',
    });
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(false);
    expect(result.profanity).toContain('fuck');
  });

  it('detects violence terms', () => {
    const script = makeScript({
      act_2_beats: ['The victim was found with blood everywhere', 'They tried to shoot their way out'],
    });
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(false);
    expect(result.high_risk.some(f => f.category === 'Violence')).toBe(true);
  });

  it('detects drug references', () => {
    const script = makeScript({
      peak_revelation: 'The real story was about the cocaine trafficking network',
    });
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(false);
    expect(result.high_risk.some(f => f.category === 'Drugs')).toBe(true);
  });

  it('detects firearms references', () => {
    const script = makeScript({
      act_1_beats: ['He pulled out a pistol from his jacket', 'The AR-15 was modified'],
    });
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(false);
    expect(result.high_risk.some(f => f.category === 'Firearms')).toBe(true);
  });

  it('flags controversy patterns for LLM review even without profanity', () => {
    const script = makeScript({
      hook: 'Celebrity GOES OFF on Network Executive',
      act_1_beats: ['She calls out the entire production team', 'The expose reveals internal documents'],
    });
    const result = quickAdvertiserScan(script);

    // Not "clean" because controversy patterns need contextual LLM review
    expect(result.clean).toBe(false);
    // But no profanity or high-risk terms
    expect(result.profanity).toEqual([]);
    expect(result.high_risk).toEqual([]);
  });

  it('handles empty/minimal scripts gracefully', () => {
    const script = makeScript({
      hook: '',
      act_1_beats: [],
      act_2_beats: [],
      peak_revelation: '',
      close_cta: '',
    });
    const result = quickAdvertiserScan(script);

    expect(result.clean).toBe(true);
    expect(result.profanity).toEqual([]);
    expect(result.high_risk).toEqual([]);
  });
});

// ── reviewForAdvertiserSafety (with skipLLM) ────────────────────

describe('reviewForAdvertiserSafety (local-only mode)', () => {

  it('returns green for a clean script', async () => {
    const script = makeScript();
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    expect(result.advertiser_safe).toBe(true);
    expect(result.risk_level).toBe('green');
    expect(result.estimated_monetization).toBe('full');
    expect(result.profanity_in_first_30s).toBe(false);
    expect(result.flagged_sections).toEqual([]);
    expect(result.review_cost_usd).toBe(0);
  });

  it('returns red for profanity in hook (first 30s)', async () => {
    const script = makeScript({
      hook: 'Holy shit you will not believe this story',
    });
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    expect(result.risk_level).toBe('red');
    expect(result.profanity_in_first_30s).toBe(true);
    expect(result.estimated_monetization).toBe('none');
    expect(result.flagged_sections.length).toBeGreaterThan(0);
    expect(result.flagged_sections[0].category).toBe('Profanity');
    expect(result.flagged_sections[0].severity).toBe('high');
  });

  it('returns yellow for mild profanity in body (not hook)', async () => {
    const script = makeScript({
      act_2_beats: ['And that is some damn fine work right there', 'Hell of a performance'],
    });
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    expect(result.risk_level).toBe('yellow');
    expect(result.profanity_in_first_30s).toBe(false);
    expect(result.estimated_monetization).toBe('limited');
  });

  it('returns red for high-risk content (violence)', async () => {
    const script = makeScript({
      act_1_beats: ['The murder scene was covered in blood', 'They found the body dismembered'],
    });
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    expect(result.risk_level).toBe('red');
    expect(result.estimated_monetization).toBe('none');
    expect(result.flagged_sections.some(f => f.category === 'Violence')).toBe(true);
  });

  it('returns yellow for controversy patterns (needs context)', async () => {
    const script = makeScript({
      hook: 'Star GOES OFF on Network Boss',
    });
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    // Controversy without profanity or high-risk = yellow (needs LLM review for context)
    expect(result.risk_level).toBe('yellow');
    expect(result.estimated_monetization).toBe('limited');
  });

  it('includes actionable suggestions in flagged sections', async () => {
    const script = makeScript({
      hook: 'What the fuck just happened at this company',
    });
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    expect(result.flagged_sections.length).toBeGreaterThan(0);
    for (const flag of result.flagged_sections) {
      expect(flag.suggestion).toBeTruthy();
      expect(flag.suggestion.length).toBeGreaterThan(10);
    }
  });

  it('costs $0 when LLM is skipped', async () => {
    const script = makeScript({
      act_1_beats: ['Some damn good analysis', 'Hell yeah it worked'],
    });
    const result = await reviewForAdvertiserSafety(script, { skipLLM: true });

    expect(result.review_cost_usd).toBe(0);
  });
});
