import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { movieMetadata } from "@/app/lib/db/schema";
import type { MovieMetadataRow, ReviewRow } from "@/app/lib/db/schema";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import { lookupMovieMetadata } from "@/app/lib/radarr";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { lookupTvmazeMetadata } from "@/app/lib/tvmaze";
import type { MetadataLookupStatus, MetadataMediaType } from "@/app/types/movie";

export interface CachedMovieMetadata {
  filmId: string;
  year: number | null;
  genres: string[];
  metadataSource: string | null;
  metadataId: string | null;
  metadataMediaType: MetadataMediaType | null;
  metadataLookupStatus: MetadataLookupStatus;
  metadataLastFetchedAt: string | null;
  posterUrl?: string;
  backdropUrl?: string;
  lookupError?: string | null;
}

interface MovieMetadataWrite {
  filmId: string;
  title: string;
  year: number | null;
  genres: string[];
  metadataSource: string | null;
  metadataId: string | null;
  metadataMediaType: MetadataMediaType | null;
  metadataLookupStatus: MetadataLookupStatus;
  metadataLastFetchedAt: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  lookupError?: string | null;
}

const CACHEABLE_STATUSES = new Set<MetadataLookupStatus>(["matched", "not_found", "error"]);
const SQLITE_IN_CHUNK_SIZE = 500;

export function normalizeMetadataTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an)\s+/, "")
    .trim();
}

function parseGenres(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((genre) => (typeof genre === "string" ? genre.trim() : "")).filter(Boolean))];
  } catch {
    return [];
  }
}

function lookupStatus(value: string): MetadataLookupStatus {
  return value === "matched" || value === "not_found" || value === "error" ? value : "pending";
}

function mediaType(value: string | null): MetadataMediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

function toCachedMetadata(row: MovieMetadataRow): CachedMovieMetadata {
  return {
    filmId: row.filmId,
    year: row.year,
    genres: parseGenres(row.genresJson),
    metadataSource: row.metadataSource,
    metadataId: row.metadataId,
    metadataMediaType: mediaType(row.metadataMediaType),
    metadataLookupStatus: lookupStatus(row.metadataLookupStatus),
    metadataLastFetchedAt: row.metadataLastFetchedAt,
    posterUrl: row.posterUrl ?? undefined,
    backdropUrl: row.backdropUrl ?? undefined,
    lookupError: row.lookupError,
  };
}

function filmIdForReview(row: Pick<ReviewRow, "title" | "year" | "letterboxdUrl" | "guid">): string {
  return canonicalFilmGuid(row);
}

function isTvLikeReview(row: Pick<ReviewRow, "title" | "tmdbMovieId" | "tmdbTvId">): boolean {
  if (row.tmdbMovieId) return false;
  if (row.tmdbTvId) return true;
  return /\b(season|series|episode|episodes|miniseries|mini series|limited series)\b/i.test(row.title);
}

function shouldUseCachedMetadata(metadata: CachedMovieMetadata | null, force: boolean): boolean {
  return Boolean(metadata && !force && CACHEABLE_STATUSES.has(metadata.metadataLookupStatus));
}

export function metadataForFilmIds(filmIds: string[]): Map<string, CachedMovieMetadata> {
  const uniqueFilmIds = [...new Set(filmIds.filter(Boolean))];
  const map = new Map<string, CachedMovieMetadata>();
  if (uniqueFilmIds.length === 0) return map;

  const db = getDb();
  for (let i = 0; i < uniqueFilmIds.length; i += SQLITE_IN_CHUNK_SIZE) {
    const chunk = uniqueFilmIds.slice(i, i + SQLITE_IN_CHUNK_SIZE);
    const rows = db.select().from(movieMetadata).where(inArray(movieMetadata.filmId, chunk)).all();
    for (const row of rows) {
      map.set(row.filmId, toCachedMetadata(row));
    }
  }
  return map;
}

export function metadataForFilmId(filmId: string): CachedMovieMetadata | null {
  const db = getDb();
  const row = db.select().from(movieMetadata).where(eq(movieMetadata.filmId, filmId)).get();
  return row ? toCachedMetadata(row) : null;
}

