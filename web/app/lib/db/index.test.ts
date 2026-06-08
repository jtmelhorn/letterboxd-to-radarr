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
});
