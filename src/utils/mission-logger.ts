/**
 * Mission Post-Mortem Logger
 * Logs detailed mission metrics to mission_post_mortem table
 * Used by all agents to track costs, latency, decisions, and outcomes
 *
 * Per MISSION_POST_MORTEM_GUIDE.md
 */

import { logMissionPostMortem as dbLogMissionPostMortem } from '../db.js';

export interface MissionMetrics {
  missionId: string;
  agentId: string;
  missionTitle: string;
  projectId?: string; // Project isolation (e.g., "test-phase1b", "fried-plantain")
  niche?: string; // Content niche (e.g., "mystery_comedy")

  // Timing
  startedAt: number; // Unix timestamp (seconds)
  completedAt: number;

  // Resource usage
  godSEyeCallsTotal: number;
  godSEyeCallsCached: number;
  godSEyeCallsApi: number;
  godSEyeCost: number;

  antiSlopChecksTotal: number;
  antiSlopChecksCached: number;
  antiSlopRejections: number; // HIGH risk scores
  antiSlopFlags: number; // MEDIUM risk scores

  totalCostUsd: number;

  // Context efficiency
  peakContextTokens: number;
  averageContextTokens: number;

  // Decision metrics
  autonomousDecisionsMade: number;
  escalationsToAva: number;
  escalationsAccepted: number;
  escalationsRejected: number;

  // Quality signals
  numOutputsProduced: number; // scripts, videos, etc.
  outputsApprovedFirstPass: number;
  outputsRejectedTotal: number;
  revisionRoundsTotal: number;

  // Friction points & loops (JSON arrays)
  frictionPoints: Array<{
    stage: string;
    issue: string;
    resolution_time_s?: number;
  }>;
  loopDetections: Array<{
    agent: string;
    loop_type: string;
    iterations: number;
  }>;

  // Estimates for variance calculation
  expectedCost: number;
  expectedDurationSeconds: number;

  // Status
  status: 'completed' | 'failed' | 'incomplete';
  summary: string;
}

/**
 * Log mission post-mortem to database
 * Call this when a mission completes (success or failure)
 *
 * @param metrics - Complete mission metrics
 */
export function logMissionPostMortem(metrics: MissionMetrics): void {
  try {
    dbLogMissionPostMortem({
      missionId: metrics.missionId,
      agentId: metrics.agentId,
      missionTitle: metrics.missionTitle,
      projectId: metrics.projectId,
      niche: metrics.niche,
      startedAt: metrics.startedAt,
      completedAt: metrics.completedAt,
      godSEyeCallsTotal: metrics.godSEyeCallsTotal,
      godSEyeCallsCached: metrics.godSEyeCallsCached,
      godSEyeCallsApi: metrics.godSEyeCallsApi,
      godSEyeCost: metrics.godSEyeCost,
      antiSlopChecksTotal: metrics.antiSlopChecksTotal,
      antiSlopChecksCached: metrics.antiSlopChecksCached,
      antiSlopRejections: metrics.antiSlopRejections,
      antiSlopFlags: metrics.antiSlopFlags,
      totalCostUsd: metrics.totalCostUsd,
      peakContextTokens: metrics.peakContextTokens,
      averageContextTokens: metrics.averageContextTokens,
      autonomousDecisionsMade: metrics.autonomousDecisionsMade,
      escalationsToAva: metrics.escalationsToAva,
      escalationsAccepted: metrics.escalationsAccepted,
      escalationsRejected: metrics.escalationsRejected,
      numOutputsProduced: metrics.numOutputsProduced,
      outputsApprovedFirstPass: metrics.outputsApprovedFirstPass,
      outputsRejectedTotal: metrics.outputsRejectedTotal,
      revisionRoundsTotal: metrics.revisionRoundsTotal,
      frictionPoints: metrics.frictionPoints,
      loopDetections: metrics.loopDetections,
      expectedCost: metrics.expectedCost,
      expectedDurationSeconds: metrics.expectedDurationSeconds,
      status: metrics.status,
      summary: metrics.summary,
    });

    console.log(`[mission-logger] Logged post-mortem for mission ${metrics.missionId}`);
  } catch (error) {
    console.error(`[mission-logger] Failed to log post-mortem: ${error}`);
    throw error;
  }
}

/**
 * Quick builder for mission metrics
 * Use this pattern in agent completion handlers
 */
export class MissionMetricsBuilder {
  private metrics: MissionMetrics;

  constructor(missionId: string, agentId: string, missionTitle: string) {
    const now = Math.floor(Date.now() / 1000);
    this.metrics = {
      missionId,
      agentId,
      missionTitle,
      startedAt: now,
      completedAt: now,
      godSEyeCallsTotal: 0,
      godSEyeCallsCached: 0,
      godSEyeCallsApi: 0,
      godSEyeCost: 0,
      antiSlopChecksTotal: 0,
      antiSlopChecksCached: 0,
      antiSlopRejections: 0,
      antiSlopFlags: 0,
      totalCostUsd: 0,
      peakContextTokens: 0,
      averageContextTokens: 0,
      autonomousDecisionsMade: 0,
      escalationsToAva: 0,
      escalationsAccepted: 0,
      escalationsRejected: 0,
      numOutputsProduced: 0,
      outputsApprovedFirstPass: 0,
      outputsRejectedTotal: 0,
      revisionRoundsTotal: 0,
      frictionPoints: [],
      loopDetections: [],
      expectedCost: 0,
      expectedDurationSeconds: 0,
      status: 'completed',
      summary: '',
    };
  }

