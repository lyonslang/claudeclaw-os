# Visual Director — Phase 1B Integration Plan

**Status:** Design complete. Implementation deferred to Phase 2.
**Timeline:** Migration applied during Phase 1B. Data collection starts in Phase 1B test.

---

## What Gets Applied Now vs Phase 2

### Phase 1B (Now)

✅ **Schema created:**
- `visual_feedback` table (empty, waiting for Phase 2 data)
- `visual_references` table (for storing best-practice examples)
- `visual_style_variants` table (for A/B testing in future)

✅ **Documentation:**
- VISUAL_DIRECTOR_PROMPT.md (system prompt, ready to use)
- This document (integration guide)

❌ **NOT implemented:**
- Visual Director agent itself
- Automatic visual analysis
- Higgsfield integration
- Visual recommendation logic

### Phase 2 (After Phase 1B Test)

✅ **Implemented:**
- Visual Director agent (T3, runs after Scriptwriter approves)
- Integration with post-mortem logging (auto-populates visual_feedback)
- Higgsfield cost tracking
- Visual quality baseline (from Phase 1 test data)

---

## Data Flow: Phase 1B → Phase 2

### Phase 1B Test (5-script mission)

**Scriptwriter:**
1. Generates 5 scripts (with emotional beats)
2. Runs anti-slop checks
3. Logs to hive_mind + mission_post_mortem

**Editing Director:**
1. Receives approved scripts
2. Edits videos with basic template
3. Logs B-roll coverage, editing choices
4. **Optionally adds visual feedback** (manual human input):
   - Visual cohesion score (how well does it hang together?)
   - Mood match (does the visual feel right?)
   - Slop risk (is this generic or intentional?)

**Result:** mission_post_mortem + visual_feedback populated with Phase 1 baseline

### Phase 2 (Visual Director Active)

**Visual Director (new):**
1. Receives approved script from Scriptwriter
2. Analyzes emotional beats
3. Queries visual_references for style examples
4. Proposes B-roll concepts + transitions + Higgsfield prompts
5. Logs recommendations to visual_feedback (before production)

**Editing Director → Skinwalker:**
1. Execute Visual Director recommendations
2. Track actual costs, render times
3. Log outcomes to visual_feedback (after production)

**Post-Production:**
1. Video published to YouTube
2. Engagement data (views, comments, retention) flows back
3. Visual Director's recommendations scored against actual performance
4. Confidence scores calibrated based on real data

---

## Phase 1B Test: Manual Visual Feedback

Since Visual Director doesn't exist yet, **you** (human) or **Editing Director** should manually assess during Phase 1B test:

```bash
# After each video is produced, log visual feedback:
sqlite3 $PROJECT_ROOT/store/claudeclaw.db << 'EOF'
INSERT INTO visual_feedback (
  mission_id, video_id, script_section,
  emotional_beat, beat_duration_seconds, mood_description,
  visual_cohesion_score, mood_match_score, slop_risk_level,
  human_feedback, approved
) VALUES (
  'mission_5scripts_001', 'video_xyz_001', 'intro_hook',
  'intrigue', 5, 'dark, asymmetrical, slow zoom',
  85, 88, 'low',
  'Strong opening. Color grade feels cohesive. Higgsfield results were clean.',
  TRUE
);
EOF
```

**What to assess:**
- Does the visual match the script's emotional intent? (mood_match_score)
- Does it feel cohesive with the rest of the video? (visual_cohesion_score)
- Is it generic/slop or intentional/on-brand? (slop_risk_level)

---

## Why This Matters for Phase 2

**Phase 1B collects baseline data:**
- Which emotional beats are easiest to visualize (low slop risk)
- Which transitions feel natural in this niche (mystery comedy)
- What Higgsfield cost you should budget
- What visual style drives engagement (if available from YouTube data)

**Phase 2 implementation uses this data:**
- Visual Director won't guess. It will say: "Based on Phase 1 data, mystery beats worked best with [X] style."
- Confidence scores will reflect actual sample sizes, not guesses
- Cost estimates will be calibrated to your actual infrastructure costs

---

## Integration Checklist

### Before Phase 1B Test:

