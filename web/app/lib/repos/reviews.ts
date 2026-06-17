import { eq } from "drizzle-orm";

import { getDb, getSqlite } from "@/app/lib/db";
import { reviews, syncResults } from "@/app/lib/db/schema";
import type { ReviewRow } from "@/app/lib/db/schema";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import { metadataForFilmIds } from "@/app/lib/repos/movieMetadata";
import { latestFilmStatuses } from "@/app/lib/repos/syncResults";
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
    backdropUrl: movie.backdropUrl?.trim() || undefined,
    reviewText: movie.reviewText?.trim() || undefined,
    letterboxdUrl: movie.letterboxdUrl?.trim() || undefined,
    tmdbMovieId:
      typeof movie.tmdbMovieId === "number" && Number.isFinite(movie.tmdbMovieId) && movie.tmdbMovieId > 0
        ? movie.tmdbMovieId
        : undefined,
    tmdbTvId:
      typeof movie.tmdbTvId === "number" && Number.isFinite(movie.tmdbTvId) && movie.tmdbTvId > 0
        ? movie.tmdbTvId
        : undefined,
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
  const byGuid = new Map<string, MovieReview & { guid: string }>();
  const byTmdbMovie = new Map<number, string>();
  const byTmdbTv = new Map<number, string>();

  const resolveKey = (movie: MovieReview & { guid: string }): string => {
    if (typeof movie.tmdbMovieId === "number" && movie.tmdbMovieId > 0) {
      const existing = byTmdbMovie.get(movie.tmdbMovieId);
      if (existing) return existing;
      byTmdbMovie.set(movie.tmdbMovieId, movie.guid);
    }
    if (typeof movie.tmdbTvId === "number" && movie.tmdbTvId > 0) {
      const existing = byTmdbTv.get(movie.tmdbTvId);
      if (existing) return existing;
      byTmdbTv.set(movie.tmdbTvId, movie.guid);
    }
    return movie.guid;
  };

  for (const movie of movies) {
    const key = resolveKey(movie);
    const existing = byGuid.get(key);
    if (!existing) {
      byGuid.set(key, movie);
    } else {
      byGuid.set(key, mergeIncomingReviews(existing, movie));
    }
  }

  return Array.from(byGuid.values());
}

function pickText(a: string | undefined, b: string | undefined): string | undefined {
  const av = a && a.trim().length > 0 ? a : undefined;
  const bv = b && b.trim().length > 0 ? b : undefined;
  return av ?? bv;
}

/**
 * Merge two incoming reviews of the same film. Most-recent rating/reviewedAt
 * wins (so a rewatch updates the star), but real review text and other fields
 * are carried forward so a diary/rewatch entry never erases a real review.
 */
function mergeIncomingReviews(
  a: MovieReview & { guid: string },
  b: MovieReview & { guid: string },
): MovieReview & { guid: string } {
  const newest = reviewTime(a.reviewedAt) >= reviewTime(b.reviewedAt) ? a : b;
  const other = newest === a ? b : a;

  const merged: MovieReview & { guid: string } = {
    title: pickText(newest.title, other.title) ?? newest.title,
    year: newest.year ?? other.year ?? null,
    rating: newest.rating,
    guid: pickText(newest.guid, other.guid) ?? newest.guid,
  };
  const reviewedAt = pickText(newest.reviewedAt, other.reviewedAt);
  if (reviewedAt) merged.reviewedAt = reviewedAt;
  const posterUrl = pickText(newest.posterUrl, other.posterUrl);
  if (posterUrl) merged.posterUrl = posterUrl;
  const backdropUrl = pickText(newest.backdropUrl, other.backdropUrl);
  if (backdropUrl) merged.backdropUrl = backdropUrl;
  const reviewText = pickText(newest.reviewText, other.reviewText);
  if (reviewText) merged.reviewText = reviewText;
  const letterboxdUrl = pickText(newest.letterboxdUrl, other.letterboxdUrl);
  if (letterboxdUrl) merged.letterboxdUrl = letterboxdUrl;
  const tmdbMovieId =
    typeof newest.tmdbMovieId === "number" && newest.tmdbMovieId > 0
      ? newest.tmdbMovieId
      : other.tmdbMovieId;
  if (typeof tmdbMovieId === "number" && tmdbMovieId > 0) merged.tmdbMovieId = tmdbMovieId;
  const tmdbTvId =
    typeof newest.tmdbTvId === "number" && newest.tmdbTvId > 0
      ? newest.tmdbTvId
      : other.tmdbTvId;
  if (typeof tmdbTvId === "number" && tmdbTvId > 0) merged.tmdbTvId = tmdbTvId;
  return merged;
}