  setProject(projectId: string, niche: string): this {
    this.metrics.projectId = projectId;
    this.metrics.niche = niche;
    return this;
  }

  setTiming(startedAt: number, completedAt: number): this {
    this.metrics.startedAt = startedAt;
    this.metrics.completedAt = completedAt;
    return this;
  }

  setGodSEyeMetrics(total: number, cached: number, api: number, cost: number): this {
    this.metrics.godSEyeCallsTotal = total;
    this.metrics.godSEyeCallsCached = cached;
    this.metrics.godSEyeCallsApi = api;
    this.metrics.godSEyeCost = cost;
    return this;
  }

  setAntiSlopMetrics(total: number, cached: number, rejections: number, flags: number): this {
    this.metrics.antiSlopChecksTotal = total;
    this.metrics.antiSlopChecksCached = cached;
    this.metrics.antiSlopRejections = rejections;
    this.metrics.antiSlopFlags = flags;
    return this;
  }

  setCost(totalCostUsd: number): this {
    this.metrics.totalCostUsd = totalCostUsd;
    return this;
  }

  setContextMetrics(peak: number, average: number): this {
    this.metrics.peakContextTokens = peak;
    this.metrics.averageContextTokens = average;
    return this;
  }

  setDecisionMetrics(
    autonomous: number,
    escalations: number,
    escalationsAccepted: number,
    escalationsRejected: number
  ): this {
    this.metrics.autonomousDecisionsMade = autonomous;
    this.metrics.escalationsToAva = escalations;
    this.metrics.escalationsAccepted = escalationsAccepted;
    this.metrics.escalationsRejected = escalationsRejected;
    return this;
  }

  setOutputMetrics(
    produced: number,
    approvedFirstPass: number,
    rejected: number,
    revisionRounds: number
  ): this {
    this.metrics.numOutputsProduced = produced;
    this.metrics.outputsApprovedFirstPass = approvedFirstPass;
    this.metrics.outputsRejectedTotal = rejected;
    this.metrics.revisionRoundsTotal = revisionRounds;
    return this;
  }

  addFrictionPoint(stage: string, issue: string, resolutionTimeSec?: number): this {
    this.metrics.frictionPoints.push({ stage, issue, resolution_time_s: resolutionTimeSec });
    return this;
  }

  addLoopDetection(agent: string, loopType: string, iterations: number): this {
    this.metrics.loopDetections.push({ agent, loop_type: loopType, iterations });
    return this;
  }

  setExpectations(expectedCost: number, expectedDurationSeconds: number): this {
    this.metrics.expectedCost = expectedCost;
    this.metrics.expectedDurationSeconds = expectedDurationSeconds;
    return this;
  }

  setStatus(status: 'completed' | 'failed' | 'incomplete', summary: string): this {
    this.metrics.status = status;
    this.metrics.summary = summary;
    return this;
  }

  build(): MissionMetrics {
    return this.metrics;
  }

  log(): void {
    logMissionPostMortem(this.metrics);
  }

  logAndReturn(): MissionMetrics {
    logMissionPostMortem(this.metrics);
    return this.metrics;
  }
}

/**
 * Quick log helper (one-liner)
 * For simple missions without complex tracking
 */
export function logSimpleMission(
  missionId: string,
  agentId: string,
  title: string,
  costUsd: number,
  durationSeconds: number,
  status: 'completed' | 'failed' | 'incomplete' = 'completed',
  summary = ''
): void {
  const now = Math.floor(Date.now() / 1000);

  logMissionPostMortem({
    missionId,
    agentId,
    missionTitle: title,
    startedAt: now - durationSeconds,
    completedAt: now,
    godSEyeCallsTotal: 0,
    godSEyeCallsCached: 0,
    godSEyeCallsApi: 0,
    godSEyeCost: 0,
    antiSlopChecksTotal: 0,
    antiSlopChecksCached: 0,
    antiSlopRejections: 0,
    antiSlopFlags: 0,
    totalCostUsd: costUsd,
    peakContextTokens: 0,
    averageContextTokens: 0,
    autonomousDecisionsMade: 0,
    escalationsToAva: 0,
    escalationsAccepted: 0,
    escalationsRejected: 0,
    numOutputsProduced: 0,
    outputsApprovedFirstPass: 0,
    outputsRejectedTotal: 0,
    revisionRoundsTotal: 0,
    frictionPoints: [],
    loopDetections: [],
    expectedCost: costUsd,
    expectedDurationSeconds: durationSeconds,
    status,
    summary,
  });
}
