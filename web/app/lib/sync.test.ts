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

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://www.themoviedb.org">
  <channel>
    <item>
      <guid>letterboxd-action-future</guid>
      <link>https://letterboxd.com/alice/film/action-future/</link>
      <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
      <letterboxd:filmTitle>Action Future</letterboxd:filmTitle>
      <letterboxd:filmYear>2026</letterboxd:filmYear>
      <letterboxd:memberRating>5</letterboxd:memberRating>
      <tmdb:movieId>100</tmdb:movieId>
    </item>
    <item>
      <guid>letterboxd-action-past</guid>
      <link>https://letterboxd.com/alice/film/action-past/</link>
      <pubDate>Mon, 01 Jun 2025 00:00:00 GMT</pubDate>
      <letterboxd:filmTitle>Action Past</letterboxd:filmTitle>
      <letterboxd:filmYear>2025</letterboxd:filmYear>
      <letterboxd:memberRating>5</letterboxd:memberRating>
      <tmdb:movieId>101</tmdb:movieId>
    </item>
    <item>
      <guid>letterboxd-future-doc</guid>
      <link>https://letterboxd.com/alice/film/future-doc/</link>
      <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
      <letterboxd:filmTitle>Future Doc</letterboxd:filmTitle>
      <letterboxd:filmYear>2026</letterboxd:filmYear>
      <letterboxd:memberRating>5</letterboxd:memberRating>
      <tmdb:movieId>200</tmdb:movieId>
    </item>
  </channel>
