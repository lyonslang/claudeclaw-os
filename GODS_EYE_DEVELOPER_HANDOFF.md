# God's Eye Pipeline — Developer Handoff

> Complete technical breakdown of the content intelligence pipeline.
> Last updated: 2026-05-08

---

## What This System Does

The God's Eye pipeline analyzes any YouTube channel and produces:
1. A **content brief** with Bayesian confidence scores on every pattern
2. A **production-ready script** generated via Claude Sonnet with quality gates
3. A **pre-production score** (0-100) that tells you if a video concept is worth producing before you spend time on it

The goal: point at any YouTube channel → know what works → generate a script → know its confidence score → then decide whether to produce.

---

## Architecture Overview

```
@ChannelHandle or URL
        │
        ▼
┌─────────────────┐
│ youtube-ingest   │  Resolves channel ID, fetches via YouTube Data API v3,
│                  │  persists to SQLite. Skips if data < 7 days old.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ gods-eye-brief   │  Bayesian pattern detection, data-driven emotional arc,
│                  │  competitor gap analysis, quality gates, pre-production scoring.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ scriptwriter     │  Sonnet API call with pivot angle (Bayesian-selected),
│                  │  insight mechanism, quality gates (novelty, anti-slop, AHA).
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ pipeline         │  Orchestrator. Connects all three. Single entry point
│                  │  for analyze, script, and score operations.
└─────────────────┘
```

---

## File Map

| File | Lines | Purpose |
|------|-------|---------|
| `src/youtube-ingest.ts` | ~360 | YouTube Data API v3 fetcher + DB persistence |
| `src/gods-eye-brief.ts` | ~1375 | Analysis engine (patterns, arc, gaps, scoring) |
| `src/utils/bayesian-confidence.ts` | ~275 | Beta distribution confidence scoring |
| `src/bayesian-pivot-governor.ts` | ~183 | Explore/exploit pivot angle selection |
| `src/scriptwriter.ts` | ~595 | Sonnet script generation + quality gates |
| `src/pipeline.ts` | ~160 | Orchestrator connecting all modules |
| `scripts/pipeline-cli.ts` | ~170 | CLI entry point |
| `src/bayesian-confidence.test.ts` | ~256 | 18 unit tests for Bayesian module |
| `src/gods-eye-brief.test.ts` | ~252 | 12 unit tests for analysis engine |
| `src/config.ts` | (modified) | Added `YOUTUBE_API_KEY` export |

---

## Module Deep Dives

### 1. YouTube Ingest (`src/youtube-ingest.ts`)

**Purpose:** Fetch channel + video data from YouTube and store it locally.

**Key functions:**
- `resolveChannelId(input)` — Accepts `@handle`, `youtube.com/@handle`, `youtube.com/channel/UCxxx`, or raw `UCxxx` ID. Uses YouTube search API to resolve handles.
- `ingestChannel(input, opts)` — Full ingest: resolve ID → fetch channel metadata → fetch up to 50 videos → persist to SQLite. Returns `IngestResult` with channel info, videos, and cache status.

**DB tables used:**
- `youtube_channels` — Created by this module if it doesn't exist. Stores channel metadata + `fetched_at` timestamp for staleness checks.
- `youtube_videos` — Existing table in `db.ts` schema. Stores per-video stats.
- `tracked_competitors` — Optionally adds the channel when `niche` param is provided.

**Staleness logic:** If `fetched_at` is < 7 days old, returns cached data and skips API calls. Pass `force: true` to override.

**API quota:** Each `ingestChannel` call uses 3-5 API quota units (1 for channel lookup, 2-4 for paginated video fetch). YouTube's daily limit is 10,000 units.

**Config dependency:** Reads `YOUTUBE_API_KEY` from `src/config.ts`, which reads from `.env`.

---

### 2. God's Eye Brief Engine (`src/gods-eye-brief.ts`)

**Purpose:** The core analysis engine. Takes channel + video data, outputs a structured brief with confidence scores.

#### Entry Points

- `generateGodsEyeBrief(channel, videos, niche)` — Main function. Returns a `GodsEyeBrief` object.
- `generateGodsEyeBriefFromHiveMind(niche, channelId?)` — Convenience wrapper that loads data from DB.
- `preProductionScore(brief, concept)` — Scores a video concept against an existing brief.
- `getOutlierVideos(videos, topN)` — Returns top outlier videos by moving average deviation.

#### Analysis Pipeline (in order)

**a) Hook Analysis** (`analyzeHook`)
- Looks at top 3 videos for pattern interrupt, curiosity gap, social proof
- Calculates a 0-10 hook score
- Note: still uses top 3 by array position, not by performance (known limitation)

**b) Emotional Arc Analysis** (`analyzeEmotionalArc`) — DATA-DRIVEN
- Clusters ALL videos into 6 sentiment patterns via title analysis:
  - curiosity, controversy, reveal, personal, urgency, nostalgia
- Each cluster gets an effectiveness score: `(cluster avg engagement) / (channel avg engagement)`
- Opening = highest-effectiveness cluster
- Peak = second-highest cluster
- Middle = cluster closest to 1.0 effectiveness (tension building)
- Close = lowest cluster (CTA improvement opportunity)
- Missing beats = sentiment patterns absent from the top-quartile performers
- Returns real numbers from real data — no hardcoded values

