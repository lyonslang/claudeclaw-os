/**
 * God's Eye Brief Cache Utility
 * Implements invocation guardrails per AGENT_AUTONOMY_RULES.md
 *
 * Purpose: Prevent redundant God's Eye API calls by caching briefs
 * Only Scriptwriter (content agent) should call God's Eye directly.
 * All other agents query the cache and read from hive_mind.
 *
 * NOTE: This is a thin wrapper around db.ts functions.
 * Core logic is in src/db.ts (queryGodSEyeBriefCache, storeGodSEyeBriefInCache, etc.)
 */

import {
  queryGodSEyeBriefCache as dbQueryCache,
  storeGodSEyeBriefInCache as dbStoreCache,
  incrementGodSEyeBriefCacheAccess as dbIncrementAccess,
  isBriefStale as dbIsBriefStale,
  getGodSEyeCacheStats as dbGetStats,
  GodSEyeBrief,
} from '../db.js';

export type { GodSEyeBrief };

export interface CacheQueryResult {
  brief: GodSEyeBrief | null;
  source: 'cache' | 'not_found';
  cost: number;
  error?: string;
}

/**
 * Query God's Eye brief cache before making API calls
 *
 * LOGIC:
 * 1. Check god_s_eye_brief_cache for (niche, channel_id)
 * 2. If found AND not expired: return cached brief (cost = $0)
 * 3. If not found or expired: return not_found (Scriptwriter calls God's Eye)
 *
 * @param niche - Content niche (e.g., "mystery_comedy")
 * @param channelId - YouTube channel ID
 * @param agentId - Current agent ID (for validation)
 * @returns CacheQueryResult with brief, source, and cost
 */
export function queryGodSEyeBriefCache(
  niche: string,
  channelId: string,
  agentId: string
): CacheQueryResult {
  try {
    const result = dbQueryCache(niche, channelId);

    if (result) {
      // Cache hit: increment access count and return brief
      dbIncrementAccess(niche, channelId);
      return {
        brief: result.brief,
        source: 'cache',
        cost: 0,
      };
    }

    // Cache miss
    return {
      brief: null,
      source: 'not_found',
      cost: 0,
    };
  } catch (error) {
    return {
      brief: null,
      source: 'not_found',
      cost: 0,
      error: `Cache query failed: ${error}`,
    };
  }
}

/**
 * Store God's Eye brief in cache after API call
 * ONLY Scriptwriter should call this (after invoking actual God's Eye API)
 *
 * @param niche - Content niche
 * @param channelId - YouTube channel ID
 * @param brief - Brief object returned by God's Eye
 * @param costUsd - API cost (typically $0.50)
 */
export function storeGodSEyeBriefInCache(
  niche: string,
  channelId: string,
  brief: GodSEyeBrief,
  costUsd: number = 0.5
): void {
  try {
    dbStoreCache(niche, channelId, brief, costUsd);
  } catch (error) {
    console.error(`Failed to store brief in cache: ${error}`);
    throw error;
  }
}

/**
 * Validate that only Scriptwriter is calling God's Eye
 * Other agents must query the cache and read from hive_mind
 *
 * @param agentId - Current agent ID
 * @returns true if agent is allowed to call God's Eye
 */
export function isAllowedToCallGodSEye(agentId: string): boolean {
  // Only 'content' agent (Scriptwriter) can call God's Eye directly
  return agentId === 'content';
}

/**
 * Check if a brief is stale (approaching expiration)
 * Used by scheduler to refresh briefs proactively
 *
 * @param niche - Content niche
 * @param channelId - YouTube channel ID
 * @param staleThresholdSeconds - Warn if expires in < this many seconds (default 12h)
 * @returns true if brief should be refreshed
 */
export function isBriefStale(
  niche: string,
  channelId: string,
  staleThresholdSeconds: number = 12 * 60 * 60
): boolean {
  return dbIsBriefStale(niche, channelId, staleThresholdSeconds);
}

/**
 * Get cache statistics for monitoring
 * @returns Object with cache stats
 */
export function getCacheStats(): {
  totalCached: number;
  totalAccesses: number;
  averageAccessCount: number;
  expiredCount: number;
} {
  return dbGetStats();
}
