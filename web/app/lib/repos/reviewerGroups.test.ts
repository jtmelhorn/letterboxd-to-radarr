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

    expect(getReviewerGroup(1)?.filters).toEqual({ version: 1, rules: [] });

    const saved = upsertReviewerGroup({
      name: "2026 without docs",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        version: 1,
        rules: [
          { type: "releaseYear", operator: "equals", value: 2026 },
          { type: "genre", operator: "excludesAny", values: ["documentary", "Short"] },
        ],
      },
      reviewerHandles: ["alice"],
    });

    expect(saved.filters).toEqual({
      version: 1,
      rules: [
        { type: "releaseYear", operator: "equals", value: 2026 },
        { type: "genre", operator: "excludesAny", values: ["Documentary", "Short"] },
      ],
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
        version: 1,
        rules: [{ type: "releaseYear", operator: "equals", value: 2026 }],
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
});