export function upsertMovieMetadata(input: MovieMetadataWrite): CachedMovieMetadata {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.select().from(movieMetadata).where(eq(movieMetadata.filmId, input.filmId)).get();
  const values = {
    filmId: input.filmId,
    normalizedTitle: normalizeMetadataTitle(input.title),
    year: input.year,
    genresJson: JSON.stringify(input.genres),
    metadataSource: input.metadataSource,
    metadataId: input.metadataId,
    metadataMediaType: input.metadataMediaType,
    metadataLookupStatus: input.metadataLookupStatus,
    metadataLastFetchedAt: input.metadataLastFetchedAt,
    posterUrl: input.posterUrl ?? null,
    backdropUrl: input.backdropUrl ?? null,
    lookupError: input.lookupError ?? null,
    updatedAt: now,
  };

  if (existing) {
    db.update(movieMetadata).set(values).where(eq(movieMetadata.filmId, input.filmId)).run();
  } else {
    db.insert(movieMetadata).values({ ...values, createdAt: now }).run();
  }

  const updated = metadataForFilmId(input.filmId);
  if (!updated) {
    throw new Error("Unable to read stored movie metadata.");
  }
  return updated;
}

async function lookupAndStore(row: ReviewRow): Promise<CachedMovieMetadata> {
  const target = getRadarrTarget();
  const filmId = filmIdForReview(row);
  const fetchedAt = new Date().toISOString();

  if (isTvLikeReview(row)) {
    const result = await lookupTvmazeMetadata({ title: row.title, year: row.year });
    if (result.status === "matched" && result.show) {
      return upsertMovieMetadata({
        filmId,
        title: row.title,
        year: result.show.year ?? row.year,
        genres: result.show.genres,
        metadataSource: "tvmaze",
        metadataId: String(result.show.id),
        metadataMediaType: "tv",
        metadataLookupStatus: "matched",
        metadataLastFetchedAt: fetchedAt,
        posterUrl: result.show.posterUrl,
        backdropUrl: null,
        lookupError: null,
      });
    }

    console.info("TV metadata lookup did not match", {
      title: row.title,
      year: row.year,
      status: result.status,
      message: result.message,
    });
    return upsertMovieMetadata({
      filmId,
      title: row.title,
      year: row.year,
      genres: [],
      metadataSource: "tvmaze",
      metadataId: null,
      metadataMediaType: "tv",
      metadataLookupStatus: result.status,
      metadataLastFetchedAt: fetchedAt,
      lookupError: result.message,
    });
  }

  const result = await lookupMovieMetadata(target, {
    title: row.title,
    year: row.year,
    tmdbMovieId: row.tmdbMovieId,
  });
  if (result.status === "matched" && result.movie) {
    return upsertMovieMetadata({
      filmId,
      title: row.title,
      year: result.movie.year,
      genres: result.movie.genres,
      metadataSource: "radarr",
      metadataId: String(result.movie.tmdbId),
      metadataMediaType: "movie",
      metadataLookupStatus: "matched",
      metadataLastFetchedAt: fetchedAt,
      posterUrl: result.movie.posterUrl ?? row.posterUrl,
      backdropUrl: result.movie.backdropUrl ?? row.backdropUrl,
      lookupError: null,
    });
  }

  console.info("Movie metadata lookup did not match", {
    title: row.title,
    year: row.year,
    tmdbMovieId: row.tmdbMovieId,
    status: result.status,
    message: result.message,
  });
  return upsertMovieMetadata({
    filmId,
    title: row.title,
    year: row.year,
    genres: [],
    metadataSource: "radarr",
    metadataId: null,
    metadataMediaType: "movie",
    metadataLookupStatus: result.status,
    metadataLastFetchedAt: fetchedAt,
    lookupError: result.message,
  });
}

export async function enrichReviewsWithMetadata(
  rows: ReviewRow[],
  options: { force?: boolean } = {},
): Promise<void> {
  const force = options.force ?? false;
  const target = getRadarrTarget();
  if (!target.baseUrl || !target.apiKey) return;

  const uniqueRows = new Map<string, ReviewRow>();
  for (const row of rows) {
    uniqueRows.set(filmIdForReview(row), row);
  }

  for (const row of uniqueRows.values()) {
    const filmId = filmIdForReview(row);
    const cached = metadataForFilmId(filmId);
    if (shouldUseCachedMetadata(cached, force)) continue;

    try {
      await lookupAndStore(row);
    } catch (error) {
      console.warn("Metadata enrichment failed", {
        title: row.title,
        year: row.year,
        error: error instanceof Error ? error.message : String(error),
      });
      upsertMovieMetadata({
        filmId,
        title: row.title,
        year: row.year,
        genres: [],
        metadataSource: isTvLikeReview(row) ? "tvmaze" : "radarr",
        metadataId: null,
        metadataMediaType: isTvLikeReview(row) ? "tv" : "movie",
        metadataLookupStatus: "error",
        metadataLastFetchedAt: new Date().toISOString(),
        lookupError: error instanceof Error ? error.message : "Metadata enrichment failed.",
      });
    }
  }
}

export async function refreshMetadataForReview(row: ReviewRow): Promise<CachedMovieMetadata | null> {
  await enrichReviewsWithMetadata([row], { force: true });
  return metadataForFilmId(filmIdForReview(row));
}