**c) Pattern Detection** (`detectPatterns`) — BAYESIAN
- 5 pattern detectors:
  1. Short clips vs long-form (duration-based)
  2. Controversy framing (keyword detection)
  3. Title length (top-quartile vs bottom-quartile)
  4. Ellipsis/cliffhanger titles
  5. Explanation/revelation framing
- Each pattern is scored via `calculateBayesianConfidence()` with:
  - Beta distribution posterior
  - Differential impact bonus (capped at +0.15)
  - Recency decay (niche-aware half-life)
  - 95% credible intervals
- Patterns below 0.40 confidence are dropped
- Uses Vexian moving average baseline (5-video trailing window) instead of channel lifetime average

**d) Competitor Gap Analysis** (`analyzeCompetitorGaps`) — DATA-DRIVEN
- 6 format detectors scan titles: ellipsis, question, ALL-CAPS, listicle, personal, name-drop
- Flags patterns used in <30% of videos but showing >1.3x engagement
- Engagement variance gap: flags if coefficient of variation > 0.8
- Recency gap: compares recent half vs older half for >30% shift
- All confidence scores via Bayesian module — zero hardcoded floats

**e) Quality Gate** (`applySelfCritiqueGate`)
- Checks credible interval width (>50% → clarity penalty)
- Checks success metric specificity
- Checks recommendation implementation detail
- Checks gap confidence thresholds
- Returns pass/fail + specific feedback

**f) Pre-Production Score** (`preProductionScore`)
- Takes a brief + proposed concept (title, hook, format)
- Checks each pattern in the brief against the concept
- Returns 0-100 score (60% pattern match + 40% confidence-weighted)
- Includes: matched patterns, missing patterns, arc alignment, summary

#### Key Interfaces

```typescript
interface GodsEyeBrief {
  brief_id: string;
  niche: string;
  channel_name: string;
  sample_size: number;
  confidence_level: 'high' | 'medium' | 'low';
  hook_analysis: HookAnalysis;
  emotional_arc: EmotionalArc;        // data-driven
  visual_pacing: VisualPacingRecommendations;
  top_patterns: Pattern[];            // Bayesian-scored
  competitor_gaps: CompetitorGap[];   // data-derived
  recommendations: Recommendation[];
  methodology: { confidence_model, decay_half_life_days, minimum_sample_for_confidence };
  caveats: { sample_size_note, survivorship_bias, niche_specificity };
}

interface PreProductionScoreResult {
  score: number;                    // 0-100
  matched_patterns: string[];
  missing_patterns: string[];
  arc_alignment: string;
  confidence_weighted_score: number;
  summary: string;                  // human-readable one-liner
}
```

---

### 3. Bayesian Confidence (`src/utils/bayesian-confidence.ts`)

**Purpose:** Statistically grounded confidence scoring using Beta distributions.

**Formula:**
```
posterior_mean = (α + successes) / (α + β + trials)
```
Default prior: Beta(2,2) — symmetric, weak, centered at 0.50.

**Features:**
- **Differential impact bonus:** If performanceDelta > 1.3x, adds scaled bonus capped at +0.15
- **Recency decay:** Exponential decay when data age > halfLife/2. Niche-aware half-lives:
  - Celebrity/meme: 30-45 days
  - Comedy: 60-90 days
  - Education/tutorial: 180-365 days
- **Credible intervals:** 95% CI via normal approximation, narrows with sample size
- **Niche-aware priors:** Override `priorAlpha`/`priorBeta` for validated niche patterns
- **Tentative flag:** True when trials < 5

**Also exports:**
- `formatConfidence(result)` — Human-readable string: "82% (71%-91%, well supported) [strong impact]"
- `toHumanReadable(brief)` — Formats a full brief into a one-paragraph memo + bullet points

---

### 4. Bayesian Pivot Governor (`src/bayesian-pivot-governor.ts`)

**Purpose:** Selects which narrative pivot angle to use for script generation, weighted by historical performance.

**Angles:** CONTRARIAN, MICRO_FACT, SYSTEMIC

**Formula:** Laplace smoothing: `P(angle) = (success_count + 1) / (total_trials + 3)`

**Key functions:**
- `sampleNextPivotAngle(niche)` — Weighted random sample based on historical outlier rates
- `recordPivotGeneration(niche, pivot, isOutlier)` — Records outcome for learning
- `calculatePivotWeights(niche)` — Returns all angles with probability weights
- `getPivotStatsForNiche(niche)` — Human-readable stats

**DB table:** `script_generation_log` (created on first use)

---

### 5. Scriptwriter (`src/scriptwriter.ts`)

**Purpose:** Generates production-ready video scripts via Claude Sonnet API.

