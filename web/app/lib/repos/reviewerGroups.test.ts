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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-groups-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("reviewer group filters", () => {
  it("persists filters and returns empty filters for existing defaults", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getReviewerGroup, upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");

    getOrCreateUser("alice");

    expect(getReviewerGroup(1)?.filters).toEqual({
      year: { mode: "any" },
      genres: { include: [], exclude: [] },
    });

    const saved = upsertReviewerGroup({
      name: "2026 without docs",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        year: { mode: "gte", minYear: 2020 },
        genres: { include: ["action"], exclude: ["documentary", "Short"] },
      },
      reviewerHandles: ["alice"],
    });

    expect(saved.filters).toEqual({
      year: { mode: "gte", minYear: 2020 },
      genres: { include: ["Action"], exclude: ["Documentary", "Short"] },
    });

    expect(getReviewerGroup(saved.id)?.filters).toEqual(saved.filters);
  });

  it("preserves filters when an update payload omits filters", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getReviewerGroup, upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");

    getOrCreateUser("alice");
    const saved = upsertReviewerGroup({
      name: "Filtered",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: [] },
      },
      reviewerHandles: ["alice"],
    });

    upsertReviewerGroup({
      id: saved.id,
      name: "Renamed",
      ratingThreshold: 4.5,
      syncInterval: "1w",
      requiresManualApproval: true,
      reviewerHandles: ["alice"],
    });

    expect(getReviewerGroup(saved.id)?.filters).toEqual(saved.filters);
  });

  it("rejects invalid filters on save", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");

    getOrCreateUser("alice");

    expect(() =>
      upsertReviewerGroup({
        name: "Invalid range",
        ratingThreshold: 4,
        syncInterval: "1d",
        requiresManualApproval: false,
        filters: {
          year: { mode: "between", minYear: 2026, maxYear: 2020 },
          genres: { include: [], exclude: [] },
        },
        reviewerHandles: ["alice"],
      }),
    ).toThrow("Minimum year cannot be greater than maximum year.");
  });

  it("returns normalized filters when stored legacy filters are read", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getDb } = await import("@/app/lib/db");
    const { reviewerGroups } = await import("@/app/lib/db/schema");
    const { getReviewerGroup, upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");

    getOrCreateUser("alice");
    const saved = upsertReviewerGroup({
      name: "Legacy filters",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });

    getDb()
      .update(reviewerGroups)
      .set({
        filtersJson: JSON.stringify({
          version: 1,
          rules: [
            { type: "releaseYear", operator: "equals", value: 2026 },
            { type: "genre", operator: "excludesAny", values: ["documentary"] },
          ],
        }),
      })
      .run();

    expect(getReviewerGroup(saved.id)?.filters).toEqual({
      year: { mode: "exact", exactYear: 2026 },
      genres: { include: [], exclude: ["Documentary"] },
    });
  });
});
