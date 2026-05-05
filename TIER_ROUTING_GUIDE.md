# Tier Routing Guide — Gods Eye System

**Owner:** Ava (orchestrator)
**Last updated:** May 5, 2026
**Purpose:** Enforce consistent model selection (Haiku/Sonnet/Opus) across all agent tasks and function calls.

---

## Tier System Overview

| Tier | Model | Cost | Use Case |
|------|-------|------|----------|
| **T1** | Haiku | ~$0.08/M input | Data queries, DB ops, simple lookups |
| **T2** | Haiku → Sonnet | ~$0.04-3.00/M | Pattern matching, basic analysis (escalate on fail) |
| **T3** | Sonnet | ~$3.00/M input | Reasoning, emotional analysis, Gemini coordination |
| **T4** | Sonnet/Opus | ~$3-15/M input | Orchestration, final decisions, multi-agent synthesis |

---

## Function Tier Routing

### T1 (Haiku) — Data & Logic Only

These functions should ALWAYS be called with Haiku. They involve no reasoning.

```typescript
// Query functions
queryHiveMind(options)
queryInsights(niche, limit)
getTopRecommendations(niche, limit)
getValidatedRecommendations(niche, minConfidence)
getEarlyStageRecommendations(niche)
getNicheMedianPerformance(niche)

// DB updates (no reasoning)
createRecommendation(niche, technique, description, initialConfidence)
recordRecommendationUsage(recommendationId, videoId)
recordVideoOutcome(outcome)
measureRecommendationOutcome(recommendationId, videoId, aboveMedianPerformance)
```

**When to call:** Before/during agent reasoning (fast context gathering)

---

### T2 (Haiku, escalate to Sonnet on failure)

Pattern matching that can fail on novel data. Start with Haiku, escalate if needed.

```typescript
// Hook/pattern analysis (may need reasoning if novel)
analyzeHookPatterns(videoData)
identifyCommentThemes(comments)
detectViewVelocity(videoHistory)
```

**When to call:** During analysis phase when patterns are familiar

---

### T3 (Sonnet) — Reasoning & Analysis

These require reasoning, creativity, or external API coordination (Gemini).

```typescript
// Emotional beat analysis
runEmotionalBeatAnalysis(script, niche)
scoreHookStrength(title, firstSeconds)
identifyMissingBeats(script, topPerformers)

// Anti-slop checks
checkForSlop(niche, title, scriptOrConcept)

// Scriptwriter operations
generateScript(brief, niche)
refineScriptBasedOnFeedback(script, feedback)

// Editing director operations
generateEditingBrief(script, visualAnalysis)
recommendThumbnailStrategy(script, niche)
```

**When to call:** During creative/analysis phases where reasoning matters

---

### T4 (Sonnet/Opus) — Orchestration & Final Decisions

Full multi-agent synthesis, strategy decisions, high-stakes reviews.

```typescript
// God's Eye orchestration
runGodEyeFullAnalysis(niche, channels)
synthesizeCompetitorInsights(competitorData)
generateChannelStrategy(channelAnalysis)

// Final content approvals (high-stakes)
finalizeContentBeforeLaunch(script, metadata, riskLevel)
decideBetweenCompetingStrategies(option1, option2)
```

**When to call:** Final decisions, strategy synthesis, or when lower tiers hit complexity ceiling

---

## Mission Delegation Template

When I (Ava) delegate work to agents, I include explicit tier routing:

```
MISSION TO [AGENT] — [PRIORITY]
═════════════════════════════════

TASK: [What the agent needs to do]

TIER ROUTING REQUIREMENTS:
─────────────────────────
• Data gathering (T1/Haiku):
  - Call queryHiveMind(niche='comedy')
  - Call getTopRecommendations('comedy')
  - Cost: ~$0.01

• Analysis (T3/Sonnet):
  - Run runEmotionalBeatAnalysis(script)
  - Call checkForSlop('comedy', title, script)
  - Cost: ~$0.50

• Final decision (T4/Sonnet):
  - Approve script based on slop check + analysis
  - Log to hive_mind

TOTAL ESTIMATED COST: ~$0.60 per mission
BUDGET LIMIT: $5.00 per day for test missions

OUTPUT FORMAT:
──────────────
Return JSON with:
  - script: "<final approved script>"
  - analysis: { hookScore, originalityScore, riskLevel }
  - decision: "<why approved or rejected>"
  - logEntry: "<what to save to hive_mind>"
```

