# Mission Logger Integration Guide

**Status:** Ready to use (Phase 1B)
**Location:** `src/utils/mission-logger.ts`
**Purpose:** Log detailed mission metrics to `mission_post_mortem` table for post-mortem analysis

---

## Quick Start

### Simple Mission (one-liner)

```typescript
import { logSimpleMission } from './utils/mission-logger.js';

// After mission completes:
logSimpleMission(
  'mission_5scripts_001',      // missionId
  'content',                    // agentId
  'Generate 5 comedy scripts',  // title
  5.75,                         // totalCostUsd
  120,                          // durationSeconds
  'completed',                  // status
  'Generated 5 scripts, 1 flagged (medium risk).'
);
```

### Complex Mission (builder pattern)

```typescript
import { MissionMetricsBuilder } from './utils/mission-logger.js';

const metrics = new MissionMetricsBuilder(
  'mission_5scripts_001',
  'content',
  'Generate 5 comedy scripts'
)
  .setTiming(startTime, endTime)
  .setGodSEyeMetrics(5, 4, 1, 0.50)        // total, cached, api, cost
  .setAntiSlopMetrics(5, 0, 0, 1)          // total, cached, rejections, flags
  .setCost(5.85)
  .setContextMetrics(38200, 35400)
  .setDecisionMetrics(5, 0, 0, 0)          // autonomous, escalations, accepted, rejected
  .setOutputMetrics(5, 4, 0, 0)            // produced, approved, rejected, revisions
  .addFrictionPoint('anti_slop_check', 'Gemini latency spike', 4)
  .setExpectations(5.75, 120)
  .setStatus('completed', 'Generated 5 scripts. 80% cache hit on God\'s Eye.')
  .log();
```

---

## Integration Pattern (Per Agent)

### In Content Agent (Scriptwriter)

After script generation mission completes, in your mission completion handler:

```typescript
import { MissionMetricsBuilder } from '../utils/mission-logger.js';

async function completeMission(missionId: string, missionTitle: string) {
  const startTime = Math.floor(Date.now() / 1000);

  // ... do work (generate scripts, run anti-slop, etc.) ...

  // Track metrics during execution
  let godSEyeCalls = 0, godSEyeCached = 0, godSEyeApi = 0, godSEyeCost = 0;
  let antiSlopChecks = 0, antiSlopRejections = 0, antiSlopFlags = 0;
  let autonomousDecisions = 0, escalations = 0;
  let scriptsGenerated = 0, scriptsApproved = 0, scriptRejected = 0;

  // When calling God's Eye:
  const cacheResult = await queryGodSEyeBriefCache(niche, channelId, 'content');
  if (cacheResult.source === 'cache') {
    godSEyeCached++;
  } else {
    godSEyeApi++;
    godSEyeCost += 0.50;
  }
  godSEyeCalls++;

  // When checking slop:
  const slopCheck = await checkForSlop(niche, title, script);
  antiSlopChecks++;
  if (slopCheck.safeToProduce === false && slopCheck.originalityScore < 50) {
    antiSlopRejections++;
  } else if (slopCheck.originalityScore >= 50 && slopCheck.originalityScore < 70) {
    antiSlopFlags++;
  }

  // When making autonomous decisions vs escalating:
  if (slopCheck.riskLevel === 'low') {
    autonomousDecisions++; // approved script autonomously
    scriptsApproved++;
  } else if (slopCheck.riskLevel === 'medium') {
    escalations++; // escalated to Ava
  } else {
    scriptRejected++; // rejected autonomously
  }

  // At the end, log post-mortem:
  const endTime = Math.floor(Date.now() / 1000);
  const totalCost = godSEyeCost + (antiSlopChecks * 0.10) + (scriptsApproved * 0.75);

  new MissionMetricsBuilder(missionId, 'content', missionTitle)
    .setTiming(startTime, endTime)
    .setGodSEyeMetrics(godSEyeCalls, godSEyeCached, godSEyeApi, godSEyeCost)
    .setAntiSlopMetrics(antiSlopChecks, 0, antiSlopRejections, antiSlopFlags)
    .setCost(totalCost)
    .setContextMetrics(peakTokens, avgTokens)
    .setDecisionMetrics(autonomousDecisions, escalations, escalationsAccepted, escalationsRejected)
    .setOutputMetrics(scriptsGenerated, scriptsApproved, scriptRejected, revisionRounds)
    .addFrictionPoint('anti_slop_check', 'Gemini latency', resolutionTime)
    .setExpectations(5.75, 120)
    .setStatus('completed', `Generated ${scriptsGenerated} scripts, ${antiSlopFlags} flagged.`)
    .log();
}
```

