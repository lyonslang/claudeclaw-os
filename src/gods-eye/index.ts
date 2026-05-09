/**
 * Gods Eye — Public API
 * Import from here — never from submodules directly.
 */

// Types
export type {
  YouTubeChannel,
  YouTubeVideo,
  Pattern,
  HookAnalysis,
  EmotionalBeat,
  EmotionalArc,
  CompetitorGap,
  Recommendation,
  GodsEyeBrief,
  QualityGateResult,
  PreProductionScoreResult,
  DreamCycleResult,
} from './types.js';

// Brief generation
export { generateGodsEyeBrief, getChannelDataFromHiveMind, getOutlierVideos, generateGodsEyeBriefFromHiveMind } from './brief.js';

// Pre-production scoring
export { preProductionScore } from './pre-production.js';

// Dreaming layer
export { runDreamCycle, getDreamLog } from './dreaming.js';