import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MovieReview } from "@/app/types/movie";

function reviewItem(opts: {
  guid: string;
  slug: string;
  title: string;
  year: number;
  rating: number;
  tmdbId?: number;
  pubDate: string;
  reviewText?: string;
}) {
  const { guid, slug, title, year, rating, tmdbId, pubDate, reviewText } = opts;
  const body = reviewText
    ? `<p>${reviewText}</p>`
    : "<p>Watched on Saturday May 30, 2026.</p>";
  const tmdb = tmdbId ? `\n      <tmdb:movieId>${tmdbId}</tmdb:movieId>` : "";
  return `    <item>
      <title>${title}, ${year} - ${"★".repeat(Math.floor(rating))}</title>
      <link>https://letterboxd.com/alice/film/${slug}/</link>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <letterboxd:filmTitle>${title}</letterboxd:filmTitle>
      <letterboxd:filmYear>${year}</letterboxd:filmYear>
      <letterboxd:memberRating>${rating.toFixed(1)}</letterboxd:memberRating>${tmdb}
      <description><![CDATA[ <p><img src="https://cdn.test/${slug}.jpg"/></p>
${body} ]]></description>
    </item>`;
}

function rss(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://www.themoviedb.org">
  <channel>
    <title>Letterboxd - alice</title>
    <link>https://letterboxd.com/alice/</link>
    <description>Letterboxd - alice</description>
${items}
  </channel>
</rss>`;
}

async function fetchReviews(handle: string, xml: string): Promise<MovieReview[]> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `https://letterboxd.com/${handle}/rss/`) {
        return new Response(xml, {
          status: 200,
          headers: { "Content-Type": "application/rss+xml" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  const { fetchLetterboxdReviews } = await import("@/app/lib/letterboxd");
  return fetchLetterboxdReviews(handle);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLetterboxdReviews rewatch handling", () => {
  it("strips the 'Watched on ...' footer so a diary/rewatch entry has no review text", async () => {
    const xml = rss(
      reviewItem({
        guid: "letterboxd-watch-100",
        slug: "backrooms-2026",
        title: "Backrooms",
        year: 2026,
        rating: 3,
        tmdbId: 1083381,
        pubDate: "Sun, 31 May 2026 16:15:27 +1200",
      }),
    );

    const movies = await fetchReviews("alice-rewatch-only", xml);

    expect(movies).toHaveLength(1);
    expect(movies[0]!.title).toBe("Backrooms");
    expect(movies[0]!.rating).toBe(3);
    expect(movies[0]!.reviewText).toBeUndefined();
    expect(movies[0]!.posterUrl).toBe("https://cdn.test/backrooms-2026.jpg");
  });

  it("merges a review + rewatch pair into one film with the most-recent star and the real review text", async () => {
    const xml = rss(
      [
        reviewItem({
          guid: "letterboxd-review-200",
          slug: "casino-royale",
          title: "Casino Royale",
          year: 2006,
          rating: 4.5,
          tmdbId: 100,
          pubDate: "Mon, 01 Jun 2025 00:00:00 GMT",
          reviewText: "Best Bond film, hands down.",
        }),
        reviewItem({
          guid: "letterboxd-watch-201",
          slug: "casino-royale",
          title: "Casino Royale",
          year: 2006,
          rating: 3.5,
          tmdbId: 100,
          pubDate: "Mon, 13 Apr 2026 00:00:00 GMT",
        }),
      ].join("\n"),
    );

    const movies = await fetchReviews("alice-pair", xml);

    expect(movies).toHaveLength(1);
    expect(movies[0]!.rating).toBe(3.5);
    expect(movies[0]!.reviewText).toBe("Best Bond film, hands down.");
    expect(movies[0]!.reviewedAt).toBe(new Date("2026-04-13").toISOString());
    expect(movies[0]!.tmdbMovieId).toBe(100);
  });

  it("collapses a review and a divergent-slug rewatch that share a tmdb id into one film", async () => {
    const xml = rss(
      [
        reviewItem({
          guid: "letterboxd-review-300",
          slug: "dune",
          title: "Dune",
          year: 2021,
          rating: 5,
          tmdbId: 438631,
          pubDate: "Mon, 01 Nov 2021 00:00:00 GMT",
          reviewText: "A breathtaking epic.",
        }),
        // Letterboxd sometimes year-disambiguates the slug on a rewatch.
        reviewItem({
          guid: "letterboxd-watch-301",
          slug: "dune-2021",
          title: "Dune",
          year: 2021,
          rating: 4,
          tmdbId: 438631,
          pubDate: "Mon, 13 Apr 2026 00:00:00 GMT",
        }),
      ].join("\n"),
    );

    const movies = await fetchReviews("alice-divergent-slug", xml);

    expect(movies).toHaveLength(1);
    expect(movies[0]!.rating).toBe(4);
    expect(movies[0]!.reviewText).toBe("A breathtaking epic.");
    expect(movies[0]!.tmdbMovieId).toBe(438631);
  });

  it("keeps real review text that does not match the footer pattern", async () => {
    const xml = rss(
      reviewItem({
        guid: "letterboxd-review-400",
        slug: "the-room",
        title: "The Room",
        year: 2003,
        rating: 1,
        tmdbId: 9407,
        pubDate: "Mon, 01 Jun 2026 00:00:00 GMT",
        reviewText: "Oh hi Mark. You are tearing me apart!",
      }),
    );

    const movies = await fetchReviews("alice-real-review", xml);

    expect(movies).toHaveLength(1);
    expect(movies[0]!.reviewText).toBe("Oh hi Mark. You are tearing me apart!");
  });
});
