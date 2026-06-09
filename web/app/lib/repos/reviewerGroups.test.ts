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
  it("persists enabled state for groups", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getReviewerGroup, upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");

    getOrCreateUser("alice");
    const saved = upsertReviewerGroup({
      name: "Paused",
      enabled: false,
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });

    expect(saved).toMatchObject({ enabled: false });
    expect(getReviewerGroup(saved.id)).toMatchObject({ enabled: false, reviewerHandles: ["alice"] });
  });

  it("seeds the default group and adds new reviewers to it", async () => {
    const { getDefaultReviewerGroupId } = await import("@/app/lib/repos/appState");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getDefaultReviewerGroup, listReviewerGroups, upsertReviewerGroup } = await import(
      "@/app/lib/repos/reviewerGroups"
    );

    const defaultGroup = getDefaultReviewerGroup();
    expect(defaultGroup).toMatchObject({
      name: "All reviewers",
      enabled: true,
      ratingThreshold: 4,
      syncInterval: "1d",
      reviewerHandles: [],
    });
    expect(getDefaultReviewerGroupId()).toBe(defaultGroup?.id);
    expect(listReviewerGroups()).toHaveLength(1);

    getOrCreateUser("Alice");

    expect(getDefaultReviewerGroup()?.reviewerHandles).toEqual(["alice"]);

    upsertReviewerGroup({
      id: defaultGroup!.id,
      name: defaultGroup!.name,
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: [],
    });

    expect(getDefaultReviewerGroup()?.reviewerHandles).toEqual(["alice"]);
  });

  it("prevents deleting the default group while still allowing it to be disabled", async () => {
    const { getDefaultReviewerGroup, deleteReviewerGroup, upsertReviewerGroup } = await import(
      "@/app/lib/repos/reviewerGroups"
    );

    const defaultGroup = getDefaultReviewerGroup();
    expect(defaultGroup).not.toBeNull();

    expect(() => deleteReviewerGroup(defaultGroup!.id)).toThrow("cannot be deleted");

    upsertReviewerGroup({
      id: defaultGroup!.id,
      name: defaultGroup!.name,
      enabled: false,
      ratingThreshold: defaultGroup!.ratingThreshold,
      syncInterval: defaultGroup!.syncInterval,
      requiresManualApproval: defaultGroup!.requiresManualApproval,
      filters: defaultGroup!.filters,
      reviewerHandles: defaultGroup!.reviewerHandles,
    });

    expect(getDefaultReviewerGroup()).toMatchObject({ enabled: false, name: "All reviewers" });
  });

  it("adopts an existing All reviewers group on upgrade without duplicating it", async () => {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const oldDb = new Database(path.join(dataDir, "app.db"));
    oldDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE reviewer_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_threshold REAL NOT NULL DEFAULT 4,
        sync_interval TEXT NOT NULL DEFAULT '1d',
        requires_manual_approval INTEGER NOT NULL DEFAULT 0,
        filters_json TEXT NOT NULL DEFAULT '{"year":{"mode":"any"},"genres":{"include":[],"exclude":[]}}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE reviewer_group_members (
        group_id INTEGER NOT NULL REFERENCES reviewer_groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE app_state (
        id INTEGER PRIMARY KEY,
        admin_password_hash TEXT NOT NULL DEFAULT '',
        setup_completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      INSERT INTO app_state (id) VALUES (1);
      INSERT INTO users (handle) VALUES ('bob');
      INSERT INTO reviewer_groups (id, name, auto_threshold, sync_interval)
        VALUES (7, 'All reviewers', 4.5, 'manual');
    `);
    oldDb.close();

    const { getDefaultReviewerGroupId } = await import("@/app/lib/repos/appState");
    const { getDefaultReviewerGroup, listReviewerGroups } = await import(
      "@/app/lib/repos/reviewerGroups"
    );

    expect(getDefaultReviewerGroupId()).toBe(7);
    expect(listReviewerGroups()).toHaveLength(1);
    expect(getDefaultReviewerGroup()).toMatchObject({
      id: 7,
      name: "All reviewers",
      ratingThreshold: 4.5,
      syncInterval: "manual",
      reviewerHandles: ["bob"],
    });
  });

  it("allows deleting any group", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { deleteReviewerGroup, getReviewerGroup, upsertReviewerGroup } = await import(
      "@/app/lib/repos/reviewerGroups"
    );

    getOrCreateUser("alice");
    const saved = upsertReviewerGroup({
      name: "Deletable",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });

    expect(getReviewerGroup(saved.id)).not.toBeNull();
    deleteReviewerGroup(saved.id);
    expect(getReviewerGroup(saved.id)).toBeNull();
  });

  it("only lists enabled non-manual groups as schedulable", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { listSchedulableReviewerGroups, upsertReviewerGroup } = await import(
      "@/app/lib/repos/reviewerGroups"
    );

    getOrCreateUser("alice");
    upsertReviewerGroup({
      name: "Disabled",
      enabled: false,
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });
    upsertReviewerGroup({
      name: "Manual",
      enabled: true,
      ratingThreshold: 4,
      syncInterval: "manual",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });
    upsertReviewerGroup({
      name: "Daily",
      enabled: true,
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });

    const names = listSchedulableReviewerGroups().map((group) => group.name);

    expect(names).toContain("Daily");
    expect(names).not.toContain("Disabled");
    expect(names).not.toContain("Manual");
  });

  it("persists filters and returns empty filters by default", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getReviewerGroup, upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");

    getOrCreateUser("alice");

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
