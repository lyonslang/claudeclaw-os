/**
 * query-hive-mind.ts
 * Structured retrieval function for accessing hive_mind data with niche/context filtering
 */

import Database from 'better-sqlite3';
import path from 'path';

interface QueryOptions {
  niche?: string;
  channel_id?: string;
  agent_id?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

interface HiveMindEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  summary: string;
  artifacts?: string;
  niche: string;
  created_at: number;
}

export function queryHiveMind(options: QueryOptions): HiveMindEntry[] {
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);

  let query = 'SELECT * FROM hive_mind WHERE 1=1';
  const params: (string | number)[] = [];

  if (options.niche) {
    query += ' AND niche = ?';
    params.push(options.niche);
  }

  if (options.agent_id) {
    query += ' AND agent_id = ?';
    params.push(options.agent_id);
  }

  if (options.action) {
    query += ' AND action = ?';
    params.push(options.action);
  }

  query += ' ORDER BY created_at DESC';

  if (options.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options.offset) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }

  const stmt = db.prepare(query);
  const results = stmt.all(...params) as HiveMindEntry[];

  db.close();
  return results;
}

/**
 * Query YouTube insights with niche filtering
 */
export function queryInsights(niche: string, limit = 10): any[] {
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);

  const query = `
    SELECT * FROM youtube_insights
    WHERE niche = ?
    ORDER BY created_at DESC, confidence_score DESC
    LIMIT ?
  `;

  const stmt = db.prepare(query);
  const results = stmt.all(niche, limit);

  db.close();
  return results;
}

/**
 * Get high-confidence insights for a niche (confidence >= threshold)
 */
export function queryHighConfidenceInsights(niche: string, minConfidence = 70, limit = 5): any[] {
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);

  const query = `
    SELECT * FROM youtube_insights
    WHERE niche = ? AND confidence_score >= ?
    ORDER BY confidence_score DESC, created_at DESC
    LIMIT ?
  `;

  const stmt = db.prepare(query);
  const results = stmt.all(niche, minConfidence, limit);

  db.close();
  return results;
}

export default {
  queryHiveMind,
  queryInsights,
  queryHighConfidenceInsights,
};
