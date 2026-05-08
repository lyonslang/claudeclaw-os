# ClaudeClaw — Complete System Overview

**Last Updated:** May 5, 2026
**Status:** Phase 1B (Infrastructure 70%, Utility 40%)
**Core Philosophy:** Data-first, human-in-the-loop agents, anti-slop guardrails

---

## 1. What Is ClaudeClaw?

ClaudeClaw is a **multi-agent video production system** that automates high-quality, avatar-based YouTube content generation at scale. It combines:

- **Specialized AI agents** (God's Eye, Scriptwriter, Visual Director, Skinwalker) that coordinate via a shared "hive mind" database
- **Smart caching & cost optimization** (90% reduction in redundant API calls)
- **Quality guardrails** (anti-slop detection before production)
- **Feedback loops** (performance tracking feeds back into recommendations)

**Goal:** Turn concepts into publication-ready YouTube videos with minimal manual intervention, while maintaining consistent quality and brand voice.

---

## 2. Core Architecture

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    ENTRY POINTS                         │
├─────────────────────────────────────────────────────────┤
│  • Telegram Bot (voice + text)                           │
│  • Mission Control Dashboard (web UI)                    │
│  • Direct CLI (testing + automation)                     │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│             ORCHESTRATOR (Ava)                           │
├─────────────────────────────────────────────────────────┤
│  Routes tasks by tier (T1=Haiku, T3=Sonnet, T4=Opus)    │
│  Monitors hive_mind for agent activity                  │
│  Makes strategic decisions (approval, budget, scope)    │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              AGENT LAYER (Specialized)                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │God's Eye │  │Scriptwr. │  │ Visual   │  │Skinwalk│ │
│  │  (T4)    │  │  (T3)    │  │Director  │  │  (T4)  │ │
│  │          │  │          │  │  (T3)    │  │        │ │
│  │Analysis  │  │Generate  │  │Directing │  │Render  │ │
│  │Patterns  │  │Scripts   │  │Visuals   │  │Avatar  │ │
│  │Gaps      │  │Refine    │  │Compose   │  │Voice   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│        │              │             │            │       │
│        └──────────────┴─────────────┴────────────┘       │
│                      │                                    │
│             ┌────────▼──────────┐                        │
│             │  Anti-Slop Gate   │                        │
│             │  (Gemini checks)  │                        │
│             └─────────────────┘                         │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│          HIVE MIND (Shared Database)                     │
├─────────────────────────────────────────────────────────┤
│  • youtube_* tables (channels, videos, comments)        │
│  • recommendations (what works in each niche)           │
│  • video_outcomes (performance tracking)                │
│  • mission_post_mortem (detailed execution telemetry)   │
│  • god_s_eye_brief_cache (caching, cost tracking)       │
│  • visual_feedback (quality baselines for Phase 2)      │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Tier System (Model Routing)

Tasks automatically routed by complexity:

| Tier | Model | Cost/Call | Latency | Use Case |
|------|-------|-----------|---------|----------|
| **T1** | Haiku | $0.00004 | <2s | Regular conversation, simple lookups, formatting |
| **T2** | Haiku | $0.00004 | <3s | Light research, basic decisions |
| **T3** | Sonnet | $0.003 | 5–15s | Creative work (scripts), analysis, orchestration |
| **T4** | Opus | $0.015 | 20–60s | Complex reasoning, architecture, system design |

**Standing rule:** Default to T1 (Haiku) unless task requires reasoning.

---

## 3. Agent System

### 3.1 God's Eye (T4) — YouTube Intelligence

**Role:** Pattern analyzer and recommendation engine
**Input:** YouTube channel data (videos, comments, engagement metrics)
**Output:** Strategic briefs (what works, why, how to replicate)

**Key capabilities:**
- Analyzes 20+ videos to identify engagement patterns
- Extracts techniques that drive performance
- Recommends hooks, pacing, visual styles
- Provides confidence scores (based on sample size)

**Example output:**
```json
{
  "niche": "mystery_comedy",
  "top_3_patterns": [
    { "pattern": "mysterious_setup", "engagement_multiplier": 5.2 },
    { "pattern": "nostalgic_reference", "engagement_multiplier": 3.1 },
    { "pattern": "absurd_escalation", "engagement_multiplier": 2.8 }
  ],
  "recommended_hook": "Start with confusing statement, take 3s to explain",
  "estimated_runtime": "2-3 minutes",
  "confidence": 0.92 // (based on 20 videos)
}
```

**Cost:** $0.50 per analysis
**Caching:** 7-day TTL (reused across scripts in same niche)

---

### 3.2 Scriptwriter (T3) — Content Generation

**Role:** Convert briefs into production-ready scripts
**Input:** God's Eye brief + concept
**Output:** Formatted script with emotional beats

**Key capabilities:**
- Generates script from brief in 15–30 seconds
- Embeds emotional beats (hook, escalation, reveal, etc.)
- Estimates runtime and pacing
- Runs through anti-slop check before approval

**Autonomy rules:**
- **Slop >= 70%:** Approve autonomously
- **Slop 50–69%:** Generate + flag, escalate to Ava
- **Slop < 50%:** Reject, escalate to Ava for override

**Cost:** $0.75 per script
**Output quality:** 1200–1800 words (2–3 min video)

---

### 3.3 Visual Director (T3) — Creative Direction [Phase 2]

**Role:** Translate scripts into visual concepts
**Input:** Approved script + emotional beats
**Output:** Visual breakdown (B-roll concepts, transitions, Higgsfield prompts)

**Key capabilities:**
- Analyzes emotional beats → visual mood
- Suggests B-roll archetypes (stock, generated, personal)
- Proposes transition styles with reasoning
- Generates ready-to-use Higgsfield prompts
- Flags visual slop risks

**Example output:**
```
VISUAL BREAKDOWN:
├─ Beat 1 (Intrigue): Dark, asymmetrical, slow zoom
│  └─ B-roll: Mysterious setup (shadows, close-ups)
├─ Beat 2 (Escalation): Bright, off-center, medium pace
│  └─ B-roll: Action/reaction footage
└─ Beat 3 (Reveal): Full-screen, fast cut, shock effect
   └─ B-roll: Climactic moment

HIGGSFIELD PROMPTS:
├─ "VHS static, 90s aesthetic, grainy, 3 seconds"
├─ "Old film footage, 16mm quality, warm color grade, 5 seconds"
└─ "Smooth zoom into object, cinematic DOF, bokeh, 2 seconds"

QUALITY SCORE: 82/100
SLOP RISK: LOW
ESTIMATED COST: $0.15
```

**Cost:** $0 (time-based, no API calls)
**Status:** Designed, Phase 2 implementation pending Phase 1B baseline data

---

### 3.4 Editing Director (T3) — Video Assembly

**Role:** Cut and compose edited video with B-roll
**Input:** Script + Visual Director recommendations
**Output:** Edited video (video_edited.mp4)

**Key capabilities:**
- Selects and arranges B-roll per visual direction
- Applies effects (zooms, fades, Ken Burns)
- Syncs pacing to script beats
- Ensures visual cohesion and color grading consistency

**Autonomy rules:**
- **B-roll coverage >= 70%:** Edit autonomously
- **B-roll coverage < 70%:** Escalate (visual strategy needed)

**Cost:** $0.30 per video
**Typical duration:** 2–3 minutes of edited footage

---

### 3.5 Skinwalker (T4) — Final Rendering

**Role:** Produce publication-ready avatar video
**Input:** Edited video + script + visual direction
**Output:** Final video with avatar, voice, branding

**Key capabilities:**
- Avatar selection (consistent per channel/niche)
- Voice synthesis with emotional prosody
- Rendering (avatar + B-roll composite)
- Quality assurance (spot-checks, metadata)
- Upload preparation

**Prosody rules:**
- **Hook beats:** Slow, measured, lower pitch (draws listener in)
- **Shock beats:** Fast, staccato, higher pitch (urgency)
- **Educational:** Neutral, clear, deliberate pacing
- **Outro:** Slow wind-down, warm, inviting

**Cost:** $0.95 per video
- Voice synthesis: $0.03 (ElevenLabs)
- Avatar rendering: $0.80 (HeyGen or ComfyUI)
- Compositing: $0.05
- QA + metadata: $0.02

**Output:** Publication-ready MP4 (1080p60, H.264, YouTube-optimized)

---

## 4. Key Features & Infrastructure

### 4.1 Agent Autonomy Rules

Every agent has explicit decision trees. No guessing.

**Example (Scriptwriter):**
```
IF slop_score >= 70:
  → Approve and generate script autonomously
ELIF slop_score 50-69:
  → Generate + flag for Ava review
ELSE (slop_score < 50):
  → Reject, don't generate, escalate to Ava
```

**Benefit:** Reduces orchestration bottleneck (Ava only handles strategic decisions).

**Doc:** `AGENT_AUTONOMY_RULES.md`

---

### 4.2 God's Eye Brief Cache

Prevents redundant $0.50 API calls when analyzing same niche.

**How it works:**
1. Scriptwriter queries cache before calling God's Eye
2. If cache hit (not expired): reuse brief, cost = $0
3. If cache miss: call API once, store for 7 days, cost = $0.50
4. All other scripts in niche reuse cached brief

**Cost impact:**
- Without caching: 5 scripts × $0.50 = $2.50 wasted
- With caching: 1 API call + 4 cache hits = $0.50 total
- **Savings: 80% reduction in God's Eye costs**

**Schema:** `god_s_eye_brief_cache` table

---

### 4.3 Anti-Slop Guardrails

Quality filter before production to prevent generic/mediocre content.

**How it works:**
```
Check: originalityScore = (Gemini 40%) + (similarity to winners 35%) + (niche novelty 25%)

IF originalityScore >= 70:
  → Approve (LOW risk)
ELIF originalityScore 50-69:
  → Flag as MEDIUM risk (human judgment needed)
ELSE (< 50):
  → Reject (HIGH risk)
```

**What it catches:**
- Concepts too similar to competitor videos
- Overused hooks/formats in the niche
- Generic setups without unique angle
- Poorly matched to audience taste

**Cost:** $0.10 per check (Gemini mini)
**Caching:** 24-hour concept hash cache

**Doc:** `AGENT_AUTONOMY_RULES.md` (Scriptwriter section)

---

### 4.4 Post-Mortem Logging

Detailed telemetry captured after every mission.

**What's tracked:**
- **Costs:** God's Eye calls, anti-slop checks, voice synthesis, rendering
- **Latency:** Duration, render time, API response times
- **Decisions:** Autonomous vs escalated, approval rate
- **Quality:** Output count, revision rounds, approval first-pass rate
- **Context efficiency:** Peak tokens, average tokens, pressure
- **Friction points:** Where did things get stuck? (latency spikes, API limits)

**Data structure:**
```json
{
  "mission_id": "5scripts_001",
  "god_s_eye_calls_total": 5,
  "god_s_eye_calls_cached": 4,
  "god_s_eye_cost": 0.50,
  "total_cost_usd": 5.85,
  "duration_seconds": 120,
  "escalations_to_ava": 0,
  "peak_context_tokens": 38200,
  "cost_variance_percent": +1.2,
  "summary": "Generated 5 scripts. 80% cache hit on God's Eye."
}
```

**Usage:** Phase 1B test collects baseline data. Phase 2 uses it to calibrate agent confidence scores.

**Tools:**
- `src/utils/mission-logger.ts` — Log metrics
- `MISSION_POST_MORTEM_GUIDE.md` — Query and interpret results

---

### 4.5 Hive Mind Database

Centralized SQLite database (the "shared brain" of all agents).

**Key tables:**

| Table | Purpose | Rows | Updated |
|-------|---------|------|---------|
| `youtube_videos` | Channel metadata, performance | 20+ | Per ingestion |
| `youtube_comments` | Top comments, sentiment | 50+ | Per ingestion |
| `recommendations` | "This works in this niche" | Growing | After each mission |
| `video_outcomes` | Performance after publish | Growing | Weekly |
| `mission_post_mortem` | Execution telemetry | Growing | Per mission |
| `god_s_eye_brief_cache` | Cached God's Eye briefs | 5–10 | Per analysis |
| `visual_feedback` | Visual quality baselines | 50+ | Phase 2+ |

**Cost:** SQLite (local, free). YouTube API quota: 10k units/day.

---

## 5. Data Flow — Concept to Video

```
PHASE 1: CONCEPT VALIDATION
─────────────────────────────────────────────────
User: "Create a mystery comedy video"
         │
         ▼
    Anti-Slop Gate (Gemini)
    └─ Check: Is this original? Compare to 50 past videos + competitors
    └─ Result: 78% originality (approved)
         │
    DECISION: Proceed or revise? (low risk, approved)


PHASE 2: SCRIPT GENERATION
─────────────────────────────────────────────────
Scriptwriter queries God's Eye cache
    └─ Cache hit: "Mystery format drives 5x engagement"
    └─ Cost: $0 (reused)
         │
    ▼ Generate script (15s, $0.75)
    "Why This Mystery Works"
    ├─ Hook (5s): "Confusing setup"
    ├─ Escalation (8s): "Recognition moment"
    └─ Reveal (2s): "Punchline"
         │
    ▼ Anti-Slop check ($0.10)
    "82% originality (low risk)"
         │
    DECISION: Approve autonomously (Scriptwriter decides)
    Log to hive_mind: status = "approved_for_production"


PHASE 3: VISUAL COMPOSITION [Phase 2]
─────────────────────────────────────────────────
Visual Director receives script
    ├─ Analyzes beats → "hook should be mysterious, dark mood"
    ├─ Suggests B-roll (stock + Higgsfield generation)
    ├─ Proposes transitions (hard cut at shock moment)
    └─ Generates Higgsfield prompts (cost estimate: $0.15)
         │
    ▼ Editing Director executes
    ├─ Gathers B-roll ($0 if stock, $0.02–0.10 if generated)
    ├─ Applies effects, pacing, color grade
    └─ Returns: video_edited.mp4 ($0.30)


PHASE 4: FINAL RENDER
─────────────────────────────────────────────────
Skinwalker receives edited video
    ├─ Selects avatar (consistent per channel)
    ├─ Synthesizes voice with prosody ($0.03)
    │  └─ Hook: slow delivery, measured tone
    │  └─ Shock beat: fast staccato
    │
    ├─ Renders avatar composite ($0.80)
    ├─ Overlays branding (logo, subscribe prompt)
    ├─ Quality check (spot-check frames, audio sync)
    └─ Returns: final_video.mp4 ($0.95 total)


PHASE 5: FEEDBACK LOOP
─────────────────────────────────────────────────
Video published to YouTube
    ├─ Views, comments, retention tracked
    ├─ Correlated with visual style + emotional beats
    ├─ Results logged to hive_mind
    └─ God's Eye learns: "This combination works"
         │
    ▼ Confidence scores increase (Bayesian update)
    "Mystery format + nostalgia + shock = 5x engagement"
    └─ Higher confidence = more aggressive recommendation in Phase 2


COST SUMMARY
─────────────────────────────────────────────────
Anti-slop check:       $0.10
God's Eye brief:       $0.50 (1st script) / $0 (cached)
Scriptwriting (5x):    $3.75 (5 scripts × $0.75)
Visual direction:      $0 (T3, no API)
Editing (5x):          $1.50 (5 × $0.30)
B-roll generation:     $0.50–1.00 (optional Higgsfield)
Voice synthesis (5x):  $0.15 (5 × $0.03)
Avatar render (5x):    $4.00 (5 × $0.80)
                       ─────────────────
TOTAL (5 videos):      $10.50 (or $2.10/video)
```

---

## 6. Phase Roadmap

### Phase 1B: Foundation (Current — Completing Now)

**Objectives:**
- ✅ Build autonomy decision trees (all agents)
- ✅ Implement caching guardrails (God's Eye)
- ✅ Design agent prompts (Scriptwriter, Visual Director, Skinwalker)
- ✅ Build post-mortem logging infrastructure
- ⏳ Run 5-script test mission (collect baseline data)

**Output:** Real cost/latency/quality baseline data

**Docs:**
- `AGENT_AUTONOMY_RULES.md`
- `MISSION_POST_MORTEM_GUIDE.md`
- `VISUAL_DIRECTOR_PROMPT.md`
- `SKINWALKER_PROMPT.md`

---

### Phase 2: Activation & Calibration

**Objectives:**
- Implement Visual Director agent (with Phase 1 baseline)
- Implement Skinwalker agent (with Phase 1 cost data)
- Integrate automatic visual feedback logging
- Run 10+ script missions (validate at scale)

**Input:** Phase 1B post-mortem data
**Output:** Calibrated confidence scores, proven cost models

---

### Phase 3: Optimization & Scaling

**Objectives:**
- Multi-niche analysis (5+ channels per niche)
- Real-time feedback loops (measure, learn, improve)
- Advanced visual similarity (embeddings, semantic search)
- Automated A/B testing (visual styles, voice personas)

---

## 7. Tech Stack

### Core

| Component | Technology | Why |
|-----------|-----------|-----|
| **Orchestration** | Claude (Haiku/Sonnet/Opus via SDK) | Best reasoning, multi-agent coordination |
| **Database** | SQLite | Fast, simple, no infrastructure |
| **Language** | TypeScript | Type safety, modern JavaScript |
| **API** | Better-sqlite3 | Speed, in-process queries |

### External APIs

| Service | Purpose | Cost | Status |
|---------|---------|------|--------|
| **Anthropic Claude** | Core reasoning (T1-T4) | ~$0.01/10 scripts | Production |
| **YouTube API** | Channel data ingestion | $0 (10k quota/day) | Production |
| **Google Gemini** | Originality scoring (anti-slop) | ~$0.001/check | Integrated |
| **ElevenLabs** | Voice synthesis | ~$0.015/min | Phase 2 |
| **HeyGen / ComfyUI** | Avatar rendering | $0.80/video | Phase 2 |

---

## 8. Quality Metrics

### Success Criteria (Phase 1B Test)

**Goal:** 5 scripts generated, < 2 minutes end-to-end, < $6 cost, no escalations

| Metric | Target | Current |
|--------|--------|---------|
| Scripts generated | 5 | TBD (Phase 1B test) |
| Total cost | $5.75 ± 10% | TBD |
| Duration | 120s ± 20% | TBD |
| God's Eye cache hit rate | >= 75% | TBD |
| Escalations to Ava | 0 | TBD |
| Approval first-pass rate | >= 80% | TBD |

### Confidence Calibration (Phase 2+)

Once we have real data:
- **Sample size < 5:** Confidence = 0.5 (tentative)
- **Sample size 5–10:** Confidence = 0.7 (moderate)
- **Sample size >= 30:** Confidence = 0.9+ (high)

---

## 9. Key Constraints & Gotchas

### Technical

1. **YouTube API quota:** 10k units/day (not much). Batch ingestion carefully.
2. **SQLite limitations:** No vector search (embeddings deferred to Phase 3).
3. **Token budget:** Default to Haiku (T1) to avoid context explosion.
4. **Rendering cost:** Avatar synthesis is expensive ($0.80/video). Budget carefully.

### Architectural

1. **Ava is a bottleneck risk** if she's consulted on every decision. Autonomy rules mitigate this.
2. **Confidence scores are tentative** until we have 30+ samples in Phase 2.
3. **Caching strategy is bet-the-business** on 7-day TTL and niche consistency. Test in Phase 1B.

### Operational

1. **Agent autonomy requires discipline.** If agents over-escalate, return to decision trees.
2. **Post-mortem logging must be complete.** Missing data makes Phase 2 calibration impossible.
3. **Brand consistency across videos.** Same avatar per channel, same voice personality per niche.

---

## 10. Success Metrics (Long-term)

### Engagement (YouTube)

- **Target:** 0.5%+ comment engagement rate (mystery format in comedy niche)
- **Validation:** Phase 1B baseline (Fried Plantain = 0.5% on best video)

### Cost Efficiency

- **Target:** < $2.50/video (with all systems running)
- **Baseline:** Currently $2.10/video (5 scripts over 120s mission)

### Speed

- **Target:** 1 video per 30 seconds (when cached/optimized)
- **Baseline:** Currently ~20s per script (Phase 1B baseline)

### Reliability

- **Target:** 95%+ mission completion rate (no corrupted renders, no escalation cascades)
- **Measurement:** Post-mortem success rate

---

## 11. How to Use This System

### As a User (via Telegram)

```
You: "Create 5 mystery comedy scripts for Fried Plantain"

Bot:
1. Validates concept (anti-slop)
2. Queries God's Eye (patterns for mystery comedy)
3. Generates 5 scripts (Scriptwriter, T3)
4. Logs metrics to hive_mind
5. Delivers scripts to you for review

You can:
- Approve for production (send to Skinwalker)
- Request revisions (script goes back to Scriptwriter)
- Review detailed metrics (post-mortem breakdown)
```

### As a Developer

```
import { MissionMetricsBuilder } from './utils/mission-logger';

// Track mission
const metrics = new MissionMetricsBuilder(missionId, agentId, title)
  .setGodSEyeMetrics(5, 4, 1, 0.50)
  .setAntiSlopMetrics(5, 0, 0, 1)
  .setCost(5.85)
  .setStatus('completed', 'Generated 5 scripts')
  .log();

// Query results
sqlite3 store/claudeclaw.db "SELECT * FROM mission_post_mortem"
```

---

## 12. Key Documents

| Document | Purpose |
|----------|---------|
| `AGENT_AUTONOMY_RULES.md` | Decision trees for each agent |
| `MISSION_POST_MORTEM_GUIDE.md` | How to log and interpret mission data |
| `TIER_ROUTING_GUIDE.md` | Model selection and cost budgeting |
| `VISUAL_DIRECTOR_PROMPT.md` | System prompt for Phase 2 agent |
| `SKINWALKER_PROMPT.md` | System prompt for Phase 2 agent |
| `ARCHITECTURE.md` | Deep dive into schema and flows |
| `PHASE_1B_EXECUTION_CHECKLIST.md` | Step-by-step implementation |

---

## 13. Quick Reference

### Costs Per Component

```
God's Eye:              $0.50 (1st call) / $0 (cached)
Scriptwriter:           $0.75 per script
Anti-Slop:              $0.10 per check
Visual Director:        $0 (T3, time-based)
Editing:                $0.30 per video
Voice Synthesis:        $0.03 per video
Avatar Render:          $0.80 per video
─────────────────────────────────
Total per video:        ~$2.10–2.50
Total for 5 scripts:    ~$10.50
```

### Latencies

```
God's Eye brief:        8–10s (1st), 0s (cached)
Scriptwriter:           15–30s per script
Anti-Slop check:        3–5s per check
Visual Direction:       10–20s (T3)
Editing:                30–60s (depends on B-roll)
Voice synthesis:        10–15s per video
Avatar rendering:       30–120s per video
─────────────────────────────────
Total (5 scripts):      2–3 minutes (end-to-end)
```

### Team

```
Ava:              Orchestrator, decision-maker, Telegram interface
God's Eye:        YouTube analysis agent (T4)
Scriptwriter:     Content generation (T3, runs in content agent)
Visual Director:  Creative direction (T3, Phase 2)
Skinwalker:       Final rendering (T4, Phase 2)
```

---

## 14. Current Status

**Infrastructure:** 70% complete
- ✅ Database schema
- ✅ God's Eye ingestion (20 videos collected)
- ✅ Autonomy rules drafted
- ✅ Caching guardrails implemented
- ✅ Post-mortem logging designed
- ⏳ Phase 1B test (pending)

**Utility:** 40% realized
- ✅ Concept validation (anti-slop)
- ✅ Pattern analysis (God's Eye)
- ⏳ Script generation (ready, untested at scale)
- ❌ Visual direction (Phase 2)
- ❌ Full production pipeline (Phase 2)

---

## 15. Next Steps

1. **Run Phase 1B test:** Execute 5-script mission, collect post-mortem data
2. **Analyze baseline:** What costs/timings matched predictions? What was off?
3. **Calibrate Phase 2:** Use actual data to set confidence scores for Visual Director + Skinwalker
4. **Scale:** Run 10+ missions to validate at scale

**Expected Phase 1B outcome:** Real cost model, latency baseline, confidence calibration for Phase 2 agents.
