/**
 * advertiser-review.ts
 * Grades a script against YouTube's 2026 advertiser-friendly content guidelines.
 *
 * Runs AFTER creative gates (novelty, anti-slop, AHA) but BEFORE ready_for_production
 * is set. Uses a cheap Haiku call (~$0.001) to catch monetization risks before you
 * spend $5-10 on avatar rendering and voice cloning.
 *
 * YouTube's advertiser-friendly guidelines categories:
 * - Controversial issues and sensitive events
 * - Drugs and dangerous substances
 * - Harassment and cyberbullying
 * - Hateful content
 * - Firearms-related content
 * - Adult/sexual themes
 * - Violence (graphic descriptions)
 * - Profanity (especially in first 30 seconds)
 * - Shocking/sensationalist content
 *
 * This is NOT a creativity killer — it flags and suggests alternatives.
 * A "yellow" script with one fixable line is still worth producing.
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Types ────────────────────────────────────────────────────────

export interface FlaggedSection {
  section: string;       // 'hook' | 'act_1' | 'act_2' | 'peak' | 'close'
  text: string;          // the flagged text snippet
  category: string;      // which guideline it violates
  severity: 'low' | 'medium' | 'high';
  suggestion: string;    // how to fix it without killing the creative
}

export interface AdvertiserReviewResult {
  advertiser_safe: boolean;           // true if green, false if yellow/red
  risk_level: 'green' | 'yellow' | 'red';
  estimated_monetization: 'full' | 'limited' | 'none';
  profanity_in_first_30s: boolean;    // YouTube specifically penalizes this
  flagged_sections: FlaggedSection[];
  summary: string;                    // one-line human-readable verdict
  review_cost_usd: number;            // cost of the Haiku call
}

// ── Local pre-scan (free, regex-based) ───────────────────────────

/**
 * Profanity and high-risk terms that are cheap to detect locally.
 * This catches obvious issues before spending on a Haiku call.
 * Not exhaustive — the LLM review handles nuance and context.
 */
const PROFANITY_TERMS = [
  'fuck', 'shit', 'bitch', 'ass', 'damn', 'hell',
  'bastard', 'crap', 'dick', 'piss',
];

const HIGH_RISK_TERMS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(kill|murder|stab|shoot|blood|gore|dismember)\b/i, category: 'Violence' },
  { pattern: /\b(suicide|self.?harm|cutting)\b/i, category: 'Sensitive events' },
  { pattern: /\b(cocaine|heroin|meth|fentanyl|drug.?use|overdose)\b/i, category: 'Drugs' },
  { pattern: /\b(racial.?slur|[n]-word|hate.?crime)\b/i, category: 'Hateful content' },
  { pattern: /\b(sex|nude|naked|porn|explicit)\b/i, category: 'Adult themes' },
  { pattern: /\b(gun|firearm|rifle|pistol|ammunition|AR-?15)\b/i, category: 'Firearms' },
];

interface LocalScanResult {
  profanity_found: string[];
  profanity_in_hook: boolean;
  high_risk_flags: Array<{ term: string; category: string }>;
  needs_llm_review: boolean;  // true if anything ambiguous was found
}

function localPreScan(script: {
  hook: string;
  act_1: { beats: string[]; sensory_details?: string[] };
  act_2: { beats: string[] };
  peak: { revelation: string };
  close: { call_to_action: string };
}): LocalScanResult {
  const hookText = script.hook.toLowerCase();
  const fullText = [
    script.hook,
    ...script.act_1.beats,
    ...(script.act_1.sensory_details || []),
    ...script.act_2.beats,
    script.peak.revelation,
    script.close.call_to_action,
  ].join(' ').toLowerCase();

  const profanityFound = PROFANITY_TERMS.filter(term =>
    new RegExp(`\\b${term}\\b`, 'i').test(fullText)
  );

  const profanityInHook = PROFANITY_TERMS.some(term =>
    new RegExp(`\\b${term}\\b`, 'i').test(hookText)
  );

  const highRiskFlags: Array<{ term: string; category: string }> = [];
  for (const { pattern, category } of HIGH_RISK_TERMS) {
    const match = fullText.match(pattern);
    if (match) {
      highRiskFlags.push({ term: match[0], category });
    }
  }

  return {
    profanity_found: profanityFound,
    profanity_in_hook: profanityInHook,
    high_risk_flags: highRiskFlags,
    needs_llm_review: profanityFound.length > 0 || highRiskFlags.length > 0 ||
      // Also flag controversy patterns that need contextual review
      /goes off|calls out|exposes|blasts|responds to/i.test(fullText),
  };
}

