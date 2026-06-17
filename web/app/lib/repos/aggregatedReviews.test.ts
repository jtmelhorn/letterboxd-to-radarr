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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-aggregated-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("getAggregatedMovies", () => {
  it("merges reviews of the same film across reviewers even when one link is not a /film/ url", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { upsertMovieMetadata } = await import("@/app/lib/repos/movieMetadata");
    const { recordSyncResult } = await import("@/app/lib/repos/syncResults");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");

    const alice = getOrCreateUser("alice");
    const bob = getOrCreateUser("bob");

    // Alice's review came in with a normal Letterboxd review link.
    upsertReviews(alice.id, [
      {
        title: "Shared Film",
        year: 2026,
        rating: 4.5,
        letterboxdUrl: "https://letterboxd.com/alice/film/shared-film/",
        reviewedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    // Bob's review came in with a boxd.it short link (no /film/ segment) but a
    // raw RSS guid that still carries the film slug. Sanitize stores the
    // canonical guid "film:shared-film" while the link stays a shortlink.
    upsertReviews(bob.id, [
      {
        title: "Shared Film",
        year: 2026,
        rating: 3.5,
        letterboxdUrl: "https://boxd.it/AbCd",
        guid: "letterboxd:bob/review/film/shared-film/",
        reviewedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    // Metadata + sync status are recorded under the canonical film id.
    upsertMovieMetadata({
      filmId: "film:shared-film",
      title: "Shared Film",
      year: 2026,
      genres: ["Drama"],
      metadataSource: "radarr",
      metadataId: "42",
      metadataMediaType: "movie",
      metadataLookupStatus: "matched",
      metadataLastFetchedAt: "2026-01-03T00:00:00.000Z",
    });
    const bobReview = (await import("@/app/lib/repos/reviews")).getReviewRows(bob.id)[0]!;
    recordSyncResult({
      reviewId: bobReview.id,
      filmId: "film:shared-film",
      status: "added",
      message: "Added by Radarr.",
      auto: false,
    });

    const movies = getAggregatedMovies({ type: "all" });
    const shared = movies.filter((movie) => movie.title === "Shared Film");

    expect(shared).toHaveLength(1);
    const movie = shared[0]!;
    expect(movie.id).toBe("film:shared-film");
    expect(movie.reviewerCount).toBe(2);
    expect(movie.reviewerHandles).toEqual(["alice", "bob"]);
    expect(movie.reviews).toHaveLength(2);
    expect(movie.reviews.map((review) => review.reviewerHandle).sort()).toEqual([
      "alice",
      "bob",
    ]);
    // Genres and sync status travel with the canonical film id to the merged movie.
    expect(movie.genres).toEqual(["Drama"]);
    expect(movie.status).toBe("added");
  });

  it("does not duplicate a film when a stored review has no link at all", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");

    const alice = getOrCreateUser("alice");
    const bob = getOrCreateUser("bob");

    upsertReviews(alice.id, [
      {
        title: "Linkless",
        year: 2025,
        rating: 4,
        letterboxdUrl: "https://letterboxd.com/alice/film/linkless/",
      },
    ]);
    // Bob's row is stored with a canonical guid but no link (e.g. legacy import).
    upsertReviews(bob.id, [
      {
        title: "Linkless",
        year: 2025,
        rating: 3,
        guid: "letterboxd:bob/review/film/linkless/",
      },
    ]);

    const movies = getAggregatedMovies({ type: "all" });
    const linkless = movies.filter((movie) => movie.title === "Linkless");

    expect(linkless).toHaveLength(1);
    expect(linkless[0]!.reviews).toHaveLength(2);
    expect(linkless[0]!.reviewerCount).toBe(2);
  });
});
