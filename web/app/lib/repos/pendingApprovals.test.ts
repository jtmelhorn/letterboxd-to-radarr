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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-approvals-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("pending approval rejection", () => {
  it("keeps rejected films rejected until the rounded average rating increases", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { createPendingApproval, resolvePendingApproval } = await import(
      "@/app/lib/repos/pendingApprovals"
    );

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Approval Movie",
        year: 2026,
        rating: 4.4,
        letterboxdUrl: "https://letterboxd.com/alice/film/approval-movie/",
      },
    ]);
    const review = getReviewRows(user.id)[0]!;
    const group = upsertReviewerGroup({
      name: "Manual",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      reviewerHandles: ["alice"],
    });

    const pending = createPendingApproval({
      groupId: group.id,
      reviewId: review.id,
      filmId: "film:approval-movie",
      title: "Approval Movie",
      year: 2026,
      averageRating: 4.4,
    });

    expect(pending).not.toBeNull();
    resolvePendingApproval(pending!.id, "rejected", "No thanks.");

    expect(
      createPendingApproval({
        groupId: group.id,
        reviewId: review.id,
        filmId: "film:approval-movie",
        title: "Approval Movie",
        year: 2026,
        averageRating: 4.44,
      }),
    ).toBeNull();

    expect(
      createPendingApproval({
        groupId: group.id,
        reviewId: review.id,
        filmId: "film:approval-movie",
        title: "Approval Movie",
        year: 2026,
        averageRating: 4.5,
      }),
    ).toMatchObject({ status: "pending", averageRating: 4.5 });
  });

  it("can reset a rejected approval", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { createPendingApproval, getPendingApproval, resetPendingApproval, resolvePendingApproval } =
      await import("@/app/lib/repos/pendingApprovals");

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Reset Movie",
        year: 2026,
        rating: 4.5,
        letterboxdUrl: "https://letterboxd.com/alice/film/reset-movie/",
      },
    ]);
    const review = getReviewRows(user.id)[0]!;
    const group = upsertReviewerGroup({
      name: "Manual reset",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      reviewerHandles: ["alice"],
    });
    const pending = createPendingApproval({
      groupId: group.id,
      reviewId: review.id,
      filmId: "film:reset-movie",
      title: "Reset Movie",
      year: 2026,
      averageRating: 4.5,
    });
    resolvePendingApproval(pending!.id, "rejected", "No thanks.");

    expect(resetPendingApproval(pending!.id)).toBe(true);
    expect(getPendingApproval(pending!.id)).toBeNull();
  });

  it("GET /api/pending-approvals returns resolved rows only with includeResolved=1", async () => {
    process.env.APP_PASSWORD = "test-password";
    try {
      const { getOrCreateUser } = await import("@/app/lib/repos/users");
      const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
      const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
      const { createPendingApproval, resolvePendingApproval } = await import(
        "@/app/lib/repos/pendingApprovals"
      );
      const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
      const { GET } = await import("@/app/api/pending-approvals/route");

      const user = getOrCreateUser("alice");
      upsertReviews(user.id, [
        {
          title: "Route Movie",
          year: 2026,
          rating: 4.5,
          letterboxdUrl: "https://letterboxd.com/alice/film/route-movie/",
        },
        {
          title: "Resolved Movie",
          year: 2026,
          rating: 4.5,
          letterboxdUrl: "https://letterboxd.com/alice/film/resolved-movie/",
        },
      ]);
      const rows = getReviewRows(user.id);
      const group = upsertReviewerGroup({
        name: "Route group",
        ratingThreshold: 4,
        syncInterval: "1d",
        requiresManualApproval: true,
        reviewerHandles: ["alice"],
      });
      createPendingApproval({
        groupId: group.id,
        reviewId: rows[0]!.id,
        filmId: "film:route-movie",
        title: "Route Movie",
        year: 2026,
        averageRating: 4.5,
      });
      const resolved = createPendingApproval({
        groupId: group.id,
        reviewId: rows[1]!.id,
        filmId: "film:resolved-movie",
        title: "Resolved Movie",
        year: 2026,
        averageRating: 4.5,
      });
      resolvePendingApproval(resolved!.id, "rejected", "No thanks.");

      const cookie = `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`;
      const defaultRes = await GET(
        new Request("http://localhost/api/pending-approvals", { headers: { cookie } }),
      );
      const defaultBody = (await defaultRes.json()) as { pendingApprovals: Array<{ title: string }> };
      expect(defaultBody.pendingApprovals.map((item) => item.title)).toEqual(["Route Movie"]);

      const resolvedRes = await GET(
        new Request("http://localhost/api/pending-approvals?includeResolved=1", {
          headers: { cookie },
        }),
      );
      const resolvedBody = (await resolvedRes.json()) as {
        pendingApprovals: Array<{ title: string; status: string }>;
      };
      expect(resolvedBody.pendingApprovals).toHaveLength(2);
      expect(resolvedBody.pendingApprovals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Route Movie", status: "pending" }),
          expect.objectContaining({ title: "Resolved Movie", status: "rejected" }),
        ]),
      );
    } finally {
      delete process.env.APP_PASSWORD;
    }
  });
});
