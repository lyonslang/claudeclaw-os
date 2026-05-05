/**
 * gods-eye-orchestrator.ts
 * Orchestrates the God's Eye → Scriptwriter → Anti-slop flow
 *
 * Pipeline:
 * 1. God's Eye analyzes niche + generates brief
 * 2. Scriptwriter uses brief to generate script
 * 3. Anti-slop checks script for originality
 * 4. Returns script with slop assessment and approval status
 */

import Database from 'better-sqlite3';
import path from 'path';
import { checkForSlop } from './anti-slop.js';

function getDb() {
  return new Database(path.join(process.cwd(), 'store', 'claudeclaw.db'));
}

interface GodsEyeBrief {
  niche: string;
  channel_id: string;
  hook_analysis: {
    score: number;
    strengths: string[];
    weaknesses: string[];
    recommended_hook: string;
  };
  emotional_arc: {
    opening: string;
    middle: string;
    peak: string;
    close: string;
    missing_beats: string[];
  };
  top_patterns: string[];
  competitor_gaps: string[];
  recommendations: string[];
}

interface ScriptwriterOutput {
  script: string;
  title: string;
  emotional_beats: string;
  hook_strength: number;
}

interface GodEyeFullOutput {
  brief: GodsEyeBrief;
  script: ScriptwriterOutput;
  slopCheck: {
    safeToProduce: boolean;
    originalityScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasons: string[];
    approved: boolean;
  };
  status: 'approved' | 'flagged' | 'rejected';
  nextStep: string;
}

/**
 * Orchestrate full pipeline: God's Eye → Scriptwriter → Anti-slop
 * This is the gatekeeper for content production
 */
