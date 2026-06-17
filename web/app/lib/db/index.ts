import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { getDataDir } from "@/app/lib/config";
import { migrateLegacyJson } from "@/app/lib/db/migrateLegacy";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import * as schema from "@/app/lib/db/schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let cached: { sqlite: Database.Database; db: DrizzleDb } | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reviewer_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_threshold REAL NOT NULL DEFAULT 4,
  sync_interval TEXT NOT NULL DEFAULT '1d',
  requires_manual_approval INTEGER NOT NULL DEFAULT 0,
  filters_json TEXT NOT NULL DEFAULT '{"year":{"mode":"any"},"genres":{"include":[],"exclude":[]}}',
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reviewer_group_members (
  group_id INTEGER NOT NULL REFERENCES reviewer_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS reviewer_group_members_user_idx ON reviewer_group_members(user_id);

CREATE TABLE IF NOT EXISTS radarr_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_url TEXT NOT NULL DEFAULT '',
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  quality_profile_id INTEGER,
  quality_profile_name TEXT,
  root_folder_path TEXT,
  min_availability TEXT NOT NULL DEFAULT 'announced',
  auto_threshold REAL NOT NULL DEFAULT 4,
  monitored INTEGER NOT NULL DEFAULT 1,
  auto_fetch_metadata INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  rating REAL NOT NULL,
  reviewed_at TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  review_text TEXT,
  letterboxd_url TEXT,
  tmdb_movie_id INTEGER,
  tmdb_tv_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_guid_unique ON reviews(user_id, guid);
CREATE INDEX IF NOT EXISTS reviews_user_rating_idx ON reviews(user_id, rating);
CREATE INDEX IF NOT EXISTS reviews_user_reviewed_idx ON reviews(user_id, reviewed_at);

CREATE TABLE IF NOT EXISTS movie_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id TEXT NOT NULL UNIQUE,
  normalized_title TEXT NOT NULL,
  year INTEGER,
  genres_json TEXT NOT NULL DEFAULT '[]',
  metadata_source TEXT,
  metadata_id TEXT,
  metadata_media_type TEXT,
  metadata_lookup_status TEXT NOT NULL DEFAULT 'pending',
  metadata_last_fetched_at TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  lookup_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS movie_metadata_status_idx ON movie_metadata(metadata_lookup_status);

CREATE TABLE IF NOT EXISTS sync_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  film_id TEXT,
  status TEXT NOT NULL,
  radarr_tmdb_id INTEGER,
  radarr_movie_id INTEGER,
  message TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 1,
  auto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS sync_results_review_idx ON sync_results(review_id);

CREATE TABLE IF NOT EXISTS pending_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES reviewer_groups(id) ON DELETE CASCADE,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  film_id TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  average_rating REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS pending_approvals_group_idx ON pending_approvals(group_id);
CREATE INDEX IF NOT EXISTS pending_approvals_status_idx ON pending_approvals(status);
CREATE INDEX IF NOT EXISTS pending_approvals_film_idx ON pending_approvals(film_id);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY,
  admin_password_hash TEXT NOT NULL DEFAULT '',
  setup_completed_at TEXT,
  default_group_id INTEGER REFERENCES reviewer_groups(id) ON DELETE SET NULL,
  session_epoch INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS movie_blocklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER,
  imdb_id TEXT,
  radarr_movie_id INTEGER,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL DEFAULT '',
  year INTEGER,
  film_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manually_blocked',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

`;

const DEFAULT_REVIEWER_GROUP_NAME = "All reviewers";
const DEFAULT_FILTERS_JSON = '{"year":{"mode":"any"},"genres":{"include":[],"exclude":[]}}';

function ensureColumn(sqlite: Database.Database, table: string, column: string, ddl: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
    return true;
  }
  return false;
}

function backfillDefaultGroupMembership(sqlite: Database.Database, groupId: number): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO reviewer_group_members (group_id, user_id)
       SELECT ?, id FROM users`,
    )
    .run(groupId);
}

function ensureDefaultReviewerGroup(sqlite: Database.Database): void {
  const tracked = sqlite
    .prepare(
      `SELECT app_state.default_group_id AS defaultGroupId, reviewer_groups.id AS groupId
       FROM app_state
       LEFT JOIN reviewer_groups ON reviewer_groups.id = app_state.default_group_id
       WHERE app_state.id = 1`,
    )
    .get() as { defaultGroupId: number | null; groupId: number | null } | undefined;

  if (tracked?.defaultGroupId && tracked.groupId) {
    backfillDefaultGroupMembership(sqlite, tracked.defaultGroupId);
    return;
  }

  const existing = sqlite
    .prepare("SELECT id FROM reviewer_groups WHERE name = ?")
    .get(DEFAULT_REVIEWER_GROUP_NAME) as { id: number } | undefined;

  const groupId =
    existing?.id ??
    (sqlite
      .prepare(
        `INSERT INTO reviewer_groups (name, filters_json)
         VALUES (?, ?)
         RETURNING id`,
      )
      .get(DEFAULT_REVIEWER_GROUP_NAME, DEFAULT_FILTERS_JSON) as { id: number }).id;

  sqlite
    .prepare(
      `UPDATE app_state
       SET default_group_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 1`,
    )
    .run(groupId);
  backfillDefaultGroupMembership(sqlite, groupId);
}

