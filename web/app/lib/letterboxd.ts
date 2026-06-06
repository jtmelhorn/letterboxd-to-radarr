import { LRUCache } from "lru-cache";
import Parser from "rss-parser";

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
}

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;

const parser = new Parser<Record<string, never>, LetterboxdFeedItem>({
  customFields: {
    item: [
      ["letterboxd:filmTitle", "filmTitle"],
      ["letterboxd:filmYear", "filmYear"],
      ["letterboxd:memberRating", "memberRating"],
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
    .filter((line) => !/^Watched\s+.+\s+(on|\.)\s*/i.test(line) && !/^Watched\s*$/.test(line));

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

function mapItems(items: LetterboxdFeedItem[]): MovieReview[] {
  return items
    .map((item) => {
      const title = textValue(item.filmTitle ?? item["letterboxd:filmTitle"] ?? item.title);
      const yearValue = textValue(item.filmYear ?? item["letterboxd:filmYear"]);
      const ratingValue = textValue(item.memberRating ?? item["letterboxd:memberRating"]);
      const year = Number.parseInt(yearValue, 10);
      const rating = Number.parseFloat(ratingValue);

      if (!title || Number.isNaN(rating)) return null;

      const { posterUrl, reviewText } = extractFromContent(
        typeof item.content === "string" ? item.content : "",
      );
      const letterboxdUrl = typeof item.link === "string" && item.link ? item.link : undefined;
      const reviewedAt = normalizeDateString(item.isoDate ?? item.pubDate);
      const guid =
        (typeof item.guid === "string" && item.guid.trim()) ||
        letterboxdUrl ||
        `${title.toLowerCase()}-${Number.isNaN(year) ? "unknown" : year}`;

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
      return movie;
    })
    .filter((movie): movie is MovieReview => movie !== null);
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
    "User-Agent": "letterboxd-to-radarr",
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
