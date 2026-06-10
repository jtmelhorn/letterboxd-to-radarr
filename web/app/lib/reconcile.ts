import { listRadarrMovies } from "@/app/lib/radarr";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { listSyncedFilmRecords, recordSyncResult } from "@/app/lib/repos/syncResults";

export interface ReconcileSummary {
  checked: number;
  missing: number;
}

/**
 * Compare films we consider synced against Radarr's actual library and record
 * reality. Films no longer present get a `missing_in_radarr` result, which is
 * treated like `removed` by the sync candidate filter (re-addable) and is
 * never blocklisted. Throws RadarrError when Radarr is unreachable so callers
 * can surface the failure without recording anything.
 */
export async function reconcileSyncedMovies(): Promise<ReconcileSummary> {
  const target = getRadarrTarget();
  const library = await listRadarrMovies(target);
  const libraryRadarrIds = new Set(library.map((movie) => movie.id));
  const libraryTmdbIds = new Set(
    library.map((movie) => movie.tmdbId).filter((tmdbId): tmdbId is number => tmdbId !== null),
  );

  const summary: ReconcileSummary = { checked: 0, missing: 0 };
  for (const record of listSyncedFilmRecords()) {
    // Films with no recorded Radarr identifiers cannot be verified; skip them
    // rather than risk false "missing" results.
    if (record.radarrMovieId === null && record.radarrTmdbId === null) continue;
    summary.checked += 1;

    const present =
      (record.radarrMovieId !== null && libraryRadarrIds.has(record.radarrMovieId)) ||
      (record.radarrTmdbId !== null && libraryTmdbIds.has(record.radarrTmdbId));
    if (present) continue;

    summary.missing += 1;
    recordSyncResult({
      reviewId: record.reviewId,
      filmId: record.filmId,
      status: "missing_in_radarr",
      message: "Removed in Radarr.",
      auto: false,
    });
  }
  return summary;
}
