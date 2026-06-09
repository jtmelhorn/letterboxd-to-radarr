import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Database = (() => {
  try {
    const BetterSqlite = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite(":memory:");
    db.close();
    return BetterSqlite;
  } catch {
    return null;
  }
})();
const describeWithSqlite = Database ? describe : describe.skip;

let dataDir = "";

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-db-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("database compatibility migrations", () => {
  it("adds blocklist columns before creating indexes on upgraded databases", async () => {
    if (!Database) return;

    mkdirSync(dataDir, { recursive: true });
    const oldDb = new Database(path.join(dataDir, "app.db"));
    oldDb.exec(`
      CREATE TABLE movie_blocklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id INTEGER,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL DEFAULT '',
        year INTEGER,
        film_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manually_blocked',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    oldDb.close();

    const { getSqlite } = await import("@/app/lib/db");
    const sqlite = getSqlite();
    const columns = sqlite.prepare("PRAGMA table_info(movie_blocklist)").all() as Array<{ name: string }>;
    const indexes = sqlite.prepare("PRAGMA index_list(movie_blocklist)").all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["imdb_id", "radarr_movie_id"]));
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["movie_blocklist_imdb_idx", "movie_blocklist_title_year_idx"]),
    );
  });

  it("backfills film ids on legacy sync result rows", async () => {
    if (!Database) return;

    mkdirSync(dataDir, { recursive: true });
    const oldDb = new Database(path.join(dataDir, "app.db"));
    oldDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE reviews (
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

      CREATE TABLE sync_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        radarr_tmdb_id INTEGER,
        radarr_movie_id INTEGER,
        message TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 1,
        auto INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      INSERT INTO users (id, handle) VALUES (1, 'alice');
      INSERT INTO reviews (id, user_id, guid, title, year, rating, letterboxd_url)
        VALUES (1, 1, 'legacy-guid', 'Legacy Movie', 2026, 5, 'https://letterboxd.com/alice/film/legacy-movie/');
      INSERT INTO sync_results (review_id, status, message, auto)
        VALUES (1, 'added', 'Added.', 1);
    `);
    oldDb.close();

    const { getSqlite } = await import("@/app/lib/db");
    const sqlite = getSqlite();
    const columns = sqlite.prepare("PRAGMA table_info(sync_results)").all() as Array<{ name: string }>;
    const row = sqlite.prepare("SELECT film_id AS filmId FROM sync_results").get() as { filmId: string };

    expect(columns.map((column) => column.name)).toContain("film_id");
    expect(row.filmId).toBe("film:legacy-movie");
  });
});
