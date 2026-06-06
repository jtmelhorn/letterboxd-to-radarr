import pLimit from "p-limit";

import { fetchLetterboxdReviews } from "@/app/lib/letterboxd";
import { addMovie } from "@/app/lib/radarr";
import type { AddMovieResult } from "@/app/lib/radarr";
import { getReviewRows, hasSuccessfulSync } from "@/app/lib/repos/reviews";
import { upsertReviews } from "@/app/lib/repos/reviews";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { getRecentSyncResults, recordSyncResult } from "@/app/lib/repos/syncResults";
import { getOrCreateUser } from "@/app/lib/repos/users";
import type { ResolvedRadarrTarget, SyncRunSummary } from "@/app/types/movie";

const MAX_ATTEMPTS = 3;
const RADARR_CONCURRENCY = 3;

export interface SyncOptions {
  auto: boolean;
  /** When true, retry movies even if a prior add failed (manual re-sync). */
  force?: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(result: AddMovieResult): boolean {
  return result.status === "error" && result.httpStatus >= 500;
}

async function addWithRetry(
  target: ResolvedRadarrTarget,
  input: { title: string; year: number | null },
): Promise<AddMovieResult> {
  let last: AddMovieResult | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await addMovie(target, input);
      if (!isRetryable(result) || attempt === MAX_ATTEMPTS) {
        return result;
      }
      last = result;
    } catch (error) {
      last = {
        status: "error",
        httpStatus: 502,
        message:
          error instanceof Error ? error.message : "Unable to communicate with Radarr.",
      };
      if (attempt === MAX_ATTEMPTS) return last;
    }
    await delay(2 ** attempt * 250);
  }
  return (
    last ?? { status: "error", httpStatus: 502, message: "Radarr request failed.", }
  );
}

// Single-flight: collapse concurrent syncs for the same handle.
const inFlight = new Map<string, Promise<SyncRunSummary>>();

async function executeSync(handle: string, options: SyncOptions): Promise<SyncRunSummary> {
  const user = getOrCreateUser(handle);

  const movies = await fetchLetterboxdReviews(handle);
  upsertReviews(user.id, movies);

  const target = getRadarrTarget();
  const threshold = target.autoThreshold;

  const summary: SyncRunSummary = {
    fetched: movies.length,
    added: 0,
    exists: 0,
    failed: 0,
    threshold,
    results: [],
  };

  const radarrConfigured = Boolean(target.baseUrl && target.apiKey);
  const automationDisabled = options.auto && threshold === -1;

  if (!radarrConfigured || automationDisabled) {
    summary.results = getRecentSyncResults(user.id, 100);
    return summary;
  }

  const rows = getReviewRows(user.id);
  const candidates = rows.filter((row) => {
    if (row.rating < threshold) return false;
    if (options.force) return true;
    return !hasSuccessfulSync(row.id);
  });

  const limit = pLimit(RADARR_CONCURRENCY);

  await Promise.all(
    candidates.map((row) =>
      limit(async () => {
        const result = await addWithRetry(target, { title: row.title, year: row.year });
        const status =
          result.status === "added"
            ? "added"
            : result.status === "exists"
              ? "exists"
              : "error";

        recordSyncResult({
          reviewId: row.id,
          status,
          radarrTmdbId: result.movie?.tmdbId ?? null,
          message: result.message,
          auto: options.auto,
        });

        if (status === "added") summary.added += 1;
        else if (status === "exists") summary.exists += 1;
        else summary.failed += 1;
      }),
    ),
  );

  summary.results = getRecentSyncResults(user.id, 100);
  return summary;
}

export function runSync(handle: string, options: SyncOptions): Promise<SyncRunSummary> {
  const key = handle.toLowerCase();
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = executeSync(handle, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
