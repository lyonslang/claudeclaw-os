# Agent Autonomy Rules — When Agents Decide, When They Escalate

**Date:** May 5, 2026
**Purpose:** Prevent orchestration bottleneck by making agent decisions explicit and Ava escalation the exception, not the default.

---

## Design Philosophy

- **Agents are autonomous operators** for routine decisions
- **Ava is a human proxy** for creative, strategic, or controversial decisions
- **Every decision has a clear rule** — no ambiguity
- **When in doubt, log and escalate** — safe to err toward caution, but log the escalation

---

## Decision Trees by Agent

### 1. SCRIPTWRITER (T3 Agent)

**Input:** Niche + brief from God's Eye (or direct request)
**Output:** Draft script (1200-1800 words)

```
SCRIPTWRITER Decision Tree

START: Received request to generate script
│
├─ Request type = "new brief from God's Eye"
│  ├─ AUTONOMOUS: Query god_s_eye_brief_cache for this niche
│  ├─ Call checkForSlop(niche, title, brief_concept) → slopScore
│  │
│  ├─ IF slopScore >= 70 (LOW risk)
│  │  ├─ AUTONOMOUS: Generate script from brief
│  │  ├─ Log to hive_mind:
│  │  │  - source: "God's Eye brief"
│  │  │  - status: "approved_for_production"
│  │  │  - estimated_cost: $0.75
│  │  └─ DONE: Return script to Skinwalker
│  │
│  ├─ IF slopScore 50–69 (MEDIUM risk)
│  │  ├─ Generate script anyway (data is valuable)
│  │  ├─ Flag in hive_mind: status = "flagged_medium_risk"
│  │  ├─ Include risk_summary in script JSON
│  │  ├─ ESCALATE to Ava: "Script flagged. Proceed to production? (y/n)"
│  │  │  (Ava decides: revise concept or risk it)
│  │  └─ Wait for Ava response
│  │
│  └─ IF slopScore < 50 (HIGH risk)
│     ├─ Do NOT generate script
│     ├─ Log to hive_mind:
│     │  - status: "rejected_high_slop"
│     │  - risk_reasons: [list reasons from anti-slop check]
│     │  - recommendation: "Suggest niche pivot or concept revision"
│     ├─ ESCALATE to Ava: "Concept rejected (slop score 40%). Reasons: [X, Y, Z]"
│     └─ Ava decides: Accept feedback or override
│
├─ Request type = "revision request from Ava"
│  ├─ AUTONOMOUS: Modify script per Ava's notes
│  ├─ Log revision to hive_mind
│  └─ Return revised script
│
└─ Request type = "emergency rewrite"
   ├─ Notify Ava: "Critical revision requested"
   ├─ AUTONOMOUS: If time permits (T3 budget available)
   │  └─ Rewrite + return in 30s
   └─ ESCALATE if budget exceeded

END: Script logged, ready for next stage
```

