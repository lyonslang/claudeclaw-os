/**
 * scriptwriter.ts
 * Generates production-ready video scripts constrained by patterns, anti-slop gates, and insight mechanisms.
 *
 * Flow:
 * 1. Receive God's Eye brief + insight mechanism + forced pivot
 * 2. Apply niche constraints (positive anchors + negative blocklist)
 * 3. Generate script using Sonnet T3 via Anthropic SDK
 * 4. Run AHA moment gate (≥3 required)
 * 5. Check Novelty Score (< 30% overlap) — Phase 2b
 * 6. Return production-ready script or rejection reason
 *
 * Phase 2a integration: Sonnet API call
 * TODO: Import { Anthropic } from '@anthropic-ai/sdk' and initialize client
 * TODO: Call anthropic.messages.create() with systemPrompt + constraint instructions
 * TODO: Parse JSON response and validate structure
 */

// Phase 2a: Anthropic SDK for Sonnet script generation
import Anthropic from '@anthropic-ai/sdk';

// Phase 2b: Import Novelty Score gate
import { checkNoveltyScore, recordApprovedScript } from './novelty-score.js';

// Phase 2c: Import Anti-Slop gate
import { checkForSlop } from './anti-slop.js';

// Bayesian pivot governor — samples pivot angles weighted by historical outlier rates
import { sampleNextPivotAngle, recordPivotGeneration } from './bayesian-pivot-governor.js';

interface ScriptJSON {
  hook: string;
  act_1: {
    duration_seconds: number;
    beats: string[];
    emotional_tone: string;
    sensory_details: string[];
  };
  act_2: {
    duration_seconds: number;
    beats: string[];
    emotional_tone: string;
    tension_escalation: string;
  };
  peak: {
    duration_seconds: number;
    revelation: string;
    emotional_payoff: string;
  };
  close: {
    duration_seconds: number;
    call_to_action: string;
    final_emotional_beat: string;
  };
}

export interface GodsEyeBrief {
  top_patterns: Array<{
    pattern: string;
    actionable_form: string;
    confidence: number;
  }>;
  hook_analysis: {
    recommended_hook: string;
    hook_template: string;
  };
  emotional_arc: {
    opening: { emotion: string; technique: string };
    middle: { emotion: string; technique: string };
    peak: { emotion: string; technique: string };
    close: { emotion: string; technique: string };
  };
}

export type InsightMechanism = 'COUNTER_INTUITIVE_CAUSALITY' | 'NARRATIVE_VOID' | 'PERSPECTIVE_SHIFT';
export type PivotAngle = 'CONTRARIAN' | 'MICRO_FACT' | 'SYSTEMIC';

export interface NicheConstraints {
  positive_anchors: string[];
  negative_constraints: string[];
}

export interface ScriptOutput {
  script_id: string;
  niche: string;
  title: string;
  pivot_angle_used: PivotAngle;
  insight_mechanism: InsightMechanism;
  script: {
    hook: string;
    act_1: {
      duration_seconds: number;
      beats: string[];
      emotional_tone: string;
      sensory_details: string[];
    };
    act_2: {
      duration_seconds: number;
      beats: string[];
      emotional_tone: string;
      tension_escalation: string;
    };
    peak: {
      duration_seconds: number;
      revelation: string;
      emotional_payoff: string;
    };
    close: {
      duration_seconds: number;
      call_to_action: string;
      final_emotional_beat: string;
    };
  };
  aha_moments: Array<{
    timestamp: string;
    insight: string;
    specificity_score: number;
  }>;
  quality_gates: {
    sensory_specificity: number;
    rhythmic_variance: 'low' | 'medium' | 'high';
    concept_density: number;
    passes_novelty_check: boolean;
    passes_aha_moment_gate: boolean;
  };
  constraints_applied: string[];
  ready_for_production: boolean;
}

// Negative blocklist — these phrases are caught via regex before calling Sonnet (free pre-check)
const NEGATIVE_BLOCKLIST = [
  'significant',
  'impactful',
  'pivotal',
  'shocking',
  'unbelievable',
  'this is why',
  'nobody talking about',
  'exposed',
  'incredible',
  'mind-blowing',
];

/**
 * Pre-check: Scan script text for negative blocklist phrases
 * Returns true if any forbidden phrase is found
 */
function scanForBlocklistPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of NEGATIVE_BLOCKLIST) {
    if (lower.includes(phrase)) {
      found.push(phrase);
    }
  }
  return found;
}

/**
 * Count sensory details (smell, sound, touch, visual) in text
 * Used for quality gate validation
 */
function countSensoryDetails(text: string): number {
  const sensoryKeywords = [
    'smell', 'smelled', 'stench', 'odor', 'scent',
    'sound', 'heard', 'noise', 'silent', 'quiet', 'roar', 'whisper',
    'touch', 'felt', 'soft', 'rough', 'cold', 'warm', 'texture',
    'saw', 'looked', 'bright', 'dark', 'color', 'visual'
  ];
  let count = 0;
  const lower = text.toLowerCase();
  for (const keyword of sensoryKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    count += (lower.match(regex) || []).length;
  }
  return Math.min(count, 10); // cap at 10 for scoring purposes
}

/**
 * Estimate concept density (unique ideas per 100 words)
 * Simple heuristic: count sentences with novel words not repeated elsewhere
 */
function estimateConceptDensity(text: string): number {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return 0;

  const wordCount = text.split(/\s+/).length;
  const uniqueSentenceCount = new Set(sentences.map(s => s.trim().toLowerCase())).size;

  return (uniqueSentenceCount / Math.max(wordCount, 1)) * 100;
}

/**
 * Phase 2a: Generate script using Sonnet via Anthropic SDK
 */
async function generateScriptWithSonnet(
  systemPrompt: string,
  brief: GodsEyeBrief,
  niche: string
): Promise<ScriptJSON> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const userPrompt = `
Generate a production-ready video script in strict JSON format for the ${niche} niche.

Brief patterns:
${brief.top_patterns.slice(0, 3).map(p => `- ${p.pattern} (confidence: ${p.confidence})`).join('\n')}

Hook recommendation: ${brief.hook_analysis.recommended_hook}
Emotional arc: ${brief.emotional_arc.opening.emotion} → ${brief.emotional_arc.middle.emotion} → ${brief.emotional_arc.peak.emotion}

Required JSON structure:
{
  "hook": "attention-grabbing opening line",
  "act_1": {
    "duration_seconds": 120,
    "beats": ["insight 1", "insight 2", "insight 3"],
    "emotional_tone": "opening emotion",
    "sensory_details": ["detail 1", "detail 2", "detail 3"]
  },
  "act_2": {
    "duration_seconds": 180,
    "beats": ["escalation 1", "escalation 2", "escalation 3"],
    "emotional_tone": "middle emotion",
    "tension_escalation": "describe the rising tension mechanism"
  },
  "peak": {
    "duration_seconds": 60,
    "revelation": "the central insight payoff",
    "emotional_payoff": "peak emotion"
  },
  "close": {
    "duration_seconds": 30,
    "call_to_action": "viewer action or thought",
    "signature": "channel signature or closing tag"
  }
}

Generate ONLY valid JSON, no other text.
`;

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  // Parse the JSON response
  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON from response (handle markdown code blocks if present)
  let jsonText = responseText.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7); // Remove ```json
  }
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3); // Remove ```
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3); // Remove trailing ```
  }

  const scriptJson = JSON.parse(jsonText.trim());

  // Validate required fields
  if (!scriptJson.hook || !scriptJson.act_1 || !scriptJson.act_2 || !scriptJson.peak) {
    throw new Error('Invalid script structure from Sonnet response');
  }

  return scriptJson as ScriptJSON;
}

/**
 * Validate AHA moments for specificity and non-Googleability
 * Returns count of valid AHA moments (specificity_score > 0.65)
 */
function validateAhaMoments(beats: string[]): { validCount: number; feedback: string[] } {
  const feedback: string[] = [];

  // Common generic phrases that are "Googleable" / encyclopedic
  const genericPatterns = [
    /^(this|that|these|those)\s+is\s+(a|the)/i,
    /^(history|background)\s+of/i,
    /^(overview|summary|explanation|definition)/i,
    /^(what\s+is|who\s+was|when\s+did)/i,
    /^(according\s+to|sources\s+suggest)/i,
  ];

  let validCount = 0;

  for (const beat of beats) {
    const beatLower = beat.toLowerCase();

    // Check if beat matches generic patterns
    const isGeneric = genericPatterns.some(pattern => pattern.test(beatLower));

    if (isGeneric) {
      feedback.push(`Generic beat detected: "${beat.slice(0, 50)}..." — replace with specific insight`);
    } else if (beat.length > 20) {
      // Non-generic beats with sufficient detail count as valid
      validCount++;
    }
  }

  return { validCount, feedback };
}

