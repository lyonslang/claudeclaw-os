# ClaudeClaw Architecture Overview

**Date:** May 5, 2026
**Status:** In development (70% infrastructure, 40% utility)
**Purpose:** Multi-agent video production system for avatar-based YouTube content

---

## 1. Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLAUDECLAW ECOSYSTEM                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Telegram Bot (user commands, voice)                                       │
│  • Mission Control Dashboard (web UI, mission creation)                      │
│  • Direct agent invocation (Bash/CLI)                                        │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────────┐
│  ORCHESTRATOR LAYER (Ava — Assistant)                                       │
├────────────────────────────────────────────────────────────────────────────┤
│  • Routes tasks by tier (T1→Haiku, T3→Sonnet, T4→Opus)                     │
│  • Monitors hive_mind for all agent activity                                │
│  • Delegates missions to specialized agents                                 │
│  • Translates between user requests and agent capabilities                  │
│  • Enforces cost discipline (T1 by default)                                 │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────────┐
│  AGENT LAYER                                                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  God's Eye      │  │ Scriptwriter │  │   Editing    │  │ Skinwalker  │  │
│  │  (T4)           │  │ (T3)         │  │ Director(T3) │  │ (T4)        │  │
│  │                 │  │              │  │              │  │             │  │
│  │ • Analysis      │  │ • Generate   │  │ • Cuts/pacing│  │ • Render    │  │
│  │ • Patterns      │  │   scripts    │  │ • B-roll     │  │ • Voice     │  │
│  │ • Gaps          │  │ • Refinement │  │ • Thumbnails │  │ • Compose   │  │
│  └────────┬────────┘  └──────┬───────┘  └──────┬───────┘  └────────┬────┘  │
│           │                  │                 │                   │       │
│           └──────────────────┴─────────────────┴───────────────────┘       │
│                              │                                             │
│                    ┌─────────▼──────────┐                                  │
│                    │  Anti-Slop Gate    │                                  │
│                    │  (Originality Chk) │                                  │
│                    └────────────────────┘                                  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────────┐
│  HIVE MIND LAYER (Central Database)                                         │
├────────────────────────────────────────────────────────────────────────────┤
│  • youtube_* tables (channels, videos, comments, transcripts, insights)     │
│  • recommendations (techniques, confidence, track records)                  │
│  • originality_checks (concept validation results)                          │
│  • hive_mind (agent activity log)                                           │
│  • token_usage (cost tracking)                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Hive Mind — Data Layer

### Tables & Schema

#### YouTube Data Tables
```sql
youtube_channels
  ├─ channel_id (PK)
  ├─ title, description, custom_url
  ├─ subscriber_count, video_count, view_count
  └─ published_at, fetched_at

youtube_videos
  ├─ video_id (PK, UNIQUE)
  ├─ channel_id (FK)
  ├─ title, description
  ├─ view_count, like_count, comment_count
  ├─ duration_seconds, published_at
  └─ last_synced_at

youtube_comments
  ├─ comment_id (PK, UNIQUE)
  ├─ video_id (FK)
  ├─ author, text
  ├─ like_count, reply_count, published_at
  └─ created_at

youtube_transcripts
  ├─ video_id (FK)
  ├─ transcript_text
  ├─ language, auto_generated
  └─ fetched_at

youtube_insights
  ├─ id (PK)
  ├─ channel_id, niche, version
  ├─ insight_type (full_analysis, pattern_match, competitor_gap, etc.)
  ├─ summary, patterns, recommendations
  ├─ emotional_themes, top_hooks
  ├─ confidence_score (0-100)
  └─ created_at
```

