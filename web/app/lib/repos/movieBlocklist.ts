import { and, asc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { movieBlocklist } from "@/app/lib/db/schema";
import type { BlocklistedMovieDto } from "@/app/types/movie";

export function isMovieBlocklisted(input: {
  tmdbId?: number | null;
  imdbId?: string | null;
  filmId?: string | null;
  title?: string | null;
  year?: number | null;
}): boolean {
  const db = getDb();
  if (typeof input.tmdbId === "number") {
    const row = db
      .select({ id: movieBlocklist.id })
      .from(movieBlocklist)
      .where(and(eq(movieBlocklist.tmdbId, input.tmdbId), isNotNull(movieBlocklist.tmdbId)))
      .get();
    if (row) return true;
  }

  const imdbId = cleanImdbId(input.imdbId);
  if (imdbId) {
    const row = db
      .select({ id: movieBlocklist.id })
      .from(movieBlocklist)
      .where(eq(movieBlocklist.imdbId, imdbId))
      .get();
    if (row) return true;
  }

  if (!input.tmdbId && !imdbId && input.filmId) {
    const row = db
      .select({ id: movieBlocklist.id })
      .from(movieBlocklist)
      .where(eq(movieBlocklist.filmId, input.filmId))
      .get();
    if (row) return true;
  }

  if (!input.tmdbId && !imdbId && input.title && typeof input.year === "number") {
    const row = db
      .select({ id: movieBlocklist.id })
      .from(movieBlocklist)
      .where(
        and(
          eq(movieBlocklist.normalizedTitle, normalizeTitle(input.title)),
          eq(movieBlocklist.year, input.year),
        ),
      )
      .get();
    if (row) return true;
  }

  return false;
}

export function addToBlocklist(input: {
  tmdbId?: number | null;
  imdbId?: string | null;
  radarrMovieId?: number | null;
  title: string;
  year?: number | null;
  filmId: string;
  source: "removed_from_radarr" | "manually_blocked";
  message?: string;
}): void {
  const db = getDb();
  db.insert(movieBlocklist)
    .values({
      tmdbId: input.tmdbId ?? null,
      imdbId: cleanImdbId(input.imdbId),
      radarrMovieId: input.radarrMovieId ?? null,
      title: input.title,
      normalizedTitle: normalizeTitle(input.title),
      year: input.year ?? null,
      filmId: input.filmId,
      source: input.source,
      message: input.message ?? "",
    })
    .onConflictDoNothing()
    .run();
}

export function removeFromBlocklist(blocklistId: number): boolean {
  const db = getDb();
  const result = db.delete(movieBlocklist).where(eq(movieBlocklist.id, blocklistId)).run();
  return (result.changes ?? 0) > 0;
}

export function unblockByFilmId(filmId: string): number {
  const db = getDb();
  const result = db.delete(movieBlocklist).where(eq(movieBlocklist.filmId, filmId)).run();
  return result.changes ?? 0;
}

export function unblockByTmdbId(tmdbId: number): number {
  const db = getDb();
  const result = db
    .delete(movieBlocklist)
    .where(and(eq(movieBlocklist.tmdbId, tmdbId), isNotNull(movieBlocklist.tmdbId)))
    .run();
  return result.changes ?? 0;
}

export function unblockById(blocklistId: number): boolean {
  const db = getDb();
  const result = db.delete(movieBlocklist).where(eq(movieBlocklist.id, blocklistId)).run();
  return (result.changes ?? 0) > 0;
}

export function listBlocklistedMovies(): BlocklistedMovieDto[] {
  const db = getDb();
  return db
    .select()
    .from(movieBlocklist)
    .orderBy(asc(movieBlocklist.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      tmdbId: row.tmdbId ?? null,
      imdbId: row.imdbId ?? null,
      radarrMovieId: row.radarrMovieId ?? null,
      title: row.title,
      year: row.year ?? null,
      filmId: row.filmId,
      source: row.source,
      message: row.message,
      createdAt: row.createdAt,
    }));
}

function cleanImdbId(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
