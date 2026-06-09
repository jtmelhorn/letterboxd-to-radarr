import pLimit from "p-limit";

import { fetchLetterboxdReviews } from "@/app/lib/letterboxd";
import { addMovie } from "@/app/lib/radarr";
import type { AddMovieResult } from "@/app/lib/radarr";
import { getAggregatedMovies } from "@/app/lib/repos/aggregatedReviews";
import { enrichReviewsWithMetadata } from "@/app/lib/repos/movieMetadata";
import { createPendingApproval } from "@/app/lib/repos/pendingApprovals";
import { getReviewRows, upsertReviews } from "@/app/lib/repos/reviews";
import {
  groupCoversReviewer,
  getReviewerGroup,
  listReviewerGroups,
} from "@/app/lib/repos/reviewerGroups";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { getRecentSyncResults, recordSyncResult } from "@/app/lib/repos/syncResults";
import { findUser, getOrCreateUser, listUsers } from "@/app/lib/repos/users";
import { isMovieBlocklisted } from "@/app/lib/repos/movieBlocklist";
import { evaluateSyncFilters, syncFiltersNeedGenreMetadata } from "@/app/lib/syncFilters";
import type {
  AggregatedMovieDto,
  ReviewerGroupDto,
  ReviewerScope,
  ResolvedRadarrTarget,
  SyncRunSummary,
} from "@/app/types/movie";

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
  input: { title: string; year: number | null; tmdbId?: number | null },
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

function emptySummary(threshold: number): SyncRunSummary {
  return {
    fetched: 0,
    added: 0,
    exists: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    threshold,
    results: getRecentSyncResults(undefined, 100),
  };
}

function handlesForGroup(group: ReviewerGroupDto): string[] {
  return group.reviewerHandles;
}

function fallbackThresholdForScope(scope: ReviewerScope): number {
  if (scope.type === "group" && typeof scope.groupId === "number") {
    return getReviewerGroup(scope.groupId)?.ratingThreshold ?? -1;
  }
  return getRadarrTarget().autoThreshold;
}

async function refreshHandles(
  handles: string[],
  options: { fetchMetadata?: boolean } = {},
): Promise<number> {
  let fetched = 0;
  for (const handle of handles) {
    const user = getOrCreateUser(handle);
    const movies = await fetchLetterboxdReviews(handle);
    upsertReviews(user.id, movies);
    if (options.fetchMetadata) {
      await enrichReviewsWithMetadata(getReviewRows(user.id));
    }
    fetched += movies.length;
  }
  return fetched;
}

interface GroupSyncRun {
  group: ReviewerGroupDto;
  handles: string[];
  aggregationScope: ReviewerScope;
}

function syncRunsForScope(scope: ReviewerScope): GroupSyncRun[] {
  if (scope.type === "group" && typeof scope.groupId === "number") {
    const group = getReviewerGroup(scope.groupId);
    if (!group?.enabled) return [];
    const handles = handlesForGroup(group);
    return handles.length > 0 ? [{ group, handles, aggregationScope: { type: "group", groupId: group.id } }] : [];
  }

  if (scope.type === "reviewer" && scope.reviewer) {
    const handle = scope.reviewer.trim().toLowerCase();
    if (!handle) return [];
    return listReviewerGroups()
      .filter((group) => group.enabled && groupCoversReviewer(group, handle))
      .map(
        (group): GroupSyncRun => ({
          group,
          handles: [handle],
          aggregationScope: { type: "reviewer", reviewer: handle },
        }),
      );
  }

  return listReviewerGroups()
    .filter((group) => group.enabled)
    .map(
      (group): GroupSyncRun => ({
        group,
        handles: handlesForGroup(group),
        aggregationScope: { type: "group", groupId: group.id },
      }),
    )
    .filter((run) => run.handles.length > 0);
}

function combineSummaries(summaries: SyncRunSummary[], threshold: number): SyncRunSummary {
  return {
    fetched: summaries.reduce((sum, item) => sum + item.fetched, 0),
    added: summaries.reduce((sum, item) => sum + item.added, 0),
    exists: summaries.reduce((sum, item) => sum + item.exists, 0),
    failed: summaries.reduce((sum, item) => sum + item.failed, 0),
    pending: summaries.reduce((sum, item) => sum + (item.pending ?? 0), 0),
    skipped: summaries.reduce((sum, item) => sum + (item.skipped ?? 0), 0),
    threshold,
    results: getRecentSyncResults(undefined, 100),
  };
}

// Single-flight: collapse concurrent syncs for the same reviewer/scope.
const inFlight = new Map<string, Promise<SyncRunSummary>>();

async function executeSyncScope(
  scope: ReviewerScope,
  options: SyncOptions,
): Promise<SyncRunSummary> {
  const runs = syncRunsForScope(scope);
  const threshold = typeof options.threshold === "number" ? options.threshold : fallbackThresholdForScope(scope);
  if (runs.length === 0) {
    return emptySummary(threshold);
  }
  if (runs.length > 1) {
    const summaries: SyncRunSummary[] = [];
    for (const run of runs) {
      summaries.push(await executeGroupSync(run, options));
    }
    return combineSummaries(summaries, threshold);
  }

  return executeGroupSync(runs[0], options);
}

async function executeGroupSync(
  run: GroupSyncRun,
  options: SyncOptions,
): Promise<SyncRunSummary> {
  const { group } = run;
  const threshold = typeof options.threshold === "number" ? options.threshold : group.ratingThreshold;
  if (options.auto && group.syncInterval === "manual") {
    return emptySummary(threshold);
  }

  const fetched = await refreshHandles(run.handles, {
    fetchMetadata: syncFiltersNeedGenreMetadata(group.filters),
  });
  return syncCachedGroup(run, options, fetched);
}

