import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sqliteAvailable = (() => {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
})();
const describeWithSqlite = sqliteAvailable ? describe : describe.skip;

let dataDir = "";

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-blocklist-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("isMovieBlocklisted identifier matrix", () => {
  async function seedRows() {
    const { addToBlocklist } = await import("@/app/lib/repos/movieBlocklist");
    // Rows always carry title/year/filmId (addToBlocklist requires them);
    // what varies is which explicit identifiers were known at block time.
    addToBlocklist({
      tmdbId: 100,
      title: "Tmdb Row",
      year: 2020,
      filmId: "film:tmdb-row",
      source: "manually_blocked",
    });
    addToBlocklist({
      imdbId: "tt0000100",
      title: "Imdb Row",
      year: 2021,
      filmId: "film:imdb-row",
      source: "manually_blocked",
    });
    addToBlocklist({
      title: "Film Row",
      year: 2022,
      filmId: "film:film-row",
      source: "removed_from_radarr",
    });
  }

  it("blocks candidates carrying any superset of the stored identifiers", async () => {
    await seedRows();
    const { isMovieBlocklisted } = await import("@/app/lib/repos/movieBlocklist");

    // tmdbId tier.
    expect(isMovieBlocklisted({ tmdbId: 100 })).toBe(true);
    // imdbId tier even when the candidate's tmdbId matches no row.
    expect(isMovieBlocklisted({ tmdbId: 999, imdbId: "tt0000100" })).toBe(true);
    // filmId tier even when the candidate carries explicit ids the row lacks.
    expect(isMovieBlocklisted({ tmdbId: 999, imdbId: "tt9999999", filmId: "film:film-row" })).toBe(
      true,
    );
    // Normalized title+year tier as the last resort.
    expect(
      isMovieBlocklisted({
        tmdbId: 999,
        imdbId: "tt9999999",
        filmId: "film:somewhere-else",
        title: "film row!",
        year: 2022,
      }),
    ).toBe(true);
  });

  it("does not block when no identifier tier matches", async () => {
    await seedRows();
    const { isMovieBlocklisted } = await import("@/app/lib/repos/movieBlocklist");

    expect(isMovieBlocklisted({ tmdbId: 999 })).toBe(false);
    expect(isMovieBlocklisted({ imdbId: "tt7777777" })).toBe(false);
    expect(isMovieBlocklisted({ filmId: "film:unblocked" })).toBe(false);
    // Title+year needs both fields and an exact year.
    expect(isMovieBlocklisted({ title: "Film Row" })).toBe(false);
    expect(isMovieBlocklisted({ title: "Film Row", year: 2023 })).toBe(false);
  });

  it("matches mismatched tmdb ids through the filmId tier", async () => {
    const { addToBlocklist, isMovieBlocklisted } = await import("@/app/lib/repos/movieBlocklist");
    addToBlocklist({
      tmdbId: 500,
      title: "Bad Metadata",
      year: 2024,
      filmId: "film:bad-metadata",
      source: "manually_blocked",
    });

    // Candidate resolved a different tmdbId for the same film.
    expect(isMovieBlocklisted({ tmdbId: 501, filmId: "film:bad-metadata" })).toBe(true);
  });
});
