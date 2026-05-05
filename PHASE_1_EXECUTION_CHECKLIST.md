# Phase 1: Mitigate Orchestration Risk — Execution Checklist

**Date:** May 5, 2026
**Scope:** Implement Grok's recommended fixes (autonomy rules, guardrails, post-mortem logging)
**Estimated time:** 2–3 hours of setup + validation

---

## Documents Created (Reference)

- ✅ `GROK_ORCHESTRATION_REVIEW.md` — Grok's assessment
- ✅ `GROK_CONCERNS_ASSESSMENT.md` — Detailed mapping of concerns to solutions
- ✅ `AGENT_AUTONOMY_RULES.md` — Decision trees for each agent
- ✅ `MISSION_POST_MORTEM_GUIDE.md` — How to log and interpret data
- ✅ `migrations/004-mission-post-mortem.sql` — Schema for mission_post_mortem table
- ⬜ Everything else (will be created/modified below)

---

## Phase 1A: Database & Schema (30 min)

**Objective:** Set up post-mortem logging infrastructure

### 1A.1: Apply migration
```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" < "$PROJECT_ROOT/migrations/004-mission-post-mortem.sql"
```

**Verification:**
```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" ".tables" | grep mission_post_mortem
# Output should include: mission_post_mortem friction_log
```

### 1A.2: Add artifact_summary column to hive_mind (for context discipline)

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" << 'EOF'
ALTER TABLE hive_mind ADD COLUMN artifact_summary TEXT;
-- Makes existing rows compatible (NULL for old rows, fine)
EOF
```

**Verification:**
```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "PRAGMA table_info(hive_mind);" | grep artifact_summary
```

### 1A.3: Add god_s_eye_brief_cache table (for invocation guardrails)

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" << 'EOF'
CREATE TABLE IF NOT EXISTS god_s_eye_brief_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  niche TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  brief JSON NOT NULL,
  cost_usd REAL,
  created_at INTEGER,
  expires_at INTEGER,
  access_count INTEGER DEFAULT 1,
  UNIQUE(niche, channel_id)
);

CREATE INDEX idx_god_s_eye_cache_expires ON god_s_eye_brief_cache(expires_at);
EOF
```

**Status:** ✅ Database layer ready

---

## Phase 1B: Agent Prompt Updates (45 min)

**Objective:** Teach agents the autonomy rules

### 1B.1: Update Scriptwriter prompt

Find the current Scriptwriter system prompt (likely in `agents/content/CLAUDE.md` or agent config).

**Add this section to the prompt:**

```
## Autonomy Rules (REQUIRED READING)

You have explicit authority to make decisions without escalating to Ava.
See AGENT_AUTONOMY_RULES.md for full decision trees.

QUICK RULES:
- Slop score >= 70%: Generate script autonomously
- Slop score 50–69%: Generate + flag, escalate for Ava decision
- Slop score < 50%: Reject automatically (do NOT generate)
- Always query god_s_eye_brief_cache before calling God's Eye (cost $0 vs $0.50)
- Log every decision to hive_mind (status: approved_for_production, flagged_medium_risk, or rejected_high_slop)

ESCALATION TEMPLATE (when needed):
"Escalating to Ava: [reason]. Risk score: [X]%. Options: [option A], [option B]. Awaiting decision."

DO NOT overthink. If the rule is clear, execute it. Only escalate if ambiguous.
```

### 1B.2: Update Editing Director prompt

**Add this section:**

```
## Autonomy Rules

QUICK RULES:
- B-roll coverage >= 70%: Edit autonomously with standard template
- B-roll coverage < 70%: Escalate to Ava (creative strategy decision)
- Always prefer cached briefs (query hive_mind for God's Eye brief instead of calling directly)
- Log to hive_mind: b_roll_coverage, template_applied, cost

ESCALATION TEMPLATE:
"Escalating to Ava: B-roll gap detected ([X]% coverage). Visual strategy needed. Options: [A], [B]. Awaiting decision."
```

### 1B.3: Update Skinwalker prompt

**Add this section:**

```
## Autonomy Rules

QUICK RULES:
- Avatar selection: Use same avatar per channel precedent (query hive_mind)
- If no precedent: Escalate to Ava (brand consistency decision)
- Render failure: Log error, escalate to Ava (retry budget decision)
- All other decisions: Autonomous

ESCALATION TEMPLATE:
"Escalating to Ava: [decision needed]. Options: [A], [B]. Awaiting approval."
```

### 1B.4: Create god_s_eye_check function (used by all agents)

