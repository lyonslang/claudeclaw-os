# God's Eye Complete Workflow — With Anti-Slop Gating

**Updated:** May 5, 2026
**Status:** Ready for testing

---

## Full Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: GOD'S EYE ANALYSIS                                  │
│ Reads: YouTube channel data, top videos, comments           │
│ Outputs: Brief with hook/emotion/pattern/gap analysis       │
│ Cost: T3 (Sonnet) ~$0.50                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ STEP 2: SCRIPTWRITER GENERATES DRAFT                        │
│ Takes: God's Eye brief                                      │
│ Generates: Full script with emotional arc, hooks, pacing    │
│ Cost: T3 (Sonnet) ~$0.75                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ STEP 3: ANTI-SLOP GATEKEEPER (NEW)                          │
│ Checks: Originality vs your past videos + niche trends      │
│ Scoring: 40% Gemini + 35% similarity + 25% novelty          │
│ Output: Originality score + risk level (LOW/MEDIUM/HIGH)    │
│ Cost: T3 (Gemini) ~$0.10                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
    ┌──────────────────┴──────────────────┐
    │                                     │
    ▼                                     ▼
APPROVED (Score ≥50)                  REJECTED (Score <50)
✅ Safe to produce                   ❌ Too derivative
   ↓                                    ↓
Ready for Editing Director         Return to Step 1
& Skinwalker (video gen)           Request new brief

TOTAL COST: ~$1.35 per script
TIME: ~4-6 seconds
```

---

## API Usage

### Scenario 1: New Content Idea

**You:** "Generate a script for comedy niche, channel ID xyz"

**System:**
1. God's Eye pulls recent analysis from DB (or runs fresh)
2. Extracts brief: hooks, patterns, gaps, recommendations
3. Scriptwriter generates script from brief
4. Anti-slop checks script: originality score + risk level
5. Returns:

```json
{
  "status": "approved|flagged|rejected",
  "script": "...",
  "title": "The Mystery Nobody Knew About X",
  "slopCheck": {
    "originalityScore": 72,
    "riskLevel": "LOW",
    "safeToProduce": true,
    "reasons": [],
    "breakdown": {
      "geminiScore": 75,
      "similarityToWinners": 45,
      "nicheNoveltyScore": 65
    }
  },
  "nextStep": "Ready for production. Proceed to Editing Director."
}
```

**If flagged (MEDIUM risk):**
```json
{
  "status": "flagged",
  "reasons": [
    "72% similar to your top performers (audience fatigue risk)",
    "Hook type used in last 3 videos"
  ],
  "recommendation": "Consider modifying hook or waiting 2 weeks before production"
}
```

**If rejected (HIGH risk):**
```json
{
  "status": "rejected",
  "reasons": [
    "Too similar to your top performers (89% overlap)",
    "Hook format is heavily overdone in comedy niche"
  ],
  "nextStep": "Return to God's Eye for new brief with different hook angle"
}
```

---

## Integration Points

### For God's Eye Skill
When running full analysis, always include anti-slop gate:

```typescript
// In God's Eye orchestration
const brief = await godEyeAnalyze(niche, channelId);
const script = await scriptwriterGenerate(brief);
const slopCheck = await checkForSlop(niche, script.title, script.content);

if (!slopCheck.safeToProduce) {
  return { brief, script, slopCheck, status: 'rejected', nextStep: 'Revise brief' };
}
```

### For Scriptwriter Agent
Before finalizing script:

```typescript
// In Scriptwriter finalization
const slopResult = await checkForSlop(niche, title, script);
if (slopResult.safeToProduce) {
  return { script, approval: 'ready' };
} else {
  return { script, approval: 'review_needed', reasons: slopResult.reasons };
}
```

### For Mission Control
When delegating script generation:

```
MISSION: Generate approved script for comedy niche

TIER ROUTING:
- T1: Query God's Eye insights
- T3: Run God's Eye analysis + Scriptwriter + Anti-slop check
- Output: Script with slop assessment

GATING:
Scripts with originality < 50% are auto-rejected.
Scripts with originality 50-70% flagged for manual review.
Scripts with originality > 70% approved for production.
```

---

## Confidence Levels

| Score | Risk | Action |
|-------|------|--------|
| 80-100 | LOW | ✅ Produce immediately |
| 60-79 | MEDIUM | ⚠️ Review reasons, can proceed with caution |
| 50-59 | MEDIUM | ⚠️ Consider modifying or waiting |
| <50 | HIGH | ❌ Reject, request new brief |

---

## Cost Tracking

Every generation logs to hive_mind:

```sql
INSERT INTO hive_mind VALUES (
  'god-s-eye',
  'content_generation_complete',
  'Generated script for comedy: "Title" (originality 72%)',
  {
    "niche": "comedy",
    "originality": 72,
    "risk": "LOW",
    "approved": true,
    "cost_usd": 1.35
  }
);
```

---

## Testing Checklist

- [ ] Run God's Eye analysis on Fried Plantain channel
- [ ] Generate test script using Scriptwriter brief
- [ ] Run anti-slop check on script
- [ ] Verify: approved script has score >70, flagged <70, rejected <50
- [ ] Check hive_mind logs for accuracy
- [ ] Test on 3-5 different concepts before shipping

---

## Future Enhancements

- [ ] Integrate real Gemini API calls (currently placeholder)
- [ ] Track recommendation success rates (self-learning feedback loop)
- [ ] Add competitor analysis alongside originality checks
- [ ] Implement recency decay (older concepts weight less)
- [ ] Add style fingerprinting after 30+ videos collected