**Flow:**
1. Select pivot angle (forced or Bayesian-sampled from governor)
2. Build system prompt with niche constraints, patterns from brief, emotional arc
3. Call Anthropic Sonnet API (`claude-3-5-sonnet-20241022`)
4. Run quality gates:
   - Blocklist scan (regex, free)
   - Anti-slop gate (originality check)
   - AHA moment validation (specificity, non-Googleability)
   - Novelty score (Jaccard overlap with last 3 approved scripts)
   - Sensory detail count
   - Concept density
5. Record pivot outcome to governor (learn from success/failure)
6. Return `ScriptOutput` with `ready_for_production` boolean

**Key:** `forcedPivot` and `constraints` are now optional. When omitted, the Bayesian governor auto-selects the pivot and constraints are derived from the brief's top patterns.

**Known gap:** No retry logic when gates fail. Planned but not yet implemented.

---

### 6. Pipeline Orchestrator (`src/pipeline.ts`)

**Purpose:** Single entry point connecting all modules.

**Functions:**
- `analyzeChannel(input, niche, opts)` — Ingest → load from DB → God's Eye brief → human summary
- `analyzeAndScript(input, niche, mechanism, opts)` — Full pipeline: brief → script → pre-production score
- `scoreConceptForChannel(input, concept, niche)` — Score a concept without generating a script

---

### 7. CLI (`scripts/pipeline-cli.ts`)

**Commands:**
```bash
# Analyze a channel
npx tsx scripts/pipeline-cli.ts analyze @ChannelHandle --niche comedy

# Generate a script
npx tsx scripts/pipeline-cli.ts script @ChannelHandle --niche comedy --mechanism NARRATIVE_VOID

# Score a concept
npx tsx scripts/pipeline-cli.ts score @ChannelHandle --title "Why Is Everyone Wrong?" --niche comedy

# JSON output
npx tsx scripts/pipeline-cli.ts analyze @Channel --json

# Force re-fetch
npx tsx scripts/pipeline-cli.ts analyze @Channel --force
```

---

## Database Schema (pipeline-relevant tables)

```sql
youtube_channels    -- channel_id (PK), title, subscriber_count, view_count, fetched_at
youtube_videos      -- video_id (PK), channel_id (FK), title, view_count, like_count,
                    -- comment_count, published_at, duration_seconds, last_synced_at
youtube_transcripts -- video_id (FK), segment text (for future transcript analysis)
youtube_comments    -- video_id (FK), author, text, like_count
youtube_analytics   -- video_id (FK), daily views, watch_time, engagement, CTR
tracked_competitors -- channel_id, channel_name, niche, tracked_since
script_generation_log -- niche, pivot_angle, is_outlier (for Bayesian governor learning)
hive_mind           -- agent_id, action, summary, artifacts (cross-agent activity log)
```

---

## Config Requirements

```env
YOUTUBE_API_KEY=...        # Required for pipeline. YouTube Data API v3.
ANTHROPIC_API_KEY=...      # Required for script generation (Sonnet API).
```

---

## Test Coverage

| File | Tests | What's covered |
|------|-------|---------------|
| `bayesian-confidence.test.ts` | 18 | Prior-only, differential impact, recency decay, CI bounds, tentative flag, niche priors, effective sample size, confidence bounds, interpretation tiers, formatConfidence |
| `gods-eye-brief.test.ts` | 12 | Emotional arc (cluster selection, effectiveness computation, missing beats, different channels → different arcs), competitor gaps (no hardcoded values, format detection, variance, recency, Bayesian confidence), integration test |

Run: `npm test` or `npx vitest run`

---

## Known Gaps / TODO

| Priority | What | Where |
|----------|------|-------|
| HIGH | Scriptwriter retry logic on gate failure | `scriptwriter.ts` |
| HIGH | Cross-channel comparison (your patterns vs theirs) | `gods-eye-brief.ts` |
| MEDIUM | Hook analysis uses top 3 by position, not performance | `gods-eye-brief.ts analyzeHook()` |
| MEDIUM | Anti-slop Gemini integration is a placeholder | `anti-slop.ts getGeminiOriginalityScore()` |
| MEDIUM | `toHumanReadable()` lives in bayesian-confidence.ts | Should move to gods-eye-brief.ts |
| LOW | No end-to-end integration test for full pipeline | Need mock YouTube API |
| LOW | Sonnet API call has no prompt caching or cost tracking | `scriptwriter.ts` |
| LOW | `detectPatterns()` and `analyzeHook()` have no dedicated tests | Only tested via integration |

---

## How to Run

```bash
# Install
cd claudeclaw-os
npm install

# Build
npm run build:server

# Run tests
npm test

# Analyze a channel (requires YOUTUBE_API_KEY in .env)
npx tsx scripts/pipeline-cli.ts analyze @MrBeast --niche entertainment

# Score a concept
npx tsx scripts/pipeline-cli.ts score @MrBeast --title "Why This Tech Will Change Everything?" --niche entertainment

# Full pipeline (requires ANTHROPIC_API_KEY for script generation)
npx tsx scripts/pipeline-cli.ts script @SomeCreator --niche comedy
```

---

## Revision History

- **2026-05-08:** Initial pipeline build. YouTube ingest, data-driven emotional arc + competitor gaps, Bayesian integration, pre-production scoring, CLI, 30 tests, README docs.
