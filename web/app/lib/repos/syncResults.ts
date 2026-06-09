import { desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviews, syncResults } from "@/app/lib/db/schema";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import type { SyncMovieStatus, SyncResultItem } from "@/app/types/movie";

export interface RecordSyncInput {
  reviewId: number;
  filmId?: string;
  status: SyncMovieStatus;
  radarrTmdbId?: number | null;
  radarrMovieId?: number | null;
  message: string;
  auto: boolean;
}

export function recordSyncResult(input: RecordSyncInput): void {
  const db = getDb();
  const review = db
    .select({
      guid: reviews.guid,
      title: reviews.title,
      year: reviews.year,
      letterboxdUrl: reviews.letterboxdUrl,
    })
    .from(reviews)
    .where(eq(reviews.id, input.reviewId))
    .get();
  if (!review) {
    throw new Error("Cannot record sync result for an unknown review.");
  }
  const filmId = input.filmId ?? canonicalFilmGuid(review);

  db.insert(syncResults)
    .values({
      reviewId: input.reviewId,
      filmId,
      status: input.status,
      radarrTmdbId: input.radarrTmdbId ?? null,
      radarrMovieId: input.radarrMovieId ?? null,
      message: input.message,
      auto: input.auto,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function getRecentSyncResults(userId?: number, limit = 100): SyncResultItem[] {
  const db = getDb();
  const query = db
    .select({
      id: syncResults.id,
      reviewId: syncResults.reviewId,
      status: syncResults.status,
      filmId: syncResults.filmId,
      radarrMovieId: syncResults.radarrMovieId,
      message: syncResults.message,
      auto: syncResults.auto,
      createdAt: syncResults.createdAt,
      title: reviews.title,
      year: reviews.year,
      letterboxdUrl: reviews.letterboxdUrl,
      guid: reviews.guid,
    })
    .from(syncResults)
    .innerJoin(reviews, eq(syncResults.reviewId, reviews.id))
    .$dynamic();

  const rows = (typeof userId === "number" ? query.where(eq(reviews.userId, userId)) : query)
    .orderBy(desc(syncResults.createdAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    reviewId: row.reviewId,
    filmId: row.filmId ?? canonicalFilmGuid(row),
    title: row.title,
    year: row.year,
    status: row.status,
    radarrMovieId: row.radarrMovieId ?? null,
    message: row.message,
    auto: row.auto,
    at: Date.parse(row.createdAt) || Date.now(),
  }));
}

export interface LatestSyncResultForFilm {
  reviewId: number;
  status: SyncMovieStatus;
  radarrTmdbId: number | null;
  radarrMovieId: number | null;
  message: string;
  createdAt: string;
}

function isTerminalRemovalStatus(status: SyncMovieStatus): boolean {
  return status === "removed" || status === "blocklisted" || status === "failed_remove";
}

function isSuccessStatus(status: SyncMovieStatus): boolean {
  return status === "added" || status === "exists";
}

export function latestFilmStatuses(filmIds: string[]): Map<string, SyncMovieStatus> {
  const uniqueFilmIds = [...new Set(filmIds.filter(Boolean))];
  const resolved = new Map<string, SyncMovieStatus>();
  if (uniqueFilmIds.length === 0) return resolved;

  const rows = getDb()
    .select({
      id: syncResults.id,
      filmId: syncResults.filmId,
      status: syncResults.status,
      createdAt: syncResults.createdAt,
    })
    .from(syncResults)
    .where(inArray(syncResults.filmId, uniqueFilmIds))
    .orderBy(desc(syncResults.createdAt), desc(syncResults.id))
    .all();

  const fallbacks = new Map<string, SyncMovieStatus>();
  for (const row of rows) {
    if (!row.filmId || resolved.has(row.filmId)) continue;
    if (!isSyncMovieStatus(row.status)) continue;

    if (isTerminalRemovalStatus(row.status) || isSuccessStatus(row.status)) {
      resolved.set(row.filmId, row.status);
      continue;
    }

    if (!fallbacks.has(row.filmId)) {
      fallbacks.set(row.filmId, row.status);
    }
  }

  for (const [filmId, status] of fallbacks) {
    if (!resolved.has(filmId)) {
      resolved.set(filmId, status);
    }
  }

  return resolved;
}

export function getLatestSyncResultForFilmId(filmId: string): LatestSyncResultForFilm | null {
  const db = getDb();
  const row = db
    .select({
      reviewId: syncResults.reviewId,
      status: syncResults.status,
      radarrTmdbId: syncResults.radarrTmdbId,
      radarrMovieId: syncResults.radarrMovieId,
      message: syncResults.message,
      createdAt: syncResults.createdAt,
    })
    .from(syncResults)
    .where(eq(syncResults.filmId, filmId))
    .orderBy(desc(syncResults.createdAt), desc(syncResults.id))
    .limit(1)
    .get();

  if (!row || !isSyncMovieStatus(row.status)) return null;
  return {
    reviewId: row.reviewId,
    status: row.status,
    radarrTmdbId: row.radarrTmdbId ?? null,
    radarrMovieId: row.radarrMovieId ?? null,
    message: row.message,
    createdAt: row.createdAt,
  };
}

export function getLatestRadarrMovieIdForFilmId(filmId: string): number | null {
  const db = getDb();
  const rows = db
    .select({
      status: syncResults.status,
      radarrMovieId: syncResults.radarrMovieId,
    })
    .from(syncResults)
    .where(eq(syncResults.filmId, filmId))
    .orderBy(desc(syncResults.createdAt), desc(syncResults.id))
    .all();

  const row = rows.find(
    (item) =>
      isSyncMovieStatus(item.status) &&
      typeof item.radarrMovieId === "number" &&
      item.radarrMovieId > 0,
  );
  return row?.radarrMovieId ?? null;
}

export function isSyncMovieStatus(status: string): status is SyncMovieStatus {
  return (
    status === "added" ||
    status === "exists" ||
    status === "error" ||
    status === "skipped" ||
    status === "removed" ||
    status === "blocklisted" ||
    status === "failed_remove"
  );
}

export function clearSyncResultsForUser(userId: number): number {
  const db = getDb();
  const reviewRows = db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, userId)).all();
  if (reviewRows.length === 0) return 0;

  const result = db
    .delete(syncResults)
    .where(
      inArray(
        syncResults.reviewId,
        reviewRows.map((row) => row.id),
      ),
    )
    .run();

  return result.changes ?? 0;
}

export function clearAllSyncResults(): number {
  const db = getDb();
  const result = db.delete(syncResults).run();
  return result.changes ?? 0;
}