#### Recommendation & Tracking Tables
```sql
recommendations
  ├─ id (PK)
  ├─ niche, technique, description
  ├─ confidence_before, confidence_after (0.1-0.95)
  ├─ times_recommended, times_succeeded
  └─ created_at, updated_at

recommendation_usage
  ├─ id (PK)
  ├─ recommendation_id (FK)
  ├─ video_id (FK)
  ├─ outcome_measured (0|1)
  ├─ outcome_success (0|1, if measured)
  └─ used_at

video_outcomes
  ├─ video_id (PK, UNIQUE)
  ├─ channel_id, title, niche
  ├─ view_count, like_count, comment_count
  ├─ watch_time_hours, avg_view_duration
  ├─ click_through_rate, subscriber_gain
  └─ measured_at

originality_checks
  ├─ id (PK)
  ├─ niche, concept, title
  ├─ concept_hash (UNIQUE, for cache)
  ├─ originality_score (0-100)
  ├─ gemini_assessment, reasons (JSON)
  ├─ safe_to_produce (0|1)
  └─ created_at
```

#### Orchestration & Logging
```sql
hive_mind
  ├─ id (PK)
  ├─ agent_id (god-s-eye, scriptwriter, etc.)
  ├─ chat_id
  ├─ action (data_ingestion, analysis_complete, script_generated, etc.)
  ├─ summary (human-readable log)
  ├─ artifacts (JSON metadata)
  ├─ niche (for filtering by content type)
  └─ created_at

token_usage
  ├─ session_id (FK)
  ├─ agent_id
  ├─ model_used (haiku, sonnet, opus)
  ├─ context_tokens, output_tokens, cost_usd
  ├─ did_compact (0|1)
  └─ created_at
```

### Data Flow

```
INGEST:
  YouTube API → youtube-fetch.js → youtube_* tables
  ↓
  God's Eye analysis → youtube_insights table
  ↓
  Scriptwriter generates script → hive_mind (artifact)
  ↓
  Anti-slop check → originality_checks table
  ↓
  Video publishes → video_outcomes table (performance data)
  ↓
  Recommendation outcome measured → recommendations (confidence updated)

QUERY:
  Agents: queryHiveMind(niche, action) → hive_mind entries
  Agents: queryInsights(niche) → youtube_insights (sorted by confidence)
  Scriptwriter: getTopRecommendations(niche) → ranked by confidence_after
  Anti-slop: originality_checks (cache by concept_hash)
```

---

## 3. God's Eye Skill — Responsibilities & Output

### What God's Eye Does
- **Centralizes YouTube intelligence** — pulls stats, transcripts, comments, performance data
- **Identifies patterns** — hook styles, emotional beats, pacing, comment themes
- **Finds gaps** — what competitors do that you don't (and vice versa)
- **Scores recommendations** — rates techniques by confidence + evidence
- **Routes to agents** — feeds analysis to Scriptwriter, Editing Director, etc.

### Invocation Tier
- **T4** (Sonnet/Opus) — Full multi-agent orchestration
- **T3** (Sonnet) — Single-niche analysis or pattern matching
- **T1** (Haiku) — Data queries (getTopRecommendations, etc.)

### Output Format

```typescript
interface GodsEyeBrief {
  niche: string;
  channel_id: string;

  hook_analysis: {
    score: number;              // 0-10
    strengths: string[];        // "clear promise", "pattern interrupt"
    weaknesses: string[];       // "too slow", "unclear value"
    recommended_hook: string;   // specific opening line to try
  };

  emotional_arc: {
    opening: string;     // curiosity, fear, excitement, etc.
    middle: string;
    peak: string;
    close: string;
    missing_beats: string[];  // "humor at 2:00", "urgency at end"
  };

  top_patterns: string[];     // "8+ min videos perform 3x better"
  competitor_gaps: string[]; // "Nobody covers X — opportunity"
  recommendations: string[]; // Actionable feedback
}
```

---

## 4. Specialized Agents

### Scriptwriter (T3 — Sonnet)
**Input:** God's Eye brief
**Process:**
1. Reads brief: hooks, patterns, emotional arc, gaps
2. Generates full script with timing, emotional beats, dialogue
3. Runs anti-slop check before finalizing
4. Returns approved script or rejection reasons

**Output:**
```json
{
  "script": "...",
  "title": "...",
  "hook_strength": 8,
  "emotional_beats": "curiosity → excitement → urgency",
  "slop_check": { "originalityScore": 72, "safeToProduce": true },
  "approval": "ready|review_needed|rejected"
}
```