**Cost tracking:**
- New script generation: ~$0.75 (Sonnet full completion)
- Revision: ~$0.40 (partial completion)
- Total per script: ~$1.15 (including God's Eye + anti-slop)

**Escalation triggers:**
- Slop score 50–69% → Ava decision needed (creative risk)
- Slop score < 50% → Automatic rejection, Ava override only
- T3 budget exhausted → Queue for next day

---

### 2. EDITING DIRECTOR (T3 Agent)

**Input:** Script + video library access
**Output:** Edited video (.mp4, with cuts/B-roll/effects)

```
EDITING DIRECTOR Decision Tree

START: Received approved script
│
├─ Script status = "approved_for_production"
│  ├─ AUTONOMOUS: Extract segments from script (hooks, transitions, explanations)
│  ├─ AUTONOMOUS: Query video_library for matching B-roll by keyword
│  │
│  ├─ IF sufficient B-roll found (≥70% coverage)
│  │  ├─ AUTONOMOUS: Apply standard template effects
│  │  │  - Hook: 1s zoom-in, sound effect
│  │  │  - Transitions: 300ms crossfade
│  │  │  - B-roll: Ken Burns effect + 30% opacity overlay
│  │  ├─ Log to hive_mind:
│  │  │  - source: "standard_template"
│  │  │  - b_roll_coverage: "92%"
│  │  │  - editing_cost: "$0.30"
│  │  └─ Return edited video to Skinwalker
│  │
│  └─ IF insufficient B-roll (< 70% coverage)
│     ├─ ESCALATE to Ava: "B-roll gap: [X% coverage]. Recommend: [options]"
│     │  (Ava decides: source external B-roll, use graphics, or simplify script)
│     └─ Wait for Ava response
│
├─ Script status = "flagged_medium_risk"
│  ├─ AUTONOMOUS: Still edit (proceed optimistically)
│  ├─ Apply slightly more polished effects (better hooks) to offset risk
│  └─ Log: status = "edited_with_risk_mitigation"
│
├─ Request type = "recut for audience feedback"
│  ├─ AUTONOMOUS: Adjust pacing/effects per feedback notes
│  ├─ If major structural change needed:
│  │  ├─ ESCALATE to Ava: "Recut requires script revision. Proceed?"
│  │  └─ Wait for Ava
│  └─ If minor (effect tweaks only):
│     ├─ AUTONOMOUS: Recut + return
│     └─ Log revision
│
└─ Unknown request type
   ├─ ESCALATE to Ava: "Request unclear. Provide context."
   └─ Wait for Ava

END: Video edited, ready for voice/render
```

**Cost tracking:**
- Standard edit: ~$0.30 (template application, local)
- Complex recut: ~$0.60 (custom effects, longer processing)

**Escalation triggers:**
- B-roll coverage < 70% → Creative decision on visual strategy
- Structural recut requested → Need script sign-off first
- Unknown request → Ambiguity (escalate)

---

### 3. SKINWALKER (T4 Agent — Avatar + Voice + Render)

**Input:** Edited video + script + avatar persona
**Output:** Final rendered video (.mp4, with voice, avatar, branding)

```
SKINWALKER Decision Tree

START: Received edited video
│
├─ Avatar selection
│  ├─ AUTONOMOUS: Query avatar_config for niche + gender + age + style
│  │  (Precedent: use same avatar per channel unless overridden by Ava)
│  └─ If no precedent, ESCALATE to Ava: "New avatar choice. Options: [A, B, C]"
│
├─ Voice cloning
│  ├─ AUTONOMOUS: Use TTS model for niche persona
│  │  (Precedent: "Mystery explainer" → calm, deliberate voice)
│  ├─ Apply prosody from God's Eye brief:
│  │  - "Hook strength 8/10" → 20% faster intro delivery
│  │  - "Educational" → 5% slower explanation sections
│  │  - "Shocking" → Pause before punchline
│  └─ Log voice parameters to hive_mind
│
├─ Rendering
│  ├─ AUTONOMOUS: Render with standard template
│  │  - Avatar positioned center-right
│  │  - 1080p60, 16:9 aspect
│  │  - Color grade: brand palette
│  ├─ Monitor render progress (should complete in <2 min for 2-min video)
│  │
│  ├─ IF render completes successfully
│  │  ├─ AUTONOMOUS: Generate thumbnail from key frame
│  │  ├─ Extract video metadata (duration, file size, codec)
│  │  ├─ Log to hive_mind:
│  │  │  - status: "production_ready"
│  │  │  - render_cost: "$0.80"
│  │  │  - total_mission_cost: "[sum all stages]"
│  │  └─ Return final video to Ava + [SEND_FILE] marker
│  │
│  └─ IF render fails (codec error, GPU timeout, etc.)
│     ├─ ESCALATE to Ava: "Render failed: [error]. Retry or investigate?"
│     └─ Wait for Ava (may increase cost if retry fails 3x)
│
└─ Final checks
   └─ AUTONOMOUS: Verify video not corrupted (play 1sec sample)

END: Video production-ready, awaiting approval
```

**Cost tracking:**
- Voice synthesis: ~$0.15 (ElevenLabs T2 latency)
- Avatar rendering: ~$0.80 (2-min video, HeyGen or local ComfyUI)
- Total per video: ~$0.95

**Escalation triggers:**
- New avatar → Creative choice (Ava decides brand consistency)
- Render failure → Technical issue (Ava decides retry budget)
- Unexpected request → Ambiguity (escalate)

---

### 4. GOD'S EYE (T4 Callable Skill — Not an Agent, No Autonomy)

**Role:** Data service, not decision-maker
**Invocation:** Only Scriptwriter calls God's Eye (design decision to reduce redundancy)

```
GOD'S EYE Invocation Rules

WHEN TO CALL:
├─ Weekly niche analysis (new channel or trending shift)
├─ New content category in established niche
└─ Post-mortem learning (after video performance feedback)

WHEN NOT TO CALL:
├─ Scriptwriter generates script for same niche (cache hit, no call)
├─ Editing Director needs brief → Query hive_mind (cost $0)
├─ Skinwalker needs persona guidance → Query hive_mind (cost $0)
└─ Any routine rerun within 7-day window → Cache, no call

CACHING RULE:
├─ BEFORE calling: Query god_s_eye_brief_cache (niche, channel_id)
│  ├─ IF found AND expires_at > now()
│  │  └─ REUSE brief (cost $0, add 1 to access_count)
│  └─ IF found AND expires_at < now()
│     └─ ONE agent refreshes (Scriptwriter initiates), others wait for hive_mind update
│
└─ ON successful call:
   ├─ Store brief in god_s_eye_brief_cache (7-day TTL)
   ├─ Log cost: $0.50
   └─ Make available to all agents via hive_mind query

RESULT STRUCTURE:
{
  "niche": "mystery_comedy",
  "top_3_patterns": [
    { "pattern": "mysterious_setup", "engagement_multiplier": 5.2 },
    { "pattern": "nostalgic_reference", "engagement_multiplier": 3.1 },
    { "pattern": "absurd_escalation", "engagement_multiplier": 2.8 }
  ],
  "recommended_hook": "Start with confusing statement, take 3s to explain",
  "estimated_runtime": "2-3 minutes",
  "cost_usd": 0.50
}
```

**NO escalation needed** — God's Eye is deterministic data retrieval, not a decision-maker.

---

## Escalation Summary Table

| Trigger | Agent | Action | Ava's Role |
|---------|-------|--------|-----------|
| Slop score 50–69% | Scriptwriter | Generate + flag | Decide: revise or risk |
| Slop score < 50% | Scriptwriter | Reject (no generation) | Decide: override or accept |
| B-roll coverage < 70% | Editing Director | Hold for input | Choose visual strategy |
| New avatar | Skinwalker | Hold for input | Decide brand consistency |
| Render failure | Skinwalker | Log + hold | Decide retry budget |
| Unclear request | Any agent | Log + escalate | Clarify intent |
| Budget exhausted | Any agent | Queue for next period | Monitor spend trends |

---

## Standing Orders

1. **Always log to hive_mind** — Every decision, autonomous or escalated, must be logged with timestamp and cost.
2. **Escalations are not failures** — Escalating a risky decision is correct. Escalating ambiguity is correct. Do not hesitate.
3. **Cache before calling** — God's Eye and Gemini API calls must check cache first. Cache hit = $0.
4. **Prefer Ava over guessing** — If truly uncertain, ask. Wrong guess costs more.
5. **Cost tracking is real** — Log actual costs in hive_mind. Post-mortem uses this data.

---

## How This Reduces Bottleneck Risk

| Before (Naive) | After (Autonomy Rules) |
|---|---|
| Every decision escalates to Ava | Clear tree: most decisions are autonomous |
| Ava is constantly context-switching | Ava only handles creative + strategic decisions (~10% of requests) |
| Unclear when to escalate (safety panic) | Explicit triggers remove guesswork |
| Cost surprises (agents over-invoke APIs) | Rules enforce caching, explicit budgets |
| No way to debug failures | Every decision logged with full context |

---

## Testing These Rules

After implementing, run this test:

**Mission:** "Generate 5 scripts for Comedy niche"

**Expected outcome:**
- God's Eye called 1 time (cache serves subsequent scripts)
- Scriptwriter makes 5 autonomous decisions (none escalate if slop check passes)
- Total cost: ~$5.75 (God's Eye $0.50 + 5 scripts × $1.15/ea)
- Total time: <2 minutes (God's Eye 8s + 5 scripts 15s each + anti-slop checks cached)
- Escalations: 0 (if slop scores all >= 70%)

**Bad outcome:**
- God's Eye called 5 times (no caching) → Cost jumps to $8
- Scriptwriter escalates on every script → Ava bottleneck
- Total time: >5 minutes (context switching delays)

---

## Next Steps

1. Implement in agent prompts (add this decision tree to system message)
2. Add logging to hive_mind (every escalation + autonomous decision)
3. Run the 5-script test mission
4. Compare actual metrics to expected outcome
5. Refine thresholds based on real data (Grok's post-mortem concept)
