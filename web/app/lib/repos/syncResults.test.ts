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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-sync-results-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("film-level sync result status", () => {
  it("keeps success over later transient failures but allows terminal removal states", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { latestFilmStatuses, recordSyncResult } = await import("@/app/lib/repos/syncResults");

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Sticky Success",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/sticky-success/",
      },
      {
        title: "Block Me",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/block-me/",
      },
      {
        title: "Remove Me",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/remove-me/",
      },
    ]);
    const rows = getReviewRows(user.id);
    const sticky = rows.find((row) => row.title === "Sticky Success")!;
    const block = rows.find((row) => row.title === "Block Me")!;
    const remove = rows.find((row) => row.title === "Remove Me")!;

    recordSyncResult({ reviewId: sticky.id, status: "added", message: "Added.", auto: true });
    recordSyncResult({ reviewId: sticky.id, status: "error", message: "Temporary failure.", auto: true });
    recordSyncResult({ reviewId: block.id, status: "added", message: "Added.", auto: true });
    recordSyncResult({ reviewId: block.id, status: "blocklisted", message: "Blocked.", auto: false });
    recordSyncResult({ reviewId: remove.id, status: "exists", message: "Already there.", auto: true });
    recordSyncResult({ reviewId: remove.id, status: "removed", message: "Removed.", auto: false });

    expect(
      latestFilmStatuses([
        "film:sticky-success",
        "film:block-me",
        "film:remove-me",
      ]),
    ).toEqual(
      new Map([
        ["film:sticky-success", "added"],
        ["film:block-me", "blocklisted"],
        ["film:remove-me", "removed"],
      ]),
    );
  });

  it("resolves status across multiple reviews for the same film", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { latestFilmStatuses, recordSyncResult } = await import("@/app/lib/repos/syncResults");

    const alice = getOrCreateUser("alice");
    const bob = getOrCreateUser("bob");
    const movie = {
      title: "Shared Film",
      year: 2026,
      rating: 5,
      letterboxdUrl: "https://letterboxd.com/alice/film/shared-film/",
    };
    upsertReviews(alice.id, [movie]);
    upsertReviews(bob.id, [{ ...movie, letterboxdUrl: "https://letterboxd.com/bob/film/shared-film/" }]);

    const aliceReview = getReviewRows(alice.id)[0]!;
    recordSyncResult({ reviewId: aliceReview.id, status: "added", message: "Added.", auto: true });

    expect(latestFilmStatuses(["film:shared-film"])).toEqual(
      new Map([["film:shared-film", "added"]]),
    );
  });
});
