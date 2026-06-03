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

function sanitizeMovie(movie: MovieReview): MovieReview | null {
  const title = movie.title.trim();
  const year = typeof movie.year === "number" && Number.isFinite(movie.year) ? movie.year : null;
  const rating = typeof movie.rating === "number" && Number.isFinite(movie.rating) ? movie.rating : NaN;

  if (!title || Number.isNaN(rating)) {
    return null;
  }

  return {
    title,
    year,
    rating,
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

  return entry?.movies ?? [];
}

export async function mergeCachedReviews(
  username: string,
  incomingMovies: MovieReview[],
): Promise<MovieReview[]> {
  const cache = await readJsonFile<ReviewCacheFile>(reviewCachePath(), emptyReviewCache);
  const normalizedUsername = normalizeUsername(username);
  const existingMovies = cache.usernames[normalizedUsername]?.movies ?? [];
  const merged = new Map<string, MovieReview>();

  for (const movie of [...incomingMovies, ...existingMovies]) {
    const sanitized = sanitizeMovie(movie);

    if (sanitized) {
      merged.set(reviewKey(sanitized), sanitized);
    }
  }

  const movies = Array.from(merged.values());

  cache.usernames[normalizedUsername] = {
    updatedAt: new Date().toISOString(),
    movies,
  };

  await writeJsonFile(reviewCachePath(), cache);

  return movies;
}
