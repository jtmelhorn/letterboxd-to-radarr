import { desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviews, syncResults } from "@/app/lib/db/schema";
import type { ReviewRow } from "@/app/lib/db/schema";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import type { MovieReview, ReviewDto } from "@/app/types/movie";

export function reviewGuid(movie: MovieReview): string {
  return canonicalFilmGuid(movie);
}

function sanitize(movie: MovieReview): MovieReview | null {
  const title = movie.title?.trim();
  const rating =
    typeof movie.rating === "number" && Number.isFinite(movie.rating) ? movie.rating : NaN;
  if (!title || Number.isNaN(rating)) {
    return null;
  }
  const year = typeof movie.year === "number" && Number.isFinite(movie.year) ? movie.year : null;

  return {
    title,
    year,
    rating,
    reviewedAt: movie.reviewedAt?.trim() || undefined,
    posterUrl: movie.posterUrl?.trim() || undefined,
    reviewText: movie.reviewText?.trim() || undefined,
    letterboxdUrl: movie.letterboxdUrl?.trim() || undefined,
    guid: canonicalFilmGuid({ title, year, letterboxdUrl: movie.letterboxdUrl, guid: movie.guid }),
  };
}

function reviewTime(reviewedAt: string | null | undefined): number {
  if (!reviewedAt) return 0;
  const time = Date.parse(reviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

function sortRows(rows: ReviewRow[]): ReviewRow[] {
  return [...rows].sort((a, b) => {
    const recency = reviewTime(b.reviewedAt) - reviewTime(a.reviewedAt);
    if (recency !== 0) return recency;
    const rating = b.rating - a.rating;
    if (rating !== 0) return rating;
    const title = a.title.localeCompare(b.title);
    if (title !== 0) return title;
    return (b.year ?? 0) - (a.year ?? 0);
  });
}

function dedupeIncoming(movies: Array<MovieReview & { guid: string }>): Array<MovieReview & { guid: string }> {
  const map = new Map<string, MovieReview & { guid: string }>();
  for (const movie of movies) {
    const guid = movie.guid;
    const existing = map.get(guid);
    if (!existing || reviewTime(movie.reviewedAt) > reviewTime(existing.reviewedAt)) {
      map.set(guid, movie);
    }
  }
  return Array.from(map.values());
}

function mergeExistingDuplicates(_userId: number, rows: ReviewRow[]): void {
  const db = getDb();
  const groups = new Map<string, ReviewRow[]>();

  for (const row of rows) {
    const key = canonicalFilmGuid(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  db.transaction((tx) => {
    for (const group of groups.values()) {
      if (group.length <= 1) continue;

      const sorted = sortRows(group);
      const keeper = sorted[0];
      const canonical = canonicalFilmGuid(keeper);

      if (keeper.guid !== canonical) {
        tx.update(reviews).set({ guid: canonical }).where(eq(reviews.id, keeper.id)).run();
      }

      for (const dupe of sorted.slice(1)) {
        tx.update(syncResults)
          .set({ reviewId: keeper.id })
          .where(eq(syncResults.reviewId, dupe.id))
          .run();
        tx.delete(reviews).where(eq(reviews.id, dupe.id)).run();
      }
    }
  });
}

/**
 * Upsert incoming reviews for a user inside a single transaction, merging the
 * best data from existing + incoming rows. Returns nothing; query separately.
 */
export function upsertReviews(userId: number, incoming: MovieReview[]): void {
  const db = getDb();
  const sanitized = incoming
    .map(sanitize)
    .filter((m): m is MovieReview & { guid: string } => m !== null && Boolean(m.guid));

  const existingRows = db.select().from(reviews).where(eq(reviews.userId, userId)).all();
  mergeExistingDuplicates(userId, existingRows);

  const deduped = dedupeIncoming(sanitized);
  if (deduped.length === 0) return;

  const now = new Date().toISOString();
  const refreshedRows = db.select().from(reviews).where(eq(reviews.userId, userId)).all();
  const byCanonical = new Map<string, ReviewRow>();
  for (const row of refreshedRows) {
    byCanonical.set(canonicalFilmGuid(row), row);
  }

  db.transaction((tx) => {
    for (const movie of deduped) {
      const existing = byCanonical.get(movie.guid);

      if (existing) {
        tx.update(reviews)
          .set({
            guid: movie.guid,
            title: movie.title,
            year: movie.year ?? existing.year,
            rating: movie.rating,
            reviewedAt: movie.reviewedAt ?? existing.reviewedAt,
            posterUrl: movie.posterUrl ?? existing.posterUrl,
            reviewText: movie.reviewText ?? existing.reviewText,
            letterboxdUrl: movie.letterboxdUrl ?? existing.letterboxdUrl,
            updatedAt: now,
          })
          .where(eq(reviews.id, existing.id))
          .run();
      } else {
        tx.insert(reviews)
          .values({
            userId,
            guid: movie.guid,
            title: movie.title,
            year: movie.year,
            rating: movie.rating,
            reviewedAt: movie.reviewedAt ?? null,
            posterUrl: movie.posterUrl ?? null,
            reviewText: movie.reviewText ?? null,
            letterboxdUrl: movie.letterboxdUrl ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }
  });
}

export function getReviewRows(userId: number): ReviewRow[] {
  const db = getDb();
  const rows = db.select().from(reviews).where(eq(reviews.userId, userId)).all();
  return sortRows(rows);
}

export function getReviewById(reviewId: number): ReviewRow | null {
  const db = getDb();
  return db.select().from(reviews).where(eq(reviews.id, reviewId)).get() ?? null;
}

/** Map the latest successful/failed status per review (added/exists win over error). */
function latestStatusByReview(reviewIds: number[]): Map<number, ReviewDto["status"]> {
  const map = new Map<number, ReviewDto["status"]>();
  if (reviewIds.length === 0) return map;

  const db = getDb();
  const rows = db
    .select()
    .from(syncResults)
    .where(inArray(syncResults.reviewId, reviewIds))
    .orderBy(desc(syncResults.createdAt))
    .all();

  for (const row of rows) {
    const current = map.get(row.reviewId);
    const normalized: ReviewDto["status"] =
      row.status === "added" || row.status === "exists"
        ? row.status
        : row.status === "error"
          ? "error"
          : null;
    // Success states are sticky and should not be overwritten by later errors.
    if (current === "added" || current === "exists") continue;
    if (normalized) {
      map.set(row.reviewId, normalized);
    }
  }
  return map;
}

export function getReviewDtos(userId: number): ReviewDto[] {
  const rows = getReviewRows(userId);
  const statusMap = latestStatusByReview(rows.map((r) => r.id));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year,
    rating: row.rating,
    reviewedAt: row.reviewedAt ?? undefined,
    posterUrl: row.posterUrl ?? undefined,
    reviewText: row.reviewText ?? undefined,
    letterboxdUrl: row.letterboxdUrl ?? undefined,
    guid: row.guid,
    status: statusMap.get(row.id) ?? null,
  }));
}

/** True when this review already has a successful add/exists result. */
export function hasSuccessfulSync(reviewId: number): boolean {
  const db = getDb();
  const rows = db
    .select()
    .from(syncResults)
    .where(eq(syncResults.reviewId, reviewId))
    .all();
  return rows.some((r) => r.status === "added" || r.status === "exists");
}