export async function orchestrateContentGeneration(
  niche: string,
  channelId: string,
  analysisContext?: string
): Promise<GodEyeFullOutput> {
  const db = getDb();

  // Step 1: Get God's Eye brief (retrieve from recent analysis)
  const briefData = db
    .prepare(`
      SELECT * FROM youtube_insights
      WHERE niche = ? AND channel_id = ?
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(niche, channelId) as any;

  if (!briefData) {
    throw new Error(`No God's Eye analysis found for ${niche} / ${channelId}`);
  }

  const brief: GodsEyeBrief = {
    niche,
    channel_id: channelId,
    hook_analysis: JSON.parse(briefData.top_hooks || '{}'),
    emotional_arc: JSON.parse(briefData.emotional_themes || '{}'),
    top_patterns: JSON.parse(briefData.patterns || '[]'),
    competitor_gaps: briefData.recommendations ? JSON.parse(briefData.recommendations) : [],
    recommendations: JSON.parse(briefData.recommendations || '[]'),
  };

  // Step 2: Scriptwriter generates script from brief
  // (This is where Scriptwriter agent would be called)
  // For now, we'll expect the script to be passed in or generated via the brief
  const scriptTitle = brief.hook_analysis?.recommended_hook || 'Untitled';
  const scriptContent = `
[SCRIPT PLACEHOLDER - Generated from God's Eye brief]

Hook: ${brief.hook_analysis?.recommended_hook}
Emotional Arc: ${brief.emotional_arc?.opening} → ${brief.emotional_arc?.peak}
Patterns: ${brief.top_patterns.join(', ')}
`;

  const scriptOutput: ScriptwriterOutput = {
    script: scriptContent,
    title: scriptTitle,
    emotional_beats: brief.emotional_arc?.opening || 'unknown',
    hook_strength: brief.hook_analysis?.score || 7,
  };

  // Step 3: Anti-slop gate check before production
  const slopCheck = await checkForSlop(niche, scriptTitle, scriptContent);

  // Log to hive_mind
  const logEntry = {
    niche,
    brief_summary: `Hook: ${brief.hook_analysis?.recommended_hook}`,
    script_title: scriptTitle,
    slop_check: {
      originalityScore: slopCheck.originalityScore,
      riskLevel: slopCheck.riskLevel,
      safeToProduce: slopCheck.safeToProduce,
    },
    status: slopCheck.safeToProduce ? 'approved' : 'flagged',
  };

  db.prepare(`
    INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, niche, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'god-s-eye',
    '8259766109',
    'content_generation_complete',
    `Generated script for ${niche}: "${scriptTitle}" (originality ${slopCheck.originalityScore}%)`,
    JSON.stringify(logEntry),
    niche,
    Math.floor(Date.now() / 1000)
  );

  db.close();

  // Determine output status
  let status: 'approved' | 'flagged' | 'rejected' = 'approved';
  let nextStep = 'Ready for production';

  if (slopCheck.riskLevel === 'HIGH') {
    status = 'rejected';
    nextStep = 'Script fails originality check. Return to God\'s Eye for new brief.';
  } else if (slopCheck.riskLevel === 'MEDIUM') {
    status = 'flagged';
    nextStep = `Script has moderate risk (${slopCheck.originalityScore}% original). Review reasons and decide whether to proceed.`;
  }

  return {
    brief,
    script: scriptOutput,
    slopCheck: {
      ...slopCheck,
      approved: status === 'approved',
    },
    status,
    nextStep,
  };
}

/**
 * Scriptwriter helper: takes a brief and generates a script
 * This is called by the Scriptwriter agent
 */
export function generateScriptFromBrief(brief: GodsEyeBrief): ScriptwriterOutput {
  const title = brief.hook_analysis?.recommended_hook || 'Untitled';
  const hook = brief.hook_analysis?.recommended_hook || 'Hook missing';
  const patterns = brief.top_patterns.join(' • ');

  const script = `
TITLE: ${title}

HOOK (0:00-0:15):
${hook}

SETUP (0:15-1:00):
- Establish context from patterns: ${patterns}
- Build emotional arc: ${brief.emotional_arc?.opening}

BODY (1:00-${brief.recommendations.length > 3 ? '2:30' : '2:00'}):
${brief.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}

PEAK (${brief.recommendations.length > 3 ? '2:30' : '2:00'}-${brief.recommendations.length > 3 ? '3:15' : '2:45'}):
- Deliver emotional peak: ${brief.emotional_arc?.peak}
- Capitalize on: ${brief.competitor_gaps[0] || 'unique angle'}

CLOSE (${brief.recommendations.length > 3 ? '3:15' : '2:45'}-${brief.recommendations.length > 3 ? '3:45' : '3:00'}):
- Emotional resolution: ${brief.emotional_arc?.close}
- Call to action

---
Notes:
- Avoid: ${brief.hook_analysis?.weaknesses.join(', ') || 'none identified'}
- Include: ${brief.hook_analysis?.strengths.join(', ') || 'hook strength'}
`;

  return {
    script,
    title,
    emotional_beats: brief.emotional_arc?.opening,
    hook_strength: brief.hook_analysis?.score || 7,
  };
}

/**
 * Get production readiness status for a script
 */
export function getProductionStatus(slopCheck: any): {
  canProduce: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  blockers: string[];
  recommendations: string[];
} {
  const blockers: string[] = [];
  const recommendations: string[] = [];

  if (slopCheck.originalityScore < 50) {
    blockers.push('Originality score too low (<50%). Concept is too derivative.');
  }

  if (slopCheck.riskLevel === 'HIGH') {
    blockers.push(`${slopCheck.reasons.join(' ')} — concept fails originality gate.`);
  }

  if (slopCheck.riskLevel === 'MEDIUM') {
    recommendations.push(`Originality is moderate (${slopCheck.originalityScore}%). Review before production.`);
    slopCheck.reasons.forEach((r: string) => recommendations.push(`Consider: ${r}`));
  }

  return {
    canProduce: blockers.length === 0,
    riskLevel: slopCheck.riskLevel,
    blockers,
    recommendations,
  };
}

export default {
  orchestrateContentGeneration,
  generateScriptFromBrief,
  getProductionStatus,
};
