import pLimit from "p-limit";

import { fetchLetterboxdReviews } from "@/app/lib/letterboxd";
import { addMovie } from "@/app/lib/radarr";
import type { AddMovieResult } from "@/app/lib/radarr";
import { getAggregatedMovies } from "@/app/lib/repos/aggregatedReviews";
import { upsertReviews } from "@/app/lib/repos/reviews";
import { getReviewerGroup, listReviewerGroups } from "@/app/lib/repos/reviewerGroups";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { getRecentSyncResults, recordSyncResult } from "@/app/lib/repos/syncResults";
import { findUser, getOrCreateUser, listUsers } from "@/app/lib/repos/users";
import type { ReviewerScope, ResolvedRadarrTarget, SyncRunSummary } from "@/app/types/movie";

const MAX_ATTEMPTS = 3;
const RADARR_CONCURRENCY = 3;

export interface SyncOptions {
  auto: boolean;
  /** When true, retry movies even if a prior add failed (manual re-sync). */
  force?: boolean;
  threshold?: number;
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

function scopeKey(scope: ReviewerScope): string {
  if (scope.type === "reviewer") return `reviewer:${scope.reviewer ?? ""}`.toLowerCase();
  if (scope.type === "group") return `group:${scope.groupId ?? ""}`;
  return "all";
}

function handlesForScope(scope: ReviewerScope): string[] {
  if (scope.type === "reviewer" && scope.reviewer) {
    return [scope.reviewer.trim().toLowerCase()].filter(Boolean);
  }
  if (scope.type === "group" && typeof scope.groupId === "number") {
    return getReviewerGroup(scope.groupId)?.reviewerHandles ?? [];
  }
  return listUsers().map((user) => user.handle);
}

function thresholdForScope(scope: ReviewerScope, explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  if (scope.type === "group" && typeof scope.groupId === "number") {
    return getReviewerGroup(scope.groupId)?.autoThreshold ?? -1;
  }
  return listReviewerGroups()[0]?.autoThreshold ?? getRadarrTarget().autoThreshold;
}

async function refreshHandles(handles: string[]): Promise<number> {
  let fetched = 0;
  for (const handle of handles) {
    const user = getOrCreateUser(handle);
    const movies = await fetchLetterboxdReviews(handle);
    upsertReviews(user.id, movies);
    fetched += movies.length;
  }
  return fetched;
}

// Single-flight: collapse concurrent syncs for the same reviewer/scope.
const inFlight = new Map<string, Promise<SyncRunSummary>>();

async function executeSyncScope(
  scope: ReviewerScope,
  options: SyncOptions,
): Promise<SyncRunSummary> {
  const handles = handlesForScope(scope);
  const fetched = await refreshHandles(handles);
  const target = getRadarrTarget();
  const threshold = thresholdForScope(scope, options.threshold);

  const summary: SyncRunSummary = {
    fetched,
    added: 0,
    exists: 0,
    failed: 0,
    threshold,
    results: [],
  };

  const radarrConfigured = Boolean(target.baseUrl && target.apiKey);
  const automationDisabled = options.auto && threshold === -1;

  if (!radarrConfigured || automationDisabled) {
    summary.results = getRecentSyncResults(undefined, 100);
    return summary;
  }

  const candidates = getAggregatedMovies(scope).filter((movie) => {
    if (movie.averageRating < threshold) return false;
    if (options.force) return true;
    return movie.status !== "added" && movie.status !== "exists";
  });

  const limit = pLimit(RADARR_CONCURRENCY);

  await Promise.all(
    candidates.map((movie) =>
      limit(async () => {
        const representativeReview = movie.reviews[0];
        if (!representativeReview) return;

        const result = await addWithRetry(target, { title: movie.title, year: movie.year });
        const status =
          result.status === "added"
            ? "added"
            : result.status === "exists"
              ? "exists"
              : "error";

        recordSyncResult({
          reviewId: representativeReview.id,
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

  summary.results = getRecentSyncResults(undefined, 100);
  return summary;
}

export function runSyncScope(scope: ReviewerScope, options: SyncOptions): Promise<SyncRunSummary> {
  const key = scopeKey(scope);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = executeSyncScope(scope, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function runSync(handle: string, options: SyncOptions): Promise<SyncRunSummary> {
  return runSyncScope({ type: "reviewer", reviewer: handle }, options);
}

export async function refreshReviewer(handle: string): Promise<number> {
  if (!findUser(handle)) {
    getOrCreateUser(handle);
  }
  return refreshHandles([handle]);
}