### Editing Director (T3 — Sonnet)
**Input:** Approved script + God's Eye visual analysis
**Process:**
1. Reads script and emotional beats
2. Generates editing brief: pacing, cuts, B-roll cues, camera direction
3. Specifies thumbnail strategy based on top patterns
4. Returns detailed editing plan for human editor or Skinwalker

**Output:**
```json
{
  "editing_brief": {
    "pacing": "cuts every 3-5 seconds (fast energy)",
    "hook_visuals": "pattern interrupt at 0:05",
    "broll_cues": ["reaction shot at 0:30", "diagram at 1:15"],
    "thumbnail_strategy": "high contrast, single emotion"
  }
}
```

### Skinwalker (T4 — Sonnet/Opus)
**Input:** Script + editing brief + voice/avatar specs
**Process:**
1. Generates avatar commands (ElevenLabs voice, HeyGen avatar movements)
2. Coordinates ComfyUI for visual generation
3. Orchestrates full render pipeline
4. Produces final MP4

**Output:** Video file + metadata

### Researcher Agent
**Input:** Topic, niche
**Process:**
1. Queries God's Eye for patterns + competitor data
2. Generates research brief with context
3. Feeds to Scriptwriter for context

---

## 5. Model Tier Routing

### Tier System

| Tier | Model | Use Cases | Cost/Task |
|------|-------|-----------|-----------|
| **T1** | Haiku | Data queries, DB ops, simple lookups, acknowledgments | ~$0.01-0.05 |
| **T2** | Haiku→Sonnet | Pattern matching, basic analysis (escalate on fail) | ~$0.05-0.50 |
| **T3** | Sonnet | Reasoning, emotional analysis, script generation | ~$0.30-1.00 |
| **T4** | Sonnet/Opus | Orchestration, final decisions, multi-agent synthesis | ~$1.00-3.00 |

### Routing Logic

**Default: T1/Haiku for everything unless complexity detected.**

```typescript
// Tier detection (in tier-detector.ts)
if (prompt.includes('query') || prompt.includes('lookup')) → T1
if (prompt.includes('analyze') || prompt.includes('pattern')) → T2
if (prompt.includes('reason') || prompt.includes('create')) → T3
if (prompt.includes('orchestrate') || prompt.includes('strategy')) → T4

// In Mission Control: auto-route with cost estimate
createMission("Generate script for comedy")
  → Detected: T3 (Sonnet)
  → Estimated: $0.75
  → User can override to Opus if high-stakes
```

---

## 6. Key Flows

### Flow 1: New Content Concept → Production Ready

```
USER: "Generate a script for comedy, channel X"
       ↓
ORCHESTRATOR (Ava):
  • Routes to God's Eye (T3/Sonnet)
       ↓
GOD'S EYE:
  1. Query hive_mind: top 10 comedy videos, patterns, gaps
  2. Analyze emotional beats, hooks, pacing
  3. Generate brief
       ↓
SCRIPTWRITER (T3):
  1. Take brief
  2. Generate full script
  3. Run anti-slop check
       ↓
ANTI-SLOP GATE:
  • Originality score 40% Gemini + 35% similarity + 25% novelty
  • Score ≥70 → APPROVED
  • Score 50-69 → FLAGGED (review)
  • Score <50 → REJECTED (request new brief)
       ↓
IF APPROVED:
  EDITING DIRECTOR (T3): Generate editing brief + thumbnail strategy
       ↓
  SKINWALKER (T4): Render video (ElevenLabs + HeyGen + ComfyUI)
       ↓
  PUBLISHED
       ↓
IF FLAGGED:
  Return to user with reasons: "Too similar to video X, hook overdone"
       ↓
IF REJECTED:
  Return to God's Eye: "Generate new brief with different hook angle"
```

### Flow 2: Performance Feedback → Recommendation Calibration

