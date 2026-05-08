import { GoogleGenAI } from '@google/genai';

import { GOOGLE_API_KEY } from './config.js';
import { logger } from './logger.js';
import { requireEnabled } from './kill-switches.js';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set. Add it to .env for memory extraction.');
  }
  client = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  return client;
}

// ── Circuit breaker ──────────────────────────────────────────────
// After consecutive 429s, pause ALL Gemini calls for a cooldown period.
// This prevents crash-loops where every message hammers a dead quota.

const CIRCUIT_BREAKER_THRESHOLD = 3;        // consecutive 429s before tripping
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

let _consecutive429s = 0;
let _circuitOpenUntil = 0;

/** Check if an error is a Gemini quota/rate-limit error. */
function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
}

/** Get circuit breaker status (for health endpoints). */
export function getGeminiCircuitStatus(): {
  open: boolean;
  openUntil: number | null;
  consecutive429s: number;
} {
  const now = Date.now();
  return {
    open: now < _circuitOpenUntil,
    openUntil: _circuitOpenUntil > now ? _circuitOpenUntil : null,
    consecutive429s: _consecutive429s,
  };
}

// ── Retry with exponential backoff ───────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract a retry delay hint from Gemini's error response.
 * YouTube/Google APIs often include "Please retry in Xs" in the error body.
 */
function parseRetryDelay(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/retry in (\d+)s/i);
  return match ? parseInt(match[1], 10) * 1000 : null;
}

/**
 * Generate text content via Gemini.
 * Defaults to gemini-2.0-flash for speed and cost efficiency.
 *
 * Includes:
 * - Exponential backoff retry (up to 3 attempts: 1s, 2s, 4s)
 * - Circuit breaker: after 3 consecutive 429s, pauses all calls for 5 min
 * - Respects server-suggested retry delays when present
 * - Returns empty string on quota exhaustion (callers already handle this)
 * - Never crashes the subprocess on transient API errors
 */
export async function generateContent(
  prompt: string,
  model = 'gemini-2.0-flash',
): Promise<string> {
  // Kill-switch: refuse Gemini calls when LLM_SPAWN_ENABLED is off.
  requireEnabled('LLM_SPAWN_ENABLED');

  // Circuit breaker: if open, return empty immediately (don't even try)
  if (Date.now() < _circuitOpenUntil) {
    logger.warn(
      { model, openUntil: new Date(_circuitOpenUntil).toISOString() },
      'Gemini circuit breaker OPEN — skipping call until cooldown expires'
    );
    return '';
  }

  const ai = getClient();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      // Success — reset the consecutive 429 counter
      _consecutive429s = 0;

      if (!response.text) {
        logger.warn({ model }, 'Gemini returned empty response');
        return '';
      }
      return response.text;

    } catch (err) {
      const isQuota = isQuotaError(err);

      if (isQuota) {
        _consecutive429s++;
        logger.warn(
          { model, attempt: attempt + 1, maxRetries: MAX_RETRIES, consecutive429s: _consecutive429s },
          'Gemini 429 RESOURCE_EXHAUSTED — quota limit hit'
        );

        // Trip the circuit breaker if we've hit too many consecutive 429s
        if (_consecutive429s >= CIRCUIT_BREAKER_THRESHOLD) {
          _circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
          logger.error(
            { model, cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS, openUntil: new Date(_circuitOpenUntil).toISOString() },
            `Gemini circuit breaker TRIPPED — ${_consecutive429s} consecutive 429s. Pausing all Gemini calls for ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000} min.`
          );
          return ''; // Don't throw — let callers handle empty response gracefully
        }

        // Retry with backoff (respect server-suggested delay if present)
        if (attempt < MAX_RETRIES) {
          const serverDelay = parseRetryDelay(err);
          const backoffDelay = serverDelay ?? (BASE_DELAY_MS * Math.pow(2, attempt));
          logger.info({ model, attempt: attempt + 1, delayMs: backoffDelay }, 'Retrying Gemini call after backoff');
          await sleep(backoffDelay);
          continue;
        }

        // All retries exhausted on quota error — return empty, don't crash
        logger.error(
          { model, attempts: attempt + 1 },
          'Gemini quota exhausted after all retries — returning empty (callers will handle gracefully)'
        );
        return '';

      } else {
        // Non-quota error (network, malformed response, etc.)
        if (attempt < MAX_RETRIES) {
          const backoffDelay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn(
            { err, model, attempt: attempt + 1, delayMs: backoffDelay },
            'Gemini call failed (non-quota) — retrying after backoff'
          );
          await sleep(backoffDelay);
          continue;
        }

        // All retries exhausted on non-quota error — throw so callers can distinguish
        logger.error({ err, model, attempts: attempt + 1 }, 'Gemini generateContent failed after all retries');
        throw err;
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  return '';
}

/**
 * Parse a JSON response from Gemini, with fallback on malformed output.
 * Returns null if parsing fails.
 */
export function parseJsonResponse<T>(text: string): T | null {
  // Try four extraction strategies in order, most permissive last:
  //   1. Bare JSON (Gemini's responseMimeType=application/json case)
  //   2. JSON inside ```json ... ``` fences (Haiku tends to wrap)
  //   3. JSON inside generic ``` ... ``` fences
  //   4. First {...} block in the text (Haiku also tends to add prose
  //      AFTER the fence, which broke the previous regex anchor).
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const firstObj = trimmed.match(/\{[\s\S]*\}/);
  if (firstObj) candidates.push(firstObj[0]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next
    }
  }
  logger.warn({ text: text.slice(0, 200) }, 'Failed to parse JSON response');
  return null;
}