### In Editing Director Agent

```typescript
// Track B-roll coverage, editing time, etc.
const bRollCoverage = computeCoverage(editedVideo);
const editingCost = 0.30;
const numOutputs = 1; // one edited video

new MissionMetricsBuilder(missionId, 'editing', 'Edit video')
  .setTiming(startTime, endTime)
  .setCost(editingCost)
  .setOutputMetrics(numOutputs, bRollCoverage >= 70 ? 1 : 0, 0, 0)
  .addFrictionPoint('b_roll_search', `Coverage only ${bRollCoverage}%`, timeSpent)
  .setStatus('completed', `Edited with ${bRollCoverage}% B-roll coverage.`)
  .log();
```

### In Skinwalker Agent

```typescript
// Track avatar render, voice synthesis, etc.
const renderTime = endTime - renderStartTime;
const voiceCost = 0.03;
const renderCost = 0.80;
const totalCost = voiceCost + renderCost;

new MissionMetricsBuilder(missionId, 'ops', 'Render final video')
  .setTiming(startTime, endTime)
  .setCost(totalCost)
  .setContextMetrics(contextTokens, avgContextTokens)
  .setOutputMetrics(1, 1, 0, 0) // 1 video produced, 1 approved, 0 rejected
  .addFrictionPoint('avatar_render', 'GPU latency spike', 45)
  .setExpectations(0.90, 85)
  .setStatus('completed', 'Video rendered and ready for upload.')
  .log();
```

---

## Metrics Tracking (What to Collect)

### During Mission Execution

Track these **in real-time** as you work:

| Metric | Where to Count | Example |
|--------|---|---|
| `godSEyeCallsTotal` | Every time you call God's Eye API | 1, 2, 3... |
| `godSEyeCallsCached` | Increment when cache hit occurs | +1 for each cache reuse |
| `godSEyeCallsApi` | Increment when API call made | +1 for each API hit |
| `godSEyeCost` | Sum of all API costs | 0.50 per call |
| `antiSlopChecksTotal` | Every concept/script checked | 5 scripts = 5 checks |
| `antiSlopRejections` | Count of < 50% slop scores | 1, 2, etc. |
| `antiSlopFlags` | Count of 50-69% slop scores | 1, 2, etc. |
| `autonomousDecisionsMade` | Decisions without escalating | 4 scripts approved autonomously |
| `escalationsToAva` | Times you escalated | 1, 2, etc. |
| `numOutputsProduced` | Scripts, videos, etc. created | 5 scripts |
| `outputsApprovedFirstPass` | Approved on first submission | 4 of 5 |
| `outputsRejectedTotal` | Total rejected (across revisions) | 0 or 1 |
| `revisionRoundsTotal` | Revisions across entire mission | 2 rounds of revision |

### At Mission End

Calculate once:

```typescript
const startTime = 1714982400;      // Unix timestamp when mission started
const endTime = 1714982520;        // Unix timestamp when mission ended
const durationSeconds = endTime - startTime; // = 120

// Context window (if available)
const peakContextTokens = 38200;   // Highest context used in any turn
const avgContextTokens = 35400;    // Average across all turns
```

---

## Example: Full 5-Script Test