```
SCRIPT APPROVED & PUBLISHED
       ↓
WAIT FOR PERFORMANCE DATA
       ↓
VIDEO OUTCOMES RECORDED:
  • 85K views (above median 50K) ✅
  • 4.2% engagement (above 2.1%) ✅
       ↓
RECOMMENDATION TRACKER:
  • Recommendation X (curiosity_gap_hook) marked "success"
  • Confidence updates: 0.70 → 0.78 (Bayesian)
  • 90% credible interval: [0.61, 0.89]
  • sampleSize: 6 (still tentative)
       ↓
NEXT SCRIPTWRITER QUERY:
  getTopRecommendations('comedy')
  → Returns ranked by confidence_after DESC
  → Curiosity_gap_hook now ranks #1 (0.78 confidence)
```

### Flow 3: Tier Routing in Practice

```
USER (Telegram): "Analyze the Fried Plantain data"

ORCHESTRATOR (Ava):
  • Detects: "analyze" + "data" = T2
  • Routes to: Haiku initially, escalate to Sonnet if needed
  • Cost estimate: $0.10
       ↓
HAIKU (T1/T2):
  • Queries youtube_videos for view_count trends
  • Calculates comment_rate
  • Returns: "Top 3 videos: [...]"
       ↓
IF SIMPLE ANSWER:
  Return to user (cost: $0.02)
       ↓
IF PATTERN COMPLEXITY:
  ESCALATE to Sonnet (T3)
  • Analyze emotional themes across top 10
  • Identify niche-specific patterns
  • Return full brief (cost: $0.40 total)
```

---

## 7. Current State (May 5, 2026)

### ✅ IMPLEMENTED (Ready to Test)

| Component | Status | Notes |
|-----------|--------|-------|
| **Data Collection** | ✅ Complete | youtube-fetch.js pulls channel stats, videos, comments |
| **YouTube Schema** | ✅ Complete | All youtube_* tables created + indexed |
| **God's Eye Skill** | ✅ Complete | Defined, emotion analysis, pattern matching, brief generation |
| **Scriptwriter Integration** | ✅ Complete | Takes brief, generates script, ready for handoff |
| **Anti-Slop Gate** | ✅ Complete | Hybrid scoring (Gemini 40% + similarity 35% + novelty 25%) |
| **Recommendation Tracking** | ✅ Complete | Full Bayesian confidence + credible intervals |
| **Self-Learning Loop** | ✅ Complete | Video outcomes feed back to recommendations |
| **Tier Routing** | ✅ Complete | Auto-detect T1-T4 in Mission Control + Telegram |
| **Mission Control** | ✅ Complete | Dashboard auto-routes by tier with cost estimates |
| **Hive Mind Logging** | ✅ Complete | All agent actions logged with metadata |

### 🔶 IN PROGRESS (Needs Real Data)

| Component | Status | Blocker |
|-----------|--------|---------|
| **God's Eye Analysis** | 🔶 Pending | Need >10 videos per niche for confident patterns |
| **Scriptwriter Output Quality** | 🔶 Pending | Needs real brief + testing |
| **Editing Director Brief** | 🔶 Pending | Visual specs need validation |
| **Skinwalker Integration** | 🔶 Pending | Needs ElevenLabs + HeyGen API keys |

### ❌ PLACEHOLDER (Not Yet Implemented)

| Component | Status | Notes |
|-----------|--------|-------|
| **Gemini Originality Scoring** | ❌ Placeholder | Current: heuristic scoring. Real Gemini integration needed |
| **Competitor Visual Analysis** | ❌ Future | Gemini video analysis of competitor videos (phase 2) |
| **Embeddings / Vector Search** | ❌ Future | Deferred until 30-50 videos collected |
| **Recency Decay** | ❌ Future | Per-recommendation aging (for style fingerprinting) |
| **Cross-Niche Orchestration** | ❌ Future | Multi-channel optimization (growth + comedy + etc.) |

---

## 8. Example: Full End-to-End Flow (Fried Plantain Comedy)

### Input
```
niche: "comedy"
channel_id: "UCg-6ZSCo-uzh79IJlYCwdfg"
request: "Generate a script ready for production"
```