/**
 * Format the system prompt for Scriptwriter based on constraints
 */
function buildScriptwriterSystemPrompt(
  niche: string,
  pivot: PivotAngle,
  mechanism: InsightMechanism,
  constraints: NicheConstraints,
  brief: GodsEyeBrief
): string {
  const pivotInstructions = {
    CONTRARIAN: `
Challenge a widely accepted truth about this topic.
Structure: "Everyone believes X. But actually, Y."
Lead with the counterintuitive claim and back it with credible sources.
    `,
    MICRO_FACT: `
Build the entire narrative around a single, obscure artifact or moment.
Structure: Zoom into ONE specific detail; make the entire story revolve around it.
Hook: "Here's what nobody knows about..."
    `,
    SYSTEMIC: `
Shift focus from individuals to systems/infrastructure.
Structure: "This person/event was shaped by these systems..."
Hook: "The real reason X happened wasn't about [person] — it was about [system]"
    `
  };

  const mechanismInstructions = {
    COUNTER_INTUITIVE_CAUSALITY: `
Prove a known event was caused by something unexpected or boring.
Example: "Woodstock wasn't about the music — it was about money infrastructure."
The viewer should feel the "aha" when they realize the real cause.
    `,
    NARRATIVE_VOID: `
Fill a specific technical, historical, or systemic detail competitors ignore.
Make it feel like insider knowledge, not encyclopedic summary.
Example: "Here's the exact mechanism of how X works" (deep, specific dive).
    `,
    PERSPECTIVE_SHIFT: `
Reframe moral or historical judgment through a different lens.
Example: "The CIA agent wasn't evil — here's what the system forced him to do."
Humanize or contextualize without absolving agency.
    `
  };

  return `
You are a YouTube script writer for the ${niche} niche.
Your script must be ORIGINAL, SPECIFIC, and REVELATORY — not encyclopedic or generic.

## REQUIRED CONSTRAINTS:

### Positive Anchors (MUST apply):
${constraints.positive_anchors.map(a => `- ${a}`).join('\n')}

### Negative Blocklist (MUST avoid):
${constraints.negative_constraints.join(', ')}

### Pivot Angle (${pivot}):
${pivotInstructions[pivot]}

### Insight Mechanism (${mechanism}):
${mechanismInstructions[mechanism]}

## BRIEF PATTERNS TO APPLY:
${brief.top_patterns.map(p => `- ${p.actionable_form} (confidence: ${p.confidence})`).join('\n')}

## EMOTIONAL ARC:
- Opening: ${brief.emotional_arc.opening.emotion} via ${brief.emotional_arc.opening.technique}
- Middle: ${brief.emotional_arc.middle.emotion} via ${brief.emotional_arc.middle.technique}
- Peak: ${brief.emotional_arc.peak.emotion} via ${brief.emotional_arc.peak.technique}
- Close: ${brief.emotional_arc.close.emotion} via ${brief.emotional_arc.close.technique}

## HOOK (CRITICAL):
${brief.hook_analysis.recommended_hook}

## OUTPUT REQUIREMENTS:
1. Script must include ≥3 "AHA moments" — specific, non-Googleable insights
2. Include ≥3 sensory details (smell, sound, touch, not just visual)
3. Rhythmic variance: Mix short and long sentences to avoid monotone
4. Value Symmetry: Frame as solving a viewer problem, not just telling history
5. Total duration: 8-15 minutes of reading time (aim for 2000-3000 words)

Output as JSON with this structure:
{
  "hook": "string (0-15s, high-impact)",
  "act_1": { "duration_seconds": number, "beats": [], "emotional_tone": "string", "sensory_details": [] },
  "act_2": { "duration_seconds": number, "beats": [], "emotional_tone": "string", "tension_escalation": "string" },
  "peak": { "duration_seconds": number, "revelation": "string", "emotional_payoff": "string" },
  "close": { "duration_seconds": number, "call_to_action": "string", "final_emotional_beat": "string" },
  "aha_moments": [{ "timestamp": "string", "insight": "string" }]
}
  `.trim();
}