// ── LLM Review (Haiku) ──────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `You are a YouTube advertiser-friendliness reviewer. You grade video scripts against YouTube's 2026 advertiser-friendly content guidelines.

Your job is to identify content that would cause:
- Full demonetization (red): hate speech, graphic violence, dangerous activities, explicit content
- Limited ads / yellow dollar sign (yellow): mild profanity, controversial framing that borders on harassment, sensitive topics without educational framing, sensationalist claims
- Full monetization (green): advertiser-safe content

IMPORTANT GUIDELINES:
1. Commentary/reaction content is ALLOWED but the script must not cross into personal attacks or harassment
2. "GOES OFF" / "CALLS OUT" / "EXPOSES" framing is common in commentary — flag it as yellow only if the script body contains personal insults, doxxing instructions, or encouragement of harassment
3. Profanity in the FIRST 30 SECONDS (hook + early act_1) is specifically penalized by YouTube even if the rest is clean
4. Discussing controversial topics is fine IF framed as analysis/education, NOT if framed as taking sides in a divisive political/social issue
5. Violence references in storytelling context (historical events, news commentary) are generally yellow, not red
6. You are NOT a creativity gate. Do not reject scripts for being edgy. Only flag genuine advertiser-safety risks.

Respond with ONLY valid JSON in this exact format:
{
  "risk_level": "green" | "yellow" | "red",
  "estimated_monetization": "full" | "limited" | "none",
  "profanity_in_first_30s": boolean,
  "flagged_sections": [
    {
      "section": "hook" | "act_1" | "act_2" | "peak" | "close",
      "text": "the specific problematic text",
      "category": "Profanity" | "Harassment" | "Violence" | "Controversial issues" | "Drugs" | "Adult themes" | "Firearms" | "Hateful content" | "Shocking content",
      "severity": "low" | "medium" | "high",
      "suggestion": "how to rephrase this to be advertiser-safe without killing the creative"
    }
  ],
  "summary": "one sentence verdict"
}`;

async function llmReview(
  scriptJson: any,
  localFlags: LocalScanResult
): Promise<{
  risk_level: 'green' | 'yellow' | 'red';
  estimated_monetization: 'full' | 'limited' | 'none';
  profanity_in_first_30s: boolean;
  flagged_sections: FlaggedSection[];
  summary: string;
}> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const userPrompt = `Review this video script for YouTube advertiser-friendliness.

SCRIPT:
${JSON.stringify(scriptJson, null, 2)}

LOCAL PRE-SCAN FLAGS:
- Profanity found: ${localFlags.profanity_found.join(', ') || 'none'}
- Profanity in hook (first 30s): ${localFlags.profanity_in_hook}
- High-risk terms: ${localFlags.high_risk_flags.map(f => `${f.term} (${f.category})`).join(', ') || 'none'}

Grade this script. Respond with JSON only.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1000,
    system: REVIEW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON (handle markdown code blocks)
  let jsonText = text.trim();
  if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
  if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
  if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);

  return JSON.parse(jsonText.trim());
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Review a script for YouTube advertiser-friendliness.
 *
 * Two-pass approach:
 * 1. Local regex pre-scan (free, instant) catches obvious profanity and high-risk terms
 * 2. If anything ambiguous is found OR always on first production run, sends to Haiku
 *    for contextual review (~$0.001)
 *
 * @param scriptJson - The script object (hook, act_1, act_2, peak, close)
 * @param opts.skipLLM - If true, only run local scan (for testing or cost saving)
 * @param opts.forceReview - If true, always run LLM review even if local scan is clean
 */