function backfillSyncResultFilmIds(sqlite: Database.Database): void {
  const rows = sqlite
    .prepare(
      `SELECT sync_results.id AS syncResultId,
              reviews.guid AS guid,
              reviews.title AS title,
              reviews.year AS year,
              reviews.letterboxd_url AS letterboxdUrl
       FROM sync_results
       INNER JOIN reviews ON reviews.id = sync_results.review_id
       WHERE sync_results.film_id IS NULL OR sync_results.film_id = ''`,
    )
    .all() as Array<{
    syncResultId: number;
    guid: string | null;
    title: string;
    year: number | null;
    letterboxdUrl: string | null;
  }>;
  if (rows.length === 0) return;

  const update = sqlite.prepare("UPDATE sync_results SET film_id = ? WHERE id = ?");
  const tx = sqlite.transaction(() => {
    for (const row of rows) {
      update.run(canonicalFilmGuid(row), row.syncResultId);
    }
  });
  tx();
}

/**
 * One-time cleanup: review rows polluted by the old Letterboxd footer bug
 * stored "Watched on Saturday May 30, 2026." (and bare "Watched") as real
 * review text. Null those out so the films recover their "No written review"
 * state without waiting for a re-fetch. Real reviews are never matched because
 * the pattern requires the trailing year + period of the diary footer.
 */
export function stripWatchedFooterReviewText(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `UPDATE reviews
          SET review_text = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE review_text IS NOT NULL
          AND (
            review_text GLOB 'Watched on *[0-9][0-9][0-9][0-9].'
            OR review_text = 'Watched'
            OR review_text = 'Watched.'
          )`,
    )
    .run();
}

function init(): { sqlite: Database.Database; db: DrizzleDb } {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(path.join(dataDir, "app.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(DDL);
  const addedReviewerGroupEnabled = ensureColumn(
    sqlite,
    "reviewer_groups",
    "enabled",
    "enabled INTEGER NOT NULL DEFAULT 1",
  );
  if (addedReviewerGroupEnabled) {
    sqlite.prepare("UPDATE reviewer_groups SET enabled = 0, auto_threshold = 4 WHERE auto_threshold = -1").run();
  }
  ensureColumn(sqlite, "reviewer_groups", "sync_interval", "sync_interval TEXT NOT NULL DEFAULT '1d'");
  ensureColumn(
    sqlite,
    "reviewer_groups",
    "requires_manual_approval",
    "requires_manual_approval INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    sqlite,
    "reviewer_groups",
    "filters_json",
    `filters_json TEXT NOT NULL DEFAULT '{"year":{"mode":"any"},"genres":{"include":[],"exclude":[]}}'`,
  );
  ensureColumn(sqlite, "reviewer_groups", "last_synced_at", "last_synced_at TEXT");
  ensureColumn(
    sqlite,
    "radarr_targets",
    "auto_fetch_metadata",
    "auto_fetch_metadata INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(sqlite, "reviews", "backdrop_url", "backdrop_url TEXT");
  ensureColumn(sqlite, "reviews", "tmdb_movie_id", "tmdb_movie_id INTEGER");
  ensureColumn(sqlite, "reviews", "tmdb_tv_id", "tmdb_tv_id INTEGER");
  ensureColumn(sqlite, "sync_results", "radarr_movie_id", "radarr_movie_id INTEGER");
  ensureColumn(sqlite, "sync_results", "film_id", "film_id TEXT");
  ensureColumn(sqlite, "movie_metadata", "year", "year INTEGER");
  ensureColumn(
    sqlite,
    "app_state",
    "default_group_id",
    "default_group_id INTEGER REFERENCES reviewer_groups(id) ON DELETE SET NULL",
  );
  ensureColumn(sqlite, "app_state", "session_epoch", "session_epoch INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "movie_blocklist", "imdb_id", "imdb_id TEXT");
  ensureColumn(sqlite, "movie_blocklist", "radarr_movie_id", "radarr_movie_id INTEGER");
  const addedBlocklistNormalizedTitle = ensureColumn(
    sqlite,
    "movie_blocklist",
    "normalized_title",
    "normalized_title TEXT NOT NULL DEFAULT ''",
  );
  if (addedBlocklistNormalizedTitle) {
    sqlite
      .prepare("UPDATE movie_blocklist SET normalized_title = lower(trim(title)) WHERE normalized_title = ''")
      .run();
  }
  sqlite
    .prepare("CREATE INDEX IF NOT EXISTS movie_metadata_title_year_idx ON movie_metadata(normalized_title, year)")
    .run();
  sqlite.prepare("CREATE INDEX IF NOT EXISTS movie_blocklist_imdb_idx ON movie_blocklist(imdb_id)").run();
  sqlite
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS movie_blocklist_tmdb_idx ON movie_blocklist(tmdb_id) WHERE tmdb_id IS NOT NULL")
    .run();
  sqlite
    .prepare("CREATE INDEX IF NOT EXISTS movie_blocklist_title_year_idx ON movie_blocklist(normalized_title, year)")
    .run();
  sqlite.prepare("CREATE INDEX IF NOT EXISTS movie_blocklist_film_idx ON movie_blocklist(film_id)").run();
  sqlite
    .prepare("CREATE INDEX IF NOT EXISTS sync_results_film_created_idx ON sync_results(film_id, created_at)")
    .run();

  // Ensure the singleton settings row exists.
  sqlite
    .prepare(
      `INSERT INTO radarr_targets (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM radarr_targets WHERE id = 1)`,
    )
    .run();

  sqlite
    .prepare(`INSERT INTO app_state (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM app_state WHERE id = 1)`)
    .run();

  migrateLegacyJson(sqlite);
  ensureDefaultReviewerGroup(sqlite);
  backfillSyncResultFilmIds(sqlite);
  stripWatchedFooterReviewText(sqlite);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export function getDb(): DrizzleDb {
  if (!cached) {
    cached = init();
  }
  return cached.db;
}

export function getSqlite(): Database.Database {
  if (!cached) {
    cached = init();
  }
  return cached.sqlite;
}
