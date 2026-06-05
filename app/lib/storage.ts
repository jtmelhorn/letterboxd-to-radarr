import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MovieReview } from "@/app/types/movie";

export interface StoredSettings {
  radarrUrl: string;
  radarrApiKey: string;
}

export interface PublicSettings {
  radarrUrl: string;
  hasRadarrApiKey: boolean;
  dataDir: string;
}

interface ReviewCacheEntry {
  updatedAt: string;
  movies: MovieReview[];
}

interface ReviewCacheFile {
  usernames: Record<string, ReviewCacheEntry>;
}

const emptySettings: StoredSettings = {
  radarrUrl: "",
  radarrApiKey: "",
};

const emptyReviewCache: ReviewCacheFile = {
  usernames: {},
};

export function getDataDir(): string {
  return (
    process.env.LETTERBOXD_RADARR_DATA_DIR ??
    process.env.APP_DATA_DIR ??
    path.join(process.cwd(), ".data")
  );
}

function settingsPath(): string {
  return path.join(getDataDir(), "settings.json");
}

function reviewCachePath(): string {
  return path.join(getDataDir(), "letterboxd-cache.json");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents) as T;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function reviewKey(movie: MovieReview): string {
  return `${movie.title.trim().toLowerCase()}-${movie.year ?? "unknown"}`;
}

function reviewTime(movie: MovieReview): number {
  if (!movie.reviewedAt) return 0;
  const time = Date.parse(movie.reviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

function sortReviews(movies: MovieReview[]): MovieReview[] {
  return [...movies].sort((a, b) => {
    const recencyDifference = reviewTime(b) - reviewTime(a);
    if (recencyDifference !== 0) return recencyDifference;

    const ratingDifference = b.rating - a.rating;
    if (ratingDifference !== 0) return ratingDifference;

    const titleDifference = a.title.localeCompare(b.title);
    if (titleDifference !== 0) return titleDifference;

    return (b.year ?? 0) - (a.year ?? 0);
  });
}

function sanitizeMovie(movie: MovieReview): MovieReview | null {
  const title = movie.title.trim();
  const year = typeof movie.year === "number" && Number.isFinite(movie.year) ? movie.year : null;
  const rating = typeof movie.rating === "number" && Number.isFinite(movie.rating) ? movie.rating : NaN;

  if (!title || Number.isNaN(rating)) {
    return null;
  }

  const result: MovieReview = { title, year, rating };

  if (typeof movie.reviewedAt === "string" && movie.reviewedAt.trim()) {
    result.reviewedAt = movie.reviewedAt.trim();
  }

  if (typeof movie.posterUrl === "string" && movie.posterUrl.trim()) {
    result.posterUrl = movie.posterUrl.trim();
  }

  if (typeof movie.reviewText === "string" && movie.reviewText.trim()) {
    result.reviewText = movie.reviewText.trim();
  }

  if (typeof movie.letterboxdUrl === "string" && movie.letterboxdUrl.trim()) {
    result.letterboxdUrl = movie.letterboxdUrl.trim();
  }

  return result;
}

function mergeMovieData(existing: MovieReview, incoming: MovieReview): MovieReview {
  return {
    title: incoming.title,
    year: incoming.year ?? existing.year,
    rating: incoming.rating,
    reviewedAt: incoming.reviewedAt ?? existing.reviewedAt,
    posterUrl: incoming.posterUrl ?? existing.posterUrl,
    reviewText: incoming.reviewText ?? existing.reviewText,
    letterboxdUrl: incoming.letterboxdUrl ?? existing.letterboxdUrl,
  };
}

export async function getSettings(): Promise<StoredSettings> {
  const settings = await readJsonFile<Partial<StoredSettings>>(settingsPath(), emptySettings);

  return {
    radarrUrl: typeof settings.radarrUrl === "string" ? settings.radarrUrl : "",
    radarrApiKey: typeof settings.radarrApiKey === "string" ? settings.radarrApiKey : "",
  };
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await writeJsonFile(settingsPath(), settings);
}

export function toPublicSettings(settings: StoredSettings): PublicSettings {
  return {
    radarrUrl: settings.radarrUrl,
    hasRadarrApiKey: settings.radarrApiKey.length > 0,
    dataDir: getDataDir(),
  };
}

export async function getCachedReviews(username: string): Promise<MovieReview[]> {
  const cache = await readJsonFile<ReviewCacheFile>(reviewCachePath(), emptyReviewCache);
  const entry = cache.usernames[normalizeUsername(username)];

  return sortReviews(entry?.movies ?? []);
}

export async function mergeCachedReviews(
  username: string,
  incomingMovies: MovieReview[],
): Promise<MovieReview[]> {
  const cache = await readJsonFile<ReviewCacheFile>(reviewCachePath(), emptyReviewCache);
  const normalizedUsername = normalizeUsername(username);
  const existingMovies = cache.usernames[normalizedUsername]?.movies ?? [];

  // Build existing map first (lower priority baseline)
  const merged = new Map<string, MovieReview>();
  for (const movie of existingMovies) {
    const sanitized = sanitizeMovie(movie);
    if (sanitized) {
      merged.set(reviewKey(sanitized), sanitized);
    }
  }

  // Merge incoming on top, combining the best data from both sources
  for (const movie of incomingMovies) {
    const sanitized = sanitizeMovie(movie);
    if (!sanitized) continue;

    const key = reviewKey(sanitized);
    const existing = merged.get(key);

    merged.set(key, existing ? mergeMovieData(existing, sanitized) : sanitized);
  }

  const movies = sortReviews(Array.from(merged.values()));

  cache.usernames[normalizedUsername] = {
    updatedAt: new Date().toISOString(),
    movies,
  };

  await writeJsonFile(reviewCachePath(), cache);

  return movies;
}