export async function reviewForAdvertiserSafety(
  scriptJson: {
    hook: string;
    act_1: { beats: string[]; sensory_details?: string[]; duration_seconds: number };
    act_2: { beats: string[]; duration_seconds: number };
    peak: { revelation: string; duration_seconds: number };
    close: { call_to_action: string; duration_seconds: number };
  },
  opts: { skipLLM?: boolean; forceReview?: boolean } = {}
): Promise<AdvertiserReviewResult> {
  const { skipLLM = false, forceReview = false } = opts;

  // Pass 1: Local pre-scan (free)
  const localResult = localPreScan(scriptJson);

  // If local scan is completely clean and we're not forced, return green immediately
  if (!localResult.needs_llm_review && !forceReview) {
    return {
      advertiser_safe: true,
      risk_level: 'green',
      estimated_monetization: 'full',
      profanity_in_first_30s: false,
      flagged_sections: [],
      summary: 'Script passed local advertiser safety scan — no flags detected.',
      review_cost_usd: 0,
    };
  }

  // If we have local flags but LLM is skipped, build result from local scan only
  if (skipLLM) {
    const flags: FlaggedSection[] = [];

    for (const term of localResult.profanity_found) {
      flags.push({
        section: localResult.profanity_in_hook ? 'hook' : 'act_1',
        text: term,
        category: 'Profanity',
        severity: localResult.profanity_in_hook ? 'high' : 'medium',
        suggestion: `Remove or bleep "${term}" — especially critical in first 30 seconds`,
      });
    }

    for (const flag of localResult.high_risk_flags) {
      flags.push({
        section: 'act_1',
        text: flag.term,
        category: flag.category,
        severity: 'high',
        suggestion: `Review "${flag.term}" in context — may need softening or removal`,
      });
    }

    const isRed = localResult.high_risk_flags.length > 0 || localResult.profanity_in_hook;
    const riskLevel: 'yellow' | 'red' = isRed ? 'red' : 'yellow';

    return {
      advertiser_safe: false, // always false in local-flag path (yellow or red)
      risk_level: riskLevel,
      estimated_monetization: riskLevel === 'red' ? 'none' : 'limited',
      profanity_in_first_30s: localResult.profanity_in_hook,
      flagged_sections: flags,
      summary: `Local scan found ${flags.length} flag(s). LLM review skipped.`,
      review_cost_usd: 0,
    };
  }

  // Pass 2: LLM review via Haiku (~$0.001)
  try {
    console.log('[ADVERTISER_REVIEW] Sending script to Haiku for contextual review...');
    const llmResult = await llmReview(scriptJson, localResult);

    return {
      advertiser_safe: llmResult.risk_level === 'green',
      risk_level: llmResult.risk_level,
      estimated_monetization: llmResult.estimated_monetization,
      profanity_in_first_30s: llmResult.profanity_in_first_30s,
      flagged_sections: llmResult.flagged_sections || [],
      summary: llmResult.summary,
      review_cost_usd: 0.001, // approximate Haiku cost
    };
  } catch (error) {
    // If Haiku fails, fall back to local-only result
    console.error(`[ADVERTISER_REVIEW] Haiku review failed: ${error}. Falling back to local scan.`);
    return reviewForAdvertiserSafety(scriptJson, { skipLLM: true });
  }
}

/**
 * Quick local-only check (no API call). Use for batch scoring or testing.
 */
export function quickAdvertiserScan(scriptJson: {
  hook: string;
  act_1: { beats: string[]; sensory_details?: string[] };
  act_2: { beats: string[] };
  peak: { revelation: string };
  close: { call_to_action: string };
}): { clean: boolean; profanity: string[]; high_risk: Array<{ term: string; category: string }> } {
  const result = localPreScan(scriptJson);
  return {
    clean: !result.needs_llm_review,
    profanity: result.profanity_found,
    high_risk: result.high_risk_flags,
  };
}

export default { reviewForAdvertiserSafety, quickAdvertiserScan };