### Step 1: God's Eye Analysis (T3)
```
Query: SELECT * FROM youtube_insights WHERE niche='comedy'
Result: Analysis from 3 Fried Plantain videos
  • Video 2 (Key & Peele mystery): 9/10 hook, 0.5% comment ratio
  • Video 1 (Aries Spears): 8/10 hook, 0.096% comment ratio
  • Pattern: Mystery format drives 5x engagement
```

### Step 2: Scriptwriter Brief
```json
{
  "niche": "comedy",
  "hook": "The Scandal Nobody Knew: Why [Celebrity] Collab Never Happened",
  "emotional_arc": "curiosity → skepticism → revelation → urgency",
  "pattern": "Mystery + schadenfreude",
  "competitor_gap": "Nobody combines mystery + schadenfreude in comedy niche"
}
```

### Step 3: Scriptwriter Generates Script
```
TITLE: The Scandal Nobody Knew: Why Key Left Peele
HOOK: "Two comedians dominated the 2010s together. Then something happened..."
SETUP: "Key & Peele's rise to fame..."
BODY: "The split nobody talks about..."
PEAK: "Here's what really went down..."
CLOSE: "And that's why Key won't touch Peele content..."
```

### Step 4: Anti-Slop Check
```
Gemini Score: 75 (originality)
Similarity to Winners: 45% (moderate, acceptable)
Niche Novelty: 65% (fresh angle)

Combined Score: (75 × 0.4) + (55 × 0.35) + (65 × 0.25) = 67%
Risk Level: MEDIUM
Verdict: ⚠️ FLAGGED — "Similar hook angle to video X, but unique content angle. Recommend proceeding with caution."
```

### Step 5: User Decision
- ✅ Override and proceed (accept MEDIUM risk)
- ↻ Return to God's Eye for new brief (different angle)
- ❌ Cancel

---

## 9. Cost Tracking

Every mission logged:
```sql
INSERT INTO hive_mind VALUES (
  agent_id='god-s-eye',
  action='content_generation_complete',
  summary='Generated script for comedy: "The Scandal Nobody Knew" (originality 67%)',
  artifacts={
    "niche": "comedy",
    "originality_score": 67,
    "risk_level": "MEDIUM",
    "approved": true,
    "cost_usd": 1.35,
    "breakdown": {
      "god_s_eye_analysis": 0.50,
      "scriptwriter": 0.75,
      "anti_slop_check": 0.10
    }
  },
  niche='comedy',
  created_at=timestamp
);
```

**Daily Budget:** $12.00/day (T1 + T3 + T4 combined)

---

## 10. Next Steps (Immediate)

### Week 1: Validation
- [ ] Ingest 3-5 more comedy channels (validation set)
- [ ] Run God's Eye analysis on all channels
- [ ] Generate 5 test scripts, measure anti-slop scores
- [ ] Verify: scripts with originality >70% are actually good

### Week 2: Real Production
- [ ] Wire Editing Director into pipeline
- [ ] Wire Skinwalker (avatar + voice) integration
- [ ] Produce 1 real video end-to-end
- [ ] Measure: does anti-slop prediction match actual engagement?

### Week 3: Self-Learning
- [ ] Track recommendation success rates
- [ ] Calibrate confidence scores against real performance
- [ ] Identify which patterns actually correlate with views

---

## Glossary

- **Hive Mind** — Central SQLite database with all video data, analysis, and agent logs
- **God's Eye** — T4 skill that analyzes YouTube data and generates content briefs
- **Anti-Slop Gate** — Hybrid originality checker (Gemini + similarity + novelty)
- **Tier System** — T1 (Haiku) → T4 (Opus) routing based on task complexity
- **Recommendation Confidence** — Bayesian score (0.1-0.95) for technique effectiveness
- **Niche** — Content category (comedy, growth, education, etc.)
- **Brief** — Structured analysis output from God's Eye (hooks, patterns, gaps)
- **Hive Mind Log** — Activity record of all agent actions (hive_mind table)
