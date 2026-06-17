import { LRUCache } from "lru-cache";
import Parser from "rss-parser";

import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import type { MovieReview } from "@/app/types/movie";

interface LetterboxdFeedItem {
  title?: string;
  filmTitle?: string;
  filmYear?: string;
  memberRating?: string;
  isoDate?: string;
  pubDate?: string;
  guid?: string;
  link?: string;
  content?: string;
  "letterboxd:filmTitle"?: string;
  "letterboxd:filmYear"?: string;
  "letterboxd:memberRating"?: string;
  "tmdb:movieId"?: string;
  "tmdb:tvId"?: string;
  tmdbMovieId?: string;
  tmdbTvId?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;

const parser = new Parser<Record<string, never>, LetterboxdFeedItem>({
  customFields: {
    item: [
      ["letterboxd:filmTitle", "filmTitle"],
      ["letterboxd:filmYear", "filmYear"],
      ["letterboxd:memberRating", "memberRating"],
      ["tmdb:movieId", "tmdbMovieId"],
      ["tmdb:tvId", "tmdbTvId"],
    ],
  },
});

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  movies: MovieReview[];
}

// Short-lived parsed-feed cache + conditional-request validators per handle.
const cache = new LRUCache<string, CacheEntry>({ max: 200, ttl: CACHE_TTL_MS });

export function isValidHandle(handle: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(handle);
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return textValue(value[0]);
  return "";
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
}

function extractFromContent(content: string): { posterUrl?: string; reviewText?: string } {
  if (!content) return {};

  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/i);
  const posterUrl = imgMatch?.[1] ?? undefined;

  const withBreaks = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const decoded = decodeHtmlEntities(withBreaks);
  const lines = decoded
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // Letterboxd diary/rewatch ("watch") items have no review body; their
    // content is just "<p>Watched on Saturday May 30, 2026.</p>". Strip those
    // footer lines so they don't become fake review text. Also drop a bare
    // "Watched" line. The previous regex never matched the real format.
    .filter(
      (line) =>
        !/^Watched\s+on\s+.+\d{4}\.?\s*$/i.test(line) && !/^Watched\s*$/i.test(line),
    );

  const reviewText = lines.join("\n\n").trim() || undefined;
  return { posterUrl, reviewText };
}

function normalizeDateString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseFeed(xml: string): Promise<{ items: LetterboxdFeedItem[] }> {
  return parser.parseString(xml) as unknown as Promise<{ items: LetterboxdFeedItem[] }>;
}

