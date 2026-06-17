import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { addMovie } from "@/app/lib/radarr";
import { isMovieBlocklisted } from "@/app/lib/repos/movieBlocklist";
import { getPendingApproval, resolvePendingApproval } from "@/app/lib/repos/pendingApprovals";
import { getReviewById } from "@/app/lib/repos/reviews";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { recordSyncResult } from "@/app/lib/repos/syncResults";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "A valid pending approval id is required." }, { status: 400 });
  }

  const pending = getPendingApproval(id);
  if (!pending || pending.status !== "pending") {
    return NextResponse.json({ message: "Pending approval was not found." }, { status: 404 });
  }

  const target = getRadarrTarget();
  if (!target.baseUrl || !target.apiKey) {
    return NextResponse.json({ message: "Set up your Radarr Connection in Settings first." }, { status: 400 });
  }

  const review = getReviewById(pending.reviewId);
  if (
    isMovieBlocklisted({
      tmdbId: review?.tmdbMovieId ?? null,
      filmId: pending.filmId,
      title: pending.title,
      year: pending.year,
    })
  ) {
    recordSyncResult({
      reviewId: pending.reviewId,
      status: "skipped",
      message: "Skipped: movie is blocklisted.",
      auto: false,
    });
    const updated = resolvePendingApproval(id, "error", "Skipped: movie is blocklisted.");
    return NextResponse.json(
      { message: "Movie is blocklisted.", pendingApproval: updated },
      { status: 409 },
    );
  }

  const result = await addMovie(target, {
    title: pending.title,
    year: pending.year,
    tmdbId: review?.tmdbMovieId ?? null,
  });
  const syncStatus = result.status === "added" ? "added" : result.status === "exists" ? "exists" : "error";
  recordSyncResult({
    reviewId: pending.reviewId,
    status: syncStatus,
    radarrTmdbId: result.movie?.tmdbId ?? null,
    radarrMovieId: result.movie?.radarrMovieId ?? null,
    message: result.message,
    auto: false,
  });

  const updated = resolvePendingApproval(
    id,
    syncStatus === "error" ? "error" : "approved",
    result.message,
  );

  const status = syncStatus === "error" ? 502 : 200;
  return NextResponse.json({ pendingApproval: updated, result }, { status });
}
