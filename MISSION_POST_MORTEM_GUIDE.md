# Mission Post-Mortem Logging & Interpretation Guide

**Date:** May 5, 2026
**Purpose:** Turn operational assumptions into validated data
**Grok's insight:** "Post-mortem data will be more valuable than assumptions"

---

## Why This Matters

We made predictions in TIER_ROUTING_GUIDE and ARCHITECTURE:
- "70% load reduction for Ava"
- "24h caching cuts costs in half"
- "$1.15 per script (actual cost)"
- "<2 minutes per 5-script mission"

Without real data, these are guesses. Post-mortem logging proves or disproves them.

---

## What Gets Logged (mission_post_mortem table)

Every mission automatically logs:

| Field | What It Tells You | Example |
|-------|------------------|---------|
| `god_s_eye_calls_total` | How many times agents invoked God's Eye | 5 (bad) vs 1 (good) |
| `god_s_eye_calls_cached` | How many reused cached briefs | 4 of 5 = 80% cache hit |
| `god_s_eye_cost` | Actual API spend | $0.50 or $2.50? |
| `anti_slop_checks_total` | How many slop checks ran | 5 scripts = 5 checks |
| `anti_slop_rejections` | High-risk rejections (< 50% score) | 0 (healthy) or 3 (problems) |
| `anti_slop_flags` | Medium-risk flags (50–69%) | 1–2 is normal |
| `autonomous_decisions_made` | Decisions agents made without Ava | Should be 90%+ |
| `escalations_to_ava` | Times agents needed Ava | Should be <10% |
| `peak_context_tokens` | Biggest context window during mission | Want < 50k |
| `cost_variance_percent` | (actual - predicted) / predicted | 0% = prediction was perfect |
| `duration_variance_percent` | Same for time | 0% = timeline was perfect |
| `friction_points` | JSON list of "stuck here" moments | Identifies bottlenecks |

---

## How to Log a Mission

After Skinwalker returns the final video (or mission fails), call:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" << 'EOF'
INSERT INTO mission_post_mortem (
  mission_id, agent_id, mission_title,
  started_at, completed_at,
  god_s_eye_calls_total, god_s_eye_calls_cached, god_s_eye_calls_api, god_s_eye_cost,
  anti_slop_checks_total, anti_slop_rejections, anti_slop_flags,
  total_cost_usd,
  peak_context_tokens, average_context_tokens,
  autonomous_decisions_made, escalations_to_ava, escalations_accepted, escalations_rejected,
  num_outputs_produced, outputs_approved_first_pass, outputs_rejected_total,
  friction_points, loop_detections,
  expected_cost, expected_duration_seconds,
  status, summary
) VALUES (
  'mission_xyz_123', 'main', 'Generate 5 comedy scripts',
  1714982400, 1714982520,
  1, 4, 1, 0.50,
  5, 0, 1,
  5.85,
  38200, 35400,
  5, 0, 0, 0,
  5, 4, 0,
  '[{"stage": "anti_slop_check", "issue": "Gemini latency spike", "resolution_time_s": 4}]',
  '[]',
  5.75, 120,
  'completed', 'Generated 5 scripts, 1 flagged (medium risk). 80% God''s Eye cache hit.'
);
EOF
```

**Alternatively:** Agents can log this programmatically (recommended for automation).

---

## Interpreting the Data — Key Metrics

### 1. Caching Effectiveness

**Query:**
```sql
SELECT
  agent_id,
  SUM(god_s_eye_calls_cached) as cached_calls,
  SUM(god_s_eye_calls_api) as api_calls,
  ROUND(SUM(god_s_eye_calls_cached) * 100.0 / SUM(god_s_eye_calls_total), 1) as cache_hit_rate_percent
FROM mission_post_mortem
WHERE status = 'completed'
GROUP BY agent_id;
```

**Good results:**
- `cache_hit_rate_percent` >= 75% (most calls reuse)
- Trend: cache hit rate increases over time (agents learning)

**Bad results:**
- `cache_hit_rate_percent` < 50% (too many API calls)
- Agents not checking cache before invoking God's Eye
- Action: Review AGENT_AUTONOMY_RULES.md, update agent prompts

---

### 2. Cost Prediction Accuracy

**Query:**
```sql
SELECT
  agent_id,
  COUNT(*) as completed_missions,
  ROUND(AVG(total_cost_usd), 2) as avg_actual_cost,
  ROUND(AVG(expected_cost), 2) as avg_predicted_cost,
  ROUND(AVG(cost_variance_percent), 1) as avg_variance_percent
FROM mission_post_mortem
WHERE status = 'completed'
GROUP BY agent_id;
```

**Good results:**
- `avg_variance_percent` between -10% and +10% (predictions accurate)
- Positive variance means missions cost less than expected (efficiency gains)

**Bad results:**
- `avg_variance_percent` > +30% (consistently over budget)
- God's Eye being invoked more than predicted
- Action: Check caching, review escalation patterns

**Example interpretation:**
```
agent_id | avg_actual | avg_predicted | variance
---------|-----------|-------------|----------
main     | $5.82     | $5.75       | +1.2%    ✓ Good
content  | $6.50     | $5.75       | +13.0%   ⚠️ Investigate
```

The content agent is $0.75 over budget per mission. Likely cause: too many God's Eye calls or extra revisions. Check friction_points and escalations.

---

### 3. Autonomy & Escalation Rate

**Query:**
```sql
SELECT
  agent_id,
  COUNT(*) as missions,
  SUM(autonomous_decisions_made) as total_autonomous,
  SUM(escalations_to_ava) as total_escalations,
  ROUND(SUM(escalations_to_ava) * 100.0 / COUNT(*), 1) as escalation_rate_percent,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_missions
