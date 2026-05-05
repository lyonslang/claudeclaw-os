/**
 * Mission Post-Mortem Logger
 * Logs detailed mission metrics to mission_post_mortem table
 * Used by all agents to track costs, latency, decisions, and outcomes
 *
 * Per MISSION_POST_MORTEM_GUIDE.md
 */
import { logMissionPostMortem as dbLogMissionPostMortem } from '../db.js';
/**
 * Log mission post-mortem to database
 * Call this when a mission completes (success or failure)
 *
 * @param metrics - Complete mission metrics
 */
export function logMissionPostMortem(metrics) {
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
    }
    catch (error) {
        console.error(`[mission-logger] Failed to log post-mortem: ${error}`);
        throw error;
    }
}
/**
 * Quick builder for mission metrics
 * Use this pattern in agent completion handlers
 */
export class MissionMetricsBuilder {
    constructor(missionId, agentId, missionTitle) {
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
    setProject(projectId, niche) {
        this.metrics.projectId = projectId;
        this.metrics.niche = niche;
        return this;
    }
    setTiming(startedAt, completedAt) {
        this.metrics.startedAt = startedAt;
        this.metrics.completedAt = completedAt;
        return this;
    }
    setGodSEyeMetrics(total, cached, api, cost) {
        this.metrics.godSEyeCallsTotal = total;
        this.metrics.godSEyeCallsCached = cached;
        this.metrics.godSEyeCallsApi = api;
        this.metrics.godSEyeCost = cost;
        return this;
    }
    setAntiSlopMetrics(total, cached, rejections, flags) {
        this.metrics.antiSlopChecksTotal = total;
        this.metrics.antiSlopChecksCached = cached;
        this.metrics.antiSlopRejections = rejections;
        this.metrics.antiSlopFlags = flags;
        return this;
    }
    setCost(totalCostUsd) {
        this.metrics.totalCostUsd = totalCostUsd;
        return this;
    }
    setContextMetrics(peak, average) {
        this.metrics.peakContextTokens = peak;
        this.metrics.averageContextTokens = average;
        return this;
    }
    setDecisionMetrics(autonomous, escalations, escalationsAccepted, escalationsRejected) {
        this.metrics.autonomousDecisionsMade = autonomous;
        this.metrics.escalationsToAva = escalations;
        this.metrics.escalationsAccepted = escalationsAccepted;
        this.metrics.escalationsRejected = escalationsRejected;
        return this;
    }
    setOutputMetrics(produced, approvedFirstPass, rejected, revisionRounds) {
        this.metrics.numOutputsProduced = produced;
        this.metrics.outputsApprovedFirstPass = approvedFirstPass;
        this.metrics.outputsRejectedTotal = rejected;
        this.metrics.revisionRoundsTotal = revisionRounds;
        return this;
    }
    addFrictionPoint(stage, issue, resolutionTimeSec) {
        this.metrics.frictionPoints.push({ stage, issue, resolution_time_s: resolutionTimeSec });
        return this;
    }
    addLoopDetection(agent, loopType, iterations) {
        this.metrics.loopDetections.push({ agent, loop_type: loopType, iterations });
        return this;
    }
    setExpectations(expectedCost, expectedDurationSeconds) {
        this.metrics.expectedCost = expectedCost;
        this.metrics.expectedDurationSeconds = expectedDurationSeconds;
        return this;
    }
    setStatus(status, summary) {
        this.metrics.status = status;
        this.metrics.summary = summary;
        return this;
    }
    build() {
        return this.metrics;
    }
    log() {
        logMissionPostMortem(this.metrics);
    }
    logAndReturn() {
        logMissionPostMortem(this.metrics);
        return this.metrics;
    }
}
/**
 * Quick log helper (one-liner)
 * For simple missions without complex tracking
 */
export function logSimpleMission(missionId, agentId, title, costUsd, durationSeconds, status = 'completed', summary = '') {
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