```typescript
import { MissionMetricsBuilder } from './utils/mission-logger.js';

async function runFiveScriptTest() {
  const missionId = 'test_5scripts_phase1b_001';
  const startTime = Math.floor(Date.now() / 1000);

  // Mission: Generate 5 scripts for mystery_comedy niche
  // Expected: 1 God's Eye call (cached 4x), 0 escalations, ~$5.75 cost

  const results = [];
  let totalCost = 0;
  let godSEyeCalls = 0, godSEyeCached = 0;

  for (let i = 0; i < 5; i++) {
    // SCRIPT 1: Query cache, hit, reuse brief (cost $0)
    // SCRIPT 2-5: Query cache, all hit, reuse brief (cost $0 each)
    const cacheResult = await queryGodSEyeBriefCache('mystery_comedy', channelId, 'content');
    godSEyeCalls++;
    godSEyeCached++;

    // Generate script, check slop, approve autonomously
    const script = generateScript(cacheResult.brief);
    const slop = await checkForSlop('mystery_comedy', script.title, script);
    totalCost += 0.75; // scriptwriter cost
    totalCost += 0.10; // anti-slop check cost

    results.push({ approved: slop.safeToProduce });
  }

  // One call to God's Eye (first script), 4 cache hits
  totalCost += 0.50; // God's Eye API cost

  const endTime = Math.floor(Date.now() / 1000);

  // Log complete post-mortem
  new MissionMetricsBuilder(missionId, 'main', 'Test: Generate 5 comedy scripts')
    .setTiming(startTime, endTime)
    .setGodSEyeMetrics(5, 4, 1, 0.50)
    .setAntiSlopMetrics(5, 0, 0, 0)  // All passed
    .setCost(totalCost)              // Should be ~$5.75
    .setContextMetrics(38200, 35400)
    .setDecisionMetrics(5, 0, 0, 0)  // 5 autonomous, 0 escalations
    .setOutputMetrics(5, 5, 0, 0)    // 5 produced, 5 approved
    .setExpectations(5.75, 120)
    .setStatus('completed', 'Generated 5 scripts. Cache hit rate: 80%.')
    .log();

  console.log('✅ Post-mortem logged. Ready to query results.');
}
```

---

## Querying Post-Mortem Data (After Test)

After running the 5-script test, query the results:

```bash
# View the post-mortem for this mission
sqlite3 $PROJECT_ROOT/store/claudeclaw.db << 'EOF'
SELECT
  mission_id, total_cost_usd, duration_seconds,
  god_s_eye_calls_total, god_s_eye_calls_cached,
  anti_slop_rejections, anti_slop_flags,
  escalations_to_ava, cost_variance_percent
FROM mission_post_mortem
WHERE mission_id = 'test_5scripts_phase1b_001';
EOF
```

Expected output:
```
mission_id | cost_usd | duration_s | god_eye_total | cached | rejections | flags | escalations | variance
-----------|----------|------------|---|---|---|---|---|---
test_...   | 5.85     | 118        | 5 | 4 | 0 | 0 | 0        | +1.7%
```

---

## Troubleshooting

### "Failed to log post-mortem: INSERT failed"

**Cause:** Column name mismatch or data type issue

**Fix:** Verify:
1. `mission_post_mortem` table exists: `sqlite3 $DB ".tables" | grep mission_post_mortem`
2. All columns exist: `sqlite3 $DB "PRAGMA table_info(mission_post_mortem);"`
3. Data types match (especially `status` enum check)

### "No such table: mission_post_mortem"

**Cause:** Migration 004 not applied

**Fix:**
```bash
sqlite3 $PROJECT_ROOT/store/claudeclaw.db < migrations/004-mission-post-mortem.sql
```

### Post-mortem logged but data looks wrong

**Debug:** Log the metrics object before calling `.log()`:

```typescript
const metrics = new MissionMetricsBuilder(...)
  .setTiming(start, end)
  .setCost(5.75)
  // ...
  .build();

console.log('DEBUG: metrics =', JSON.stringify(metrics, null, 2));
metrics.log();
```

---

## Status

✅ **Phase 1B ready** — All infrastructure in place
⏳ **Phase 1B test** — Run 5-script mission with full logging
✅ **Phase 2** — Use post-mortem data to calibrate Visual Director + Skinwalker