function reviewTime(reviewedAt: string | undefined): number {
  if (!reviewedAt) return 0;
  const time = Date.parse(reviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Merge two reviews of the same film. The most-recent entry wins rating /
 * reviewedAt (so a rewatch updates the star), but every other field is carried
 * forward from whichever entry actually has it. This prevents a
 * diary/rewatch entry (no reviewText) from erasing a real review when both
 * appear in the same feed, while still reflecting the latest watch.
 */
function mergeReviews(a: MovieReview, b: MovieReview): MovieReview {
  const newest = reviewTime(a.reviewedAt) >= reviewTime(b.reviewedAt) ? a : b;
  const other = newest === a ? b : a;
  const pick = (val: string | undefined, fallback: string | undefined): string | undefined =>
    val && val.trim().length > 0 ? val : fallback;

  const merged: MovieReview = {
    title: pick(newest.title, other.title) ?? newest.title,
    year: newest.year ?? other.year ?? null,
    rating: newest.rating,
    guid: pick(newest.guid, other.guid) ?? newest.guid,
  };
  const reviewedAt = pick(newest.reviewedAt, other.reviewedAt);
  if (reviewedAt) merged.reviewedAt = reviewedAt;
  const posterUrl = pick(newest.posterUrl, other.posterUrl);
  if (posterUrl) merged.posterUrl = posterUrl;
  const backdropUrl = pick(newest.backdropUrl, other.backdropUrl);
  if (backdropUrl) merged.backdropUrl = backdropUrl;
  // Prefer real review text over the rewatch/diary entry (which has none).
  const reviewText = pick(newest.reviewText, other.reviewText);
  if (reviewText) merged.reviewText = reviewText;
  const letterboxdUrl = pick(newest.letterboxdUrl, other.letterboxdUrl);
  if (letterboxdUrl) merged.letterboxdUrl = letterboxdUrl;
  const tmdbMovieId =
    typeof newest.tmdbMovieId === "number" && newest.tmdbMovieId > 0
      ? newest.tmdbMovieId
      : other.tmdbMovieId;
  if (typeof tmdbMovieId === "number" && tmdbMovieId > 0) merged.tmdbMovieId = tmdbMovieId;
  const tmdbTvId =
    typeof newest.tmdbTvId === "number" && newest.tmdbTvId > 0
      ? newest.tmdbTvId
      : other.tmdbTvId;
  if (typeof tmdbTvId === "number" && tmdbTvId > 0) merged.tmdbTvId = tmdbTvId;
  return merged;
}

/**
 * Collapse reviews of the same film into one row. Two reviews are considered
 * the same film when they share a canonical guid, OR when they share a
 * tmdb_movie_id / tmdb_tv_id (Letterboxd sometimes year-disambiguates the film
 * slug differently for the original review vs. a rewatch, which previously
 * produced duplicate film cards). When a group collapses, the most-recent
 * rating/reviewedAt wins and other fields are merged so a real review is never
 * discarded in favor of a diary/rewatch entry.
 */
function dedupeMovies(movies: MovieReview[]): MovieReview[] {
  const byGuid = new Map<string, MovieReview>();
  const byTmdbMovie = new Map<number, string>();
  const byTmdbTv = new Map<number, string>();

  const resolveKey = (movie: MovieReview): string => {
    const guid = canonicalFilmGuid(movie);
    if (typeof movie.tmdbMovieId === "number" && movie.tmdbMovieId > 0) {
      const existing = byTmdbMovie.get(movie.tmdbMovieId);
      if (existing) return existing;
      byTmdbMovie.set(movie.tmdbMovieId, guid);
    }
    if (typeof movie.tmdbTvId === "number" && movie.tmdbTvId > 0) {
      const existing = byTmdbTv.get(movie.tmdbTvId);
      if (existing) return existing;
      byTmdbTv.set(movie.tmdbTvId, guid);
    }
    return guid;
  };

  for (const movie of movies) {
    const guid = canonicalFilmGuid(movie);
    const normalized = { ...movie, guid };
    const key = resolveKey(normalized);
    const existing = byGuid.get(key);
    if (!existing) {
      byGuid.set(key, normalized);
    } else {
      byGuid.set(key, mergeReviews(existing, normalized));
    }
  }

  return Array.from(byGuid.values());
}

function mapItems(items: LetterboxdFeedItem[]): MovieReview[] {
  const mapped = items
    .map((item) => {
      const title = textValue(item.filmTitle ?? item["letterboxd:filmTitle"] ?? item.title);
      const yearValue = textValue(item.filmYear ?? item["letterboxd:filmYear"]);
      const ratingValue = textValue(item.memberRating ?? item["letterboxd:memberRating"]);
      const tmdbMovieIdValue = textValue(item.tmdbMovieId ?? item["tmdb:movieId"]);
      const tmdbTvIdValue = textValue(item.tmdbTvId ?? item["tmdb:tvId"]);
      const year = Number.parseInt(yearValue, 10);
      const rating = Number.parseFloat(ratingValue);
      const tmdbMovieId = Number.parseInt(tmdbMovieIdValue, 10);
      const tmdbTvId = Number.parseInt(tmdbTvIdValue, 10);

      if (!title || Number.isNaN(rating)) return null;

      const { posterUrl, reviewText } = extractFromContent(
        typeof item.content === "string" ? item.content : "",
      );
      const letterboxdUrl = typeof item.link === "string" && item.link ? item.link : undefined;
      const reviewedAt = normalizeDateString(item.isoDate ?? item.pubDate);
      const rawGuid = typeof item.guid === "string" ? item.guid.trim() : undefined;
      const guid = canonicalFilmGuid({
        title,
        year: Number.isNaN(year) ? null : year,
        letterboxdUrl,
        guid: rawGuid,
      });

      const movie: MovieReview = {
        title,
        year: Number.isNaN(year) ? null : year,
        rating,
        guid,
      };
      if (reviewedAt) movie.reviewedAt = reviewedAt;
      if (posterUrl) movie.posterUrl = posterUrl;
      if (reviewText) movie.reviewText = reviewText;
      if (letterboxdUrl) movie.letterboxdUrl = letterboxdUrl;
      if (Number.isInteger(tmdbMovieId) && tmdbMovieId > 0) movie.tmdbMovieId = tmdbMovieId;
      if (Number.isInteger(tmdbTvId) && tmdbTvId > 0) movie.tmdbTvId = tmdbTvId;
      return movie;
    })
    .filter((movie): movie is MovieReview => movie !== null);

  return dedupeMovies(mapped);
}

/**
 * Fetch + parse a Letterboxd RSS feed with a hard timeout, an in-process LRU
 * cache, and conditional requests (ETag / Last-Modified) to avoid refetching
 * unchanged feeds.
 */
export async function fetchLetterboxdReviews(handle: string): Promise<MovieReview[]> {
  const key = handle.toLowerCase();
  const cached = cache.get(key);

  const headers: Record<string, string> = {
    "User-Agent": "letterboxdarr",
    Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

  const response = await fetch(`https://letterboxd.com/${handle}/rss/`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status === 304 && cached) {
    cache.set(key, cached);
    return cached.movies;
  }

  if (!response.ok) {
    throw new Error(`Letterboxd responded with status ${response.status}.`);
  }

  const xml = await response.text();
  const feed = await parseFeed(xml);
  const movies = mapItems(feed.items ?? []);

  cache.set(key, {
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    movies,
  });

  return movies;
}