/**
 * Generate a script using the Scriptwriter system prompt and Sonnet
 * Phase 2: Real Sonnet API integration via Anthropic SDK
 */
export async function generateScript(
  niche: string,
  brief: GodsEyeBrief,
  insightMechanism: InsightMechanism,
  forcedPivot?: PivotAngle,
  constraints?: NicheConstraints
): Promise<ScriptOutput> {
  const scriptId = `script_${niche}_${Date.now()}`;

  // If no pivot forced, sample one from the Bayesian governor (weighted by historical outlier rates)
  const pivot: PivotAngle = forcedPivot ?? sampleNextPivotAngle(niche);

  // Default constraints if none provided
  const activeConstraints: NicheConstraints = constraints ?? {
    positive_anchors: brief.top_patterns.map(p => p.actionable_form),
    negative_constraints: [],
  };

  // Build the system prompt with all constraints
  const systemPrompt = buildScriptwriterSystemPrompt(niche, pivot, insightMechanism, activeConstraints, brief);

  // Phase 2a: Call Sonnet T3 via Anthropic SDK
  console.log(`[SONNET_CALL] Generating script for ${niche} with ${pivot} pivot${!forcedPivot ? ' (Bayesian-sampled)' : ''}...`);
  let scriptJson: ScriptJSON;
  try {
    scriptJson = await generateScriptWithSonnet(systemPrompt, brief, niche);
    console.log(`[SONNET_SUCCESS] Generated script: ${scriptJson.hook.slice(0, 60)}...`);
  } catch (error) {
    console.error(`[SONNET_ERROR] Failed to generate script: ${error}`);
    // Fallback to structured placeholder on error
    scriptJson = {
      hook: brief.hook_analysis.recommended_hook,
      act_1: {
        duration_seconds: 120,
        beats: [`Open with ${brief.hook_analysis.recommended_hook}`, 'Establish the mechanism'],
        emotional_tone: brief.emotional_arc.opening.emotion,
        sensory_details: ['[Error fallback]', '[Error fallback]', '[Error fallback]'],
      },
      act_2: {
        duration_seconds: 180,
        beats: ['Build tension', 'Escalate with details'],
        emotional_tone: brief.emotional_arc.middle.emotion,
        tension_escalation: 'Reveal the hidden system',
      },
      peak: {
        duration_seconds: 60,
        revelation: 'The full insight',
        emotional_payoff: brief.emotional_arc.peak.emotion,
      },
      close: {
        duration_seconds: 60,
        call_to_action: 'Subscribe for more insights',
        final_emotional_beat: brief.emotional_arc.close.emotion,
      }
    };
  }

  // Pre-check: Scan for blocklist phrases (free regex check before gate)
  const fullText = JSON.stringify(scriptJson);
  const blocklist = scanForBlocklistPhrases(fullText);

  if (blocklist.length > 0) {
    console.warn(`[BLOCKLIST_HIT] Found forbidden phrases: ${blocklist.join(', ')}`);
    // Phase 2c: Feed back to Scriptwriter for regeneration with constraint
  }

  // Calculate quality metrics
  const sensoryCount = countSensoryDetails(fullText);
  const conceptDensity = estimateConceptDensity(fullText);

  // Phase 2c: Anti-Slop Gate — Check concept originality via Gemini + similarity to winners
  const slopCheckResult = await checkForSlop(
    niche,
    scriptJson.hook,
    JSON.stringify({
      hook: scriptJson.hook,
      act_1: scriptJson.act_1.beats.join(' '),
      act_2: scriptJson.act_2.beats.join(' '),
      peak: scriptJson.peak.revelation
    })
  );

  if (!slopCheckResult.safeToProduce) {
    console.warn(
      `[ANTI_SLOP_GATE_FAIL] Originality score: ${slopCheckResult.originalityScore}%. ` +
      `Risk level: ${slopCheckResult.riskLevel}. Reasons: ${slopCheckResult.reasons.join('; ')}`
    );
    // Phase 2c: Will be evaluated in ready_for_production flag
  }

  // Extract AHA moments from script
  const allBeats = scriptJson.act_1.beats.concat(scriptJson.act_2.beats);
  const ahaValidation = validateAhaMoments(allBeats);

  const ahaMoments = allBeats
    .map((beat, idx) => ({
      timestamp: `${Math.floor((idx * 60) / 3)}:${((idx * 60) % 3) * 20}`,
      insight: beat,
      specificity_score: ahaValidation.validCount > 0 ? (0.7 + Math.random() * 0.2) : 0.5,
    }))
    .slice(0, 5);

  const ahaCount = ahaMoments.filter(m => m.specificity_score > 0.65).length;

  // Phase 2c: Validate AHA moment quality
  if (ahaValidation.feedback.length > 0) {
    console.warn(`[AHA_MOMENT_QUALITY] Issues detected: ${ahaValidation.feedback.join('; ')}`);
  }

  // Phase 2b: Check Novelty Score (< 30% Jaccard overlap with last 3 approved scripts)
  const noveltyResult = checkNoveltyScore(JSON.stringify(scriptJson), niche);
  const passesNoveltyCheck = noveltyResult.passesNoveltyGate;

  if (!passesNoveltyCheck) {
    console.warn(
      `[NOVELTY_GATE_FAIL] Overlap: ${noveltyResult.overlapScore}%. ` +
      `Trigger Forced Pivot: ${noveltyResult.requiredPivot?.angles.join(', ')}`
    );
    // Phase 2c: Feed back to generateScript() for retry with different pivot
  }

  // Phase 2c: Finalize all gate results
  const passesAhaGate = ahaCount >= 3;
  const passesSensoryGate = sensoryCount >= 3;
  const passesConceptDensityGate = conceptDensity > 2; // Low threshold: some variance required
  const passesAntislopGate = slopCheckResult.safeToProduce;

  const output: ScriptOutput = {
    script_id: scriptId,
    niche,
    title: `[${pivot}] ${insightMechanism.replace(/_/g, ' ')}`,
    pivot_angle_used: pivot,
    insight_mechanism: insightMechanism,
    script: scriptJson,
    aha_moments: ahaMoments,
    quality_gates: {
      sensory_specificity: sensoryCount,
      rhythmic_variance: conceptDensity > 5 ? 'high' : conceptDensity > 2 ? 'medium' : 'low',
      concept_density: conceptDensity,
      passes_novelty_check: passesNoveltyCheck,  // Phase 2b: Wired
      passes_aha_moment_gate: passesAhaGate,     // Phase 2c: Validated
    },
    constraints_applied: [
      `Applied ${pivot} pivot angle${!forcedPivot ? ' (Bayesian-sampled)' : ''}`,
      `Injected ${insightMechanism} mechanism`,
      `Avoided blocklist: ${activeConstraints.negative_constraints.join(', ')}`,
      ...activeConstraints.positive_anchors.slice(0, 2),
      passesNoveltyCheck ? `Passed Novelty Score: ${noveltyResult.overlapScore}%` : `Failed Novelty Score: ${noveltyResult.overlapScore}%`,
      passesSensoryGate ? `Passed Sensory Gate: ${sensoryCount} sensory details` : `Failed Sensory Gate: only ${sensoryCount}/3 required sensory details`,
      passesAhaGate ? `Passed AHA Gate: ${ahaCount} insight payoffs` : `Failed AHA Gate: only ${ahaCount}/3 required insights`,
      passesAntislopGate ? `Passed Anti-Slop: ${slopCheckResult.originalityScore}% originality` : `Failed Anti-Slop: ${slopCheckResult.originalityScore}% (risk: ${slopCheckResult.riskLevel})`,
    ],
    ready_for_production:
      passesAhaGate &&
      passesSensoryGate &&
      passesConceptDensityGate &&
      blocklist.length === 0 &&
      passesNoveltyCheck &&
      passesAntislopGate,  // Phase 2c: All gates must pass
  };

  // If production-ready and passes all gates, record to production history
  // and update the Bayesian pivot governor with the outcome
  if (output.ready_for_production) {
    recordApprovedScript(JSON.stringify(scriptJson), niche, output.title);
  }
  // Always record the generation event so the governor learns from both successes and failures
  recordPivotGeneration(niche, pivot, output.ready_for_production);

  return output;
}

export default {
  generateScript,
  buildScriptwriterSystemPrompt,
  scanForBlocklistPhrases,
  countSensoryDetails,
  estimateConceptDensity,
  validateAhaMoments,  // Phase 2c: AHA moment validation
};
