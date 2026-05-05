import { describe, it, expect } from 'vitest';
import { classifyMessageComplexity, classifyMessageTier } from './message-classifier.js';

// ── Legacy compatibility (classifyMessageComplexity) ──────────────────

describe('classifyMessageComplexity', () => {
  // ── Simple messages ────────────────────────────────────────────────

  it('classifies "thanks" as simple', () => {
    expect(classifyMessageComplexity('thanks')).toBe('simple');
  });

  it('classifies "ok got it" as simple', () => {
    expect(classifyMessageComplexity('ok got it')).toBe('simple');
  });

  it('classifies "yes" as simple', () => {
    expect(classifyMessageComplexity('yes')).toBe('simple');
  });

  it('classifies "sounds good" as simple', () => {
    expect(classifyMessageComplexity('sounds good')).toBe('simple');
  });

  it('classifies "lgtm" as simple', () => {
    expect(classifyMessageComplexity('lgtm')).toBe('simple');
  });

  it('classifies "k" as simple', () => {
    expect(classifyMessageComplexity('k')).toBe('simple');
  });

  it('classifies empty string as simple', () => {
    expect(classifyMessageComplexity('')).toBe('simple');
  });

  it('classifies "thanks!" (with punctuation) as simple', () => {
    expect(classifyMessageComplexity('thanks!')).toBe('simple');
  });

  it('is case-insensitive ("THANKS" -> simple)', () => {
    expect(classifyMessageComplexity('THANKS')).toBe('simple');
  });

  // ── Complex messages ───────────────────────────────────────────────

  it('classifies a refactoring request as complex', () => {
    expect(
      classifyMessageComplexity(
        'Can you refactor the authentication module to use JWT?',
      ),
    ).toBe('complex');
  });

  it('classifies messages with URLs as complex', () => {
    expect(
      classifyMessageComplexity('check this https://example.com'),
    ).toBe('complex');
  });

  it('classifies messages with code fences as complex', () => {
    expect(
      classifyMessageComplexity('here is code ```const x = 1```'),
    ).toBe('complex');
  });

  it('classifies messages longer than 120 chars as complex', () => {
    const long = 'a'.repeat(201);
    expect(classifyMessageComplexity(long)).toBe('complex');
  });

  it('classifies messages with file paths as complex', () => {
    expect(
      classifyMessageComplexity('/Users/foo/bar.ts'),
    ).toBe('complex');
  });

  it('classifies "hey" as simple (casual greeting -> T1)', () => {
    expect(classifyMessageComplexity('hey')).toBe('simple');
  });
});

// ── Tier-based classifier (classifyMessageTier) ───────────────────────

describe('classifyMessageTier', () => {
  // ── T1: Acknowledgments ────────────────────────────────────────────

  it('classifies "ok" as T1', () => {
    expect(classifyMessageTier('ok').tier).toBe('T1');
  });

  it('classifies "thanks" as T1', () => {
    expect(classifyMessageTier('thanks').tier).toBe('T1');
  });

  it('classifies "bet" as T1', () => {
    expect(classifyMessageTier('bet').tier).toBe('T1');
  });

  it('classifies empty string as T1', () => {
    expect(classifyMessageTier('').tier).toBe('T1');
  });

  // ── T1: Casual conversation ────────────────────────────────────────

  it('classifies "hey" as T1 casual', () => {
    const result = classifyMessageTier('hey');
    expect(result.tier).toBe('T1');
    expect(result.reason).toBe('casual-chat');
  });

  it('classifies "good morning" as T1 casual', () => {
    expect(classifyMessageTier('good morning').tier).toBe('T1');
  });

  it('classifies "never mind" as T1 casual', () => {
    expect(classifyMessageTier('never mind').tier).toBe('T1');
  });

  it('classifies short statements as T1', () => {
    expect(classifyMessageTier('I like that idea').tier).toBe('T1');
  });

  // ── T2: Skill triggers ────────────────────────────────────────────

  it('classifies "check my inbox" as T2', () => {
    expect(classifyMessageTier('check my inbox').tier).toBe('T2');
  });

  it('classifies "schedule a meeting for tomorrow" as T2', () => {
    expect(classifyMessageTier('schedule a meeting for tomorrow').tier).toBe('T2');
  });

  it('classifies "scrape that page for me" as T2', () => {
    expect(classifyMessageTier('scrape that page for me').tier).toBe('T2');
  });

  it('classifies simple questions as T2', () => {
    expect(classifyMessageTier('what time is it?').tier).toBe('T2');
  });

  // ── T3: Complex reasoning ─────────────────────────────────────────

  it('classifies "analyze this video" as T3', () => {
    expect(classifyMessageTier('analyze this video').tier).toBe('T3');
  });

  it('classifies "write me a script for a youtube short" as T3', () => {
    expect(classifyMessageTier('write me a script for a youtube short').tier).toBe('T3');
  });

  it('classifies "build a tool that tracks views" as T3', () => {
    expect(classifyMessageTier('build a tool that tracks views').tier).toBe('T3');
  });

  it('classifies messages with code fences as T3', () => {
    expect(classifyMessageTier('fix this ```const x = 1```').tier).toBe('T3');
  });

  it('classifies messages with URLs as T3', () => {
    expect(classifyMessageTier('check this https://example.com').tier).toBe('T3');
  });

  it('classifies long messages as T3', () => {
    const long = 'a'.repeat(201);
    expect(classifyMessageTier(long).tier).toBe('T3');
  });

  // ── T4: Pipeline triggers ─────────────────────────────────────────

  it('classifies "run the full pipeline" as T4', () => {
    expect(classifyMessageTier('run the full pipeline').tier).toBe('T4');
  });

  it('classifies "competitor analysis for tech channels" as T4', () => {
    expect(classifyMessageTier('competitor analysis for tech channels').tier).toBe('T4');
  });

  it('classifies "full content production" as T4', () => {
    expect(classifyMessageTier('full content production').tier).toBe('T4');
  });

  // ── Special commands ───────────────────────────────────────────────

  it('classifies "convolife" as T3 (special command)', () => {
    const result = classifyMessageTier('convolife');
    expect(result.tier).toBe('T3');
    expect(result.reason).toBe('special-command');
  });

  it('classifies "checkpoint" as T3 (special command)', () => {
    expect(classifyMessageTier('checkpoint').tier).toBe('T3');
  });

  // ── Model mapping ─────────────────────────────────────────────────

  it('T1 maps to haiku', () => {
    expect(classifyMessageTier('ok').model).toBe('claude-haiku-4-5');
  });

  it('T2 maps to haiku', () => {
    expect(classifyMessageTier('check my inbox').model).toBe('claude-haiku-4-5');
  });

  it('T3 maps to sonnet', () => {
    expect(classifyMessageTier('analyze this video').model).toBe('claude-sonnet-4-6');
  });

  it('T4 maps to sonnet', () => {
    expect(classifyMessageTier('run the full pipeline').model).toBe('claude-sonnet-4-6');
  });
});
