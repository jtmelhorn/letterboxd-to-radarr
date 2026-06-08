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

  it("runs freshly pulled reviews through sync groups from the reviews refresh endpoint", async () => {
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
          return Response.json(
            { id: 900 + addCalls, title: "Action Future", year: 2026, tmdbId: 100 },
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

    getOrCreateUser("alice");
    saveSettings({
      radarrUrl: "http://radarr.local",
      radarrApiKey: "secret",
      qualityProfileId: 1,
      rootFolderPath: "/movies",
    });
    upsertReviewerGroup({
      name: "Action fans",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: {
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: [] },
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
    expect(addCalls).toBe(1);
    expect(body.reviews?.find((movie) => movie.title === "Action Future")?.status).toBe("added");
    expect(getRecentSyncResults(undefined, 10).filter((result) => result.status === "added")).toHaveLength(
      1,
    );
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

    const user = getOrCreateUser("alice");
    upsertReviews(user.id, [
      {
        title: "Delete Me",
        year: 2026,
        rating: 5,
        letterboxdUrl: "https://letterboxd.com/alice/film/delete-me/",
        tmdbMovieId: 700,
      },
    ]);
    const movie = getAggregatedMovies()[0];
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
    expect(isMovieBlocklisted({ tmdbId: 801, title: "Fallback Block", year: 2024 })).toBe(false);
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
});
