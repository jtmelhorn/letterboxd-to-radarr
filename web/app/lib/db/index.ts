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
  review_text TEXT,
  letterboxd_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_guid_unique ON reviews(user_id, guid);
CREATE INDEX IF NOT EXISTS reviews_user_rating_idx ON reviews(user_id, rating);
CREATE INDEX IF NOT EXISTS reviews_user_reviewed_idx ON reviews(user_id, reviewed_at);

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

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY,
  admin_password_hash TEXT NOT NULL DEFAULT '',
  setup_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function init(): { sqlite: Database.Database; db: DrizzleDb } {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(path.join(dataDir, "app.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(DDL);

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