FROM mission_post_mortem
GROUP BY agent_id;
```

**Good results:**
- `escalation_rate_percent` between 5–15% (only escalate when needed)
- All escalations accepted by Ava (agents are making good judgment calls)

**Bad results:**
- `escalation_rate_percent` > 30% (agents over-cautious, Ava bottleneck)
- Action: Re-train agents with AGENT_AUTONOMY_RULES.md, clarify thresholds

**Example:**
```
agent_id | escalation_rate_percent | escalations_accepted
---------|------------------------|---------------------
main     | 8%                      | 8 of 10 (80% accepted) ✓
content  | 35%                     | 20 of 30 (67% accepted) ⚠️ Over-escalating
```

Content agent is escalating too much. Issue: agents are unsure about slop score thresholds. Action: Review anti_slop_flags vs rejections (are they calling correctly?).

---

### 4. Context Window Efficiency

**Query:**
```sql
SELECT
  mission_id,
  peak_context_tokens,
  ROUND(peak_context_tokens * 100.0 / 1000000, 1) as peak_context_percent
FROM mission_post_mortem
WHERE status = 'completed'
ORDER BY peak_context_tokens DESC
LIMIT 10;
```

**Good results:**
- All missions under 50,000 tokens (5% of 1M context)
- Trending downward (agents getting more efficient)

**Bad results:**
- Some missions hitting 200k+ tokens (20% of context)
- Ava's context bloating (she's carrying too much mission state)
- Action: Check artifact_summary logging, implement query limits

---

### 5. Friction Points (Finding Bottlenecks)

**Query:**
```sql
SELECT
  stage,
  COUNT(*) as occurrences,
  ROUND(AVG(resolution_time_seconds), 1) as avg_resolution_time_s
FROM friction_log
GROUP BY stage
ORDER BY occurrences DESC;
```

**Output might look like:**
```
stage                   | occurrences | avg_resolution_time_s
------------------------|-------------|---------------------
anti_slop_check         | 8           | 3.2    (Gemini latency)
skinwalker_render       | 5           | 15.1   (GPU contention)
scriptwriter_generation | 2           | 0.8    (rare issue)
```

**Interpretation:**
- Anti-slop is the bottleneck (8 occurrences, 3.2s each)
- Could be Gemini API latency or network
- Action: Implement client-side timeout, try caching heuristics instead of live API

---

## The 5-Script Test Mission

After implementing AGENT_AUTONOMY_RULES.md, run this test:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
node "$PROJECT_ROOT/dist/mission-cli.js" create \
  --agent main \
  --title "Test: Generate 5 comedy scripts (post-mortem validation)" \
  "Generate 5 scripts for the 'mystery comedy' niche. Log detailed post-mortem. Expected: ~$5.75 cost, <120s duration, 0 escalations, 1 God's Eye call (cached for 4 others)."
```

**Expected post-mortem:**
```
mission_id: test_5scripts_123
total_cost_usd: $5.75 ± 10%
duration_seconds: 120 ± 20%
god_s_eye_calls_total: 5
god_s_eye_calls_cached: 4
god_s_eye_calls_api: 1
escalations_to_ava: 0
anti_slop_rejections: 0
anti_slop_flags: 0 (ideal) or 1–2 (acceptable)
peak_context_tokens: <40k
status: completed
```

**If results match expectations:** Design assumptions validated. Proceed to scale.

**If results differ:** Post-mortem data tells you exactly why. Update predictions and rules.

---

## Dashboard: Mission Performance View

Add this to the web dashboard:

```
MISSION PERFORMANCE SUMMARY (last 7 days)
─────────────────────────────────────────

Total missions: 23
Avg cost per mission: $5.87 (predicted: $5.75) [+2.1% variance]
Avg duration: 118s (predicted: 120s) [-1.7% variance] ✓

God's Eye API Efficiency:
  Total calls: 47
  Cache hits: 41 (87.2%) ✓
  API calls: 6
  Cost: $3.00

Escalation Rate: 9.5% (target: 5–15%) ✓

Context Window:
  Peak: 38,201 tokens (3.8% of 1M)
  Trend: ↓ (improving)

Friction Points (top 3):
  1. anti_slop_check latency (avg 3.2s) — investigate Gemini
  2. skinwalker_render timeout (2 occurrences) — GPU memory issue
  3. editing_director B-roll gap (1 occurrence) — good recovery
```

---

## Validation Timeline

**Week 1:** Establish baseline (10–15 missions logged, all stages working)
**Week 2:** Validate cost predictions (should converge to ±5% accuracy)
**Week 3:** Validate autonomy rules (should see escalation rate stabilize at 5–15%)
**Week 4:** Optimize (use friction points to fix bottlenecks)

---

## Next Steps

1. Run migration: `sqlite3 $(git rev-parse --show-toplevel)/store/claudeclaw.db < $(git rev-parse --show-toplevel)/migrations/004-mission-post-mortem.sql`
2. Integrate post-mortem logging into agents (add 10 lines to each agent's completion handler)
3. Run 5-script test mission
4. Compare actual vs expected
5. If good: document learnings, proceed to next phase
6. If bad: use post-mortem data to refine rules and try again
