/**
 * anti-slop.ts
 * Hybrid anti-slop: Gemini (40%) + similarity to winners (35%) + niche novelty (25%)
 * Lean, testable, ships fast.
 */

import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

interface SlopCheckResult {
  safeToProduce: boolean;
  originalityScore: number;     // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  geminiFeedback?: string;
  breakdown?: {
    geminiScore: number;
    similarityToWinners: number;
    nicheNoveltyScore: number;
  };
}

function getDb() {
  return new Database(path.join(process.cwd(), 'store', 'claudeclaw.db'));
}

function hashConcept(title: string, concept: string): string {
  return crypto
    .createHash('sha256')
    .update(`${title}|${concept}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * 35%: Similarity to your top 10 performers (keyword overlap)
 * Returns 0-100 where 100 = identical to a top performer
 */
function getSimilarityToWinners(niche: string, title: string, concept: string): number {
  const db = getDb();

  // Get your top 10 videos by view count in this niche
  const topVideos = db
    .prepare(`
      SELECT title, description FROM youtube_videos
      WHERE id IN (
        SELECT channel_id FROM youtube_channels LIMIT 1
      )
      ORDER BY view_count DESC
      LIMIT 10
    `)
    .all() as { title: string; description: string }[];

  db.close();

  if (topVideos.length === 0) return 0; // no history

  // Simple keyword overlap
  const inputWords = `${title} ${concept}`.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let maxOverlap = 0;

  for (const video of topVideos) {
    const videoWords = `${video.title} ${video.description}`.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const shared = inputWords.filter(w => videoWords.includes(w));
    const overlap = (shared.length / Math.max(inputWords.length, 1)) * 100;
    maxOverlap = Math.max(maxOverlap, overlap);
  }

  return Math.min(100, maxOverlap);
}

/**
 * 25%: Niche novelty — is this hook/format overdone right now?
 * Simple heuristic: check if title contains overused phrases
 */
function getNicheNoveltyScore(title: string, niche: string): number {
  // Common overdone phrases by niche (basic heuristic)
  const overdoneByNiche: Record<string, string[]> = {
    comedy: [
      'nobody talking about', 'wait until', 'this is why', 'the truth about',
      'exposed', 'shocking', 'unbelievable', 'i cant believe'
    ],
    growth: [
      'secret to', 'how to', 'i made', 'why i', 'lessons from', 'blueprint'
    ],
    education: [
      'teach you', 'learn', 'tutorial', 'guide to', 'explained'
    ],
  };

  const overdoneList = overdoneByNiche[niche] || [];
  const lowerTitle = title.toLowerCase();

  const overdoneCount = overdoneList.filter(phrase => lowerTitle.includes(phrase)).length;
  const noveltyScore = Math.max(0, 100 - overdoneCount * 15); // 15 points off per overdone phrase

  return noveltyScore;
}

/**
 * 40%: Gemini originality assessment
 * Uses native Anthropic API (not Google) for consistency
 */
async function getGeminiOriginalityScore(niche: string, title: string, concept: string): Promise<{ score: number; feedback: string }> {
  // For now, return a placeholder. In practice, this would call Anthropic's API or Gemini.
  // Since we're using Anthropic's Claude, we'd integrate this via a synchronous call or queue it.

  // Placeholder: simple heuristic based on prompt length and specificity
  const specificity = concept.length / 100; // longer = more specific
  const uniqueWords = new Set(concept.toLowerCase().split(/\s+/)).size;
  const baseScore = 50 + specificity * 20 + (uniqueWords > 20 ? 20 : 0);

  return {
    score: Math.min(100, baseScore),
    feedback: `Concept has ${uniqueWords} unique terms and ${concept.length} characters. (Placeholder scoring — integrate Gemini for real assessment)`
  };
}

/**
 * Main: Hybrid anti-slop check
 * 40% Gemini + 35% similarity to winners + 25% niche novelty
 */
export async function checkForSlop(
  niche: string,
  title: string,
  scriptOrConcept: string
): Promise<SlopCheckResult> {
  const db = getDb();
  const conceptHash = hashConcept(title, scriptOrConcept);

  // Check cache (24h)
  const cached = db
    .prepare(`SELECT * FROM originality_checks WHERE concept_hash = ? AND niche = ?`)
    .get(conceptHash, niche) as any;

  if (cached && Math.floor(Date.now() / 1000) - cached.created_at < 86400) {
    db.close();
    return {
      safeToProduce: cached.safe_to_produce === 1,
      originalityScore: cached.originality_score,
      riskLevel: cached.originality_score > 70 ? 'LOW' : cached.originality_score > 50 ? 'MEDIUM' : 'HIGH',
      reasons: JSON.parse(cached.reasons || '[]'),
      geminiFeedback: cached.gemini_assessment,
    };
  }

  const reasons: string[] = [];

  // Calculate three scores
  const geminiResult = await getGeminiOriginalityScore(niche, title, scriptOrConcept);
  const similarityToWinners = getSimilarityToWinners(niche, title, scriptOrConcept);
  const nicheNovelty = getNicheNoveltyScore(title, niche);

  // Flag issues
  if (similarityToWinners > 70) {
    reasons.push(`Too similar to your top performers (${Math.round(similarityToWinners)}% overlap)`);
  }
  if (nicheNovelty < 40) {
    reasons.push(`Hook/format is overdone in ${niche} niche right now`);
  }

  // Weighted score: 40% Gemini + 35% (100 - similarity) + 25% novelty
  const originalityScore = Math.round(
    geminiResult.score * 0.4 +
    (100 - similarityToWinners) * 0.35 +
    nicheNovelty * 0.25
  );

  const riskLevel = originalityScore > 70 ? 'LOW' : originalityScore > 50 ? 'MEDIUM' : 'HIGH';
  const safeToProduce = originalityScore >= 50 && reasons.length === 0;

  // Store result
  db.prepare(`
    INSERT INTO originality_checks
    (niche, concept, title, concept_hash, originality_score, gemini_assessment, safe_to_produce, reasons, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    niche,
    scriptOrConcept,
    title,
    conceptHash,
    originalityScore,
    geminiResult.feedback,
    safeToProduce ? 1 : 0,
    JSON.stringify(reasons),
    Math.floor(Date.now() / 1000)
  );

  db.close();

  return {
    safeToProduce,
    originalityScore,
    riskLevel,
    reasons,
    geminiFeedback: geminiResult.feedback,
    breakdown: {
      geminiScore: geminiResult.score,
      similarityToWinners,
      nicheNoveltyScore: nicheNovelty,
    },
  };
}

/**
 * Quick cache lookup (no async)
 */
export function getOriginality(niche: string, title: string): SlopCheckResult | null {
  const db = getDb();
  const conceptHash = hashConcept(title, '');

  const result = db
    .prepare(`SELECT * FROM originality_checks WHERE concept_hash = ? AND niche = ?`)
    .get(conceptHash, niche) as any;

  db.close();

  if (!result) return null;

  return {
    safeToProduce: result.safe_to_produce === 1,
    originalityScore: result.originality_score,
    riskLevel: result.originality_score > 70 ? 'LOW' : result.originality_score > 50 ? 'MEDIUM' : 'HIGH',
    reasons: JSON.parse(result.reasons || '[]'),
    geminiFeedback: result.gemini_assessment,
  };
}

export default {
  checkForSlop,
  getOriginality,
};
