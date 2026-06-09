import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { deleteMovieByRadarrId, resolveExistingRadarrMovieId } from "@/app/lib/radarr";
import { addToBlocklist } from "@/app/lib/repos/movieBlocklist";
import { getAggregatedMovies } from "@/app/lib/repos/aggregatedReviews";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import {
  getLatestRadarrMovieIdForFilmId,
  getLatestSyncResultForFilmId,
  recordSyncResult,
} from "@/app/lib/repos/syncResults";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: { deleteFiles?: boolean; blockFutureSync?: boolean };
  try {
    body = (await request.json()) as { deleteFiles?: boolean; blockFutureSync?: boolean };
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const { id: rawId } = await context.params;
  const filmId = decodeURIComponent(rawId);
  const movie = getAggregatedMovies({ type: "all" }, { onlySynced: true }).find((item) => item.id === filmId);
  if (!movie) {
    return NextResponse.json({ message: "Movie is not currently synced by this app." }, { status: 404 });
  }

  const latestSync = getLatestSyncResultForFilmId(filmId);
  const representativeReview = movie.reviews[0];
  const reviewId = latestSync?.reviewId ?? representativeReview?.id ?? null;
  if (!reviewId) {
    return NextResponse.json({ message: "Unable to resolve a stored review for this movie." }, { status: 400 });
  }

  const target = getRadarrTarget();
  if (!target.baseUrl || !target.apiKey) {
    return NextResponse.json(
      { message: "Configure the Radarr Base URL and API key in Settings first." },
      { status: 400 },
    );
  }

  const radarrMovieId =
    latestSync?.radarrMovieId ??
    getLatestRadarrMovieIdForFilmId(filmId) ??
    (await resolveExistingRadarrMovieId(target, {
      tmdbId: movie.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null,
      imdbId: movie.imdbId ?? null,
    }));
  if (!radarrMovieId) {
    return NextResponse.json(
      {
        message:
          "Cannot safely remove this movie because this app could not find an exact matching Radarr movie ID.",
      },
      { status: 409 },
    );
  }

  const deleteFiles = body.deleteFiles ?? false;
  const blockFutureSync = body.blockFutureSync ?? true;
  const result = await deleteMovieByRadarrId(target, radarrMovieId, { deleteFiles });

  if (result.status === "deleted" || result.status === "not_found") {
    if (blockFutureSync) {
      addToBlocklist({
        tmdbId: movie.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null,
        imdbId: movie.imdbId ?? null,
        radarrMovieId,
        title: movie.title,
        year: movie.year,
        filmId,
        source: "removed_from_radarr",
        message: `Removed from Radarr${result.status === "not_found" ? " (already missing)" : ""}.`,
      });
    }

    recordSyncResult({
      reviewId,
      status: blockFutureSync ? "blocklisted" : "removed",
      radarrTmdbId: movie.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null,
      radarrMovieId,
      message: blockFutureSync
        ? "Removed from Radarr and blocked from future auto-sync."
        : "Removed from Radarr.",
      auto: false,
    });
  } else {
    recordSyncResult({
      reviewId,
      status: "failed_remove",
      radarrTmdbId: movie.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null,
      radarrMovieId,
      message: result.message,
      auto: false,
    });
  }

  const httpStatus = result.status === "deleted" || result.status === "not_found" ? 200 : result.httpStatus;
  return NextResponse.json(
    {
      message: result.message,
      status: result.status,
      blocklisted: result.status !== "error" && blockFutureSync,
    },
    { status: httpStatus },
  );
}