</rss>`;

const lookupMovies = new Map([
  [
    "100",
    {
      title: "Action Future",
      titleSlug: "action-future-2026",
      year: 2026,
      tmdbId: 100,
      genres: ["Action"],
      images: [],
    },
  ],
  [
    "101",
    {
      title: "Action Past",
      titleSlug: "action-past-2025",
      year: 2025,
      tmdbId: 101,
      genres: ["Action"],
      images: [],
    },
  ],
  [
    "200",
    {
      title: "Future Doc",
      titleSlug: "future-doc-2026",
      year: 2026,
      tmdbId: 200,
      genres: ["Documentary"],
      images: [],
    },
  ],
]);

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-sync-"));
  process.env.DATA_DIR = dataDir;
  process.env.APP_PASSWORD = "test-password";
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.APP_PASSWORD;
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describeWithSqlite("sync filtering", () => {
  it("skips filtered movies before approval or Radarr add and leaves direct manual adds unfiltered", async () => {
    let addCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }

        if (url === "http://radarr.local/api/v3/movie" && method === "POST") {
          addCalls += 1;
          return Response.json({ id: addCalls }, { status: 201 });
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getDb } = await import("@/app/lib/db");
    const { radarrTargets } = await import("@/app/lib/db/schema");
    const { getReviewRows } = await import("@/app/lib/repos/reviews");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    getDb().update(radarrTargets).set({ autoFetchMetadata: false }).run();
    const group = upsertReviewerGroup({
      name: "2026 no docs",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: ["Documentary"] },
      },
      reviewerHandles: ["alice"],
    });

    const summary = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(summary.added).toBe(0);
    expect(summary.pending).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(addCalls).toBe(0);
    expect(summary.results.filter((result) => result.status === "skipped")).toHaveLength(2);
    expect(summary.results.some((result) => result.message.includes("release year 2025 does not match exact year 2026"))).toBe(true);
    expect(summary.results.some((result) => result.message.includes("genre Documentary is excluded"))).toBe(true);

    const docReview = getReviewRows(getOrCreateUser("alice").id).find((review) => review.title === "Future Doc");
    expect(docReview).toBeDefined();

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { POST } = await import("@/app/api/radarr/route");
    const response = await POST(
      new Request("http://localhost/api/radarr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
        body: JSON.stringify({ reviewId: docReview!.id }),
      }),
    );

    expect(response.status).toBe(200);
    expect(addCalls).toBe(1);
  });

  it("does not recreate a rejected pending approval on the next sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { listPendingApprovals, resolvePendingApproval } = await import("@/app/lib/repos/pendingApprovals");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    const group = upsertReviewerGroup({
      name: "Manual 2026 action",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: ["Documentary"] },
      },
      reviewerHandles: ["alice"],
    });

    const first = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });
    const pending = listPendingApprovals()[0];
    expect(first.pending).toBe(1);
    expect(pending).toMatchObject({ filmId: "film:action-future", status: "pending" });

    resolvePendingApproval(pending!.id, "rejected", "Rejected before Radarr sync.");
    const second = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(second.pending).toBe(0);
    expect(listPendingApprovals()).toHaveLength(0);
  });

  it("does not fetch or sync a disabled group", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ message: "Unexpected request" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    const group = upsertReviewerGroup({
      name: "Paused",
      enabled: false,
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });

    const summary = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(summary.fetched).toBe(0);
    expect(summary.added).toBe(0);
    expect(summary.pending).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips metadata lookup when enabled group filters do not use genres", async () => {
    let lookupCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          lookupCalls += 1;
          return Response.json([]);
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    const group = upsertReviewerGroup({
      name: "Future only",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: [] },
      },
      reviewerHandles: ["alice"],
    });

    const summary = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(summary.fetched).toBe(3);
    expect(summary.pending).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(lookupCalls).toBe(0);
  });

  it("uses the setup threshold on the default group for all-scope syncs", async () => {
    const addedTitles: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }

        if (url === "http://radarr.local/api/v3/movie" && method === "POST") {
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            title?: string;
            year?: number;
            tmdbId?: number;
          };
          if (payload.title) addedTitles.push(payload.title);
          return Response.json(
            { id: 800 + addedTitles.length, title: payload.title, year: payload.year, tmdbId: payload.tmdbId },
            { status: 201 },
          );
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getDefaultReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { POST } = await import("@/app/api/setup/complete/route");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
      autoThreshold: 5,
    });

    const setupResponse = await POST(
      new Request("http://localhost/api/setup/complete", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
      }),
    );
    const summary = await runSyncScope({ type: "all" }, { auto: true });

    expect(setupResponse.status).toBe(200);
    expect(getDefaultReviewerGroup()).toMatchObject({
      name: "All reviewers",
      ratingThreshold: 5,
      reviewerHandles: ["alice"],
    });
    expect(summary.added).toBe(3);
    expect(addedTitles.sort()).toEqual(["Action Future", "Action Past", "Future Doc"]);
  });

  it("refreshes reviews without Radarr add side effects and keeps POST sync as the add path", async () => {
    let addCalls = 0;
    const addedTitles: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }

        if (url === "http://radarr.local/api/v3/movie" && method === "POST") {
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            title?: string;
            year?: number;
            tmdbId?: number;
          };
          addCalls += 1;
          if (payload.title) addedTitles.push(payload.title);
          return Response.json(
            { id: 900 + addCalls, title: payload.title, year: payload.year, tmdbId: payload.tmdbId },
            { status: 201 },
          );
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { getRecentSyncResults } = await import("@/app/lib/repos/syncResults");
    const { GET } = await import("@/app/api/reviews/route");
    const { POST: syncPost } = await import("@/app/api/sync/route");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    const group = upsertReviewerGroup({
      name: "Action fans",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: ["Documentary"] },
      },
      reviewerHandles: ["alice"],
    });

    const response = await GET(
      new Request("http://localhost/api/reviews?refresh=1&scope=reviewer&reviewer=alice", {
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
      }),
    );
    const body = (await response.json()) as {
      reviews?: Array<{ title: string; status: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(addCalls).toBe(0);
    expect(addedTitles).toEqual([]);
    expect(body.reviews?.find((movie) => movie.title === "Action Future")?.status).not.toBe("added");
    expect(body.reviews?.find((movie) => movie.title === "Future Doc")?.status).not.toBe("added");
    expect(getRecentSyncResults(undefined, 10).filter((result) => result.status === "added")).toHaveLength(
      0,
    );

    const syncResponse = await syncPost(
      new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
        body: JSON.stringify({ scope: "group", groupId: group.id }),
      }),
    );
    const syncBody = (await syncResponse.json()) as { added?: number };

    expect(syncResponse.status).toBe(200);
    expect(syncBody.added).toBe(1);
    expect(addCalls).toBe(1);
    expect(addedTitles).toEqual(["Action Future"]);
    expect(getRecentSyncResults(undefined, 10).filter((result) => result.status === "added")).toHaveLength(
      1,
    );
  });

  it("does not re-add movies after activity is cleared", async () => {
    let addCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }

        if (url === "http://radarr.local/api/v3/movie" && method === "POST") {
          addCalls += 1;
          return Response.json({ id: 800 + addCalls }, { status: 201 });
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { clearAllSyncResults, latestFilmStatuses } = await import("@/app/lib/repos/syncResults");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    const group = upsertReviewerGroup({
      name: "Action fans",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: ["Documentary"] },
      },
      reviewerHandles: ["alice"],
    });

    const first = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });
    expect(first.added).toBe(1);
    expect(addCalls).toBe(1);

    expect(clearAllSyncResults()).toBe(0);
    expect(latestFilmStatuses(["film:action-future"])).toEqual(
      new Map([["film:action-future", "added"]]),
    );

    const second = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });
    expect(second.added).toBe(0);
    expect(addCalls).toBe(1);
  });

  it("adds both 2026 films when a group has no genre exclusions", async () => {
    const addedTitles: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }

        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }

        if (url === "http://radarr.local/api/v3/movie" && method === "POST") {
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            title?: string;
            year?: number;
            tmdbId?: number;
          };
          if (payload.title) addedTitles.push(payload.title);
          return Response.json(
            { id: 950 + addedTitles.length, title: payload.title, year: payload.year, tmdbId: payload.tmdbId },
            { status: 201 },
          );
        }

        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    const group = upsertReviewerGroup({
      name: "All 2026",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: [] },
      },
      reviewerHandles: ["alice"],
    });

    const summary = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(summary.added).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(addedTitles.sort()).toEqual(["Action Future", "Future Doc"]);
  });

  it("removes a synced movie by exact Radarr id without deleting files or blocklisting", async () => {
    let deleteUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";
        if (method === "DELETE" && url.startsWith("http://radarr.local/api/v3/movie/777")) {
          deleteUrl = url;
          return new Response(null, { status: 200 });
        }
        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { recordSyncResult } = await import("@/app/lib/repos/syncResults");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");
    const { listBlocklistedMovies } = await import("@/app/lib/repos/movieBlocklist");
    const { POST } = await import("@/app/api/movies/[id]/remove/route");

    const alice = getOrCreateUser("alice");
    const bob = getOrCreateUser("bob");
    upsertReviews(alice.id, [
      {
        title: "Delete Me",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/delete-me/",
        tmdbMovieId: 700,
      },
    ]);
    upsertReviews(bob.id, [
      {
        title: "Delete Me",
        year: 2026,
        rating: 4.5,
        letterboxdUrl: "https://letterboxd.com/bob/film/delete-me/",
        tmdbMovieId: 700,
      },
    ]);
    const movie = getAggregatedMovies()[0];
    expect(movie.reviews).toHaveLength(2);
    recordSyncResult({
      reviewId: movie.reviews[0]!.id,
      status: "added",
      radarrTmdbId: 700,
      radarrMovieId: 777,
      message: "Movie added to Radarr.",
      auto: false,
    });
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });

    const response = await POST(
      new Request(`http://localhost/api/movies/${encodeURIComponent(movie.id)}/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
        body: JSON.stringify({ deleteFiles: false, blockFutureSync: false }),
      }),
      { params: Promise.resolve({ id: encodeURIComponent(movie.id) }) },
    );

    expect(response.status).toBe(200);
    expect(deleteUrl).toBe("http://radarr.local/api/v3/movie/777");
    expect(getAggregatedMovies(undefined, { onlySynced: true })).toHaveLength(0);
    expect(listBlocklistedMovies()).toHaveLength(0);
  });

  it("recovers the exact Radarr id by TMDB lookup before removing when sync history is missing it", async () => {
    let lookupUrl = "";
    let deleteUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";
        if (method === "GET" && url === "http://radarr.local/api/v3/movie?tmdbId=703") {
          lookupUrl = url;
          return Response.json([{ id: 780, title: "Lookup Delete", year: 2026, tmdbId: 703 }]);
        }
        if (method === "DELETE" && url.startsWith("http://radarr.local/api/v3/movie/780")) {
          deleteUrl = url;
          return new Response(null, { status: 200 });
        }
        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { getRecentSyncResults, recordSyncResult } = await import("@/app/lib/repos/syncResults");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");
    const { POST } = await import("@/app/api/movies/[id]/remove/route");

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Lookup Delete",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/lookup-delete/",
        tmdbMovieId: 703,
      },
    ]);
    const movie = getAggregatedMovies()[0];
    recordSyncResult({
      reviewId: movie.reviews[0]!.id,
      status: "exists",
      radarrTmdbId: 703,
      radarrMovieId: null,
      message: "Already exists in Radarr.",
      auto: false,
    });
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });

    const response = await POST(
      new Request(`http://localhost/api/movies/${encodeURIComponent(movie.id)}/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
        body: JSON.stringify({ deleteFiles: false, blockFutureSync: false }),
      }),
      { params: Promise.resolve({ id: encodeURIComponent(movie.id) }) },
    );

    expect(response.status).toBe(200);
    expect(lookupUrl).toBe("http://radarr.local/api/v3/movie?tmdbId=703");
    expect(deleteUrl).toBe("http://radarr.local/api/v3/movie/780");
    expect(getRecentSyncResults(undefined, 1)).toEqual([
      expect.objectContaining({ status: "removed", radarrMovieId: 780 }),
    ]);
  });

  it("passes explicit deleteFiles and blocklists after removal", async () => {
    let deleteUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";
        if (method === "DELETE" && url.startsWith("http://radarr.local/api/v3/movie/778")) {
          deleteUrl = url;
          return new Response(null, { status: 200 });
        }
        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { recordSyncResult } = await import("@/app/lib/repos/syncResults");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");
    const { listBlocklistedMovies } = await import("@/app/lib/repos/movieBlocklist");
    const { POST } = await import("@/app/api/movies/[id]/remove/route");

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Delete Files",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/delete-files/",
        tmdbMovieId: 701,
      },
    ]);
    const movie = getAggregatedMovies()[0];
    recordSyncResult({
      reviewId: movie.reviews[0]!.id,
      status: "added",
      radarrTmdbId: 701,
      radarrMovieId: 778,
      message: "Movie added to Radarr.",
      auto: false,
    });
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });

    const response = await POST(
      new Request(`http://localhost/api/movies/${encodeURIComponent(movie.id)}/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
        body: JSON.stringify({ deleteFiles: true, blockFutureSync: true }),
      }),
      { params: Promise.resolve({ id: encodeURIComponent(movie.id) }) },
    );

    expect(response.status).toBe(200);
    expect(deleteUrl).toBe("http://radarr.local/api/v3/movie/778?deleteFiles=true");
    expect(listBlocklistedMovies()).toEqual([
      expect.objectContaining({ tmdbId: 701, radarrMovieId: 778, source: "removed_from_radarr" }),
    ]);
  });

  it("records failed_remove and keeps failed removals in the synced list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "Radarr refused deletion." }, { status: 500 })),
    );

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { recordSyncResult } = await import("@/app/lib/repos/syncResults");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");
    const { POST } = await import("@/app/api/movies/[id]/remove/route");

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Still There",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/still-there/",
        tmdbMovieId: 702,
      },
    ]);
    const movie = getAggregatedMovies()[0];
    recordSyncResult({
      reviewId: movie.reviews[0]!.id,
      status: "added",
      radarrTmdbId: 702,
      radarrMovieId: 779,
      message: "Movie added to Radarr.",
      auto: false,
    });
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });

    const response = await POST(
      new Request(`http://localhost/api/movies/${encodeURIComponent(movie.id)}/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
        body: JSON.stringify({ deleteFiles: false, blockFutureSync: true }),
      }),
      { params: Promise.resolve({ id: encodeURIComponent(movie.id) }) },
    );

    expect(response.status).toBe(500);
    expect(getAggregatedMovies(undefined, { onlySynced: true })).toEqual([
      expect.objectContaining({ title: "Still There", status: "failed_remove" }),
    ]);
  });

  it("matches blocklist entries by tmdb id, imdb id, and title/year fallback", async () => {
    const { addToBlocklist, isMovieBlocklisted } = await import("@/app/lib/repos/movieBlocklist");

    addToBlocklist({
      tmdbId: 800,
      title: "TMDB Block",
      year: 2026,
      filmId: "film:tmdb-block",
      source: "manually_blocked",
    });
    addToBlocklist({
      imdbId: "tt1234567",
      title: "IMDb Block",
      year: 2025,
      filmId: "film:imdb-block",
      source: "manually_blocked",
    });
    addToBlocklist({
      title: "Fallback Block",
      year: 2024,
      filmId: "film:fallback-block",
      source: "manually_blocked",
    });

    expect(isMovieBlocklisted({ tmdbId: 800, title: "Anything", year: 1999 })).toBe(true);
    expect(isMovieBlocklisted({ imdbId: "tt1234567", title: "Anything", year: 1999 })).toBe(true);
    expect(isMovieBlocklisted({ title: "fallback block", year: 2024 })).toBe(true);
    // A candidate carrying a tmdbId must still match rows stored without one.
    expect(isMovieBlocklisted({ tmdbId: 801, title: "Fallback Block", year: 2024 })).toBe(true);
    expect(isMovieBlocklisted({ tmdbId: 801, title: "Unrelated Film", year: 2024 })).toBe(false);
  });

  it("skips a sync candidate whose blocklist row lacks the candidate's identifiers", async () => {
    let addCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = init?.method ?? request?.method ?? "GET";

        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rss, {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }
        if (url.startsWith("http://radarr.local/api/v3/movie/lookup")) {
          const term = new URL(url).searchParams.get("term") ?? "";
          const tmdbId = term.startsWith("tmdb:") ? term.slice("tmdb:".length) : "100";
          const movie = lookupMovies.get(tmdbId);
          return Response.json(movie ? [movie] : []);
        }
        if (url === "http://radarr.local/api/v3/movie" && method === "POST") {
          addCalls += 1;
          return Response.json({ id: addCalls }, { status: 201 });
        }
        return Response.json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { getDb } = await import("@/app/lib/db");
    const { radarrTargets } = await import("@/app/lib/db/schema");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { addToBlocklist } = await import("@/app/lib/repos/movieBlocklist");
    const { runSyncScope } = await import("@/app/lib/sync");

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    getDb().update(radarrTargets).set({ autoFetchMetadata: false }).run();
    const group = upsertReviewerGroup({
      name: "All films",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      reviewerHandles: ["alice"],
    });

    // Blocked without a tmdbId; the RSS candidate carries tmdb:100.
    addToBlocklist({
      title: "Action Future",
      year: 2026,
      filmId: "film:action-future",
      source: "manually_blocked",
    });

    const summary = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(summary.skipped).toBe(1);
    expect(summary.added).toBe(2);
    expect(addCalls).toBe(2);

    // Completed runs stamp the group's last-synced timestamp (P1-5).
    const { getReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    expect(getReviewerGroup(group.id)?.lastSyncedAt).toBeTruthy();
    expect(
      summary.results.some(
        (result) => result.title === "Action Future" && result.message.includes("blocklisted"),
      ),
    ).toBe(true);
  });

  it("refuses to approve a pending movie when it is blocklisted", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ message: "Unexpected request" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews } = await import("@/app/lib/repos/reviews");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { upsertReviewerGroup } = await import("@/app/lib/repos/reviewerGroups");
    const { createPendingApproval } = await import("@/app/lib/repos/pendingApprovals");
    const { addToBlocklist } = await import("@/app/lib/repos/movieBlocklist");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");
    const { POST } = await import("@/app/api/pending-approvals/[id]/approve/route");

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Blocked Approval",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/blocked-approval/",
        tmdbMovieId: 900,
      },
    ]);
    const movie = getAggregatedMovies()[0];
    const group = upsertReviewerGroup({
      name: "Approvals",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      reviewerHandles: ["alice"],
    });
    const pending = createPendingApproval({
      groupId: group.id,
      reviewId: movie.reviews[0]!.id,
      filmId: movie.id,
      title: movie.title,
      year: movie.year,
      averageRating: movie.averageRating,
    });
    addToBlocklist({
      tmdbId: 900,
      title: movie.title,
      year: movie.year,
      filmId: movie.id,
      source: "manually_blocked",
    });
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });

    const response = await POST(
      new Request(`http://localhost/api/pending-approvals/${pending!.id}/approve`, {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`,
        },
      }),
      { params: Promise.resolve({ id: String(pending!.id) }) },
    );

    expect(response.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const rewatchedFilmRss = (slug: string, rating: number, date: string, tmdbId: number) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://www.themoviedb.org">
  <channel>
    <item>
      <title>Casino Royale, 2006 - ${"★".repeat(Math.floor(rating))}</title>
      <link>https://letterboxd.com/alice/film/${slug}/</link>
      <guid isPermaLink="false">letterboxd-watch-9001</guid>
      <pubDate>${date}</pubDate>
      <letterboxd:filmTitle>Casino Royale</letterboxd:filmTitle>
      <letterboxd:filmYear>2006</letterboxd:filmYear>
      <letterboxd:memberRating>${rating.toFixed(1)}</letterboxd:memberRating>
      <tmdb:movieId>${tmdbId}</tmdb:movieId>
      <description><![CDATA[ <p><img src="https://cdn.test/${slug}.jpg"/></p>
<p>Watched on Monday April 13, 2026.</p> ]]></description>
    </item>
  </channel>
</rss>`;

  it("preserves a stored real review when a rewatch-only re-sync updates the rating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rewatchedFilmRss("casino-royale", 3.5, "Mon, 13 Apr 2026 00:00:00 GMT", 100), {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }
        return Response.json({ message: "Unexpected request" }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { refreshReviewer } = await import("@/app/lib/sync");
    const { canonicalFilmGuid } = await import("@/app/lib/filmIdentity");

    const alice = getOrCreateUser("alice");
    upsertReviews(alice.id, [
      {
        title: "Casino Royale",
        year: 2006,
        rating: 4.5,
        tmdbMovieId: 100,
        letterboxdUrl: "https://letterboxd.com/alice/film/casino-royale/",
        reviewText: "Best Bond film, hands down.",
        reviewedAt: "2025-06-01T00:00:00.000Z",
      },
    ]);

    await refreshReviewer("alice");

    const rows = getReviewRows(alice.id);
    const royale = rows.filter((row) => row.title === "Casino Royale");
    expect(royale).toHaveLength(1);
    expect(royale[0]!.rating).toBe(3.5);
    expect(royale[0]!.reviewText).toBe("Best Bond film, hands down.");
    expect(canonicalFilmGuid(royale[0]!)).toBe("film:casino-royale");
  });

  it("collapses a divergent-slug rewatch onto the existing row by tmdb id, keeping one film", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://letterboxd.com/alice/rss/") {
          return new Response(rewatchedFilmRss("casino-royale-2006", 3, "Mon, 13 Apr 2026 00:00:00 GMT", 200), {
            status: 200,
            headers: { "Content-Type": "application/rss+xml" },
          });
        }
        return Response.json({ message: "Unexpected request" }, { status: 500 });
      }),
    );

    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { getAggregatedMovies } = await import("@/app/lib/repos/aggregatedReviews");
    const { refreshReviewer } = await import("@/app/lib/sync");

    const alice = getOrCreateUser("alice");
    upsertReviews(alice.id, [
      {
        title: "Casino Royale",
        year: 2006,
        rating: 4.5,
        tmdbMovieId: 200,
        letterboxdUrl: "https://letterboxd.com/alice/film/casino-royale/",
        reviewText: "Best Bond film, hands down.",
        reviewedAt: "2025-06-01T00:00:00.000Z",
      },
    ]);

    await refreshReviewer("alice");

    const rows = getReviewRows(alice.id).filter((row) => row.title === "Casino Royale");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(3);
    expect(rows[0]!.reviewText).toBe("Best Bond film, hands down.");

    const movies = getAggregatedMovies().filter((movie) => movie.title === "Casino Royale");
    expect(movies).toHaveLength(1);
    expect(movies[0]!.reviews).toHaveLength(1);
    expect(movies[0]!.tmdbMovieId).toBe(200);
    expect(movies[0]!.reviews[0]!.reviewText).toBe("Best Bond film, hands down.");
  });

  it("cleans up 'Watched on ...' review text already stored from the old footer bug on startup", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { upsertReviews, getReviewRows } = await import("@/app/lib/repos/reviews");
    const { getSqlite, stripWatchedFooterReviewText } = await import("@/app/lib/db");

    const alice = getOrCreateUser("alice");
    // Seed one polluted diary-style row and one real review.
    upsertReviews(alice.id, [
      {
        title: "Old Watch",
        year: 2024,
        rating: 3,
        tmdbMovieId: 555,
        letterboxdUrl: "https://letterboxd.com/alice/film/old-watch/",
        reviewText: "Watched on Friday January 2, 2026.",
      },
      {
        title: "Real Review",
        year: 2024,
        rating: 5,
        tmdbMovieId: 556,
        letterboxdUrl: "https://letterboxd.com/alice/film/real-review/",
        reviewText: "An all-time favorite that holds up in 2026.",
      },
    ]);

    stripWatchedFooterReviewText(getSqlite());

    const rows = getReviewRows(alice.id);
    const oldWatch = rows.find((r) => r.title === "Old Watch");
    const realReview = rows.find((r) => r.title === "Real Review");
    expect(oldWatch).toBeDefined();
    expect(oldWatch!.reviewText).toBeNull();
    expect(realReview).toBeDefined();
    expect(realReview!.reviewText).toBe("An all-time favorite that holds up in 2026.");
  });
});
