/**
 * Gods Eye — Shared Type Definitions
 * All interfaces used across the modular gods-eye/ subsystem.
 * No internal imports. Build this first — everything depends on it.
 */

export interface YouTubeChannel {
  title: string;
  custom_url?: string;
  subscriber_count: number;
  view_count: number;
  video_count: number;
  description?: string;
}

export interface YouTubeVideo {
  video_id: string;
  title: string;
  description?: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at?: string;
  duration_seconds?: number;
  engagement_rate: number;
  // Vexian moving average fields — set by calculateMovingAverages()
  moving_avg_5?: number;   // avg view_count of the 5 videos published before this one
  outlier_score?: number;  // view_count / moving_avg_5 — >1.5 = outlier
  is_outlier?: boolean;    // true if outlier_score >= 1.5
}

export interface Pattern {
  pattern: string;
  confidence: number;
  confidence_tier: string;
  credible_interval: [number, number];
  is_tentative: boolean;
  recency_adjusted: boolean;
  sample_count: number;
  performance_delta: string;
  performance_baseline: number;
  performance_with_pattern: number;
  evidence: string[];
  actionable_form: string;
  test_cost: 'Low' | 'Medium' | 'High';
  test_duration: number;
  success_metric: string;
}

export interface HookAnalysis {
  score: number;
  psychology: string;
  pattern_interrupt: boolean;
  curiosity_gap: boolean;
  social_proof: boolean;
  time_to_reveal_promise: number;
  strengths: string[];
  weaknesses: string[];
  recommended_hook: string;
  hook_template: string;
}

export interface EmotionalBeat {
  emotion: string;
  technique: string;
  example: string;
  effectiveness: number;
}

export interface EmotionalArc {
  opening: EmotionalBeat;
  middle: EmotionalBeat;
  peak: EmotionalBeat;
  close: EmotionalBeat;
  missing_beats: string[];
}

export interface CompetitorGap {
  gap: string;
  why_it_matters: string;
  how_to_exploit: string;
  risk_level: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface Recommendation {
  rank: number;
  technique: string;
  confidence: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  why: string;
  implementation: string;
  success_signal: string;
  test_cost: 'Low' | 'Medium' | 'High';
}

export interface KeyVisualMoment {
  timestamp: string;
  description: string;
  purpose: string;
}

export interface VisualPacingRecommendations {
  pace_profile: string;
  cut_frequency: string;
  key_visual_moments: KeyVisualMoment[];
  broll_cues: string[];
  thumbnail_strategy: string;
  avatar_direction: {
    emotion_map: Record<string, string>;
    gesture_intensity: string;
  };
}

export interface GodsEyeBrief {
  brief_id: string;
  niche: string;
  channel_name: string;
  analysis_date: string;
  sample_size: number;
  confidence_level: 'high' | 'medium' | 'low';
  confidence_note: string;
  hook_analysis: HookAnalysis;
  emotional_arc: EmotionalArc;
  visual_pacing: VisualPacingRecommendations;
  top_patterns: Pattern[];
  competitor_gaps: CompetitorGap[];
  recommendations: Recommendation[];
  next_steps: string[];
  methodology: {
    confidence_model: string;
    decay_half_life_days: number;
    minimum_sample_for_confidence: number;
  };
  caveats: {
    sample_size_note: string;
    survivorship_bias: string;
    niche_specificity: string;
  };
}

export interface QualityGateResult {
  clarity: number;
  actionability: number;
  novelty: number;
  passed: boolean;
  feedback: string[];
}

export interface PreProductionScoreResult {
  score: number;
  matched_patterns: string[];
  missing_patterns: string[];
  arc_alignment: string;
  confidence_weighted_score: number;
  summary: string;
}

export interface DreamCycleResult {
  full_summary: string;
  patterns_strengthened: number;
  patterns_pruned: number;
  priors_updated: number;
  channels_flagged: string[];
}