const SLUG_GUID_PATTERN = /^film:[a-z0-9-]+$/;

/** Prefer a /film/-slug-derived guid over a title-year fallback when collapsing. */
function bestCanonicalGuid(rows: ReviewRow[]): string {
  const sorted = sortRows(rows);
  for (const row of sorted) {
    const guid = canonicalFilmGuid(row);
    if (SLUG_GUID_PATTERN.test(guid)) return guid;
  }
  return canonicalFilmGuid(sorted[0]!);
}

/**
 * Collapse existing duplicate review rows for a user. Rows are considered the
 * same film when they share a canonical guid OR a tmdb_movie_id / tmdb_tv_id
 * (Letterboxd sometimes year-disambiguates the film slug differently for an
 * original review vs. a rewatch, which previously left two rows for one film).
 * The keeper keeps the most-recent rating; sync_results and movie_metadata are
 * re-pointed onto the keeper's canonical guid before dupes are deleted.
 */
function mergeExistingDuplicates(_userId: number, rows: ReviewRow[]): void {
  const groups = new Map<string, ReviewRow[]>();
  const tmdbMovieOwner = new Map<number, string>();
  const tmdbTvOwner = new Map<number, string>();

  const groupKey = (row: ReviewRow): string => {
    const guidKey = canonicalFilmGuid(row);
    if (typeof row.tmdbMovieId === "number" && row.tmdbMovieId > 0) {
      const owner = tmdbMovieOwner.get(row.tmdbMovieId);
      if (owner) return owner;
      tmdbMovieOwner.set(row.tmdbMovieId, guidKey);
    }
    if (typeof row.tmdbTvId === "number" && row.tmdbTvId > 0) {
      const owner = tmdbTvOwner.get(row.tmdbTvId);
      if (owner) return owner;
      tmdbTvOwner.set(row.tmdbTvId, guidKey);
    }
    return guidKey;
  };

  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const collapseTargets = Array.from(groups.values()).filter((group) => group.length > 1);
  if (collapseTargets.length === 0) return;

  const db = getDb();
  const sqlite = getSqlite();
  // Re-point metadata film_id safely around the movie_metadata.film_id UNIQUE
  // constraint: only rename when no row already exists at the keeper guid, then
  // delete any leftover dupe metadata rows.
  const repointMetadata = sqlite.prepare(
    `UPDATE movie_metadata
       SET film_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE film_id = ?
       AND NOT EXISTS (SELECT 1 FROM movie_metadata m2 WHERE m2.film_id = ?)`,
  );
  const deleteMetadata = sqlite.prepare(`DELETE FROM movie_metadata WHERE film_id = ?`);

  db.transaction((tx) => {
    for (const group of collapseTargets) {
      const sorted = sortRows(group);
      const keeper = sorted[0]!;
      const canonical = bestCanonicalGuid(group);

      // Re-point every metadata row keyed to an old canonical guid in this group
      // onto the chosen canonical, working around the movie_metadata.film_id
      // UNIQUE constraint: rename only when no row exists at canonical yet, then
      // delete any leftover rows at the old guid.
      const oldCanonicals = new Set(
        sorted.map((row) => canonicalFilmGuid(row)).filter((guid) => guid !== canonical),
      );
      for (const oldGuid of oldCanonicals) {
        repointMetadata.run(canonical, oldGuid, canonical);
        deleteMetadata.run(oldGuid);
      }

      if (keeper.guid !== canonical) {
        tx.update(reviews).set({ guid: canonical }).where(eq(reviews.id, keeper.id)).run();
      }
      tx.update(syncResults)
        .set({ filmId: canonical })
        .where(eq(syncResults.reviewId, keeper.id))
        .run();

      for (const dupe of sorted.slice(1)) {
        tx.update(syncResults)
          .set({ reviewId: keeper.id, filmId: canonical })
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
  const byTmdbMovie = new Map<number, ReviewRow>();
  const byTmdbTv = new Map<number, ReviewRow>();
  for (const row of refreshedRows) {
    byCanonical.set(canonicalFilmGuid(row), row);
    if (typeof row.tmdbMovieId === "number" && row.tmdbMovieId > 0) {
      if (!byTmdbMovie.has(row.tmdbMovieId)) byTmdbMovie.set(row.tmdbMovieId, row);
    }
    if (typeof row.tmdbTvId === "number" && row.tmdbTvId > 0) {
      if (!byTmdbTv.has(row.tmdbTvId)) byTmdbTv.set(row.tmdbTvId, row);
    }
  }

  db.transaction((tx) => {
    for (const movie of deduped) {
      // Match by canonical guid first, then by tmdb id so a rewatch whose film
      // slug differs from the original review still updates the existing row
      // instead of inserting a duplicate. The existing row keeps its stored
      // guid so sync_results / pending_approvals / movie_metadata references
      // stay valid.
      const existing =
        byCanonical.get(movie.guid) ??
        (typeof movie.tmdbMovieId === "number" && movie.tmdbMovieId > 0
          ? byTmdbMovie.get(movie.tmdbMovieId)
          : undefined) ??
        (typeof movie.tmdbTvId === "number" && movie.tmdbTvId > 0
          ? byTmdbTv.get(movie.tmdbTvId)
          : undefined);

      if (existing) {
        tx.update(reviews)
          .set({
            title: movie.title,
            year: movie.year ?? existing.year,
            rating: movie.rating,
            reviewedAt: movie.reviewedAt ?? existing.reviewedAt,
            posterUrl: movie.posterUrl ?? existing.posterUrl,
            backdropUrl: movie.backdropUrl ?? existing.backdropUrl,
            // Real review text wins: an incoming diary/rewatch entry now has
            // reviewText = undefined (footer stripped), so it never overwrites
            // a previously stored real review.
            reviewText: movie.reviewText ?? existing.reviewText,
            letterboxdUrl: movie.letterboxdUrl ?? existing.letterboxdUrl,
            tmdbMovieId: movie.tmdbMovieId ?? existing.tmdbMovieId,
            tmdbTvId: movie.tmdbTvId ?? existing.tmdbTvId,
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
            backdropUrl: movie.backdropUrl ?? null,
            reviewText: movie.reviewText ?? null,
            letterboxdUrl: movie.letterboxdUrl ?? null,
            tmdbMovieId: movie.tmdbMovieId ?? null,
            tmdbTvId: movie.tmdbTvId ?? null,
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

export function getReviewByFilmId(filmId: string): ReviewRow | null {
  const db = getDb();
  const canonicalRow = db.select().from(reviews).where(eq(reviews.guid, filmId)).get();
  if (canonicalRow) return canonicalRow;

  const rows = db.select().from(reviews).all();
  return rows.find((row) => canonicalFilmGuid(row) === filmId) ?? null;
}

export function getReviewDtos(userId: number): ReviewDto[] {
  const rows = getReviewRows(userId);
  const filmIds = rows.map((row) => canonicalFilmGuid(row));
  const statusMap = latestFilmStatuses(filmIds);
  const metadataMap = metadataForFilmIds(filmIds);

  return rows.map((row) => {
    const filmId = canonicalFilmGuid(row);
    const metadata = metadataMap.get(filmId);
    return {
      id: row.id,
      title: row.title,
      year: row.year,
      rating: row.rating,
      reviewedAt: row.reviewedAt ?? undefined,
      posterUrl: row.posterUrl ?? metadata?.posterUrl ?? undefined,
      backdropUrl: row.backdropUrl ?? metadata?.backdropUrl ?? undefined,
      reviewText: row.reviewText ?? undefined,
      letterboxdUrl: row.letterboxdUrl ?? undefined,
      tmdbMovieId: row.tmdbMovieId ?? undefined,
      tmdbTvId: row.tmdbTvId ?? undefined,
      genres: metadata?.genres ?? [],
      metadataSource: metadata?.metadataSource ?? null,
      metadataId: metadata?.metadataId ?? null,
      metadataMediaType: metadata?.metadataMediaType ?? null,
      metadataLookupStatus: metadata?.metadataLookupStatus ?? "pending",
      metadataLastFetchedAt: metadata?.metadataLastFetchedAt ?? null,
      guid: row.guid,
      status: statusMap.get(filmId) ?? null,
    };
  });
}

/** True when this review already has a successful add/exists result. */
export function hasSuccessfulSync(reviewId: number): boolean {
  const review = getReviewById(reviewId);
  if (!review) return false;

  const filmId = canonicalFilmGuid(review);
  const status = latestFilmStatuses([filmId]).get(filmId);
  return status === "added" || status === "exists";
}