- [ ] Apply migration: `migrations/005-visual-feedback.sql`
- [ ] Verify tables created: `visual_feedback`, `visual_references`, `visual_style_variants`
- [ ] Add VISUAL_DIRECTOR_PROMPT.md to agent reference library
- [ ] Brief Editing Director on manual visual feedback logging (template above)

### During Phase 1B Test (5-script mission):

- [ ] Each video: After editing, log visual feedback (script section, emotional beat, quality scores)
- [ ] Track: Higgsfield costs, editing time, quality assessment
- [ ] Collect: YouTube engagement data (once published) and correlate with visual choices

### After Phase 1B Test:

- [ ] Query visual_quality_baseline view (see what worked)
- [ ] Analyze visual_director_effectiveness (ready for Phase 2)
- [ ] Document: Which visual styles + transitions performed best
- [ ] Use data to calibrate Phase 2 Visual Director confidence scores

---

## SQL Queries for Phase 1B Analysis

### What visual styles got the highest cohesion scores?

```sql
SELECT
  visual_references.name,
  COUNT(*) as usage_count,
  ROUND(AVG(vf.visual_cohesion_score), 1) as avg_cohesion,
  ROUND(AVG(vf.engagement_contribution), 2) as avg_engagement
FROM visual_feedback vf
JOIN visual_references vr ON vf.mood_description LIKE '%' || vr.description || '%'
WHERE vf.confidence_sample_size >= 2
GROUP BY visual_references.name
ORDER BY avg_cohesion DESC;
```

### Which emotional beats had the lowest slop risk?

```sql
SELECT
  emotional_beat,
  COUNT(*) as samples,
  SUM(CASE WHEN slop_risk_level = 'low' THEN 1 ELSE 0 END) as low_risk,
  ROUND(SUM(CASE WHEN slop_risk_level = 'low' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as low_risk_percent
FROM visual_feedback
WHERE confidence_sample_size >= 2
GROUP BY emotional_beat
ORDER BY low_risk_percent DESC;
```

### Higgsfield cost accuracy (are estimates realistic)?

```sql
SELECT
  ROUND(AVG(b_roll_cost_estimate), 2) as avg_estimated_cost,
  ROUND(AVG(actual_higgsfield_cost), 2) as avg_actual_cost,
  ROUND(AVG(ABS(b_roll_cost_estimate - actual_higgsfield_cost)), 2) as avg_error,
  COUNT(*) as samples
FROM visual_feedback
WHERE actual_higgsfield_cost IS NOT NULL;
```

---

## Notes for Phase 2 Implementation

1. **Confidence Calibration:** Once Phase 1 data exists, Visual Director's confidence scores will be based on:
   - Sample size (more videos = higher confidence, up to max 100%)
   - Historical accuracy (how often were recommendations approved?)
   - Engagement correlation (did the visual style predict engagement?)

2. **Reference Library Growth:** Each Phase 2 video adds to `visual_references`, creating a growing library of "what worked in this niche."

3. **Learning Loop:**
   - Visual Director suggests → Editing Director executes → YouTube data validates → confidence scores update
   - This creates a feedback loop that improves over time

4. **No Embeddings Yet:** Phase 1B uses metadata + heuristics. Visual similarity search (via embeddings) deferred to Phase 3.

---

## Files Involved

- **VISUAL_DIRECTOR_PROMPT.md** — System prompt (ready to copy into agent definition)
- **migrations/005-visual-feedback.sql** — Schema (apply during Phase 1B)
- **VISUAL_DIRECTOR_INTEGRATION.md** — This file (integration guide)
- **MISSION_POST_MORTEM_GUIDE.md** — How post-mortem logging works (visual_feedback is extension)

---

## Status Summary

| Item | Phase 1B | Phase 2 |
|------|----------|---------|
| Prompt designed | ✅ | ✅ (use as-is) |
| Schema created | ✅ | ✅ (queries use it) |
| Agent implemented | ❌ | ✅ |
| Data collected | Manual | Automatic |
| Confidence scores | N/A | Calibrated to Phase 1 data |
| Cost tracking | Basic | Real (Higgsfield + render) |
| Learning loop | Manual | Automated |

Phase 1B is data collection. Phase 2 is where the agent learns from that data.
