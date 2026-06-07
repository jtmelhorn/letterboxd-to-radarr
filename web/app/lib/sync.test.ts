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
      autoFetchMetadata: true,
    });
    const group = upsertReviewerGroup({
      name: "2026 no docs",
      ratingThreshold: 4,
      syncInterval: "1d",
      requiresManualApproval: true,
      filters: {
        version: 1,
        rules: [
          { type: "releaseYear", operator: "equals", value: 2026 },
          { type: "genre", operator: "excludesAny", values: ["Documentary"] },
        ],
      },
      reviewerHandles: ["alice"],
    });

    const summary = await runSyncScope({ type: "group", groupId: group.id }, { auto: true });

    expect(summary.added).toBe(0);
    expect(summary.pending).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(addCalls).toBe(0);
    expect(summary.results.filter((result) => result.status === "skipped")).toHaveLength(2);
    expect(summary.results.some((result) => result.message.includes("release year 2025 does not equal 2026"))).toBe(true);
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
});
