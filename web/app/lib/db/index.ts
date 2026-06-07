import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { getDataDir } from "@/app/lib/config";
import { migrateLegacyJson } from "@/app/lib/db/migrateLegacy";
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
  auto_threshold REAL NOT NULL DEFAULT 4,
  sync_interval TEXT NOT NULL DEFAULT '1d',
  requires_manual_approval INTEGER NOT NULL DEFAULT 0,
  filters_json TEXT NOT NULL DEFAULT '{"year":{"mode":"any"},"genres":{"include":[],"exclude":[]}}',
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
  status TEXT NOT NULL,
  radarr_tmdb_id INTEGER,
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
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function ensureColumn(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  }
}

function init(): { sqlite: Database.Database; db: DrizzleDb } {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(path.join(dataDir, "app.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(DDL);
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
  ensureColumn(
    sqlite,
    "radarr_targets",
    "auto_fetch_metadata",
    "auto_fetch_metadata INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(sqlite, "reviews", "backdrop_url", "backdrop_url TEXT");
  ensureColumn(sqlite, "reviews", "tmdb_movie_id", "tmdb_movie_id INTEGER");
  ensureColumn(sqlite, "reviews", "tmdb_tv_id", "tmdb_tv_id INTEGER");
  ensureColumn(sqlite, "movie_metadata", "year", "year INTEGER");
  sqlite
    .prepare("CREATE INDEX IF NOT EXISTS movie_metadata_title_year_idx ON movie_metadata(normalized_title, year)")
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

  sqlite
    .prepare(
      `INSERT INTO reviewer_groups (id, name, auto_threshold)
       SELECT 1, 'All reviewers', COALESCE((SELECT auto_threshold FROM radarr_targets WHERE id = 1), 4)
       WHERE NOT EXISTS (SELECT 1 FROM reviewer_groups WHERE id = 1)`,
    )
    .run();

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO reviewer_group_members (group_id, user_id)
       SELECT 1, id FROM users`,
    )
    .run();

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