async function syncCachedGroup(
  run: GroupSyncRun,
  options: SyncOptions,
  fetched: number,
): Promise<SyncRunSummary> {
  const { group } = run;
  const threshold = typeof options.threshold === "number" ? options.threshold : group.ratingThreshold;
  if (options.auto && group.syncInterval === "manual") {
    return emptySummary(threshold);
  }

  const target = getRadarrTarget();

  const summary: SyncRunSummary = {
    fetched,
    added: 0,
    exists: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    threshold,
    results: [],
  };

  const radarrConfigured = Boolean(target.baseUrl && target.apiKey);
  const automationDisabled = threshold === -1;

  if (!radarrConfigured || automationDisabled) {
    summary.results = getRecentSyncResults(undefined, 100);
    return summary;
  }

  const candidates = getAggregatedMovies(run.aggregationScope).filter((movie) => {
    if (movie.averageRating < threshold) return false;
    if (options.force) return true;
    return movie.status !== "added" && movie.status !== "exists" && movie.status !== "failed_remove";
  });

  const allowedCandidates: AggregatedMovieDto[] = [];
  for (const movie of candidates) {
    const representativeReview = movie.reviews[0];
    if (!representativeReview) continue;

    if (
      isMovieBlocklisted({
        tmdbId: movie.tmdbMovieId,
        imdbId: movie.imdbId,
        filmId: movie.id,
        title: movie.title,
        year: movie.year,
      })
    ) {
      recordSyncResult({
        reviewId: representativeReview.id,
        status: "skipped",
        message: "Skipped: movie is blocklisted.",
        auto: options.auto,
      });
      summary.skipped = (summary.skipped ?? 0) + 1;
      continue;
    }

    const filterResult = evaluateSyncFilters(movie, group.filters);
    if (filterResult.allowed) {
      allowedCandidates.push(movie);
      continue;
    }

    recordSyncResult({
      reviewId: representativeReview.id,
      status: "skipped",
      message: `Skipped: ${filterResult.reasons.join("; ")} (${group.name} filters).`,
      auto: options.auto,
    });
    summary.skipped = (summary.skipped ?? 0) + 1;
  }

  if (group?.requiresManualApproval) {
    for (const movie of allowedCandidates) {
      const representativeReview = movie.reviews[0];
      if (!representativeReview) continue;
      const pending = createPendingApproval({
        groupId: group.id,
        reviewId: representativeReview.id,
        filmId: movie.id,
        title: movie.title,
        year: movie.year,
        averageRating: movie.averageRating,
        message: `Avg ${movie.averageRating.toFixed(1)} stars meets ${group.name}'s threshold.`,
      });
      if (pending) summary.pending = (summary.pending ?? 0) + 1;
    }
    summary.results = getRecentSyncResults(undefined, 100);
    return summary;
  }

  const limit = pLimit(RADARR_CONCURRENCY);

  await Promise.all(
    allowedCandidates.map((movie) =>
      limit(async () => {
        const representativeReview = movie.reviews[0];
        if (!representativeReview) return;

        const parsedMetadataTmdbId =
          movie.metadataSource === "radarr" && movie.metadataMediaType === "movie" && movie.metadataId
            ? Number(movie.metadataId)
            : null;
        const result = await addWithRetry(target, {
          title: movie.title,
          year: movie.year,
          tmdbId:
            representativeReview.tmdbMovieId ??
            movie.tmdbMovieId ??
            (typeof parsedMetadataTmdbId === "number" && Number.isFinite(parsedMetadataTmdbId)
              ? parsedMetadataTmdbId
              : null),
        });
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
          radarrMovieId: result.movie?.radarrMovieId ?? null,
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

export async function refreshScopeReviews(scope: ReviewerScope): Promise<number> {
  if (scope.type === "reviewer" && scope.reviewer) {
    return refreshReviewer(scope.reviewer, { fetchMetadata: scopeNeedsGenreMetadata(scope) });
  }
  if (scope.type === "group" && typeof scope.groupId === "number") {
    const group = getReviewerGroup(scope.groupId);
    return refreshHandles(group?.reviewerHandles ?? [], { fetchMetadata: scopeNeedsGenreMetadata(scope) });
  }

  return refreshHandles(
    listUsers().map((reviewer) => reviewer.handle),
    { fetchMetadata: scopeNeedsGenreMetadata(scope) },
  );
}

function scopeNeedsGenreMetadata(scope: ReviewerScope): boolean {
  if (scope.type === "group" && typeof scope.groupId === "number") {
    const group = getReviewerGroup(scope.groupId);
    return Boolean(group?.enabled && syncFiltersNeedGenreMetadata(group.filters));
  }

  if (scope.type === "reviewer" && scope.reviewer) {
    return listReviewerGroups().some(
      (group) =>
        group.enabled &&
        groupCoversReviewer(group, scope.reviewer ?? "") &&
        syncFiltersNeedGenreMetadata(group.filters),
    );
  }

  return listReviewerGroups().some(
    (group) => group.enabled && syncFiltersNeedGenreMetadata(group.filters),
  );
}

export async function refreshReviewer(
  handle: string,
  options: { fetchMetadata?: boolean } = {},
): Promise<number> {
  if (!findUser(handle)) {
    getOrCreateUser(handle);
  }
  return refreshHandles([handle], options);
}