---

## Hive Mind Logging

Every mission logs which tiers were used:

```sql
INSERT INTO hive_mind (agent_id, action, summary, artifacts, niche, created_at)
VALUES (
  'scriptwriter',
  'script_generation',
  'Generated 200-word script for mystery format in comedy niche',
  JSON({
    tiers_used: ['T1', 'T3'],
    functions_called: ['queryHiveMind', 'getTopRecommendations', 'runEmotionalBeatAnalysis', 'checkForSlop'],
    tokens_used: { input: 4200, output: 1100 },
    cost_usd: 0.62,
    slop_check: { originalityScore: 73, safeToProduce: true }
  }),
  'comedy',
  strftime('%s','now')
);
```

This way I can:
- Track cost per agent per day
- Audit which functions are called most
- Detect tier misrouting (e.g., T3 function called by Haiku-only agent)
- Optimize routing based on actual usage

---

## Cost Budgets (Daily)

| Agent | T1 Budget | T3 Budget | T4 Budget | Total |
|-------|-----------|-----------|-----------|-------|
| Scriptwriter | $0.50 | $2.00 | $0.50 | $3.00 |
| Editing Director | $0.30 | $1.50 | $0.20 | $2.00 |
| God's Eye | $1.00 | $3.00 | $2.00 | $6.00 |
| Anti-slop checks | $0.00 | $1.00 | $0.00 | $1.00 |
| **TOTAL** | — | — | — | **$12.00/day** |

---

## Mission Control Integration

Mission Control dashboard should auto-select model based on tier:

```typescript
// In mission creation:
const missionTiers = extractTiersFromTask(missionPrompt);
// e.g., ['T1', 'T3'] → use Haiku for T1 ops, Sonnet for T3

// Submit to agent with model instructions:
mission.modelRoutingInstructions = {
  defaultModel: missionTiers.includes('T4') ? 'opus' : 'sonnet',
  dataQueryModel: 'haiku',
  escapeHatchModel: 'opus'  // if lower tier fails
};
```

Currently this is manual. Should be automated.

---

## Escalation Rules

If a function fails or hits complexity ceiling:

1. **Haiku fails** → Escalate to Sonnet (T2 → T3)
2. **Sonnet hits wall** → Escalate to Opus (T3 → T4)
3. **Log the escalation** to hive_mind with reason

Example:
```
❌ Haiku failed: "Script analysis too complex for available context"
↓
✅ Escalating to Sonnet...
↓
✅ Sonnet completed in 2s, cost $0.18
↓
📝 Logged to hive_mind: escalation_count += 1
```

---

## Quick Reference

**Starting a new task? Ask:**

1. Does it query data? → T1/Haiku
2. Does it involve reasoning/creativity? → T3/Sonnet
3. Is it a high-stakes decision? → T4/Opus
4. Is it unknown? → Start with T1, escalate if needed

**Documenting for agents:**

Always include `@tier` comments in function definitions:

```typescript
/**
 * Get top recommendations for a niche
 * @tier T1 — pure DB query, use Haiku
 * @cost ~$0.01 per call
 */
export function getTopRecommendations(niche: string): Recommendation[]
```

---

## TODO: Mission Control Updates

- [ ] Auto-detect tier from mission prompt
- [ ] Enforce tier budgets per agent
- [ ] Escalation logic (Haiku → Sonnet → Opus)
- [ ] Cost tracking per function call
- [ ] Dashboard widget: "Today's tier usage" pie chart
