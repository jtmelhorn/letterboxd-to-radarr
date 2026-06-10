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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-reconcile-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function stubRadarrLibrary(movies: Array<{ id: number; tmdbId?: number; imdbId?: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url === "http://radarr.local/api/v3/movie" && method === "GET") {
        return Response.json(movies);
      }
      return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
    }),
  );
}

async function seedSyncedFilms() {
  const { getOrCreateUser } = await import("@/app/lib/repos/users");
  const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
  const { recordSyncResult } = await import("@/app/lib/repos/syncResults");
  const { saveSettings } = await import("@/app/lib/repos/settings");

  saveSettings({ radarrUrl: "http://radarr.local", radarrApiKey: "secret" });

  const user = getOrCreateUser("alice");
  upsertReviews(user.id, [
    {
      title: "Still There",
      year: 2026,
      rating: 5,
      letterboxdUrl: "https://letterboxd.com/alice/film/still-there/",
    },
    {
      title: "Gone Movie",
      year: 2026,
      rating: 5,
      letterboxdUrl: "https://letterboxd.com/alice/film/gone-movie/",
    },
    {
      title: "No Ids",
      year: 2026,
      rating: 5,
      letterboxdUrl: "https://letterboxd.com/alice/film/no-ids/",
    },
  ]);
  const rows = getReviewRows(user.id);
  const stillThere = rows.find((row) => row.title === "Still There")!;
  const goneMovie = rows.find((row) => row.title === "Gone Movie")!;
  const noIds = rows.find((row) => row.title === "No Ids")!;

  recordSyncResult({
    reviewId: stillThere.id,
    status: "added",
    radarrTmdbId: 100,
    radarrMovieId: 11,
    message: "Added.",
    auto: true,
  });
  recordSyncResult({
    reviewId: goneMovie.id,
    status: "added",
    radarrTmdbId: 200,
    radarrMovieId: 22,
    message: "Added.",
    auto: true,
  });
  // Synced film with no recorded Radarr identifiers: cannot be verified.
  recordSyncResult({ reviewId: noIds.id, status: "exists", message: "Already there.", auto: true });
}

describeWithSqlite("reconcileSyncedMovies", () => {
  it("records missing_in_radarr for synced films absent from the library and is idempotent", async () => {
    await seedSyncedFilms();
    stubRadarrLibrary([{ id: 11, tmdbId: 100 }]);

    const { reconcileSyncedMovies } = await import("@/app/lib/reconcile");
    const { latestFilmStatuses } = await import("@/app/lib/repos/syncResults");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");

    const first = await reconcileSyncedMovies();
    expect(first).toEqual({ checked: 2, missing: 1 });
    expect(latestFilmStatuses(["film:still-there", "film:gone-movie", "film:no-ids"])).toEqual(
      new Map([
        ["film:still-there", "added"],
        ["film:gone-movie", "missing_in_radarr"],
        ["film:no-ids", "exists"],
      ]),
    );

    const syncedTitles = getAggregatedMovies({ type: "all" }, { onlySynced: true }).map(
      (movie) => movie.title,
    );
    expect(syncedTitles).not.toContain("Gone Movie");
    expect(syncedTitles).toContain("Still There");

    // The missing film is no longer in the synced set, so a second run
    // verifies one fewer film and records nothing new.
    const second = await reconcileSyncedMovies();
    expect(second).toEqual({ checked: 1, missing: 0 });
  });

  it("matches by tmdbId when no radarrMovieId is recorded", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { recordSyncResult, latestFilmStatuses } = await import("@/app/lib/repos/syncResults");
    const { saveSettings } = await import("@/app/lib/repos/settings");

    saveSettings({ radarrUrl: "http://radarr.local", radarrApiKey: "secret" });
    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Tmdb Only",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/tmdb-only/",
      },
    ]);
    const review = getReviewRows(user.id)[0]!;
    recordSyncResult({
      reviewId: review.id,
      status: "added",
      radarrTmdbId: 300,
      message: "Added.",
      auto: true,
    });

    stubRadarrLibrary([{ id: 99, tmdbId: 300 }]);
    const { reconcileSyncedMovies } = await import("@/app/lib/reconcile");

    expect(await reconcileSyncedMovies()).toEqual({ checked: 1, missing: 0 });
    expect(latestFilmStatuses(["film:tmdb-only"])).toEqual(new Map([["film:tmdb-only", "added"]]));
  });

  it("throws and records nothing when Radarr is unreachable", async () => {
    await seedSyncedFilms();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );

    const { reconcileSyncedMovies } = await import("@/app/lib/reconcile");
    const { RadarrError } = await import("@/app/lib/radarr");
    const { latestFilmStatuses } = await import("@/app/lib/repos/syncResults");

    await expect(reconcileSyncedMovies()).rejects.toBeInstanceOf(RadarrError);
    expect(latestFilmStatuses(["film:still-there", "film:gone-movie", "film:no-ids"])).toEqual(
      new Map([
        ["film:still-there", "added"],
        ["film:gone-movie", "added"],
        ["film:no-ids", "exists"],
      ]),
    );
  });

  it("treats missing_in_radarr as a valid status that sync may re-add", async () => {
    const { isSyncMovieStatus } = await import("@/app/lib/repos/syncResults");
    expect(isSyncMovieStatus("missing_in_radarr")).toBe(true);
  });
});