This goes in shared agent utilities. Pseudo-code:

```typescript
async function queryGodSEyeBriefCache(niche: string, channelId: string) {
  // Before calling God's Eye, check cache
  const cached = await db.queryOne(`
    SELECT brief, expires_at FROM god_s_eye_brief_cache
    WHERE niche = ? AND channel_id = ?
  `, [niche, channelId]);

  if (cached && cached.expires_at > now()) {
    // Cache hit
    db.execute(`UPDATE god_s_eye_brief_cache SET access_count = access_count + 1`);
    return { brief: cached.brief, source: 'cache', cost: 0 };
  }

  // Cache miss or expired — only Scriptwriter calls God's Eye
  if (agentId !== 'content') {
    return { error: 'Only Scriptwriter invokes God\'s Eye. Query hive_mind instead.' };
  }

  // Call God's Eye (expensive)
  const result = await godsEye.analyze(niche, channelId);

  // Store in cache (7-day TTL)
  db.execute(`
    INSERT OR REPLACE INTO god_s_eye_brief_cache
    (niche, channel_id, brief, cost_usd, created_at, expires_at)
    VALUES (?, ?, ?, 0.50, ?, ?)
  `, [niche, channelId, JSON.stringify(result.brief), now(), now() + 7 * 86400]);

  return { brief: result.brief, source: 'api', cost: 0.50 };
}
```

**Status:** ✅ Agent prompts updated with autonomy rules

---

## Phase 1C: Mission Logging Integration (45 min)

**Objective:** Agents automatically log post-mortem data after each mission

### 1C.1: Create mission-logger utility

File: `src/utils/mission-logger.ts`

```typescript
export async function logMissionPostMortem(data: {
  missionId: string;
  agentId: string;
  missionTitle: string;
  startedAt: number;
  completedAt: number;
  godSEyeCallsTotal: number;
  godSEyeCallsCached: number;
  godSEyeCallsApi: number;
  godSEyeCost: number;
  antiSlopChecksTotal: number;
  antiSlopRejections: number;
  antiSlopFlags: number;
  totalCostUsd: number;
  peakContextTokens: number;
  averageContextTokens: number;
  autonomousDecisionsMade: number;
  escalationsToAva: number;
  escalationsAccepted: number;
  escalationsRejected: number;
  numOutputsProduced: number;
  outputsApprovedFirstPass: number;
  outputsRejectedTotal: number;
  frictionPoints: any[]; // JSON
  loopDetections: any[]; // JSON
  expectedCost: number;
  expectedDurationSeconds: number;
  status: 'completed' | 'failed' | 'incomplete';
  summary: string;
}) {
  const db = await getDb();
  db.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.missionId, data.agentId, data.missionTitle,
    data.startedAt, data.completedAt,
    data.godSEyeCallsTotal, data.godSEyeCallsCached, data.godSEyeCallsApi, data.godSEyeCost,
    data.antiSlopChecksTotal, data.antiSlopRejections, data.antiSlopFlags,
    data.totalCostUsd,
    data.peakContextTokens, data.averageContextTokens,
    data.autonomousDecisionsMade, data.escalationsToAva, data.escalationsAccepted, data.escalationsRejected,
    data.numOutputsProduced, data.outputsApprovedFirstPass, data.outputsRejectedTotal,
    JSON.stringify(data.frictionPoints), JSON.stringify(data.loopDetections),
    data.expectedCost, data.expectedDurationSeconds,
    data.status, data.summary
  );
}
```

### 1C.2: Call from each agent's mission handler

**In Scriptwriter's completion handler:**
```typescript
await logMissionPostMortem({
  missionId: mission.id,
  agentId: 'content',
  missionTitle: mission.title,
  startedAt: mission.created_at,
  completedAt: Date.now(),
  godSEyeCallsTotal: metrics.godSEyeCallCount,
  godSEyeCallsCached: metrics.godSEyeCachedCount,
  godSEyeCallsApi: metrics.godSEyeApiCount,
  godSEyeCost: metrics.godSEyeCost,
  antiSlopChecksTotal: metrics.slopCheckCount,
  antiSlopRejections: metrics.slopRejectCount,
  antiSlopFlags: metrics.slopFlagCount,
  totalCostUsd: metrics.totalCost,
  peakContextTokens: metrics.peakContextSize,
  averageContextTokens: metrics.avgContextSize,
  autonomousDecisionsMade: metrics.autonomousCount,
  escalationsToAva: metrics.escalationCount,
  escalationsAccepted: metrics.escalationAcceptedCount,
  escalationsRejected: metrics.escalationRejectedCount,
  numOutputsProduced: metrics.outputCount,
  outputsApprovedFirstPass: metrics.approvedFirstPass,
  outputsRejectedTotal: metrics.rejectedCount,
  frictionPoints: metrics.frictionLog,
  loopDetections: metrics.loopDetections,
  expectedCost: 5.75,
  expectedDurationSeconds: 120,
  status: 'completed',
  summary: `Generated ${metrics.outputCount} scripts, ${metrics.slopFlagCount} flagged, 0 rejected.`
});
```

