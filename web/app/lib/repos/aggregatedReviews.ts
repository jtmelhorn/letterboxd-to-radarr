import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviews, users } from "@/app/lib/db/schema";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import { metadataForFilmIds } from "@/app/lib/repos/movieMetadata";
import { getReviewerGroup } from "@/app/lib/repos/reviewerGroups";
import { latestFilmStatuses } from "@/app/lib/repos/syncResults";
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
  backdropUrl: string | null;
  reviewText: string | null;
  letterboxdUrl: string | null;
  tmdbMovieId: number | null;
  tmdbTvId: number | null;
}

function reviewTime(reviewedAt: string | null | undefined): number {
  if (!reviewedAt) return 0;
  const time = Date.parse(reviewedAt);
  return Number.isNaN(time) ? 0 : time;
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
      backdropUrl: reviews.backdropUrl,
      reviewText: reviews.reviewText,
      letterboxdUrl: reviews.letterboxdUrl,
      tmdbMovieId: reviews.tmdbMovieId,
      tmdbTvId: reviews.tmdbTvId,
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
  const filmIds = rows.map((row) => canonicalFilmGuid(row));
  const statusMap = latestFilmStatuses(filmIds);
  const metadataMap = metadataForFilmIds(filmIds);
  const grouped = new Map<string, AggregatedMovieDto>();

  for (const row of rows) {
    const filmId = canonicalFilmGuid(row);
    const status = statusMap.get(filmId) ?? null;
    const metadata = metadataMap.get(filmId);
    const year = row.year ?? metadata?.year ?? null;
    const posterUrl = row.posterUrl ?? metadata?.posterUrl ?? undefined;
    const backdropUrl = row.backdropUrl ?? metadata?.backdropUrl ?? undefined;
    const review: AggregatedReviewDto = {
      id: row.id,
      reviewerId: row.userId,
      reviewerHandle: row.reviewerHandle,
      title: row.title,
      year,
      rating: row.rating,
      guid: row.guid,
      status,
      ...(row.reviewedAt && { reviewedAt: row.reviewedAt }),
      ...(posterUrl && { posterUrl }),
      ...(backdropUrl && { backdropUrl }),
      ...(row.reviewText && { reviewText: row.reviewText }),
      ...(row.letterboxdUrl && { letterboxdUrl: row.letterboxdUrl }),
      ...(row.tmdbMovieId && { tmdbMovieId: row.tmdbMovieId }),
      ...(row.tmdbTvId && { tmdbTvId: row.tmdbTvId }),
      genres: metadata?.genres ?? [],
      metadataSource: metadata?.metadataSource ?? null,
      metadataId: metadata?.metadataId ?? null,
      metadataMediaType: metadata?.metadataMediaType ?? null,
      metadataLookupStatus: metadata?.metadataLookupStatus ?? "pending",
      metadataLastFetchedAt: metadata?.metadataLastFetchedAt ?? null,
    };

    const existing = grouped.get(filmId);
    if (!existing) {
      grouped.set(filmId, {
        id: filmId,
        title: row.title,
        year,
        averageRating: row.rating,
        latestReviewedAt: row.reviewedAt ?? undefined,
        posterUrl,
        backdropUrl,
        letterboxdUrl: row.letterboxdUrl ?? undefined,
        tmdbMovieId: row.tmdbMovieId ?? undefined,
        tmdbTvId: row.tmdbTvId ?? undefined,
        genres: metadata?.genres ?? [],
        metadataSource: metadata?.metadataSource ?? null,
        metadataId: metadata?.metadataId ?? null,
        metadataMediaType: metadata?.metadataMediaType ?? null,
        metadataLookupStatus: metadata?.metadataLookupStatus ?? "pending",
        metadataLastFetchedAt: metadata?.metadataLastFetchedAt ?? null,
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
    existing.status = status;
    if (!existing.posterUrl && posterUrl) existing.posterUrl = posterUrl;
    if (!existing.backdropUrl && backdropUrl) existing.backdropUrl = backdropUrl;
    if (!existing.letterboxdUrl && row.letterboxdUrl) existing.letterboxdUrl = row.letterboxdUrl;
    if (!existing.tmdbMovieId && row.tmdbMovieId) existing.tmdbMovieId = row.tmdbMovieId;
    if (!existing.tmdbTvId && row.tmdbTvId) existing.tmdbTvId = row.tmdbTvId;
    if (reviewTime(row.reviewedAt) > reviewTime(existing.latestReviewedAt)) {
      existing.latestReviewedAt = row.reviewedAt ?? undefined;
      existing.title = row.title;
      existing.year = year;
    }
  }

  return Array.from(grouped.values())
    .filter((movie) => {
      if (!options.onlySynced) return true;
      return movie.status === "added" || movie.status === "exists" || movie.status === "failed_remove";
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
