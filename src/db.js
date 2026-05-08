import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DB_ENCRYPTION_KEY, STORE_DIR } from './config.js';
import { cosineSimilarity } from './embeddings.js';
import { logger } from './logger.js';
// ── Field-Level Encryption (AES-256-GCM) ────────────────────────────
// All message bodies (WhatsApp, Slack) are encrypted before storage
// and decrypted on read. The key lives in .env (DB_ENCRYPTION_KEY).
let encryptionKey = null;
function getEncryptionKey() {
    if (encryptionKey)
        return encryptionKey;
    const hex = DB_ENCRYPTION_KEY;
    if (!hex || hex.length < 32) {
        throw new Error('DB_ENCRYPTION_KEY is missing or too short. Run: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" and add to .env');
    }
    encryptionKey = Buffer.from(hex, 'hex');
    return encryptionKey;
}
/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a compact string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encryptField(plaintext) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
/**
 * Decrypt a string produced by encryptField().
 * Returns the original plaintext. If decryption fails (wrong key, tampered),
 * returns the raw input unchanged (graceful fallback for pre-encryption data).
 */
export function decryptField(ciphertext) {
    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 3)
            return ciphertext; // Not encrypted, return as-is
        const [ivHex, authTagHex, dataHex] = parts;
        if (!ivHex || !authTagHex || !dataHex)
            return ciphertext;
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const data = Buffer.from(dataHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
        return decrypted.toString('utf8');
    }
    catch {
        // Decryption failed: probably pre-encryption plaintext data
        return ciphertext;
    }
}
let db;
function createSchema(database) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id          TEXT PRIMARY KEY,
      prompt      TEXT NOT NULL,
      schedule    TEXT NOT NULL,
      next_run    INTEGER NOT NULL,
      last_run    INTEGER,
      last_result TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON scheduled_tasks(status, next_run);

    CREATE TABLE IF NOT EXISTS sessions (
      chat_id    TEXT NOT NULL,
      agent_id   TEXT NOT NULL DEFAULT 'main',
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id       TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'conversation',
      raw_text      TEXT NOT NULL,
      summary       TEXT NOT NULL,
      entities      TEXT NOT NULL DEFAULT '[]',
      topics        TEXT NOT NULL DEFAULT '[]',
      connections   TEXT NOT NULL DEFAULT '[]',
      importance    REAL NOT NULL DEFAULT 0.5,
      salience      REAL NOT NULL DEFAULT 1.0,
      consolidated  INTEGER NOT NULL DEFAULT 0,
      embedding     TEXT,
      created_at    INTEGER NOT NULL,
      accessed_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS consolidations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id       TEXT NOT NULL,
      source_ids    TEXT NOT NULL,
      summary       TEXT NOT NULL,
      insight       TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_consolidations_chat ON consolidations(chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS wa_message_map (
      telegram_msg_id INTEGER PRIMARY KEY,
      wa_chat_id      TEXT NOT NULL,
      contact_name    TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_outbox (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      to_chat_id  TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      sent_at     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_wa_outbox_unsent ON wa_outbox(sent_at) WHERE sent_at IS NULL;

    CREATE TABLE IF NOT EXISTS wa_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id      TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      body         TEXT NOT NULL,
      timestamp    INTEGER NOT NULL,
      is_from_me   INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wa_messages_chat ON wa_messages(chat_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS conversation_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id     TEXT NOT NULL,
      session_id  TEXT,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_convo_log_chat ON conversation_log(chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS token_usage (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id         TEXT NOT NULL,
      session_id      TEXT,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_read      INTEGER NOT NULL DEFAULT 0,
      context_tokens  INTEGER NOT NULL DEFAULT 0,
      cost_usd        REAL NOT NULL DEFAULT 0,
      did_compact     INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_token_usage_chat ON token_usage(chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS slack_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id   TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      user_name    TEXT NOT NULL,
      body         TEXT NOT NULL,
      timestamp    TEXT NOT NULL,
      is_from_me   INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS hive_mind (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      action      TEXT NOT NULL,
      summary     TEXT NOT NULL,
      artifacts   TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hive_mind_agent ON hive_mind(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hive_mind_time ON hive_mind(created_at DESC);

    CREATE TABLE IF NOT EXISTS inter_agent_tasks (
      id            TEXT PRIMARY KEY,
      from_agent    TEXT NOT NULL,
      to_agent      TEXT NOT NULL,
      chat_id       TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      result        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inter_agent_tasks_status ON inter_agent_tasks(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS mission_tasks (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      prompt          TEXT NOT NULL,
      assigned_agent  TEXT,
      status          TEXT NOT NULL DEFAULT 'queued',
      result          TEXT,
      error           TEXT,
      created_by      TEXT NOT NULL DEFAULT 'dashboard',
      priority        INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      started_at      INTEGER,
      completed_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_mission_status
      ON mission_tasks(assigned_agent, status, priority DESC, created_at ASC);

    CREATE TABLE IF NOT EXISTS meet_sessions (
      id              TEXT PRIMARY KEY,         -- session id from the provider's join response
      agent_id        TEXT NOT NULL,            -- which agent is in the meeting
      meet_url        TEXT NOT NULL,
      bot_name        TEXT NOT NULL,
      platform        TEXT NOT NULL DEFAULT 'google_meet',
      provider        TEXT NOT NULL DEFAULT 'pika',  -- pika (avatar) | recall (voice-only)
      status          TEXT NOT NULL DEFAULT 'joining', -- joining | live | left | failed
      voice_id        TEXT,
      image_path      TEXT,                     -- avatar image used for this session (pika only)
      brief_path      TEXT,                     -- path to the frozen system prompt file
      created_at      INTEGER NOT NULL,
      joined_at       INTEGER,
      left_at         INTEGER,
      post_notes      TEXT,                     -- post-meeting notes, fetched after leave
      error           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_meet_status ON meet_sessions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meet_agent ON meet_sessions(agent_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS warroom_meetings (
      id          TEXT PRIMARY KEY,
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      duration_s  INTEGER,
      mode        TEXT NOT NULL DEFAULT 'direct',  -- direct | auto
      pinned_agent TEXT DEFAULT 'main',
      entry_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_warroom_meetings_time ON warroom_meetings(started_at DESC);

    CREATE TABLE IF NOT EXISTS warroom_transcript (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id  TEXT NOT NULL,
      speaker     TEXT NOT NULL,     -- 'user' | agent id | 'system'
      text        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES warroom_meetings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_warroom_transcript_meeting ON warroom_transcript(meeting_id, created_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL DEFAULT 'main',
      chat_id     TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '',
      blocked     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, created_at DESC);

    -- Per-workspace personalization (workspace name, hotkey mod, mission
    -- column order/widths, etc). Simple key/value with last-write-wins;
    -- no auth scoping because the dashboard token is the auth boundary.
    CREATE TABLE IF NOT EXISTS dashboard_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- Append-only version history for agent files edited from the
    -- dashboard (CLAUDE.md, agent.yaml). Replaces the single-file .backup
    -- approach so the user can browse prior versions and restore any.
    -- file_kind is the editor's tab key ('claudemd' | 'agent-yaml').
    -- Content stored inline; size cap is enforced at the API layer
    -- (200KB for CLAUDE.md, 64KB for agent.yaml).
    CREATE TABLE IF NOT EXISTS agent_file_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL,
      file_kind   TEXT NOT NULL,
      content     TEXT NOT NULL,
      byte_size   INTEGER NOT NULL,
      sha256      TEXT NOT NULL,
      author      TEXT NOT NULL DEFAULT 'dashboard',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_file_history_lookup
      ON agent_file_history(agent_id, file_kind, created_at DESC);

    -- LLM-generated suggestions for spinning off specialized agents.
    -- The analyzer scans hive_mind activity grouped by agent_id and
    -- spots when one agent is doing several distinct domains that
    -- would benefit from being split. Each suggestion lives until the
    -- user dismisses it (sets dismissed_at) or acts on it. We keep
    -- dismissed rows so re-running analysis doesn't keep re-suggesting
    -- the same split — the analyzer skips parents+IDs that already
    -- have a non-superseded suggestion.
    CREATE TABLE IF NOT EXISTS agent_suggestions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent            TEXT NOT NULL,
      suggested_id          TEXT NOT NULL,
      suggested_name        TEXT NOT NULL,
      suggested_description TEXT NOT NULL,
      reasoning             TEXT NOT NULL,
      activity_share_pct    INTEGER,
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      dismissed_at          INTEGER,
      acted_at              INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_suggestions_active
      ON agent_suggestions(from_agent, created_at DESC)
      WHERE dismissed_at IS NULL AND acted_at IS NULL;

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      summary,
      raw_text,
      entities,
      topics,
      content=memories,
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, summary, raw_text, entities, topics)
        VALUES (new.id, new.summary, new.raw_text, new.entities, new.topics);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text, entities, topics)
        VALUES ('delete', old.id, old.summary, old.raw_text, old.entities, old.topics);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text, entities, topics)
        VALUES ('delete', old.id, old.summary, old.raw_text, old.entities, old.topics);
      INSERT INTO memories_fts(rowid, summary, raw_text, entities, topics)
        VALUES (new.id, new.summary, new.raw_text, new.entities, new.topics);
    END;

    -- Phase 2.4: Compaction event tracking
    CREATE TABLE IF NOT EXISTS compaction_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      pre_tokens  INTEGER NOT NULL DEFAULT 0,
      post_tokens INTEGER NOT NULL DEFAULT 0,
      turn_count  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_compaction_session ON compaction_events(session_id, created_at DESC);

    -- Phase 4.2: Skill health checks
    CREATE TABLE IF NOT EXISTS skill_health (
      skill_id    TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'unchecked',
      error_msg   TEXT NOT NULL DEFAULT '',
      last_check  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- Phase 4.3: Skill usage analytics
    CREATE TABLE IF NOT EXISTS skill_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id    TEXT NOT NULL,
      chat_id     TEXT NOT NULL DEFAULT '',
      agent_id    TEXT NOT NULL DEFAULT 'main',
      triggered_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      tokens_used INTEGER NOT NULL DEFAULT 0,
      succeeded   INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage(skill_id, triggered_at DESC);

    -- Phase 6.2: Session summaries
    CREATE TABLE IF NOT EXISTS session_summaries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL UNIQUE,
      summary     TEXT NOT NULL,
      key_decisions TEXT NOT NULL DEFAULT '[]',
      turn_count  INTEGER NOT NULL DEFAULT 0,
      total_cost  REAL NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- ── Competitor Tracking ───────────────────────────────────────────
    -- Monitor competitor channels for drop-off patterns and strategy intel

    CREATE TABLE IF NOT EXISTS tracked_competitors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id      TEXT NOT NULL UNIQUE,
      channel_name    TEXT NOT NULL,
      platform        TEXT NOT NULL DEFAULT 'youtube',
      niche           TEXT NOT NULL DEFAULT '',
      tracked_since   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      notes           TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_competitors_niche ON tracked_competitors(niche, platform);

    -- ── Channel Authority ─────────────────────────────────────────────
    -- Channel health, monetization readiness, and email list scoring

    CREATE TABLE IF NOT EXISTS channel_snapshots (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id            TEXT NOT NULL,
      platform              TEXT NOT NULL DEFAULT 'youtube',
      snapshot_date         TEXT NOT NULL,
      subscriber_count      INTEGER NOT NULL DEFAULT 0,
      total_views           INTEGER NOT NULL DEFAULT 0,
      avg_engagement_rate   REAL NOT NULL DEFAULT 0,
      watch_time_hours      REAL NOT NULL DEFAULT 0,
      health_score          REAL NOT NULL DEFAULT 0,   -- 0-100
      email_health_score    REAL NOT NULL DEFAULT 0,   -- 0-100
      sponsor_ready_score   REAL NOT NULL DEFAULT 0,   -- 0-100
      notes                 TEXT NOT NULL DEFAULT '',
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(channel_id, platform, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_snapshots_channel ON channel_snapshots(channel_id, snapshot_date DESC);

    CREATE TABLE IF NOT EXISTS email_list_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id         TEXT NOT NULL,
      list_name       TEXT NOT NULL,
      snapshot_date   TEXT NOT NULL,
      total_subs      INTEGER NOT NULL DEFAULT 0,
      open_rate       REAL NOT NULL DEFAULT 0,
      click_rate      REAL NOT NULL DEFAULT 0,
      unsub_rate      REAL NOT NULL DEFAULT 0,
      health_score    REAL NOT NULL DEFAULT 0,   -- 0-100
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(list_id, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_email_list_channel ON email_list_snapshots(list_id, snapshot_date DESC);

    -- ── YouTube Content Pipeline ──────────────────────────────────────
    -- Stores YouTube video metadata and analytics for God's Eye orchestration

    CREATE TABLE IF NOT EXISTS youtube_videos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id          TEXT NOT NULL UNIQUE,
      channel_id        TEXT NOT NULL,
      title             TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      published_at      INTEGER NOT NULL,
      duration_seconds  INTEGER,
      view_count        INTEGER NOT NULL DEFAULT 0,
      like_count        INTEGER NOT NULL DEFAULT 0,
      comment_count     INTEGER NOT NULL DEFAULT 0,
      last_synced_at    INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_videos_channel ON youtube_videos(channel_id, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_youtube_videos_published ON youtube_videos(published_at DESC);

    CREATE TABLE IF NOT EXISTS youtube_transcripts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id        TEXT NOT NULL,
      segment_num     INTEGER NOT NULL,
      start_seconds   INTEGER NOT NULL,
      end_seconds     INTEGER NOT NULL,
      text            TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_transcripts_video ON youtube_transcripts(video_id, segment_num);

    CREATE TABLE IF NOT EXISTS youtube_comments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id        TEXT NOT NULL,
      comment_id      TEXT NOT NULL UNIQUE,
      author          TEXT NOT NULL,
      text            TEXT NOT NULL,
      like_count      INTEGER NOT NULL DEFAULT 0,
      reply_count     INTEGER NOT NULL DEFAULT 0,
      published_at    INTEGER NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_comments_video ON youtube_comments(video_id, like_count DESC);

    CREATE TABLE IF NOT EXISTS youtube_analytics (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id        TEXT NOT NULL,
      analytics_date  TEXT NOT NULL,
      views           INTEGER NOT NULL DEFAULT 0,
      watch_time_hours REAL NOT NULL DEFAULT 0,
      engagement_rate REAL NOT NULL DEFAULT 0,
      click_through_rate REAL NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_analytics_video ON youtube_analytics(video_id, analytics_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_analytics_unique ON youtube_analytics(video_id, analytics_date);

    CREATE TABLE IF NOT EXISTS youtube_viewer_retention (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id        TEXT NOT NULL,
      segment_num     INTEGER NOT NULL,
      start_seconds   INTEGER NOT NULL,
      end_seconds     INTEGER NOT NULL,
      viewers_started REAL NOT NULL DEFAULT 100,  -- percentage (100 = full audience)
      viewers_at_end  REAL NOT NULL DEFAULT 0,    -- percentage who stayed to end of segment
      drop_off_rate   REAL NOT NULL DEFAULT 0,    -- percentage who left during segment
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_retention_video ON youtube_viewer_retention(video_id, segment_num);
    CREATE INDEX IF NOT EXISTS idx_youtube_retention_dropoff ON youtube_viewer_retention(video_id, drop_off_rate DESC);

    CREATE TABLE IF NOT EXISTS youtube_visual_analysis (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id        TEXT NOT NULL,
      pacing_score    REAL NOT NULL DEFAULT 0,    -- 0-100: fast cuts = higher
      cut_frequency   REAL NOT NULL DEFAULT 0,    -- cuts per minute
      avatar_quality  REAL NOT NULL DEFAULT 0,    -- 0-100: expressiveness, movement
      visual_complexity REAL NOT NULL DEFAULT 0,  -- 0-100: graphics, overlays, B-roll
      editing_style   TEXT NOT NULL DEFAULT '',   -- descriptive: "jump cuts", "smooth transitions", etc.
      thumbnail_notes TEXT NOT NULL DEFAULT '',   -- what works in thumbnail
      overall_notes   TEXT NOT NULL DEFAULT '',   -- Gemini's summary of visual approach
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (video_id) REFERENCES youtube_videos(video_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_visual_video ON youtube_visual_analysis(video_id);
    CREATE INDEX IF NOT EXISTS idx_youtube_visual_quality ON youtube_visual_analysis(avatar_quality DESC);

    -- Recurring analysis requests (e.g., "every Monday analyze top 3 videos")
    CREATE TABLE IF NOT EXISTS standing_queries (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      prompt          TEXT NOT NULL,
      schedule        TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      next_run        INTEGER NOT NULL,
      last_run        INTEGER,
      last_result     TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      created_by      TEXT NOT NULL DEFAULT 'system'
    );
    CREATE INDEX IF NOT EXISTS idx_standing_queries_next_run ON standing_queries(status, next_run);
    CREATE INDEX IF NOT EXISTS idx_standing_queries_agent ON standing_queries(agent_id, status);
  `);
}
export function initDatabase() {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
    // Validate encryption key is available before proceeding
    getEncryptionKey();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    // Wait up to 5s on write locks. Multiple agent processes (main + research +
    // comms + content + ops) run initDatabase() at startup; without this a
    // concurrent ALTER can throw SQLITE_BUSY on whichever process loses the race.
    db.pragma('busy_timeout = 5000');
    createSchema(db);
    runMigrations(db);
    // Restrict database file permissions (owner-only read/write)
    try {
        for (const suffix of ['', '-wal', '-shm']) {
            const f = dbPath + suffix;
            if (fs.existsSync(f))
                fs.chmodSync(f, 0o600);
        }
        fs.chmodSync(STORE_DIR, 0o700);
    }
    catch { /* non-fatal on platforms that don't support chmod */ }
}
/**
 * Add a column to a table if it doesn't already exist. Tolerates the
 * concurrent-startup race where two agent processes both observe the column
 * as missing and both attempt the ALTER; whichever loses sees "duplicate
 * column" and treats it as a no-op.
 */
function addColumnIfMissing(database, table, column, typeAndDefault) {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.some((c) => c.name === column))
        return;
    try {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeAndDefault}`);
    }
    catch (err) {
        if (/duplicate column/i.test(err?.message ?? ''))
            return;
        throw err;
    }
}
/** Add columns that may not exist in older databases. */
function runMigrations(database) {
    // Add context_tokens column to token_usage (introduced for accurate context tracking)
    const cols = database.prepare(`PRAGMA table_info(token_usage)`).all();
    const hasContextTokens = cols.some((c) => c.name === 'context_tokens');
    if (!hasContextTokens) {
        database.exec(`ALTER TABLE token_usage ADD COLUMN context_tokens INTEGER NOT NULL DEFAULT 0`);
    }
    // Multi-agent: migrate sessions table to composite primary key (chat_id, agent_id)
    // Check if PK is composite by looking at pk column count in pragma
    const sessionCols = database.prepare(`PRAGMA table_info(sessions)`).all();
    const pkCount = sessionCols.filter((c) => c.pk > 0).length;
    if (pkCount < 2) {
        // Need to recreate table with composite PK
        database.exec(`
      CREATE TABLE sessions_new (
        chat_id    TEXT NOT NULL,
        agent_id   TEXT NOT NULL DEFAULT 'main',
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (chat_id, agent_id)
      );
      INSERT OR IGNORE INTO sessions_new (chat_id, agent_id, session_id, updated_at)
        SELECT chat_id, COALESCE(agent_id, 'main'), session_id, updated_at FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
    }
    const taskCols = database.prepare(`PRAGMA table_info(scheduled_tasks)`).all();
    if (!taskCols.some((c) => c.name === 'agent_id')) {
        database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'`);
    }
    const usageCols = database.prepare(`PRAGMA table_info(token_usage)`).all();
    if (!usageCols.some((c) => c.name === 'agent_id')) {
        database.exec(`ALTER TABLE token_usage ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'`);
    }
    const convoCols = database.prepare(`PRAGMA table_info(conversation_log)`).all();
    if (!convoCols.some((c) => c.name === 'agent_id')) {
        database.exec(`ALTER TABLE conversation_log ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'`);
    }
    // Task state machine: add started_at and last_status columns
    const taskColNames = taskCols.map((c) => c.name);
    if (!taskColNames.includes('started_at')) {
        database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN started_at INTEGER`);
    }
    if (!taskColNames.includes('last_status')) {
        database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN last_status TEXT`);
    }
    // ── Memory V2 migration ──────────────────────────────────────────────
    // Detect old schema (has 'sector' column but no 'importance') and migrate.
    const memCols = database.prepare(`PRAGMA table_info(memories)`).all();
    const memColNames = memCols.map((c) => c.name);
    const isOldSchema = memColNames.includes('sector') && !memColNames.includes('importance');
    if (isOldSchema) {
        database.exec(`
      -- Drop old FTS triggers first
      DROP TRIGGER IF EXISTS memories_fts_insert;
      DROP TRIGGER IF EXISTS memories_fts_delete;
      DROP TRIGGER IF EXISTS memories_fts_update;

      -- Drop old FTS table
      DROP TABLE IF EXISTS memories_fts;

      -- Drop old indexes (they'll conflict with new table's indexes)
      DROP INDEX IF EXISTS idx_memories_chat;
      DROP INDEX IF EXISTS idx_memories_sector;

      -- Backup old memories table
      ALTER TABLE memories RENAME TO memories_v1_backup;

      -- Create new memories table
      CREATE TABLE memories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id       TEXT NOT NULL,
        source        TEXT NOT NULL DEFAULT 'conversation',
        raw_text      TEXT NOT NULL,
        summary       TEXT NOT NULL,
        entities      TEXT NOT NULL DEFAULT '[]',
        topics        TEXT NOT NULL DEFAULT '[]',
        connections   TEXT NOT NULL DEFAULT '[]',
        importance    REAL NOT NULL DEFAULT 0.5,
        salience      REAL NOT NULL DEFAULT 1.0,
        consolidated  INTEGER NOT NULL DEFAULT 0,
        embedding     TEXT,
        created_at    INTEGER NOT NULL,
        accessed_at   INTEGER NOT NULL
      );

      CREATE INDEX idx_memories_chat ON memories(chat_id, created_at DESC);
      CREATE INDEX idx_memories_importance ON memories(chat_id, importance DESC);
      CREATE INDEX idx_memories_unconsolidated ON memories(chat_id, consolidated);

      -- Create consolidations table
      CREATE TABLE IF NOT EXISTS consolidations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id       TEXT NOT NULL,
        source_ids    TEXT NOT NULL,
        summary       TEXT NOT NULL,
        insight       TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_consolidations_chat ON consolidations(chat_id, created_at DESC);

      -- Create new FTS table
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        summary,
        raw_text,
        entities,
        topics,
        content=memories,
        content_rowid=id
      );

      -- Create new triggers
      CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, summary, raw_text, entities, topics)
          VALUES (new.id, new.summary, new.raw_text, new.entities, new.topics);
      END;

      CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text, entities, topics)
          VALUES ('delete', old.id, old.summary, old.raw_text, old.entities, old.topics);
      END;

      CREATE TRIGGER memories_fts_update AFTER UPDATE OF summary, raw_text, entities, topics ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text, entities, topics)
          VALUES ('delete', old.id, old.summary, old.raw_text, old.entities, old.topics);
        INSERT INTO memories_fts(rowid, summary, raw_text, entities, topics)
          VALUES (new.id, new.summary, new.raw_text, new.entities, new.topics);
      END;
    `);
        logger.info('Memory V2 migration: backed up old memories, created new schema');
    }
    // Ensure memory V2 indexes exist (covers both migrated and fresh installs)
    const memColsPost = database.prepare(`PRAGMA table_info(memories)`).all();
    if (memColsPost.some((c) => c.name === 'importance')) {
        database.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(chat_id, importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_unconsolidated ON memories(chat_id, consolidated);
    `);
    }
    // Add embedding column if missing (V2 tables created before embedding support)
    if (memColsPost.some((c) => c.name === 'importance') && !memColsPost.some((c) => c.name === 'embedding')) {
        database.exec(`ALTER TABLE memories ADD COLUMN embedding TEXT`);
        logger.info('Migration: added embedding column to memories table');
    }
    // Hive Mind V2: Add agent_id to memories for attribution
    if (!memColsPost.some((c) => c.name === 'agent_id')) {
        database.exec(`ALTER TABLE memories ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'`);
        logger.info('Migration: added agent_id column to memories table');
    }
    // Hive Mind V2: Add embedding + model tracking to consolidations
    const consolCols = database.prepare('PRAGMA table_info(consolidations)').all();
    if (!consolCols.some((c) => c.name === 'embedding')) {
        database.exec(`ALTER TABLE consolidations ADD COLUMN embedding TEXT`);
        logger.info('Migration: added embedding column to consolidations table');
    }
    if (!consolCols.some((c) => c.name === 'embedding_model')) {
        database.exec(`ALTER TABLE consolidations ADD COLUMN embedding_model TEXT DEFAULT 'embedding-001'`);
    }
    // Add embedding_model to memories too (future-proofing)
    if (!memColsPost.some((c) => c.name === 'embedding_model')) {
        database.exec(`ALTER TABLE memories ADD COLUMN embedding_model TEXT DEFAULT 'embedding-001'`);
    }
    // Hive Mind V2: Fix FTS5 update trigger to only fire on content column changes.
    // The old trigger fires on every UPDATE (including salience/importance-only changes),
    // causing massive write amplification during decay sweeps.
    const triggerCheck = database.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='memories_fts_update'`).get();
    if (triggerCheck?.sql && !triggerCheck.sql.includes('UPDATE OF')) {
        database.exec(`
      DROP TRIGGER IF EXISTS memories_fts_update;
      CREATE TRIGGER memories_fts_update AFTER UPDATE OF summary, raw_text, entities, topics ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text, entities, topics)
          VALUES ('delete', old.id, old.summary, old.raw_text, old.entities, old.topics);
        INSERT INTO memories_fts(rowid, summary, raw_text, entities, topics)
          VALUES (new.id, new.summary, new.raw_text, new.entities, new.topics);
      END;
    `);
        logger.info('Migration: restricted FTS5 update trigger to content columns only');
    }
    // Hive Mind V2: Add superseded_by for contradiction resolution
    if (!memColsPost.some((c) => c.name === 'superseded_by')) {
        database.exec(`ALTER TABLE memories ADD COLUMN superseded_by INTEGER REFERENCES memories(id)`);
        logger.info('Migration: added superseded_by column to memories table');
    }
    // Hive Mind V2: Add pinned flag for permanent memories that never decay.
    // Memories are only pinned explicitly by the user ("remember this permanently")
    // or via /pin command. No auto-pinning: the user controls what's permanent.
    if (!memColsPost.some((c) => c.name === 'pinned')) {
        database.exec(`ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
        logger.info('Migration: added pinned column to memories table');
    }
    // Mission Control: migrate assigned_agent from NOT NULL to nullable (allow unassigned tasks)
    const missionCols = database.prepare(`PRAGMA table_info(mission_tasks)`).all();
    const assignedCol = missionCols.find((c) => c.name === 'assigned_agent');
    if (assignedCol && assignedCol.notnull === 1) {
        database.exec(`
      CREATE TABLE mission_tasks_new (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL,
        assigned_agent TEXT, status TEXT NOT NULL DEFAULT 'queued',
        result TEXT, error TEXT, created_by TEXT NOT NULL DEFAULT 'dashboard',
        priority INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        started_at INTEGER, completed_at INTEGER
      );
      INSERT INTO mission_tasks_new SELECT * FROM mission_tasks;
      DROP TABLE mission_tasks;
      ALTER TABLE mission_tasks_new RENAME TO mission_tasks;
      CREATE INDEX IF NOT EXISTS idx_mission_status
        ON mission_tasks(assigned_agent, status, priority DESC, created_at ASC);
    `);
        logger.info('Migration: made mission_tasks.assigned_agent nullable');
    }
    // Live Meetings: add provider column so we can track which platform
    // each session used (pika avatar vs recall voice-only). Default 'pika'
    // for existing rows so historical data keeps the right label.
    const meetCols = database.prepare(`PRAGMA table_info(meet_sessions)`).all();
    if (meetCols.length > 0 && !meetCols.some((c) => c.name === 'provider')) {
        database.exec(`ALTER TABLE meet_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'pika'`);
        logger.info('Migration: added provider column to meet_sessions');
    }
    // Text War Room: tag each meeting as voice or text so existing voice rows
    // stay untouched and the dashboard can filter. The existing `mode` column
    // on warroom_meetings is voice-only semantics (direct|auto) and can't
    // double as meeting-type.
    addColumnIfMissing(database, 'warroom_meetings', 'meeting_type', `TEXT NOT NULL DEFAULT 'voice'`);
    // Text War Room hive-mind: chat_id on warroom_meetings so a text meeting
    // knows which Telegram chat owns it, separately from the synthetic
    // SDK session key (`warroom-text:${meetingId}`). Memory/missions/conv-log
    // calls inside runAgentTurn use this real chat_id; legacy rows default
    // to '' and the bridge no-ops for them.
    addColumnIfMissing(database, 'warroom_meetings', 'chat_id', `TEXT NOT NULL DEFAULT ''`);
    // Text War Room hive-mind: tag conversation_log rows that originated from
    // the war room so they can be deduped on retry and so memory ingestion
    // can scope by source if needed. Existing Telegram rows default to
    // 'telegram'. source_meeting_id + source_turn_id back the partial unique
    // indexes below, which guard against double-persistence on retries.
    addColumnIfMissing(database, 'conversation_log', 'source', `TEXT NOT NULL DEFAULT 'telegram'`);
    addColumnIfMissing(database, 'conversation_log', 'source_meeting_id', `TEXT`);
    addColumnIfMissing(database, 'conversation_log', 'source_turn_id', `TEXT`);
    // Two partial unique indexes so a multi-agent slash turn (which produces
    // ONE user prompt + N assistant rows under one source_turn_id) doesn't
    // collide on retry. User row keyed without agent_id (singleton per turn);
    // assistant rows keyed WITH agent_id (one per speaking agent).
    database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_convlog_warroom_user
      ON conversation_log(source, source_meeting_id, source_turn_id)
      WHERE source != 'telegram' AND role = 'user';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_convlog_warroom_assistant
      ON conversation_log(source, source_meeting_id, source_turn_id, agent_id)
      WHERE source != 'telegram' AND role = 'assistant';
  `);
}
/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase() {
    // Use a test encryption key for field-level encryption
    encryptionKey = crypto.randomBytes(32);
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    createSchema(db);
    runMigrations(db);
}
/**
 * Test-only: backdate a war-room meeting's `ended_at` so retention sweep
 * tests don't have to wait real wall-clock time. Marked with the `_test`
 * prefix consistent with other test-only exports.
 */
export function _testBackdateMeetingEnd(meetingId, endedAtSec) {
    db.prepare('UPDATE warroom_meetings SET ended_at = ? WHERE id = ?')
        .run(endedAtSec, meetingId);
}
export function getSession(chatId, agentId = 'main') {
    const row = db
        .prepare('SELECT session_id FROM sessions WHERE chat_id = ? AND agent_id = ?')
        .get(chatId, agentId);
    return row?.session_id;
}
export function setSession(chatId, sessionId, agentId = 'main') {
    db.prepare('INSERT OR REPLACE INTO sessions (chat_id, agent_id, session_id, updated_at) VALUES (?, ?, ?, ?)').run(chatId, agentId, sessionId, new Date().toISOString());
}
export function clearSession(chatId, agentId = 'main') {
    db.prepare('DELETE FROM sessions WHERE chat_id = ? AND agent_id = ?').run(chatId, agentId);
}
export function saveStructuredMemory(chatId, rawText, summary, entities, topics, importance, source = 'conversation', agentId = 'main') {
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`INSERT INTO memories (chat_id, source, raw_text, summary, entities, topics, importance, agent_id, created_at, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chatId, source, rawText, summary, JSON.stringify(entities), JSON.stringify(topics), importance, agentId, now, now);
    return result.lastInsertRowid;
}
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'it', 'its', 'my', 'me', 'we', 'our', 'you', 'your', 'he',
    'him', 'his', 'she', 'her', 'they', 'them', 'their', 'i', 'up',
    'down', 'get', 'got', 'like', 'make', 'know', 'think', 'take',
    'come', 'go', 'see', 'look', 'find', 'give', 'tell', 'say',
    'much', 'many', 'well', 'also', 'back', 'use', 'way',
    'feel', 'mark', 'marks', 'does', 'how',
]);
/**
 * Extract meaningful keywords from a query, stripping stop words and short tokens.
 */
function extractKeywords(query) {
    return query
        .replace(/[""]/g, '"')
        .replace(/[^\w\s]/g, '')
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}
/**
 * Search memories using embedding similarity (primary) with FTS5/LIKE fallback.
 * The queryEmbedding parameter is optional; if provided, vector search is used first.
 * If not provided (or no embeddings in DB), falls back to keyword search.
 * When `agentId` is supplied, results are strictly scoped to that agent so
 * one agent never sees another agent's private memories.
 */
export function searchMemories(chatId, query, limit = 5, queryEmbedding, agentId) {
    // Strategy 1: Vector similarity search (if embedding provided)
    if (queryEmbedding && queryEmbedding.length > 0) {
        const candidates = getMemoriesWithEmbeddings(chatId, agentId);
        if (candidates.length > 0) {
            const scored = candidates
                .map((c) => ({ id: c.id, score: cosineSimilarity(queryEmbedding, c.embedding) }))
                .filter((s) => s.score > 0.3) // minimum similarity threshold
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);
            if (scored.length > 0) {
                const ids = scored.map((s) => s.id);
                const placeholders = ids.map(() => '?').join(',');
                const rows = db
                    .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND superseded_by IS NULL`)
                    .all(...ids);
                // Preserve similarity-score ordering (SQL IN doesn't guarantee order)
                const rowMap = new Map(rows.map((r) => [r.id, r]));
                return ids.map((id) => rowMap.get(id)).filter(Boolean);
            }
        }
    }
    // Strategy 2: FTS5 keyword search with OR
    const keywords = extractKeywords(query);
    if (keywords.length === 0)
        return [];
    // Strip double-quotes from each keyword before wrapping it as an FTS5
    // phrase. Without this, a keyword like `"foo` would produce the
    // malformed fragment `""foo"*` and FTS5 would either error out or, in
    // the worst case, interpret attacker-controlled characters as query
    // operators. Belt-and-braces on top of extractKeywords' own filtering.
    const ftsQuery = keywords.map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
    const ftsAgentClause = agentId ? ' AND memories.agent_id = ?' : '';
    const ftsParams = [ftsQuery, chatId];
    if (agentId)
        ftsParams.push(agentId);
    ftsParams.push(limit);
    let results = db
        .prepare(`SELECT memories.* FROM memories
       JOIN memories_fts ON memories.id = memories_fts.rowid
       WHERE memories_fts MATCH ? AND memories.chat_id = ? AND memories.superseded_by IS NULL${ftsAgentClause}
       ORDER BY rank
       LIMIT ?`)
        .all(...ftsParams);
    if (results.length > 0)
        return results;
    // Strategy 3: LIKE fallback on summary + entities + topics
    const likeConditions = keywords.map(() => `(summary LIKE ? OR entities LIKE ? OR topics LIKE ? OR raw_text LIKE ?)`).join(' OR ');
    const likeParams = [];
    for (const kw of keywords) {
        const pattern = `%${kw}%`;
        likeParams.push(pattern, pattern, pattern, pattern);
    }
    const likeAgentClause = agentId ? ' AND agent_id = ?' : '';
    const likeAllParams = [chatId, ...likeParams];
    if (agentId)
        likeAllParams.push(agentId);
    likeAllParams.push(limit);
    results = db
        .prepare(`SELECT * FROM memories
       WHERE chat_id = ? AND superseded_by IS NULL AND (${likeConditions})${likeAgentClause}
       ORDER BY importance DESC, accessed_at DESC
       LIMIT ?`)
        .all(...likeAllParams);
    return results;
}
export function saveMemoryEmbedding(memoryId, embedding) {
    db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), memoryId);
}
/**
 * Atomically save a structured memory and its embedding in a single transaction.
 * If either step fails, both are rolled back.
 */
export function saveStructuredMemoryAtomic(chatId, rawText, summary, entities, topics, importance, embedding, source = 'conversation', agentId = 'main') {
    const txn = db.transaction(() => {
        const memoryId = saveStructuredMemory(chatId, rawText, summary, entities, topics, importance, source, agentId);
        if (embedding.length > 0) {
            saveMemoryEmbedding(memoryId, embedding);
        }
        return memoryId;
    });
    return txn();
}
export function getMemoriesWithEmbeddings(chatId, agentId) {
    const sql = agentId
        ? 'SELECT id, embedding, summary, importance FROM memories WHERE chat_id = ? AND agent_id = ? AND embedding IS NOT NULL AND superseded_by IS NULL'
        : 'SELECT id, embedding, summary, importance FROM memories WHERE chat_id = ? AND embedding IS NOT NULL AND superseded_by IS NULL';
    const params = agentId ? [chatId, agentId] : [chatId];
    const rows = db
        .prepare(sql)
        .all(...params);
    return rows.map((r) => ({
        id: r.id,
        embedding: JSON.parse(r.embedding),
        summary: r.summary,
        importance: r.importance,
    }));
}
export function getRecentHighImportanceMemories(chatId, limit = 5, agentId) {
    if (agentId) {
        return db
            .prepare(`SELECT * FROM memories WHERE chat_id = ? AND agent_id = ? AND importance >= 0.5
         ORDER BY accessed_at DESC LIMIT ?`)
            .all(chatId, agentId, limit);
    }
    return db
        .prepare(`SELECT * FROM memories WHERE chat_id = ? AND importance >= 0.5
       ORDER BY accessed_at DESC LIMIT ?`)
        .all(chatId, limit);
}
export function getRecentMemories(chatId, limit = 5) {
    return db
        .prepare('SELECT * FROM memories WHERE chat_id = ? ORDER BY accessed_at DESC LIMIT ?')
        .all(chatId, limit);
}
export function touchMemory(id) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE memories SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0) WHERE id = ?').run(now, id);
}
export function penalizeMemory(memoryId) {
    db.prepare(`UPDATE memories SET salience = MAX(0.05, salience - 0.05) WHERE id = ?`).run(memoryId);
}
/**
 * Batch-update salience for multiple memories in a single transaction.
 * Reduces SQLite lock contention when multiple agents finish concurrently.
 */
export function batchUpdateMemoryRelevance(allIds, usefulIds) {
    const txn = db.transaction(() => {
        for (const id of allIds) {
            if (usefulIds.has(id)) {
                touchMemory(id);
            }
            else {
                penalizeMemory(id);
            }
        }
    });
    txn();
}
/**
 * Importance-weighted decay. High-importance memories decay slower.
 * Pinned memories are exempt from decay entirely.
 * - pinned:             no decay (permanent)
 * - importance >= 0.8:  1% per day (retains ~460 days)
 * - importance >= 0.5:  2% per day (retains ~230 days)
 * - importance < 0.5:   5% per day (retains ~90 days)
 */
export function decayMemories() {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    db.prepare(`
    UPDATE memories SET salience = salience * CASE
      WHEN importance >= 0.8 THEN 0.99
      WHEN importance >= 0.5 THEN 0.98
      ELSE 0.95
    END
    WHERE created_at < ? AND pinned = 0
  `).run(oneDayAgo);
    // Clear superseded_by references pointing to memories we're about to delete,
    // otherwise the FOREIGN KEY constraint on superseded_by -> memories(id) fails.
    db.prepare(`
    UPDATE memories SET superseded_by = NULL
    WHERE superseded_by IN (SELECT id FROM memories WHERE salience < 0.05 AND pinned = 0)
  `).run();
    db.prepare('DELETE FROM memories WHERE salience < 0.05 AND pinned = 0').run();
}
export function pinMemory(memoryId) {
    db.prepare('UPDATE memories SET pinned = 1 WHERE id = ?').run(memoryId);
}
export function unpinMemory(memoryId) {
    db.prepare('UPDATE memories SET pinned = 0 WHERE id = ?').run(memoryId);
}
// ── Consolidation CRUD ──────────────────────────────────────────────
export function getUnconsolidatedMemories(chatId, limit = 20) {
    return db
        .prepare(`SELECT * FROM memories WHERE chat_id = ? AND consolidated = 0
       ORDER BY created_at DESC LIMIT ?`)
        .all(chatId, limit);
}
export function saveConsolidation(chatId, sourceIds, summary, insight) {
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`INSERT INTO consolidations (chat_id, source_ids, summary, insight, created_at)
     VALUES (?, ?, ?, ?, ?)`).run(chatId, JSON.stringify(sourceIds), summary, insight, now);
    return result.lastInsertRowid;
}
export function saveConsolidationEmbedding(consolidationId, embedding) {
    db.prepare('UPDATE consolidations SET embedding = ?, embedding_model = ? WHERE id = ?')
        .run(JSON.stringify(embedding), 'embedding-001', consolidationId);
}
export function getConsolidationsWithEmbeddings(chatId) {
    const rows = db
        .prepare('SELECT id, embedding, summary, insight FROM consolidations WHERE chat_id = ? AND embedding IS NOT NULL AND embedding_model = ?')
        .all(chatId, 'embedding-001');
    return rows.map((r) => ({ ...r, embedding: JSON.parse(r.embedding) }));
}
export function supersedeMemory(oldId, newId) {
    db.prepare(`UPDATE memories SET superseded_by = ?, importance = importance * 0.3, salience = salience * 0.5 WHERE id = ?`).run(newId, oldId);
}
export function updateMemoryConnections(memoryId, connections) {
    const row = db.prepare('SELECT connections FROM memories WHERE id = ?').get(memoryId);
    if (!row)
        return;
    const existing = JSON.parse(row.connections);
    const merged = [...existing, ...connections];
    // Deduplicate by linked_to to prevent unbounded growth on re-consolidation
    const seen = new Set();
    const deduped = merged.filter((c) => {
        if (seen.has(c.linked_to))
            return false;
        seen.add(c.linked_to);
        return true;
    });
    db.prepare('UPDATE memories SET connections = ? WHERE id = ?').run(JSON.stringify(deduped), memoryId);
}
export function markMemoriesConsolidated(ids) {
    if (ids.length === 0)
        return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE memories SET consolidated = 1 WHERE id IN (${placeholders})`).run(...ids);
}
/**
 * Atomically save a consolidation, wire connections, handle contradictions,
 * and mark source memories as consolidated. If any step fails, all roll back.
 */
export function saveConsolidationAtomic(chatId, sourceIds, summary, insight, connections, contradictions) {
    const txn = db.transaction(() => {
        const consolidationId = saveConsolidation(chatId, sourceIds, summary, insight);
        for (const conn of connections) {
            updateMemoryConnections(conn.from_id, [
                { linked_to: conn.to_id, relationship: conn.relationship },
            ]);
            updateMemoryConnections(conn.to_id, [
                { linked_to: conn.from_id, relationship: conn.relationship },
            ]);
        }
        for (const contra of contradictions) {
            supersedeMemory(contra.stale_id, contra.superseded_by);
        }
        markMemoriesConsolidated(sourceIds);
        return consolidationId;
    });
    return txn();
}
export function getRecentConsolidations(chatId, limit = 5) {
    return db
        .prepare(`SELECT * FROM consolidations WHERE chat_id = ?
       ORDER BY created_at DESC LIMIT ?`)
        .all(chatId, limit);
}
export function searchConsolidations(chatId, query, limit = 3) {
    // Simple LIKE search on consolidation summaries and insights
    const pattern = `%${query.replace(/[%_]/g, '')}%`;
    return db
        .prepare(`SELECT * FROM consolidations
       WHERE chat_id = ? AND (summary LIKE ? OR insight LIKE ?)
       ORDER BY created_at DESC LIMIT ?`)
        .all(chatId, pattern, pattern, limit);
}
export function createScheduledTask(id, prompt, schedule, nextRun, agentId = 'main') {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO scheduled_tasks (id, prompt, schedule, next_run, status, created_at, agent_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(id, prompt, schedule, nextRun, now, agentId);
}
export function getDueTasks(agentId = 'main') {
    const now = Math.floor(Date.now() / 1000);
    return db
        .prepare(`SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run <= ? AND agent_id = ? ORDER BY next_run`)
        .all(now, agentId);
}
export function getAllScheduledTasks(agentId) {
    if (agentId) {
        return db
            .prepare('SELECT * FROM scheduled_tasks WHERE agent_id = ? ORDER BY created_at DESC')
            .all(agentId);
    }
    return db
        .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
        .all();
}
/**
 * Mark a task as running and optionally advance its next_run to the next
 * scheduled occurrence. Advancing next_run immediately prevents the scheduler
 * from re-firing the same task on subsequent ticks while it is still executing
 * (double-fire bug), and survives process restarts since the value is persisted.
 */
export function markTaskRunning(id, tentativeNextRun) {
    const now = Math.floor(Date.now() / 1000);
    if (tentativeNextRun !== undefined) {
        db.prepare(`UPDATE scheduled_tasks SET status = 'running', started_at = ?, next_run = ? WHERE id = ?`).run(now, tentativeNextRun, id);
    }
    else {
        db.prepare(`UPDATE scheduled_tasks SET status = 'running', started_at = ? WHERE id = ?`).run(now, id);
    }
}
export function updateTaskAfterRun(id, nextRun, result, lastStatus = 'success') {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE scheduled_tasks SET status = 'active', last_run = ?, next_run = ?, last_result = ?, last_status = ?, started_at = NULL WHERE id = ?`).run(now, nextRun, result.slice(0, 4000), lastStatus, id);
}
export function resetStuckTasks(agentId) {
    const result = db.prepare(`UPDATE scheduled_tasks SET status = 'active', started_at = NULL WHERE status = 'running' AND agent_id = ?`).run(agentId);
    return result.changes;
}
export function deleteScheduledTask(id) {
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}
/**
 * Patch the editable fields of a scheduled task. Caller is responsible
 * for recomputing next_run when schedule changes. Pass `undefined` to
 * skip a field; pass a value to update it.
 */
export function updateScheduledTask(id, patch) {
    const sets = [];
    const vals = [];
    if (patch.prompt !== undefined) {
        sets.push('prompt = ?');
        vals.push(patch.prompt);
    }
    if (patch.schedule !== undefined) {
        sets.push('schedule = ?');
        vals.push(patch.schedule);
    }
    if (patch.nextRun !== undefined) {
        sets.push('next_run = ?');
        vals.push(patch.nextRun);
    }
    if (patch.agentId !== undefined) {
        sets.push('agent_id = ?');
        vals.push(patch.agentId);
    }
    if (sets.length === 0)
        return;
    vals.push(id);
    db.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
export function pauseScheduledTask(id) {
    db.prepare(`UPDATE scheduled_tasks SET status = 'paused' WHERE id = ?`).run(id);
}
export function resumeScheduledTask(id) {
    db.prepare(`UPDATE scheduled_tasks SET status = 'active' WHERE id = ?`).run(id);
}
/**
 * Get recent scheduled task outputs for a given agent.
 * Used to inject context into the next user message so Claude knows
 * what was just shown to the user via a scheduled task.
 *
 * Returns tasks that ran in the last `withinMinutes` (default 30).
 */
export function getRecentTaskOutputs(agentId, withinMinutes = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - withinMinutes * 60;
    return db
        .prepare(`SELECT prompt, last_result, last_run FROM scheduled_tasks
       WHERE agent_id = ? AND last_status = 'success' AND last_run > ?
       ORDER BY last_run DESC LIMIT 3`)
        .all(agentId, cutoff);
}
// ── WhatsApp message map ──────────────────────────────────────────────
export function saveWaMessageMap(telegramMsgId, waChatId, contactName) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT OR REPLACE INTO wa_message_map (telegram_msg_id, wa_chat_id, contact_name, created_at)
     VALUES (?, ?, ?, ?)`).run(telegramMsgId, waChatId, contactName, now);
}
export function lookupWaChatId(telegramMsgId) {
    const row = db
        .prepare('SELECT wa_chat_id, contact_name FROM wa_message_map WHERE telegram_msg_id = ?')
        .get(telegramMsgId);
    if (!row)
        return null;
    return { waChatId: row.wa_chat_id, contactName: row.contact_name };
}
export function getRecentWaContacts(limit = 20) {
    const rows = db.prepare(`SELECT wa_chat_id, contact_name, MAX(created_at) as lastSeen
     FROM wa_message_map
     GROUP BY wa_chat_id
     ORDER BY lastSeen DESC
     LIMIT ?`).all(limit);
    return rows.map((r) => ({ waChatId: r.wa_chat_id, contactName: r.contact_name, lastSeen: r.lastSeen }));
}
export function enqueueWaMessage(toChatId, body) {
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`INSERT INTO wa_outbox (to_chat_id, body, created_at) VALUES (?, ?, ?)`).run(toChatId, encryptField(body), now);
    return result.lastInsertRowid;
}
export function getPendingWaMessages() {
    const rows = db.prepare(`SELECT id, to_chat_id, body, created_at FROM wa_outbox WHERE sent_at IS NULL ORDER BY created_at`).all();
    return rows.map((r) => ({ ...r, body: decryptField(r.body) }));
}
export function markWaMessageSent(id) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE wa_outbox SET sent_at = ? WHERE id = ?`).run(now, id);
}
// ── WhatsApp messages ────────────────────────────────────────────────
/**
 * Prune WhatsApp messages older than the given number of days.
 * Covers wa_messages, wa_outbox (sent only), and wa_message_map.
 */
export function pruneWaMessages(retentionDays = 3) {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    const msgResult = db.prepare('DELETE FROM wa_messages WHERE created_at < ?').run(cutoff);
    const outboxResult = db.prepare('DELETE FROM wa_outbox WHERE sent_at IS NOT NULL AND created_at < ?').run(cutoff);
    const mapResult = db.prepare('DELETE FROM wa_message_map WHERE created_at < ?').run(cutoff);
    return {
        messages: msgResult.changes,
        outbox: outboxResult.changes,
        map: mapResult.changes,
    };
}
/**
 * Prune Slack messages older than the given number of days.
 */
export function pruneSlackMessages(retentionDays = 3) {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    const result = db.prepare('DELETE FROM slack_messages WHERE created_at < ?').run(cutoff);
    return result.changes;
}
export function logConversationTurn(chatId, role, content, sessionId, agentId = 'main') {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO conversation_log (chat_id, session_id, role, content, created_at, agent_id)
     VALUES (?, ?, ?, ?, ?, ?)`).run(chatId, sessionId ?? null, role, content, now, agentId);
}
export function getRecentConversation(chatId, limit = 20, agentId) {
    // IMPORTANT: filter by agent_id too. Without this, /respin in the main
    // agent bleeds in turns from research/comms/content/ops that share the
    // same chat_id, producing respins contaminated with other agents'
    // conversations. Reported by Benjamin Elkrieff in April 2026.
    if (agentId) {
        return db
            .prepare(`SELECT * FROM conversation_log
         WHERE chat_id = ? AND agent_id = ?
         ORDER BY created_at DESC LIMIT ?`)
            .all(chatId, agentId, limit);
    }
    return db
        .prepare(`SELECT * FROM conversation_log WHERE chat_id = ?
       ORDER BY created_at DESC LIMIT ?`)
        .all(chatId, limit);
}
/**
 * Search conversation_log by keywords. Used when the user asks about
 * past conversations ("remember when we...", "what did we talk about").
 * Returns recent turns that match any keyword, grouped chronologically.
 */
export function searchConversationHistory(chatId, query, agentId, daysBack = 7, limit = 20) {
    const cutoff = Math.floor(Date.now() / 1000) - (daysBack * 86400);
    const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 8);
    if (keywords.length === 0)
        return [];
    const conditions = keywords.map(() => 'content LIKE ?').join(' OR ');
    const params = [chatId, cutoff];
    for (const kw of keywords) {
        params.push(`%${kw}%`);
    }
    const agentFilter = agentId ? ' AND agent_id = ?' : '';
    if (agentId)
        params.push(agentId);
    return db
        .prepare(`SELECT * FROM conversation_log
       WHERE chat_id = ? AND created_at > ? AND (${conditions})${agentFilter}
       ORDER BY created_at DESC LIMIT ?`)
        .all(...params, limit);
}
/**
 * Get a page of conversation turns for the dashboard chat overlay.
 * Returns turns in reverse chronological order (newest first).
 * Use `beforeId` for cursor-based pagination (load older messages).
 */
export function getConversationPage(chatId, limit = 40, beforeId) {
    if (beforeId) {
        return db
            .prepare(`SELECT * FROM conversation_log
         WHERE chat_id = ? AND id < ?
         ORDER BY id DESC LIMIT ?`)
            .all(chatId, beforeId, limit);
    }
    return db
        .prepare(`SELECT * FROM conversation_log
       WHERE chat_id = ?
       ORDER BY id DESC LIMIT ?`)
        .all(chatId, limit);
}
/**
 * Prune old conversation_log entries, keeping only the most recent N rows
 * per (chat_id, agent_id) pair. Scoping by agent matters because all five
 * agents share the same chat_id in a typical install, and a chatty agent
 * could otherwise evict a quieter agent's history under the shared cap.
 * Wrapped in a transaction so a mid-loop crash can't leave the table in a
 * half-pruned state.
 */
export function pruneConversationLog(keepPerChat = 500) {
    const pairs = db
        .prepare('SELECT DISTINCT chat_id, agent_id FROM conversation_log')
        .all();
    const deleteStmt = db.prepare(`
    DELETE FROM conversation_log
    WHERE chat_id = ? AND agent_id = ? AND id NOT IN (
      SELECT id FROM conversation_log
      WHERE chat_id = ? AND agent_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    )
  `);
    const runAll = db.transaction((rows) => {
        for (const row of rows) {
            deleteStmt.run(row.chat_id, row.agent_id, row.chat_id, row.agent_id, keepPerChat);
        }
    });
    runAll(pairs);
}
/**
 * Retention sweep for ended war-room meetings + their transcripts.
 *
 * Why this exists: warroom_meetings + warroom_transcript were not touched
 * by the original decay sweep. Long-running installs accumulate every
 * meeting indefinitely; transcripts can be hundreds of rows each. Cap at
 * `retentionDays` since `ended_at` (default 90). Active meetings (no
 * `ended_at`) are never pruned.
 *
 * Cascading: deleting a `warroom_meetings` row removes its
 * `warroom_transcript` rows via the FK ON DELETE CASCADE. We also clear
 * matching `conversation_log` rows tagged with the meeting's ID so the
 * "delete a meeting actually deletes its content" promise holds.
 */
export function pruneWarRoomMeetings(retentionDays = 90) {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    return db.transaction(() => {
        const expired = db
            .prepare(`SELECT id FROM warroom_meetings WHERE ended_at IS NOT NULL AND ended_at < ?`)
            .all(cutoff);
        if (expired.length === 0)
            return { meetings: 0, convLog: 0 };
        const ids = expired.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const convDel = db
            .prepare(`DELETE FROM conversation_log WHERE source_meeting_id IN (${placeholders})`)
            .run(...ids);
        // warroom_transcript rows go via the FK cascade on warroom_meetings.
        const meetDel = db
            .prepare(`DELETE FROM warroom_meetings WHERE id IN (${placeholders})`)
            .run(...ids);
        return {
            meetings: Number(meetDel.changes),
            convLog: Number(convDel.changes),
        };
    })();
}
// ── WhatsApp messages ────────────────────────────────────────────────
export function saveWaMessage(chatId, contactName, body, timestamp, isFromMe) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO wa_messages (chat_id, contact_name, body, timestamp, is_from_me, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`).run(chatId, contactName, encryptField(body), timestamp, isFromMe ? 1 : 0, now);
}
export function getRecentWaMessages(chatId, limit = 20) {
    const rows = db
        .prepare(`SELECT * FROM wa_messages WHERE chat_id = ?
       ORDER BY timestamp DESC LIMIT ?`)
        .all(chatId, limit);
    return rows.map((r) => ({ ...r, body: decryptField(r.body) }));
}
// ── Slack messages ────────────────────────────────────────────────
export function saveSlackMessage(channelId, channelName, userName, body, timestamp, isFromMe) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO slack_messages (channel_id, channel_name, user_name, body, timestamp, is_from_me, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(channelId, channelName, userName, encryptField(body), timestamp, isFromMe ? 1 : 0, now);
}
export function getRecentSlackMessages(channelId, limit = 20) {
    const rows = db
        .prepare(`SELECT * FROM slack_messages WHERE channel_id = ?
       ORDER BY created_at DESC LIMIT ?`)
        .all(channelId, limit);
    return rows.map((r) => ({ ...r, body: decryptField(r.body) }));
}
// ── Token Usage ──────────────────────────────────────────────────────
export function saveTokenUsage(chatId, sessionId, inputTokens, outputTokens, cacheRead, contextTokens, costUsd, didCompact, agentId = 'main') {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO token_usage (chat_id, session_id, input_tokens, output_tokens, cache_read, context_tokens, cost_usd, did_compact, created_at, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chatId, sessionId ?? null, inputTokens, outputTokens, cacheRead, contextTokens, costUsd, didCompact ? 1 : 0, now, agentId);
}
export function getDashboardMemoryStats(chatId) {
    const counts = db
        .prepare(`SELECT
         COUNT(*) as total,
         AVG(importance) as avgImportance,
         AVG(salience) as avgSalience
       FROM memories WHERE chat_id = ?`)
        .get(chatId);
    const consolidationCount = db
        .prepare('SELECT COUNT(*) as cnt FROM consolidations WHERE chat_id = ?')
        .get(chatId);
    const pinnedCount = db
        .prepare('SELECT COUNT(*) as cnt FROM memories WHERE chat_id = ? AND pinned = 1')
        .get(chatId);
    const buckets = db
        .prepare(`SELECT
         CASE
           WHEN importance < 0.2 THEN '0-0.2'
           WHEN importance < 0.4 THEN '0.2-0.4'
           WHEN importance < 0.6 THEN '0.4-0.6'
           WHEN importance < 0.8 THEN '0.6-0.8'
           ELSE '0.8-1.0'
         END as bucket,
         COUNT(*) as count
       FROM memories WHERE chat_id = ?
       GROUP BY bucket
       ORDER BY bucket`)
        .all(chatId);
    return {
        total: counts.total,
        pinned: pinnedCount.cnt,
        consolidations: consolidationCount.cnt,
        avgImportance: counts.avgImportance ?? 0,
        avgSalience: counts.avgSalience ?? 0,
        importanceDistribution: buckets,
    };
}
export function getDashboardPinnedMemories(chatId) {
    return db
        .prepare('SELECT * FROM memories WHERE chat_id = ? AND pinned = 1 ORDER BY importance DESC')
        .all(chatId);
}
export function getDashboardLowSalienceMemories(chatId, limit = 10) {
    return db
        .prepare(`SELECT * FROM memories WHERE chat_id = ? AND salience < 0.5
       ORDER BY salience ASC LIMIT ?`)
        .all(chatId, limit);
}
export function getDashboardTopAccessedMemories(chatId, limit = 5) {
    return db
        .prepare(`SELECT * FROM memories WHERE chat_id = ? AND importance >= 0.5
       ORDER BY accessed_at DESC LIMIT ?`)
        .all(chatId, limit);
}
export function getDashboardMemoryTimeline(chatId, days = 30) {
    return db
        .prepare(`SELECT
         date(created_at, 'unixepoch') as date,
         COUNT(*) as count
       FROM memories
       WHERE chat_id = ? AND created_at >= unixepoch('now', ?)
       GROUP BY date
       ORDER BY date`)
        .all(chatId, `-${days} days`);
}
export function getDashboardConsolidations(chatId, limit = 5) {
    return getRecentConsolidations(chatId, limit);
}
export function getDashboardTokenStats(chatId) {
    const today = db
        .prepare(`SELECT
         COALESCE(SUM(input_tokens), 0) as todayInput,
         COALESCE(SUM(output_tokens), 0) as todayOutput,
         COALESCE(SUM(cost_usd), 0) as todayCost,
         COUNT(*) as todayTurns
       FROM token_usage
       WHERE chat_id = ? AND created_at >= unixepoch('now', 'start of day')`)
        .get(chatId);
    const allTime = db
        .prepare(`SELECT
         COALESCE(SUM(input_tokens), 0) as allTimeInput,
         COALESCE(SUM(output_tokens), 0) as allTimeOutput,
         COALESCE(SUM(cost_usd), 0) as allTimeCost,
         COUNT(*) as allTimeTurns
       FROM token_usage WHERE chat_id = ?`)
        .get(chatId);
    return { ...today, ...allTime };
}
export function getDashboardCostTimeline(chatId, days = 30) {
    return db
        .prepare(`SELECT
         date(created_at, 'unixepoch') as date,
         SUM(cost_usd) as cost,
         COUNT(*) as turns
       FROM token_usage
       WHERE chat_id = ? AND created_at >= unixepoch('now', ?)
       GROUP BY date
       ORDER BY date`)
        .all(chatId, `-${days} days`);
}
export function getDashboardRecentTokenUsage(chatId, limit = 20) {
    return db
        .prepare(`SELECT * FROM token_usage WHERE chat_id = ?
       ORDER BY created_at DESC LIMIT ?`)
        .all(chatId, limit);
}
export function getDashboardMemoriesList(chatId, limit = 50, offset = 0, sortBy = 'importance') {
    const total = db
        .prepare('SELECT COUNT(*) as cnt FROM memories WHERE chat_id = ?')
        .get(chatId);
    let orderClause;
    switch (sortBy) {
        case 'salience':
            orderClause = 'ORDER BY salience DESC, created_at DESC';
            break;
        case 'recent':
            orderClause = 'ORDER BY created_at DESC';
            break;
        default:
            orderClause = 'ORDER BY importance DESC, created_at DESC';
    }
    const memories = db
        .prepare(`SELECT * FROM memories WHERE chat_id = ? ${orderClause} LIMIT ? OFFSET ?`)
        .all(chatId, limit, offset);
    return { memories, total: total.cnt };
}
export function logToHiveMind(agentId, chatId, action, summary, artifacts) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`).run(agentId, chatId, action, summary, artifacts ?? null, now);
}
export function getHiveMindEntries(limit = 20, agentId) {
    if (agentId) {
        return db
            .prepare('SELECT * FROM hive_mind WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(agentId, limit);
    }
    return db
        .prepare('SELECT * FROM hive_mind ORDER BY created_at DESC LIMIT ?')
        .all(limit);
}
/**
 * Get recent hive_mind entries from agents OTHER than the given one.
 * Used to give each agent awareness of what teammates have been doing.
 */
export function getOtherAgentActivity(excludeAgentId, hoursBack = 24, limit = 10) {
    const cutoff = Math.floor(Date.now() / 1000) - (hoursBack * 3600);
    return db
        .prepare(`SELECT * FROM hive_mind
       WHERE agent_id != ? AND created_at > ?
       ORDER BY created_at DESC LIMIT ?`)
        .all(excludeAgentId, cutoff, limit);
}
/**
 * Get conversation turns for a specific session, ordered chronologically.
 * Used for hive-mind auto-commit on session end.
 */
export function getSessionConversation(sessionId, limit = 40) {
    return db
        .prepare(`SELECT * FROM conversation_log WHERE session_id = ?
       ORDER BY created_at ASC LIMIT ?`)
        .all(sessionId, limit);
}
export function getAgentTokenStats(agentId) {
    const today = db
        .prepare(`SELECT COALESCE(SUM(cost_usd), 0) as todayCost, COUNT(*) as todayTurns
       FROM token_usage
       WHERE agent_id = ? AND created_at >= unixepoch('now', 'start of day')`)
        .get(agentId);
    const allTime = db
        .prepare('SELECT COALESCE(SUM(cost_usd), 0) as allTimeCost FROM token_usage WHERE agent_id = ?')
        .get(agentId);
    return { ...today, allTimeCost: allTime.allTimeCost };
}
export function getAgentRecentConversation(agentId, chatId, limit = 4) {
    return db
        .prepare(`SELECT * FROM conversation_log WHERE agent_id = ? AND chat_id = ?
       ORDER BY created_at DESC LIMIT ?`)
        .all(agentId, chatId, limit);
}
export function getSessionTokenUsage(sessionId) {
    const row = db
        .prepare(`SELECT
         COUNT(*)           as turns,
         SUM(input_tokens)  as totalInputTokens,
         SUM(output_tokens) as totalOutputTokens,
         SUM(cost_usd)      as totalCostUsd,
         SUM(did_compact)   as compactions,
         MIN(created_at)    as firstTurnAt,
         MAX(created_at)    as lastTurnAt
       FROM token_usage WHERE session_id = ?`)
        .get(sessionId);
    if (!row || row.turns === 0)
        return null;
    // Get the most recent turn's context_tokens (actual context window size from last API call)
    // Falls back to cache_read for backward compat with rows before the migration
    const lastRow = db
        .prepare(`SELECT cache_read, context_tokens FROM token_usage
       WHERE session_id = ?
       ORDER BY created_at DESC LIMIT 1`)
        .get(sessionId);
    return {
        turns: row.turns,
        totalInputTokens: row.totalInputTokens,
        totalOutputTokens: row.totalOutputTokens,
        lastCacheRead: lastRow?.cache_read ?? 0,
        lastContextTokens: lastRow?.context_tokens ?? lastRow?.cache_read ?? 0,
        totalCostUsd: row.totalCostUsd,
        compactions: row.compactions,
        firstTurnAt: row.firstTurnAt,
        lastTurnAt: row.lastTurnAt,
    };
}
export function createInterAgentTask(id, fromAgent, toAgent, chatId, prompt) {
    db.prepare(`INSERT INTO inter_agent_tasks (id, from_agent, to_agent, chat_id, prompt, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`).run(id, fromAgent, toAgent, chatId, prompt);
}
export function completeInterAgentTask(id, status, result) {
    db.prepare(`UPDATE inter_agent_tasks SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ?`).run(status, result?.slice(0, 2000) ?? null, id);
}
export function getInterAgentTasks(limit = 20, status) {
    if (status) {
        return db
            .prepare('SELECT * FROM inter_agent_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?')
            .all(status, limit);
    }
    return db
        .prepare('SELECT * FROM inter_agent_tasks ORDER BY created_at DESC LIMIT ?')
        .all(limit);
}
export function createMissionTask(id, title, prompt, assignedAgent = null, createdBy = 'dashboard', priority = 0) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO mission_tasks (id, title, prompt, assigned_agent, status, created_by, priority, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`).run(id, title, prompt, assignedAgent, createdBy, priority, now);
}
export function getUnassignedMissionTasks() {
    return db
        .prepare(`SELECT * FROM mission_tasks WHERE assigned_agent IS NULL AND status = 'queued'
       ORDER BY priority DESC, created_at ASC`)
        .all();
}
export function getMissionTasks(agentId, status) {
    const conditions = [];
    const params = [];
    if (agentId) {
        conditions.push('assigned_agent = ?');
        params.push(agentId);
    }
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    return db
        .prepare(`SELECT * FROM mission_tasks${where}
       ORDER BY
         CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
         priority DESC, created_at DESC`)
        .all(...params);
}
export function getMissionTask(id) {
    return db.prepare('SELECT * FROM mission_tasks WHERE id = ?').get(id) ?? null;
}
export function claimNextMissionTask(agentId) {
    const txn = db.transaction(() => {
        const task = db
            .prepare(`SELECT * FROM mission_tasks
         WHERE assigned_agent = ? AND status = 'queued'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`)
            .get(agentId);
        if (!task)
            return null;
        db.prepare(`UPDATE mission_tasks SET status = 'running', started_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000), task.id);
        return { ...task, status: 'running', started_at: Math.floor(Date.now() / 1000) };
    });
    return txn();
}
export function completeMissionTask(id, result, status, error) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE mission_tasks SET status = ?, result = ?, error = ?, completed_at = ? WHERE id = ?`).run(status, result, error ?? null, now, id);
}
export function cancelMissionTask(id) {
    const result = db.prepare(`UPDATE mission_tasks SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('queued', 'running')`).run(Math.floor(Date.now() / 1000), id);
    return result.changes > 0;
}
export function deleteMissionTask(id) {
    const result = db.prepare(`DELETE FROM mission_tasks WHERE id = ? AND status IN ('completed', 'cancelled', 'failed')`).run(id);
    return result.changes > 0;
}
export function cleanupOldMissionTasks(olderThanDays = 7) {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const result = db.prepare(`DELETE FROM mission_tasks WHERE status IN ('completed', 'cancelled', 'failed') AND completed_at < ?`).run(cutoff);
    return result.changes;
}
export function reassignMissionTask(id, newAgent) {
    const result = db.prepare(`UPDATE mission_tasks SET assigned_agent = ? WHERE id = ? AND status = 'queued'`).run(newAgent, id);
    return result.changes > 0;
}
export function assignMissionTask(id, agent) {
    const result = db.prepare(`UPDATE mission_tasks SET assigned_agent = ? WHERE id = ? AND assigned_agent IS NULL AND status = 'queued'`).run(agent, id);
    return result.changes > 0;
}
export function getMissionTaskHistory(limit = 30, offset = 0) {
    const total = db.prepare(`SELECT COUNT(*) as c FROM mission_tasks WHERE status IN ('completed', 'failed', 'cancelled')`).get().c;
    const tasks = db.prepare(`SELECT * FROM mission_tasks WHERE status IN ('completed', 'failed', 'cancelled')
     ORDER BY completed_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    return { tasks, total };
}
export function resetStuckMissionTasks(agentId) {
    const result = db.prepare(`UPDATE mission_tasks SET status = 'queued', started_at = NULL WHERE status = 'running' AND assigned_agent = ?`).run(agentId);
    return result.changes;
}
export function createMeetSession(session) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO meet_sessions (id, agent_id, meet_url, bot_name, platform, provider, status, voice_id, image_path, brief_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'joining', ?, ?, ?, ?)`).run(session.id, session.agentId, session.meetUrl, session.botName, session.platform ?? 'google_meet', session.provider ?? 'pika', session.voiceId ?? null, session.imagePath ?? null, session.briefPath ?? null, now);
}
export function markMeetSessionLive(id) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE meet_sessions SET status = 'live', joined_at = ? WHERE id = ?`).run(now, id);
}
export function markMeetSessionLeft(id, postNotes) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE meet_sessions SET status = 'left', left_at = ?, post_notes = ? WHERE id = ?`).run(now, postNotes ?? null, id);
}
export function markMeetSessionFailed(id, error) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE meet_sessions SET status = 'failed', left_at = ?, error = ? WHERE id = ?`).run(now, error.slice(0, 2000), id);
}
export function getMeetSession(id) {
    return db.prepare('SELECT * FROM meet_sessions WHERE id = ?').get(id) ?? null;
}
export function listActiveMeetSessions() {
    return db.prepare(`SELECT * FROM meet_sessions WHERE status IN ('joining', 'live') ORDER BY created_at DESC`).all();
}
export function listRecentMeetSessions(limit = 20) {
    return db.prepare(`SELECT * FROM meet_sessions ORDER BY created_at DESC LIMIT ?`).all(limit);
}
// ── Audit Log ────────────────────────────────────────────────────────
export function insertAuditLog(agentId, chatId, action, detail, blocked) {
    db.prepare(`INSERT INTO audit_log (agent_id, chat_id, action, detail, blocked, created_at) VALUES (?, ?, ?, ?, ?, strftime('%s','now'))`).run(agentId, chatId, action, detail.slice(0, 2000), blocked ? 1 : 0);
}
export function getAuditLog(limit = 50, offset = 0, agentId) {
    if (agentId) {
        return db.prepare(`SELECT * FROM audit_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(agentId, limit, offset);
    }
    return db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
}
export function getAuditLogCount(agentId) {
    if (agentId) {
        return db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE agent_id = ?').get(agentId).c;
    }
    return db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
}
export function getRecentBlockedActions(limit = 10) {
    return db.prepare(`SELECT * FROM audit_log WHERE blocked = 1 ORDER BY created_at DESC LIMIT ?`).all(limit);
}
// ── Phase 2: Compaction events ────────────────────────────────────────
export function saveCompactionEvent(sessionId, preTokens, postTokens, turnCount) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO compaction_events (session_id, pre_tokens, post_tokens, turn_count, created_at)
     VALUES (?, ?, ?, ?, ?)`).run(sessionId, preTokens, postTokens, turnCount, now);
}
export function getCompactionCount(sessionId) {
    return db.prepare('SELECT COUNT(*) as c FROM compaction_events WHERE session_id = ?').get(sessionId).c;
}
export function getCompactionHistory(sessionId) {
    return db.prepare('SELECT * FROM compaction_events WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
}
// ── Phase 2: Session stats for /convolife ──────────────────────────────
export function getSessionStats(sessionId) {
    const stats = db.prepare(`
    SELECT
      COUNT(*) as turnCount,
      COALESCE(SUM(cost_usd), 0) as totalCost,
      COALESCE(SUM(did_compact), 0) as compactionCount,
      COALESCE(MAX(context_tokens), 0) as maxContextTokens
    FROM token_usage WHERE session_id = ?
  `).get(sessionId);
    return stats ?? { turnCount: 0, totalCost: 0, compactionCount: 0, maxContextTokens: 0 };
}
// ── Phase 2: Memory nudge support ──────────────────────────────────────
export function getLastMemorySaveTime(chatId, agentId = 'main') {
    const row = db.prepare('SELECT created_at FROM memories WHERE chat_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1').get(chatId, agentId);
    return row?.created_at ?? null;
}
export function getTurnCountSinceTimestamp(chatId, sinceTimestamp, agentId = 'main') {
    const row = db.prepare('SELECT COUNT(*) as c FROM conversation_log WHERE chat_id = ? AND agent_id = ? AND role = ? AND created_at > ?').get(chatId, agentId, 'user', sinceTimestamp);
    return row.c;
}
// ── Phase 4: Skill health & usage ────────────────────────────────────
export function upsertSkillHealth(skillId, status, errorMsg = '') {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO skill_health (skill_id, status, error_msg, last_check, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET status = ?, error_msg = ?, last_check = ?
  `).run(skillId, status, errorMsg, now, now, status, errorMsg, now);
}
export function getSkillHealth(skillId) {
    return db.prepare('SELECT status, error_msg, last_check FROM skill_health WHERE skill_id = ?')
        .get(skillId);
}
export function getAllSkillHealth() {
    return db.prepare('SELECT * FROM skill_health ORDER BY skill_id').all();
}
export function logSkillUsage(skillId, chatId, agentId, tokensUsed, succeeded) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO skill_usage (skill_id, chat_id, agent_id, triggered_at, tokens_used, succeeded)
     VALUES (?, ?, ?, ?, ?, ?)`).run(skillId, chatId, agentId, now, tokensUsed, succeeded ? 1 : 0);
}
export function getSkillUsageStats() {
    return db.prepare(`
    SELECT skill_id,
           COUNT(*) as count,
           MAX(triggered_at) as last_used,
           SUM(tokens_used) as total_tokens
    FROM skill_usage
    GROUP BY skill_id
    ORDER BY count DESC
  `).all();
}
// ── Phase 6: Session summaries ────────────────────────────────────────
export function saveSessionSummary(sessionId, summary, keyDecisions, turnCount, totalCost) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO session_summaries (session_id, summary, key_decisions, turn_count, total_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET summary = ?, key_decisions = ?, turn_count = ?, total_cost = ?, created_at = ?
  `).run(sessionId, summary, JSON.stringify(keyDecisions), turnCount, totalCost, now, summary, JSON.stringify(keyDecisions), turnCount, totalCost, now);
}
export function getSessionSummary(sessionId) {
    return db.prepare('SELECT summary, key_decisions, turn_count, total_cost FROM session_summaries WHERE session_id = ?')
        .get(sessionId);
}
// ── War Room meeting history ─────────────────────────────────────────────
export function createWarRoomMeeting(id, mode, pinnedAgent) {
    db.prepare('INSERT OR IGNORE INTO warroom_meetings (id, started_at, mode, pinned_agent) VALUES (?, ?, ?, ?)').run(id, Math.floor(Date.now() / 1000), mode, pinnedAgent);
}
export function endWarRoomMeeting(id, entryCount) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE warroom_meetings SET ended_at = ?, duration_s = ? - started_at, entry_count = ? WHERE id = ?').run(now, now, entryCount, id);
}
export function addWarRoomTranscript(meetingId, speaker, text) {
    const created_at = Math.floor(Date.now() / 1000);
    const info = db.prepare('INSERT INTO warroom_transcript (meeting_id, speaker, text, created_at) VALUES (?, ?, ?, ?)').run(meetingId, speaker, text, created_at);
    return { id: Number(info.lastInsertRowid), created_at };
}
// Voice-only history. Text meetings live in the same table (with
// meeting_type = 'text') and have their own /warroom/text picker — they
// must not leak into the voice meeting list.
export function getWarRoomMeetings(limit = 20) {
    return db.prepare(`SELECT * FROM warroom_meetings
      WHERE meeting_type IS NULL OR meeting_type = 'voice'
      ORDER BY started_at DESC LIMIT ?`).all(limit);
}
export function getWarRoomTranscript(meetingId, opts = {}) {
    const { limit, beforeTs, beforeId } = opts;
    // When limit is omitted, preserve the legacy "return everything ASC"
    // behavior for the voice War Room caller in dashboard.ts.
    if (limit === undefined && beforeTs === undefined && beforeId === undefined) {
        return db.prepare('SELECT id, speaker, text, created_at FROM warroom_transcript WHERE meeting_id = ? ORDER BY created_at, id').all(meetingId);
    }
    // Paginated path: composite cursor on (created_at, id) so multiple rows
    // with the same created_at second don't get skipped. Callers pass
    // beforeTs+beforeId (the oldest already-loaded row's values); we return
    // rows strictly older than that cursor, newest-first, and the caller
    // reverses for display order.
    const cap = Math.max(1, Math.min(1000, limit ?? 200));
    if (beforeTs !== undefined) {
        const bId = beforeId ?? Number.MAX_SAFE_INTEGER;
        return db.prepare(`SELECT id, speaker, text, created_at
         FROM warroom_transcript
        WHERE meeting_id = ?
          AND (created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC
        LIMIT ?`).all(meetingId, beforeTs, beforeTs, bId, cap);
    }
    return db.prepare('SELECT id, speaker, text, created_at FROM warroom_transcript WHERE meeting_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(meetingId, cap);
}
// ── War Room hive-mind bridges ───────────────────────────────────────
/** Persist a war-room turn to conversation_log atomically and idempotently.
 *  - User row written ONCE per turn (singleton via partial unique index).
 *  - One assistant row per agent (per-agent unique via index).
 *  - On retry, INSERT OR IGNORE detects existing rows; only fresh inserts
 *    are reported back, so the caller can gate memory ingestion on the
 *    assistant row being NEW (not a no-op replay).
 *  - chatId === '' (legacy meetings) → caller should skip this entirely.
 */
export function saveWarRoomConversationTurn(args) {
    const { chatId, agentId, originalUserText, agentReply, meetingId, turnId } = args;
    if (!meetingId || !turnId) {
        throw new Error('saveWarRoomConversationTurn: meetingId and turnId required');
    }
    const now = Math.floor(Date.now() / 1000);
    const userStmt = db.prepare(`INSERT OR IGNORE INTO conversation_log
       (chat_id, session_id, role, content, created_at, agent_id, source, source_meeting_id, source_turn_id)
     VALUES (?, NULL, 'user', ?, ?, ?, 'warroom-text', ?, ?)`);
    const asstStmt = db.prepare(`INSERT OR IGNORE INTO conversation_log
       (chat_id, session_id, role, content, created_at, agent_id, source, source_meeting_id, source_turn_id)
     VALUES (?, NULL, 'assistant', ?, ?, ?, 'warroom-text', ?, ?)`);
    const txn = db.transaction(() => {
        const u = userStmt.run(chatId, originalUserText, now, agentId, meetingId, turnId);
        const a = asstStmt.run(chatId, agentReply, now, agentId, meetingId, turnId);
        return {
            userInserted: u.changes > 0,
            assistantInserted: a.changes > 0,
        };
    });
    return txn();
}
/** Bounded mission lookup. Existing getMissionTasks is unbounded; this
 *  variant takes a sinceTs cutoff and a hard limit so /standup never
 *  pulls a runaway result set. */
export function getRecentMissionTasks(agentId, status, sinceTs, limit = 10) {
    const conds = ['assigned_agent = ?', 'created_at >= ?'];
    const params = [agentId, sinceTs];
    if (status) {
        conds.push('status = ?');
        params.push(status);
    }
    params.push(limit);
    return db
        .prepare(`SELECT * FROM mission_tasks WHERE ${conds.join(' AND ')}
       ORDER BY created_at DESC LIMIT ?`)
        .all(...params);
}
/** Last N war-room transcript rows for a chat across all its meetings,
 *  optionally excluding the meeting that's currently building context.
 *  Used by buildMemoryContext to bridge war room → Telegram so a Telegram
 *  follow-up can cite what was said earlier in a war room. */
export function getRecentWarRoomTranscriptForChat(chatId, opts = {}) {
    const { limit = 10, sinceTs, excludeMeetingId } = opts;
    const conds = ['m.meeting_type = ?', 'm.chat_id = ?'];
    const params = ['text', chatId];
    if (sinceTs !== undefined) {
        conds.push('t.created_at >= ?');
        params.push(sinceTs);
    }
    if (excludeMeetingId) {
        conds.push('t.meeting_id != ?');
        params.push(excludeMeetingId);
    }
    params.push(limit);
    return db
        .prepare(`SELECT t.id, t.meeting_id, t.speaker, t.text, t.created_at
         FROM warroom_transcript t
         JOIN warroom_meetings m ON m.id = t.meeting_id
        WHERE ${conds.join(' AND ')}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ?`)
        .all(...params);
}
// ── Text War Room helpers ────────────────────────────────────────────
// Kept separate from createWarRoomMeeting so the text path can't accidentally
// inherit the voice default of pinned_agent='main'. A text meeting starts
// with NO pinned agent so the router is allowed to pick primary.
export function createTextMeeting(id, chatId = '') {
    db.prepare(`INSERT OR IGNORE INTO warroom_meetings
       (id, started_at, mode, pinned_agent, meeting_type, chat_id)
     VALUES (?, ?, 'direct', NULL, 'text', ?)`).run(id, Math.floor(Date.now() / 1000), chatId);
}
export function getTextMeeting(id) {
    const row = db.prepare(`SELECT id, started_at, ended_at, duration_s, mode, pinned_agent, entry_count, meeting_type, chat_id
       FROM warroom_meetings WHERE id = ? AND meeting_type = 'text'`).get(id);
    return row ?? null;
}
export function setMeetingPin(meetingId, agentId) {
    db.prepare(`UPDATE warroom_meetings SET pinned_agent = ? WHERE id = ? AND meeting_type = 'text'`).run(agentId, meetingId);
}
/** Returns ids of every still-open text meeting except the optional
 *  exclusion. Optionally scope by chat_id so creating a new meeting in
 *  chat A does not auto-end open meetings belonging to chat B. The
 *  dashboard uses this to force-end stale meetings when the user creates
 *  a new one (refresh = clean slate within the same chat). */
export function getOpenTextMeetingIds(exceptId, chatId) {
    const conds = [`meeting_type = 'text'`, `ended_at IS NULL`];
    const params = [];
    if (exceptId) {
        conds.push('id != ?');
        params.push(exceptId);
    }
    if (chatId !== undefined) {
        conds.push('chat_id = ?');
        params.push(chatId);
    }
    const rows = db.prepare(`SELECT id FROM warroom_meetings WHERE ${conds.join(' AND ')}`).all(...params);
    return rows.map((r) => r.id);
}
/** Recent text meetings, newest first. Includes a short preview of the
 *  first user message so the picker can show a recognizable label.
 *  Optionally scope by chat_id so the picker only shows meetings for the
 *  current chat. Pass chatId='' to see legacy/unscoped meetings; omit
 *  to include everything (admin/debug). */
export function getTextMeetings(limit = 20, chatId) {
    const params = [];
    let where = `meeting_type = 'text'`;
    if (chatId !== undefined) {
        where += ` AND chat_id = ?`;
        params.push(chatId);
    }
    params.push(limit);
    const rows = db.prepare(`SELECT id, started_at, ended_at, entry_count
       FROM warroom_meetings
      WHERE ${where}
      ORDER BY started_at DESC
      LIMIT ?`).all(...params);
    if (rows.length === 0)
        return [];
    const previewStmt = db.prepare(`SELECT text FROM warroom_transcript
      WHERE meeting_id = ? AND speaker = 'user'
      ORDER BY created_at, id LIMIT 1`);
    return rows.map((r) => {
        const p = previewStmt.get(r.id);
        const preview = (p?.text ?? '').slice(0, 140);
        return { ...r, preview };
    });
}
export function clearMeetingSessions(meetingId, agentIds) {
    if (agentIds.length === 0)
        return 0;
    const chatId = `warroom-text:${meetingId}`;
    const placeholders = agentIds.map(() => '?').join(',');
    const info = db.prepare(`DELETE FROM sessions WHERE chat_id = ? AND agent_id IN (${placeholders})`).run(chatId, ...agentIds);
    return info.changes;
}
// ── Client message dedup (in-memory LRU) ─────────────────────────────
// Sized for 10k concurrent conversations with rapid resends. 24h TTL means
// a user that retries a message a day later gets re-processed (acceptable).
// Not persisted across bot restarts — worst case a retry after restart
// double-processes; acceptable tradeoff vs a DB table for something this
// ephemeral.
const CLIENT_MSG_TTL_MS = 24 * 60 * 60 * 1000;
const CLIENT_MSG_MAX_ENTRIES = 10000;
const _clientMsgSeen = new Map(); // id -> expires_at
export function rememberClientMsgId(id, ttlMs = CLIENT_MSG_TTL_MS) {
    const now = Date.now();
    // Reject anything that isn't a v4 UUID. Malformed IDs would otherwise
    // cache unbounded and become a DoS vector.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return false;
    }
    const existing = _clientMsgSeen.get(id);
    if (existing !== undefined && existing > now)
        return false; // duplicate
    _clientMsgSeen.set(id, now + ttlMs);
    // Opportunistic eviction: evict expired entries whenever we cross the cap.
    if (_clientMsgSeen.size > CLIENT_MSG_MAX_ENTRIES) {
        for (const [k, exp] of _clientMsgSeen) {
            if (exp <= now)
                _clientMsgSeen.delete(k);
            if (_clientMsgSeen.size <= CLIENT_MSG_MAX_ENTRIES)
                break;
        }
        // If still over cap after evicting expired entries, drop oldest-inserted
        // (Map iteration order is insertion order in ES2015+).
        while (_clientMsgSeen.size > CLIENT_MSG_MAX_ENTRIES) {
            const oldest = _clientMsgSeen.keys().next().value;
            if (oldest === undefined)
                break;
            _clientMsgSeen.delete(oldest);
        }
    }
    return true;
}
/** @internal for tests — clear the dedup cache. */
export function _resetClientMsgCache() {
    _clientMsgSeen.clear();
}
// ── Dashboard settings (personalization KV) ─────────────────────────
export function getDashboardSetting(key) {
    const row = db.prepare(`SELECT value FROM dashboard_settings WHERE key = ?`).get(key);
    return row ? row.value : null;
}
export function setDashboardSetting(key, value) {
    db.prepare(`INSERT INTO dashboard_settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value);
}
export function getAllDashboardSettings() {
    const rows = db.prepare(`SELECT key, value FROM dashboard_settings`).all();
    const out = {};
    for (const row of rows)
        out[row.key] = row.value;
    return out;
}
export function appendAgentFileHistory(agentId, fileKind, content, sha256, author = 'dashboard') {
    const result = db.prepare(`INSERT INTO agent_file_history (agent_id, file_kind, content, byte_size, sha256, author)
     VALUES (?, ?, ?, ?, ?, ?)`).run(agentId, fileKind, content, Buffer.byteLength(content, 'utf8'), sha256, author);
    return Number(result.lastInsertRowid);
}
/** List versions newest-first. Excludes content by default to keep the
 *  payload small; callers fetch full content via getAgentFileHistory(id). */
export function listAgentFileHistory(agentId, fileKind, limit = 50) {
    return db.prepare(`SELECT id, agent_id, file_kind, byte_size, sha256, author, created_at
     FROM agent_file_history
     WHERE agent_id = ? AND file_kind = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`).all(agentId, fileKind, limit);
}
export function getAgentFileHistory(id) {
    const row = db.prepare(`SELECT * FROM agent_file_history WHERE id = ?`).get(id);
    return row ?? null;
}
export function insertAgentSuggestion(s) {
    const r = db.prepare(`INSERT INTO agent_suggestions
       (from_agent, suggested_id, suggested_name, suggested_description, reasoning, activity_share_pct)
     VALUES (?, ?, ?, ?, ?, ?)`).run(s.from_agent, s.suggested_id, s.suggested_name, s.suggested_description, s.reasoning, s.activity_share_pct);
    return Number(r.lastInsertRowid);
}
export function listActiveAgentSuggestions() {
    return db.prepare(`SELECT * FROM agent_suggestions
     WHERE dismissed_at IS NULL AND acted_at IS NULL
     ORDER BY created_at DESC`).all();
}
export function dismissAgentSuggestion(id) {
    const r = db.prepare(`UPDATE agent_suggestions SET dismissed_at = strftime('%s','now')
     WHERE id = ? AND dismissed_at IS NULL AND acted_at IS NULL`).run(id);
    return r.changes > 0;
}
export function markAgentSuggestionActed(id) {
    const r = db.prepare(`UPDATE agent_suggestions SET acted_at = strftime('%s','now')
     WHERE id = ? AND acted_at IS NULL`).run(id);
    return r.changes > 0;
}
/** Used by the analyzer to skip re-suggesting splits the user already
 *  rejected or acted on. Returns the set of (from_agent, suggested_id)
 *  pairs that have any historical suggestion (active or not). */
export function getRecentlySuggestedSplits(daysBack = 30) {
    return db.prepare(`SELECT from_agent, suggested_id FROM agent_suggestions
     WHERE created_at > strftime('%s','now') - (? * 86400)`).all(daysBack);
}
/** Hard cap on retained versions per (agent, kind) so the table doesn't
 *  grow unboundedly. Called after each insert. */
export function pruneAgentFileHistory(agentId, fileKind, keep = 100) {
    const result = db.prepare(`DELETE FROM agent_file_history
     WHERE id IN (
       SELECT id FROM agent_file_history
       WHERE agent_id = ? AND file_kind = ?
       ORDER BY created_at DESC, id DESC
       LIMIT -1 OFFSET ?
     )`).run(agentId, fileKind, keep);
    return result.changes;
}
/** Store a YouTube video record (or update if exists). */
export function upsertYouTubeVideo(data) {
    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT id FROM youtube_videos WHERE video_id = ?').get(data.video_id);
    if (existing) {
        db.prepare(`
      UPDATE youtube_videos
      SET title = ?, description = ?, view_count = ?, like_count = ?, comment_count = ?,
          last_synced_at = ?, updated_at = ?
      WHERE video_id = ?
    `).run(data.title, data.description, data.view_count, data.like_count, data.comment_count, now, now, data.video_id);
    }
    else {
        db.prepare(`
      INSERT INTO youtube_videos
      (video_id, channel_id, title, description, published_at, duration_seconds,
       view_count, like_count, comment_count, last_synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.video_id, data.channel_id, data.title, data.description, data.published_at, data.duration_seconds, data.view_count, data.like_count, data.comment_count, now, now, now);
    }
    return db.prepare('SELECT * FROM youtube_videos WHERE video_id = ?').get(data.video_id);
}
/** Get top N videos by view count for a channel. */
export function getTopYouTubeVideos(channelId, limit = 10) {
    return db.prepare(`
    SELECT * FROM youtube_videos
    WHERE channel_id = ?
    ORDER BY view_count DESC
    LIMIT ?
  `).all(channelId, limit);
}
/** Store YouTube transcript segment. */
export function insertYouTubeTranscript(videoId, segmentNum, startSeconds, endSeconds, text) {
    db.prepare(`
    INSERT INTO youtube_transcripts
    (video_id, segment_num, start_seconds, end_seconds, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(videoId, segmentNum, startSeconds, endSeconds, text, Math.floor(Date.now() / 1000));
    return db.prepare(`
    SELECT * FROM youtube_transcripts
    WHERE video_id = ? AND segment_num = ?
  `).get(videoId, segmentNum);
}
/** Get full transcript for a video (concatenated). */
export function getYouTubeTranscript(videoId) {
    const segments = db.prepare(`
    SELECT text FROM youtube_transcripts
    WHERE video_id = ?
    ORDER BY segment_num
  `).all(videoId);
    return segments.map((s) => s.text).join(' ');
}
/** Store a YouTube comment. */
export function insertYouTubeComment(data) {
    db.prepare(`
    INSERT INTO youtube_comments
    (video_id, comment_id, author, text, like_count, reply_count, published_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.video_id, data.comment_id, data.author, data.text, data.like_count, data.reply_count, data.published_at, Math.floor(Date.now() / 1000));
    return db.prepare(`
    SELECT * FROM youtube_comments WHERE comment_id = ?
  `).get(data.comment_id);
}
/** Get top comments for a video (by likes). */
export function getTopYouTubeComments(videoId, limit = 20) {
    return db.prepare(`
    SELECT * FROM youtube_comments
    WHERE video_id = ?
    ORDER BY like_count DESC
    LIMIT ?
  `).all(videoId, limit);
}
/** Store daily analytics for a video. */
export function insertYouTubeAnalytics(data) {
    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT id FROM youtube_analytics WHERE video_id = ? AND analytics_date = ?').get(data.video_id, data.analytics_date);
    if (existing) {
        db.prepare(`
      UPDATE youtube_analytics
      SET views = ?, watch_time_hours = ?, engagement_rate = ?, click_through_rate = ?
      WHERE video_id = ? AND analytics_date = ?
    `).run(data.views, data.watch_time_hours, data.engagement_rate, data.click_through_rate, data.video_id, data.analytics_date);
    }
    else {
        db.prepare(`
      INSERT INTO youtube_analytics
      (video_id, analytics_date, views, watch_time_hours, engagement_rate, click_through_rate, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.video_id, data.analytics_date, data.views, data.watch_time_hours, data.engagement_rate, data.click_through_rate, now);
    }
    return db.prepare(`
    SELECT * FROM youtube_analytics
    WHERE video_id = ? AND analytics_date = ?
  `).get(data.video_id, data.analytics_date);
}
/** Create a standing query (recurring analysis request). */
export function createStandingQuery(data) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO standing_queries
    (id, title, prompt, schedule, agent_id, next_run, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.id, data.title, data.prompt, data.schedule, data.agent_id, data.next_run, data.status, now, data.created_by || 'system');
    return db.prepare('SELECT * FROM standing_queries WHERE id = ?').get(data.id);
}
/** Get standing queries due for execution. */
export function getStandingQueriesDue(now = Math.floor(Date.now() / 1000)) {
    return db.prepare(`
    SELECT * FROM standing_queries
    WHERE status = 'active' AND next_run <= ?
    ORDER BY next_run ASC
  `).all(now);
}
/** Update standing query after execution. */
export function updateStandingQueryRun(id, result, nextRun) {
    const now = Math.floor(Date.now() / 1000);
    const r = db.prepare(`
    UPDATE standing_queries
    SET last_run = ?, last_result = ?, next_run = ?
    WHERE id = ?
  `).run(now, result, nextRun, id);
    return r.changes > 0;
}
/** Get agent cost metrics: total spend, count, average per turn. */
export function getAgentCostMetrics(agentId, daysBack = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - daysBack * 86400;
    const row = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COUNT(*) as turn_count,
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
    FROM token_usage
    WHERE agent_id = ? AND created_at > ?
  `).get(agentId, cutoff);
    return {
        total_cost: row.total_cost,
        turn_count: row.turn_count,
        avg_cost_per_turn: row.turn_count > 0 ? row.total_cost / row.turn_count : 0,
        total_tokens: row.total_tokens,
    };
}
/** Analyze a script's emotional content by comparing to successful transcripts in your channel. */
export function analyzeScriptEmotions(scriptText, channelId) {
    // Get top 10 performing videos from this channel
    const topVideos = db.prepare(`
    SELECT v.video_id, a.engagement_rate, t.text as transcript
    FROM youtube_videos v
    JOIN youtube_analytics a ON v.video_id = a.video_id
    LEFT JOIN youtube_transcripts t ON v.video_id = t.video_id
    WHERE v.channel_id = ?
    ORDER BY a.engagement_rate DESC, v.view_count DESC
    LIMIT 10
  `).all(channelId);
    // Emotional keywords/patterns to scan for
    const emotionPatterns = {
        curiosity: /\b(wait|actually|turns out|here's|secret|revealed|discovered|unexpected)\b/gi,
        excitement: /\b(amazing|incredible|epic|insane|wow|oh wow|best|absolutely)\b/gi,
        fear: /\b(danger|risk|problem|fail|lost|worst|scared|terrify)\b/gi,
        humor: /\b(lol|haha|funny|joke|hilarious|ridiculous|absurd|silly)\b/gi,
        urgency: /\b(now|quick|fast|limited|only|immediately|before|hurry|today)\b/gi,
        nostalgia: /\b(remember|back then|used to|old school|classic|throwback|golden|was)\b/gi,
    };
    // Scan script for emotions
    const emotionalScores = {};
    for (const [emotion, pattern] of Object.entries(emotionPatterns)) {
        const matches = scriptText.match(pattern) || [];
        emotionalScores[emotion] = Math.min(100, matches.length * 5); // Scale to 0-100
    }
    // Determine primary emotions (top 3)
    const primaryEmotions = Object.entries(emotionalScores)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([emotion, strength]) => ({ emotion, strength }));
    // Hook strength: check opening 2 sentences for emotional triggers
    const sentences = scriptText.split(/[.!?]+/).slice(0, 2).join('. ');
    const hookScore = Math.min(100, (primaryEmotions.reduce((sum, e) => sum + e.strength, 0) / 3) * 1.2);
    // Analyze pacing: count sentences and punctuation
    const sentenceCount = scriptText.split(/[.!?]+/).length;
    const punctuationCount = (scriptText.match(/[!?—]/g) || []).length;
    // Get comparison metrics from top videos
    const avgEngagementTopVideos = topVideos.reduce((sum, v) => sum + v.engagement_rate, 0) / (topVideos.length || 1);
    // Calculate audience resonance based on emotional alignment with top performers
    const emotionalAlignment = primaryEmotions.reduce((sum, e) => sum + e.strength, 0) / 3;
    const audienceResonance = Math.min(100, (emotionalAlignment * 0.6 + (hookScore * 0.4)) * 0.95);
    // Identify missing emotional beats (based on top videos)
    const missingBeats = [];
    if (!scriptText.match(/\b(story|tell|once|one day)\b/i))
        missingBeats.push('narrative framing');
    if (!scriptText.match(/\b(here's|tip|trick|way|how to)\b/i))
        missingBeats.push('explicit value proposition');
    if (!scriptText.match(/\b(but|however|actually|turns out)\b/i))
        missingBeats.push('plot twist / unexpected turn');
    if (!scriptText.match(/[!?]{2,}/))
        missingBeats.push('climactic moment');
    // CTA clarity
    const ctaPatterns = /\b(check out|click|subscribe|link|in description|follow|dm|comment)\b/gi;
    const ctaScore = (ctaPatterns.test(scriptText) ? 60 : 30) + (punctuationCount > 5 ? 20 : 0);
    return {
        primary_emotions: primaryEmotions,
        hook_strength_score: hookScore,
        emotional_arc: {
            opening: 'Opening establishes ' + (primaryEmotions[0]?.emotion || 'unknown') + ' tone',
            buildup: 'Maintains momentum through middle section',
            peak: 'Reaches emotional peak at ~' + Math.floor(sentenceCount / 2) + ' sentences in',
            resolution: 'Concludes with ' + (primaryEmotions[1]?.emotion || 'closing') + ' resolution',
        },
        pacing_analysis: {
            energy_shifts: punctuationCount,
            pattern_interrupts: (scriptText.match(/\n\n/g) || []).length,
            avg_beat_length: sentenceCount > 20 ? 'varied' : 'consistent',
        },
        audience_resonance: Math.round(audienceResonance),
        missing_beats: missingBeats,
        cta_clarity: Math.min(100, ctaScore),
        comparison_to_top_performers: {
            similar_videos_analyzed: topVideos.length,
            engagement_percentile: Math.round((audienceResonance / avgEngagementTopVideos) * 100),
            suggested_improvements: [
                hookScore < 70 ? 'Strengthen opening hook with more emotional trigger words' : null,
                missingBeats.length > 2 ? 'Add missing narrative elements: ' + missingBeats.join(', ') : null,
                ctaScore < 50 ? 'Add clearer call-to-action at end' : null,
                primaryEmotions.length < 2 ? 'Layer additional emotions for engagement' : null,
            ].filter(Boolean),
        },
    };
}
/** Get top hooks from your most-engaged videos for reference. */
export function getTopHooks(channelId, limit = 10) {
    return db.prepare(`
    SELECT
      v.video_id,
      SUBSTR(t.text, 1, 150) as opening_lines,
      a.engagement_rate,
      v.view_count
    FROM youtube_videos v
    JOIN youtube_analytics a ON v.video_id = a.video_id
    LEFT JOIN youtube_transcripts t ON v.video_id = t.video_id AND t.segment_num = 1
    WHERE v.channel_id = ?
    ORDER BY a.engagement_rate DESC, v.view_count DESC
    LIMIT ?
  `).all(channelId, limit);
}
/** Store viewer retention data for a video segment — where they clicked off. */
export function insertViewerRetention(data) {
    const drop_off_rate = Math.max(0, data.viewers_started - data.viewers_at_end);
    db.prepare(`
    INSERT INTO youtube_viewer_retention
    (video_id, segment_num, start_seconds, end_seconds, viewers_started, viewers_at_end, drop_off_rate, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.video_id, data.segment_num, data.start_seconds, data.end_seconds, data.viewers_started, data.viewers_at_end, drop_off_rate, Math.floor(Date.now() / 1000));
}
/** Get viewer drop-off points for a video — where people are clicking off. */
export function getViewerDropoffByVideo(videoId) {
    return db.prepare(`
    SELECT
      r.segment_num,
      r.start_seconds,
      r.end_seconds,
      r.viewers_started,
      r.viewers_at_end,
      r.drop_off_rate,
      t.text as transcript_text
    FROM youtube_viewer_retention r
    LEFT JOIN youtube_transcripts t ON r.video_id = t.video_id AND r.segment_num = t.segment_num
    WHERE r.video_id = ?
    ORDER BY r.segment_num ASC
  `).all(videoId);
}
/** Find the highest drop-off segments across your top videos — pinpoint problem areas. */
export function getHighestDropoffSegments(channelId, limit = 10) {
    return db.prepare(`
    SELECT
      r.video_id,
      v.title as video_title,
      r.segment_num,
      r.drop_off_rate,
      t.text as segment_text,
      r.start_seconds,
      r.end_seconds
    FROM youtube_viewer_retention r
    JOIN youtube_videos v ON r.video_id = v.video_id
    LEFT JOIN youtube_transcripts t ON r.video_id = t.video_id AND r.segment_num = t.segment_num
    WHERE v.channel_id = ?
    ORDER BY r.drop_off_rate DESC
    LIMIT ?
  `).all(channelId, limit);
}
// ── Competitor Intelligence ────────────────────────────────────────────
/** Add a competitor channel to track. */
export function addTrackedCompetitor(data) {
    db.prepare(`
    INSERT OR IGNORE INTO tracked_competitors
    (channel_id, channel_name, niche, notes)
    VALUES (?, ?, ?, ?)
  `).run(data.channel_id, data.channel_name, data.niche, data.notes || '');
    return {
        channel_id: data.channel_id,
        channel_name: data.channel_name,
    };
}
/** Get list of competitors being tracked. */
export function getTrackedCompetitors(niche) {
    const query = niche
        ? 'SELECT channel_id, channel_name, niche, tracked_since FROM tracked_competitors WHERE niche = ? ORDER BY channel_name'
        : 'SELECT channel_id, channel_name, niche, tracked_since FROM tracked_competitors ORDER BY niche, channel_name';
    return db.prepare(query).all(niche);
}
/** Compare your drop-off patterns vs competitor drop-off patterns — see where you're stronger/weaker. */
export function compareDropoffVsCompetitors(yourChannelId, limit = 5) {
    // Get your top drop-off segments
    const yourDropoffs = db.prepare(`
    SELECT
      r.segment_num,
      r.drop_off_rate,
      t.text as segment_text
    FROM youtube_viewer_retention r
    JOIN youtube_videos v ON r.video_id = v.video_id
    LEFT JOIN youtube_transcripts t ON r.video_id = t.video_id AND r.segment_num = t.segment_num
    WHERE v.channel_id = ?
    ORDER BY r.drop_off_rate DESC
    LIMIT ?
  `).all(yourChannelId, limit);
    // Get competitor averages
    const competitorStats = db.prepare(`
    SELECT
      c.channel_name,
      MAX(r.drop_off_rate) as highest_dropoff_rate,
      AVG(r.drop_off_rate) as avg_dropoff
    FROM tracked_competitors c
    JOIN youtube_videos v ON c.channel_id = v.channel_id
    JOIN youtube_viewer_retention r ON v.video_id = r.video_id
    WHERE c.channel_id != ?
    GROUP BY c.channel_id
    ORDER BY avg_dropoff DESC
  `).all(yourChannelId);
    // Generate insights
    const insights = [];
    if (yourDropoffs.length > 0 && competitorStats.length > 0) {
        const yourAvg = yourDropoffs.reduce((sum, d) => sum + d.drop_off_rate, 0) / yourDropoffs.length;
        const competitorAvg = competitorStats.reduce((sum, c) => sum + c.avg_dropoff, 0) / competitorStats.length;
        if (yourAvg < competitorAvg) {
            insights.push(`Your videos hold viewers ${Math.round(competitorAvg - yourAvg)}% better than competitors`);
        }
        else {
            insights.push(`Competitors hold viewers ${Math.round(yourAvg - competitorAvg)}% better — focus on these segments`);
        }
        if (yourDropoffs[0]) {
            insights.push(`Your biggest drop-off: segment ${yourDropoffs[0].segment_num} (${Math.round(yourDropoffs[0].drop_off_rate)}%)`);
        }
    }
    return {
        your_highest_dropoffs: yourDropoffs,
        competitor_patterns: competitorStats,
        insights,
    };
}
/** Get a specific competitor's top-performing segments (low drop-off = good). */
export function getCompetitorStrengths(competitorChannelId, limit = 5) {
    return db.prepare(`
    SELECT
      v.title as video_title,
      r.segment_num,
      r.drop_off_rate,
      t.text as segment_text
    FROM youtube_videos v
    JOIN youtube_viewer_retention r ON v.video_id = r.video_id
    LEFT JOIN youtube_transcripts t ON v.video_id = t.video_id AND r.segment_num = t.segment_num
    WHERE v.channel_id = ?
    ORDER BY r.drop_off_rate ASC
    LIMIT ?
  `).all(competitorChannelId, limit);
}
/** Full intelligence report: scrapes comments, cross-references drop-off points,
 *  compares vs competitors, and returns ranked recommendations. */
export function generateFullIntelligenceReport(yourChannelId) {
    // ── Pull top comments from your videos
    const rawComments = db.prepare(`
    SELECT c.text, c.like_count, c.video_id
    FROM youtube_comments c
    JOIN youtube_videos v ON c.video_id = v.video_id
    WHERE v.channel_id = ?
    ORDER BY c.like_count DESC
    LIMIT 100
  `).all(yourChannelId);
    // Classify comment sentiment and cluster themes
    const positiveWords = /\b(love|great|amazing|best|helpful|awesome|excellent|perfect|good|brilliant)\b/gi;
    const negativeWords = /\b(boring|slow|bad|skip|lost|confused|unclear|too long|waste|clickbait|misleading)\b/gi;
    const themeMap = {};
    for (const comment of rawComments) {
        const isPositive = positiveWords.test(comment.text);
        const isNegative = negativeWords.test(comment.text);
        const sentiment = isNegative ? 'negative' : isPositive ? 'positive' : 'neutral';
        // Extract simple theme keywords
        const themes = comment.text.toLowerCase().match(/\b(intro|hook|editing|pacing|audio|visuals|length|content|topic|quality)\b/g) || ['general'];
        for (const theme of themes) {
            if (!themeMap[theme])
                themeMap[theme] = { count: 0, sentiment, examples: [] };
            themeMap[theme].count++;
            if (themeMap[theme].examples.length < 2)
                themeMap[theme].examples.push(comment.text.slice(0, 80));
        }
    }
    const comment_themes = Object.entries(themeMap)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 5)
        .map(([theme, data]) => ({
        theme,
        count: data.count,
        sentiment: data.sentiment,
        example: data.examples[0] || '',
    }));
    // ── Pull critical drop-off points (>30% drop in a single segment)
    const dropoffs = db.prepare(`
    SELECT
      r.start_seconds,
      r.end_seconds,
      r.drop_off_rate,
      t.text as segment_text
    FROM youtube_viewer_retention r
    JOIN youtube_videos v ON r.video_id = v.video_id
    LEFT JOIN youtube_transcripts t ON r.video_id = t.video_id AND r.segment_num = t.segment_num
    WHERE v.channel_id = ? AND r.drop_off_rate > 30
    ORDER BY r.drop_off_rate DESC
    LIMIT 5
  `).all(yourChannelId);
    const critical_dropoff_points = dropoffs.map((d) => ({
        seconds: `${d.start_seconds}s-${d.end_seconds}s`,
        drop_rate: Math.round(d.drop_off_rate),
        what_was_playing: d.segment_text?.slice(0, 100) || 'No transcript available',
        likely_cause: d.drop_off_rate > 50
            ? 'Severe pacing or relevance issue — restructure this section'
            : d.drop_off_rate > 35
                ? 'Energy drop or unclear transition — add pattern interrupt here'
                : 'Moderate audience loss — tighten pacing',
    }));
    // ── Pull competitor advantages (segments where they retain better than you)
    const yourAvgDropoff = db.prepare(`
    SELECT AVG(r.drop_off_rate) as avg
    FROM youtube_viewer_retention r
    JOIN youtube_videos v ON r.video_id = v.video_id
    WHERE v.channel_id = ?
  `).get(yourChannelId);
    const competitorStrengths = db.prepare(`
    SELECT
      c.channel_name,
      AVG(r.drop_off_rate) as avg_dropoff,
      MIN(r.drop_off_rate) as best_segment_dropoff,
      t.text as best_segment_text
    FROM tracked_competitors c
    JOIN youtube_videos v ON c.channel_id = v.channel_id
    JOIN youtube_viewer_retention r ON v.video_id = r.video_id
    LEFT JOIN youtube_transcripts t ON v.video_id = t.video_id
    GROUP BY c.channel_id
    HAVING avg_dropoff < ?
    ORDER BY avg_dropoff ASC
    LIMIT 3
  `).all(yourAvgDropoff?.avg || 30);
    const competitor_advantages = competitorStrengths.map((c) => ({
        channel_name: c.channel_name,
        what_they_do_better: `Average drop-off ${Math.round(c.avg_dropoff)}% vs your ${Math.round(yourAvgDropoff?.avg || 0)}%`,
        segment_example: c.best_segment_text?.slice(0, 100) || 'No transcript available',
    }));
    // ── Generate ranked recommendations
    const ranked_recommendations = [];
    // Priority 1: Fix critical drop-offs
    if (critical_dropoff_points.length > 0) {
        ranked_recommendations.push({
            priority: 1,
            action: `Rewrite segment at ${critical_dropoff_points[0].seconds} — ${critical_dropoff_points[0].drop_rate}% of viewers leave here`,
            expected_impact: 'Up to 30% improvement in average view duration',
            based_on: 'Viewer retention data across your videos',
        });
    }
    // Priority 2: Address negative comment themes
    const negativeThemes = comment_themes.filter((t) => t.sentiment === 'negative');
    if (negativeThemes.length > 0) {
        ranked_recommendations.push({
            priority: 2,
            action: `Fix recurring "${negativeThemes[0].theme}" complaints — mentioned ${negativeThemes[0].count} times in top comments`,
            expected_impact: 'Higher like/comment ratio, better algorithm signal',
            based_on: `${rawComments.length} scraped comments analyzed`,
        });
    }
    // Priority 3: Copy competitor strengths
    if (competitor_advantages.length > 0) {
        ranked_recommendations.push({
            priority: 3,
            action: `Study "${competitor_advantages[0].channel_name}" — they retain viewers better. Analyze what's different in their pacing and structure`,
            expected_impact: `Close the ${Math.round((yourAvgDropoff?.avg || 0) - competitorStrengths[0]?.avg_dropoff)} point retention gap`,
            based_on: 'Competitor drop-off comparison',
        });
    }
    // Priority 4: Amplify what's working
    const positiveThemes = comment_themes.filter((t) => t.sentiment === 'positive');
    if (positiveThemes.length > 0) {
        ranked_recommendations.push({
            priority: 4,
            action: `Double down on "${positiveThemes[0].theme}" — viewers love it based on top comments`,
            expected_impact: 'Higher engagement, more shares and saves',
            based_on: `${positiveThemes[0].count} positive mentions in comments`,
        });
    }
    return {
        comment_themes,
        critical_dropoff_points,
        competitor_advantages,
        ranked_recommendations,
    };
}
/** Analyze competitor weaknesses: correlate their drop-offs with comment complaints.
 *  Shows what viewers hate at the exact moments they leave. */
export function analyzeCompetitorWeaknesses(competitorChannelId) {
    // Get competitor's high drop-off segments
    const dropoffSegments = db.prepare(`
    SELECT
      r.video_id,
      r.segment_num,
      r.start_seconds,
      r.end_seconds,
      r.drop_off_rate,
      t.text as segment_text
    FROM youtube_viewer_retention r
    JOIN youtube_videos v ON r.video_id = v.video_id
    LEFT JOIN youtube_transcripts t ON r.video_id = t.video_id AND r.segment_num = t.segment_num
    WHERE v.channel_id = ? AND r.drop_off_rate > 25
    ORDER BY r.drop_off_rate DESC
  `).all(competitorChannelId);
    // Get competitor's comments — look for complaints about pacing, length, clarity, etc.
    const negativeComments = db.prepare(`
    SELECT
      c.text,
      c.video_id,
      c.like_count,
      CASE
        WHEN c.text ILIKE '%slow%' OR c.text ILIKE '%boring%' THEN 'pacing issue'
        WHEN c.text ILIKE '%long%' OR c.text ILIKE '%too much%' THEN 'length issue'
        WHEN c.text ILIKE '%confus%' OR c.text ILIKE '%unclear%' THEN 'clarity issue'
        WHEN c.text ILIKE '%skip%' THEN 'skipping content'
        WHEN c.text ILIKE '%clickbait%' OR c.text ILIKE '%mislead%' THEN 'expectation mismatch'
        WHEN c.text ILIKE '%audio%' OR c.text ILIKE '%sound%' THEN 'audio quality'
        WHEN c.text ILIKE '%editing%' THEN 'editing/transitions'
        ELSE 'other complaint'
      END as complaint_type
    FROM youtube_comments c
    JOIN youtube_videos v ON c.video_id = v.video_id
    WHERE v.channel_id = ?
      AND (c.text ILIKE '%slow%' OR c.text ILIKE '%boring%' OR c.text ILIKE '%long%'
        OR c.text ILIKE '%confus%' OR c.text ILIKE '%skip%' OR c.text ILIKE '%clickbait%'
        OR c.text ILIKE '%audio%' OR c.text ILIKE '%editing%')
    ORDER BY c.like_count DESC
  `).all(competitorChannelId);
    // Correlate: which complaints appear in videos with high drop-offs?
    const problem_areas = dropoffSegments.slice(0, 5).map((segment) => {
        const relatedComplaints = negativeComments.filter((c) => c.video_id === segment.video_id && c.like_count > 2);
        const complaintTypes = relatedComplaints.map((c) => c.complaint_type);
        const uniqueComplaints = [...new Set(complaintTypes)];
        return {
            segment_seconds: `${segment.start_seconds}s-${segment.end_seconds}s`,
            drop_off_rate: Math.round(segment.drop_off_rate),
            viewer_complaints: uniqueComplaints.slice(0, 3),
            complaint_count: relatedComplaints.length,
            opportunity: `Viewers complain about ${uniqueComplaints[0] || 'unknown issue'} at exactly where they drop off — this is YOUR opening to do it better`,
        };
    });
    // Identify competitor blind spots (high complaints, but they don't seem to realize)
    const complaintCounts = {};
    for (const comment of negativeComments) {
        complaintCounts[comment.complaint_type] = (complaintCounts[comment.complaint_type] || 0) + 1;
    }
    const competitor_blind_spots = Object.entries(complaintCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([type, count]) => `"${type}" — ${count} complaints (they haven't fixed this)`);
    // Strategic advantage
    const topComplaint = Object.entries(complaintCounts).sort(([, a], [, b]) => b - a)[0];
    const strategic_advantage = topComplaint
        ? `If you solve their #1 problem ("${topComplaint[0]}"), you have a competitive moat. They've ignored it for multiple videos, viewers clearly want it fixed.`
        : 'Their content seems well-received. Focus on differentiation instead.';
    return {
        problem_areas,
        competitor_blind_spots,
        strategic_advantage,
    };
}
/** Log God's Eye intelligence to hive_mind so all agents can see and act on it collectively. */
export function logIntelligenceToHiveMind(data) {
    const result = db.prepare(`
    INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.agent_id || 'god_eye', data.chat_id, data.action, data.summary, JSON.stringify(data.artifacts), Math.floor(Date.now() / 1000));
    return { id: result.lastInsertRowid };
}
/** Get latest intelligence reports from hive_mind for agents to read. */
export function getLatestIntelligence(chatId, action, limit = 10) {
    const query = action
        ? `SELECT id, agent_id, action, summary, artifacts, created_at FROM hive_mind
       WHERE chat_id = ? AND action = ?
       ORDER BY created_at DESC LIMIT ?`
        : `SELECT id, agent_id, action, summary, artifacts, created_at FROM hive_mind
       WHERE chat_id = ? AND agent_id = 'god_eye'
       ORDER BY created_at DESC LIMIT ?`;
    const rows = action
        ? db.prepare(query).all(chatId, action, limit)
        : db.prepare(query).all(chatId, limit);
    return rows.map((row) => ({
        ...row,
        artifacts: typeof row.artifacts === 'string' ? JSON.parse(row.artifacts) : row.artifacts,
    }));
}
/** Agents query: "What do I need to know from God's Eye?" */
export function getAgentActionItems(chatId, forAgent) {
    const intelligence = getLatestIntelligence(chatId, undefined, 5);
    const actionItems = [];
    for (const report of intelligence) {
        if (report.action === 'full_report' && report.artifacts.ranked_recommendations) {
            // Scriptwriter reads recommendations
            if (!forAgent || forAgent === 'scriptwriter') {
                for (const rec of report.artifacts.ranked_recommendations) {
                    actionItems.push({
                        action_type: 'scriptwriting',
                        priority: rec.priority,
                        task: rec.action,
                        source_insight: `Expected impact: ${rec.expected_impact}`,
                    });
                }
            }
        }
        if (report.action === 'competitor_analysis' && report.artifacts.problem_areas) {
            // Analyst reads competitor insights
            if (!forAgent || forAgent === 'analyst') {
                const topProblem = report.artifacts.problem_areas[0];
                actionItems.push({
                    action_type: 'competitive_analysis',
                    priority: 1,
                    task: `Competitors have blind spot: ${topProblem?.opportunity || 'strategic advantage identified'}`,
                    source_insight: report.artifacts.strategic_advantage,
                });
            }
        }
        if (report.action === 'drop_off_alert') {
            // Editing Director reads drop-off alerts
            if (!forAgent || forAgent === 'editing_director') {
                actionItems.push({
                    action_type: 'pacing_edit',
                    priority: 1,
                    task: report.summary,
                    source_insight: 'Viewer retention data indicates editing opportunity',
                });
            }
        }
    }
    return actionItems.sort((a, b) => a.priority - b.priority);
}
/** Store Gemini's visual analysis of a competitor video. */
export function storeVisualAnalysis(videoId, analysis) {
    const result = db.prepare(`
    INSERT INTO youtube_visual_analysis
    (video_id, pacing_score, cut_frequency, avatar_quality, visual_complexity, editing_style, thumbnail_notes, overall_notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(videoId, analysis.pacing_score, analysis.cut_frequency, analysis.avatar_quality, analysis.visual_complexity, analysis.editing_style, analysis.thumbnail_notes, analysis.overall_notes, Math.floor(Date.now() / 1000));
    return { id: result.lastInsertRowid };
}
/** Get visual analysis for a video — what Gemini saw. */
export function getVisualAnalysis(videoId) {
    return db.prepare(`
    SELECT
      pacing_score, cut_frequency, avatar_quality, visual_complexity,
      editing_style, thumbnail_notes, overall_notes
    FROM youtube_visual_analysis
    WHERE video_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(videoId);
}
/** Compare visual styles across competitor videos — identify their patterns. */
export function getCompetitorVisualPatterns(competitorChannelId) {
    const analyses = db.prepare(`
    SELECT
      v.pacing_score, v.avatar_quality, v.visual_complexity, v.editing_style
    FROM youtube_visual_analysis v
    JOIN youtube_videos yt ON v.video_id = yt.video_id
    WHERE yt.channel_id = ?
  `).all(competitorChannelId);
    if (analyses.length === 0) {
        return {
            avg_pacing_score: 0,
            avg_avatar_quality: 0,
            avg_visual_complexity: 0,
            common_editing_styles: [],
            top_insight: 'No visual analysis data available yet',
        };
    }
    const avg_pacing = analyses.reduce((sum, a) => sum + a.pacing_score, 0) / analyses.length;
    const avg_avatar = analyses.reduce((sum, a) => sum + a.avatar_quality, 0) / analyses.length;
    const avg_visual = analyses.reduce((sum, a) => sum + a.visual_complexity, 0) / analyses.length;
    // Count editing styles
    const styleCounts = {};
    for (const a of analyses) {
        const styles = a.editing_style.split(',').map((s) => s.trim());
        for (const style of styles) {
            styleCounts[style] = (styleCounts[style] || 0) + 1;
        }
    }
    const common_editing_styles = Object.entries(styleCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([style, frequency]) => ({ style, frequency }));
    const pacing_desc = avg_pacing > 70 ? 'fast-paced with frequent cuts' : avg_pacing > 40 ? 'moderate pacing' : 'slow, minimal cuts';
    const avatar_desc = avg_avatar > 70 ? 'highly expressive avatar' : avg_avatar > 40 ? 'moderately expressive' : 'static or minimal avatar movement';
    const top_insight = `Competitors use ${pacing_desc}, ${avatar_desc}, and focus on: ${common_editing_styles[0]?.style || 'standard editing'}`;
    return {
        avg_pacing_score: Math.round(avg_pacing),
        avg_avatar_quality: Math.round(avg_avatar),
        avg_visual_complexity: Math.round(avg_visual),
        common_editing_styles,
        top_insight,
    };
}
export function queryGodSEyeBriefCache(niche, channelId) {
    const now = Math.floor(Date.now() / 1000);
    const cached = db
        .prepare(`SELECT brief, expires_at FROM god_s_eye_brief_cache
       WHERE niche = ? AND channel_id = ? AND expires_at > ?
       LIMIT 1`)
        .get(niche, channelId, now);
    if (!cached)
        return null;
    return {
        brief: JSON.parse(cached.brief),
        expires_at: cached.expires_at,
    };
}
export function storeGodSEyeBriefInCache(niche, channelId, brief, costUsd = 0.5) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 7 * 24 * 60 * 60; // 7-day TTL
    db.prepare(`INSERT OR REPLACE INTO god_s_eye_brief_cache
     (niche, channel_id, brief, cost_usd, created_at, expires_at, access_count)
     VALUES (?, ?, ?, ?, ?, ?, 0)`).run(niche, channelId, JSON.stringify(brief), costUsd, now, expiresAt);
}
export function incrementGodSEyeBriefCacheAccess(niche, channelId) {
    db.prepare(`UPDATE god_s_eye_brief_cache SET access_count = access_count + 1
     WHERE niche = ? AND channel_id = ?`).run(niche, channelId);
}
export function isBriefStale(niche, channelId, staleThresholdSeconds = 12 * 60 * 60) {
    const cached = db
        .prepare(`SELECT expires_at FROM god_s_eye_brief_cache WHERE niche = ? AND channel_id = ? LIMIT 1`)
        .get(niche, channelId);
    if (!cached)
        return true; // Not cached, consider stale
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = cached.expires_at - now;
    return timeUntilExpiry < staleThresholdSeconds;
}
export function getGodSEyeCacheStats() {
    const now = Math.floor(Date.now() / 1000);
    const stats = db
        .prepare(`SELECT
         COUNT(*) as total_cached,
         SUM(access_count) as total_accesses,
         AVG(access_count) as avg_access_count,
         SUM(CASE WHEN expires_at < ? THEN 1 ELSE 0 END) as expired_count
       FROM god_s_eye_brief_cache`)
        .get(now);
    return {
        totalCached: stats.total_cached || 0,
        totalAccesses: stats.total_accesses || 0,
        averageAccessCount: stats.avg_access_count || 0,
        expiredCount: stats.expired_count || 0,
    };
}
// ── Mission Post-Mortem Logging ───────────────────────────────────────
export function logMissionPostMortem(data) {
    const durationSeconds = data.completedAt - data.startedAt;
    const costVariancePercent = data.expectedCost > 0
        ? ((data.totalCostUsd - data.expectedCost) / data.expectedCost) * 100
        : null;
    const durationVariancePercent = data.expectedDurationSeconds > 0
        ? ((durationSeconds - data.expectedDurationSeconds) / data.expectedDurationSeconds) * 100
        : null;
    const contextWindowPressurePercent = data.peakContextTokens > 0
        ? (data.peakContextTokens / 1000000) * 100
        : null;
    db.prepare(`INSERT INTO mission_post_mortem (
      mission_id, agent_id, mission_title, project_id, niche,
      started_at, completed_at, duration_seconds,
      god_s_eye_calls_total, god_s_eye_calls_cached, god_s_eye_calls_api, god_s_eye_cost,
      anti_slop_checks_total, anti_slop_checks_cached, anti_slop_rejections, anti_slop_flags,
      total_cost_usd,
      peak_context_tokens, average_context_tokens, context_window_pressure_percent,
      autonomous_decisions_made, escalations_to_ava, escalations_accepted, escalations_rejected,
      num_outputs_produced, outputs_approved_first_pass, outputs_rejected_total, revision_rounds_total,
      friction_points, loop_detections,
      expected_cost, expected_duration_seconds,
      cost_variance_percent, duration_variance_percent,
      status, summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(data.missionId, data.agentId, data.missionTitle, data.projectId || null, data.niche || null, data.startedAt, data.completedAt, durationSeconds, data.godSEyeCallsTotal, data.godSEyeCallsCached, data.godSEyeCallsApi, data.godSEyeCost, data.antiSlopChecksTotal, data.antiSlopChecksCached, data.antiSlopRejections, data.antiSlopFlags, data.totalCostUsd, data.peakContextTokens, data.averageContextTokens, contextWindowPressurePercent, data.autonomousDecisionsMade, data.escalationsToAva, data.escalationsAccepted, data.escalationsRejected, data.numOutputsProduced, data.outputsApprovedFirstPass, data.outputsRejectedTotal, data.revisionRoundsTotal, typeof data.frictionPoints === 'string' ? data.frictionPoints : JSON.stringify(data.frictionPoints), typeof data.loopDetections === 'string' ? data.loopDetections : JSON.stringify(data.loopDetections), data.expectedCost, data.expectedDurationSeconds, costVariancePercent, durationVariancePercent, data.status, data.summary);
}
