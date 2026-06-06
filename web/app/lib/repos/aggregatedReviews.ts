import { desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviews, syncResults, users } from "@/app/lib/db/schema";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import { getReviewerGroup } from "@/app/lib/repos/reviewerGroups";
import { findUser, listUsers } from "@/app/lib/repos/users";
import type {
  AggregatedMovieDto,
  AggregatedReviewDto,
  ReviewerScope,
  ReviewDto,
} from "@/app/types/movie";

type SyncStatus = ReviewDto["status"];

interface ReviewWithHandle {
  id: number;
  userId: number;
  reviewerHandle: string;
  guid: string;
  title: string;
  year: number | null;
  rating: number;
  reviewedAt: string | null;
  posterUrl: string | null;
  reviewText: string | null;
  letterboxdUrl: string | null;
}

function reviewTime(reviewedAt: string | null | undefined): number {
  if (!reviewedAt) return 0;
  const time = Date.parse(reviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

function normalizeStatus(status: string): SyncStatus {
  if (status === "added" || status === "exists" || status === "error") return status;
  return null;
}

function statusRank(status: SyncStatus): number {
  if (status === "added") return 3;
  if (status === "exists") return 2;
  if (status === "error") return 1;
  return 0;
}

function resolveReviewerIds(scope: ReviewerScope): number[] {
  if (scope.type === "reviewer" && scope.reviewer) {
    const reviewer = findUser(scope.reviewer);
    return reviewer ? [reviewer.id] : [];
  }

  if (scope.type === "group" && typeof scope.groupId === "number") {
    const group = getReviewerGroup(scope.groupId);
    if (!group) return [];
    return group.reviewerHandles
      .map((handle) => findUser(handle)?.id ?? null)
      .filter((id): id is number => id !== null);
  }

  return listUsers().map((reviewer) => reviewer.id);
}

function syncStatusByReview(reviewIds: number[]): Map<number, SyncStatus> {
  const map = new Map<number, SyncStatus>();
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
    if (current === "added" || current === "exists") continue;
    const normalized = normalizeStatus(row.status);
    if (normalized) map.set(row.reviewId, normalized);
  }
  return map;
}

function rowsForScope(scope: ReviewerScope): ReviewWithHandle[] {
  const reviewerIds = resolveReviewerIds(scope);
  if (reviewerIds.length === 0) return [];

  const db = getDb();
  return db
    .select({
      id: reviews.id,
      userId: reviews.userId,
      reviewerHandle: users.handle,
      guid: reviews.guid,
      title: reviews.title,
      year: reviews.year,
      rating: reviews.rating,
      reviewedAt: reviews.reviewedAt,
      posterUrl: reviews.posterUrl,
      reviewText: reviews.reviewText,
      letterboxdUrl: reviews.letterboxdUrl,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.userId, users.id))
    .where(inArray(reviews.userId, reviewerIds))
    .all();
}

export function getAggregatedMovies(
  scope: ReviewerScope = { type: "all" },
  options: { onlySynced?: boolean } = {},
): AggregatedMovieDto[] {
  const rows = rowsForScope(scope);
  const statusMap = syncStatusByReview(rows.map((row) => row.id));
  const grouped = new Map<string, AggregatedMovieDto>();

  for (const row of rows) {
    const filmId = canonicalFilmGuid(row);
    const status = statusMap.get(row.id) ?? null;
    const review: AggregatedReviewDto = {
      id: row.id,
      reviewerId: row.userId,
      reviewerHandle: row.reviewerHandle,
      title: row.title,
      year: row.year,
      rating: row.rating,
      guid: row.guid,
      status,
      ...(row.reviewedAt && { reviewedAt: row.reviewedAt }),
      ...(row.posterUrl && { posterUrl: row.posterUrl }),
      ...(row.reviewText && { reviewText: row.reviewText }),
      ...(row.letterboxdUrl && { letterboxdUrl: row.letterboxdUrl }),
    };

    const existing = grouped.get(filmId);
    if (!existing) {
      grouped.set(filmId, {
        id: filmId,
        title: row.title,
        year: row.year,
        averageRating: row.rating,
        latestReviewedAt: row.reviewedAt ?? undefined,
        posterUrl: row.posterUrl ?? undefined,
        letterboxdUrl: row.letterboxdUrl ?? undefined,
        reviewerCount: 1,
        reviewerHandles: [row.reviewerHandle],
        reviews: [review],
        status,
      });
      continue;
    }

    existing.reviews.push(review);
    existing.reviewerHandles = [...new Set([...existing.reviewerHandles, row.reviewerHandle])].sort();
    existing.reviewerCount = existing.reviewerHandles.length;
    existing.averageRating =
      existing.reviews.reduce((sum, item) => sum + item.rating, 0) / existing.reviews.length;
    existing.status =
      statusRank(status) > statusRank(existing.status) ? status : existing.status;
    if (!existing.posterUrl && row.posterUrl) existing.posterUrl = row.posterUrl;
    if (!existing.letterboxdUrl && row.letterboxdUrl) existing.letterboxdUrl = row.letterboxdUrl;
    if (reviewTime(row.reviewedAt) > reviewTime(existing.latestReviewedAt)) {
      existing.latestReviewedAt = row.reviewedAt ?? undefined;
      existing.title = row.title;
      existing.year = row.year;
    }
  }

  return Array.from(grouped.values())
    .filter((movie) => {
      if (!options.onlySynced) return true;
      return movie.status === "added" || movie.status === "exists";
    })
    .map((movie) => ({
      ...movie,
      averageRating: Math.round(movie.averageRating * 10) / 10,
      reviews: [...movie.reviews].sort((a, b) => {
        const rating = b.rating - a.rating;
        if (rating !== 0) return rating;
        return reviewTime(b.reviewedAt) - reviewTime(a.reviewedAt);
      }),
    }))
    .sort((a, b) => {
      const rating = b.averageRating - a.averageRating;
      if (rating !== 0) return rating;
      return reviewTime(b.latestReviewedAt) - reviewTime(a.latestReviewedAt);
    });
}
