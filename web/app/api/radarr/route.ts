import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { addMovie, deleteMovieByRadarrId } from "@/app/lib/radarr";
import { addToBlocklist } from "@/app/lib/repos/movieBlocklist";
import { getReviewById } from "@/app/lib/repos/reviews";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { getLatestSyncResultForFilmId, recordSyncResult } from "@/app/lib/repos/syncResults";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";
import type { RadarrAddRequest, RadarrAddResponse } from "@/app/types/movie";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: Partial<RadarrAddRequest>;
  try {
    body = (await request.json()) as Partial<RadarrAddRequest>;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  // Resolve the movie from a stored review when possible (so we can record the
  // outcome and keep idempotency). Radarr credentials are ALWAYS resolved
  // server-side; client-supplied creds are intentionally ignored.
  const reviewId = typeof body.reviewId === "number" ? body.reviewId : null;
  const review = reviewId ? getReviewById(reviewId) : null;

  const title = review?.title ?? body.title?.trim();
  const year = review ? review.year : typeof body.year === "number" ? body.year : null;

  if (!title) {
    return NextResponse.json({ message: "A movie title or reviewId is required." }, { status: 400 });
  }

  const target = getRadarrTarget();
  if (!target.baseUrl || !target.apiKey) {
    return NextResponse.json(
      { message: "Configure the Radarr Base URL and API key in Settings first." },
      { status: 400 },
    );
  }

  try {
    const result = await addMovie(target, { title, year, tmdbId: review?.tmdbMovieId ?? null });

    if (review && (result.status === "added" || result.status === "exists" || result.status === "error")) {
      recordSyncResult({
        reviewId: review.id,
        status: result.status,
        radarrTmdbId: result.movie?.tmdbId ?? null,
        radarrMovieId: result.movie?.radarrMovieId ?? null,
        message: result.message,
        auto: false,
      });
    }

    const payload: RadarrAddResponse = {
      message: result.message,
      status: result.status,
      ...(result.movie && { movie: result.movie }),
    };

    const httpStatus =
      result.status === "added" || result.status === "exists" ? 200 : result.httpStatus;
    return NextResponse.json(payload, { status: httpStatus });
  } catch (error) {
    console.error("Failed to communicate with Radarr", error);
    if (review) {
      recordSyncResult({
        reviewId: review.id,
        status: "error",
        message: "Unable to communicate with Radarr.",
        auto: false,
      });
    }
    return NextResponse.json(
      { message: "Unable to communicate with Radarr. Check the URL, API key, and network access." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: { reviewId?: number; deleteFiles?: boolean; blockFutureSync?: boolean };
  try {
    body = (await request.json()) as {
      reviewId?: number;
      deleteFiles?: boolean;
      blockFutureSync?: boolean;
    };
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const reviewId = typeof body.reviewId === "number" ? body.reviewId : null;
  const review = reviewId ? getReviewById(reviewId) : null;
  if (!review) {
    return NextResponse.json(
      { message: "A valid reviewId is required." },
      { status: 400 },
    );
  }

  const target = getRadarrTarget();
  if (!target.baseUrl || !target.apiKey) {
    return NextResponse.json(
      { message: "Configure the Radarr Base URL and API key in Settings first." },
      { status: 400 },
    );
  }

  const deleteFiles = body.deleteFiles ?? false;
  const blockFutureSync = body.blockFutureSync ?? true;
  const filmId = canonicalFilmGuid(review);
  const latestSync = getLatestSyncResultForFilmId(filmId);
  const radarrMovieId = latestSync?.radarrMovieId ?? null;
  if (!radarrMovieId) {
    return NextResponse.json(
      {
        message:
          "Cannot safely remove this movie because this app does not have the exact Radarr movie ID. Re-sync the movie first, then try again.",
      },
      { status: 409 },
    );
  }

  const result = await deleteMovieByRadarrId(target, radarrMovieId, {
    deleteFiles,
  });

  if (result.status === "deleted" || result.status === "not_found") {
    if (blockFutureSync) {
      addToBlocklist({
        tmdbId: review.tmdbMovieId,
        radarrMovieId,
        title: review.title,
        year: review.year,
        filmId,
        source: "removed_from_radarr",
        message: `Removed from Radarr${result.status === "not_found" ? " (already missing)" : ""}.`,
      });
    }
    recordSyncResult({
      reviewId: review.id,
      status: blockFutureSync ? "blocklisted" : "removed",
      radarrTmdbId: review.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null,
      radarrMovieId,
      message: blockFutureSync
        ? "Removed from Radarr and blocked from future auto-sync."
        : "Removed from Radarr.",
      auto: false,
    });
  } else {
    recordSyncResult({
      reviewId: review.id,
      status: "failed_remove",
      radarrTmdbId: review.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null,
      radarrMovieId,
      message: result.message,
      auto: false,
    });
  }

  const httpStatus = result.status === "deleted" || result.status === "not_found" ? 200 : result.httpStatus;
  return NextResponse.json(
    { message: result.message, status: result.status },
    { status: httpStatus },
  );
}