Repeat for Editing Director and Skinwalker.

**Status:** ✅ Post-mortem logging integrated

---

## Phase 1D: Test & Validate (30 min)

### 1D.1: Run 5-script test mission

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
node "$PROJECT_ROOT/dist/mission-cli.js" create \
  --agent main \
  --title "Test: 5 comedy scripts (post-mortem validation)" \
  "Generate 5 scripts for 'mystery comedy' niche using God's Eye brief. Expected: 1 God's Eye call (cached 4x), ~\$5.75 cost, <120s duration, 0 escalations."
```

**Wait for mission to complete.**

### 1D.2: Query post-mortem

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" << 'EOF'
SELECT
  mission_id,
  total_cost_usd,
  duration_seconds,
  god_s_eye_calls_total,
  god_s_eye_calls_cached,
  god_s_eye_calls_api,
  escalations_to_ava,
  anti_slop_rejections,
  anti_slop_flags,
  peak_context_tokens,
  cost_variance_percent,
  duration_variance_percent,
  summary
FROM mission_post_mortem
WHERE mission_id LIKE '%post_mortem_validation%'
ORDER BY created_at DESC LIMIT 1;
EOF
```

### 1D.3: Validate against expectations

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| Total cost | $5.75 ± 10% | ? | ✓ or ⚠️ |
| Duration | 120s ± 20% | ? | ✓ or ⚠️ |
| God's Eye calls | 1 API + 4 cached | ? | ✓ or ⚠️ |
| Escalations | 0 | ? | ✓ or ⚠️ |
| Peak context | < 40k tokens | ? | ✓ or ⚠️ |

**If all ✓:** Design validated. Grok's concerns mitigated. Ready for Phase 2.

**If any ⚠️:** Post-mortem data tells you why. Use it to refine rules. Log friction_points for debugging.

---

## Phase 1E: Documentation & Handoff (15 min)

### 1E.1: Create PHASE_1_RESULTS.md

After 1D.3, document:
- What we tested
- What we learned
- What assumptions held up
- What needs refinement

### 1E.2: Summarize for Ava's new agents

Make sure all new agents (if any added) read:
1. AGENT_AUTONOMY_RULES.md (mandatory)
2. MISSION_POST_MORTEM_GUIDE.md (reference)

### 1E.3: Update CLAUDE.md

Add standing order:
> Agents: Log post-mortem after every mission. The data is used to validate design and optimize systems. No exceptions.

---

## Success Criteria (Phase 1 Complete)

- ✅ Migration applied, all new tables created
- ✅ Agent prompts updated with autonomy rules
- ✅ Post-mortem logging integrated
- ✅ 5-script test mission run and logged
- ✅ Actual metrics within ±15% of predictions (or friction points explain why)
- ✅ Escalation rate <= 15% (agents acting autonomously)
- ✅ God's Eye cache hit rate >= 75%
- ✅ Peak context <= 50k tokens
- ✅ Documentation complete

---

## Timeline

| Phase | Task | Duration | Owner |
|-------|------|----------|-------|
| 1A | DB setup | 30 min | Ava |
| 1B | Agent prompts | 45 min | Ava + agents |
| 1C | Logging integration | 45 min | Ava |
| 1D | Test & validate | 30 min | Ava + mission |
| 1E | Docs & handoff | 15 min | Ava |
| **Total** | | **2h 45m** | |

---

## Next: Phase 2 (If Phase 1 Succeeds)

Once Phase 1 is validated, Phase 2 will:
- Scale to 3+ niches
- Run longer missions (10+ scripts)
- Measure cumulative cost + latency
- Validate autonomy rules hold under load
- Begin collecting performance data for real learning

---

## Quick Links

- Autonomy rules: `AGENT_AUTONOMY_RULES.md`
- Post-mortem interpretation: `MISSION_POST_MORTEM_GUIDE.md`
- Grok's assessment: `GROK_ORCHESTRATION_REVIEW.md`
- Full concern analysis: `GROK_CONCERNS_ASSESSMENT.md`
