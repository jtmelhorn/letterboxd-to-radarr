import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { refreshMetadataForReview } from "@/app/lib/repos/movieMetadata";
import { getReviewByFilmId, getReviewById } from "@/app/lib/repos/reviews";
import { getRadarrTarget } from "@/app/lib/repos/settings";

export const runtime = "nodejs";

interface RefreshMetadataBody {
  reviewId?: unknown;
  filmId?: unknown;
}

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: RefreshMetadataBody;
  try {
    body = (await request.json()) as RefreshMetadataBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const reviewId = typeof body.reviewId === "number" ? body.reviewId : null;
  const filmId = typeof body.filmId === "string" ? body.filmId.trim() : "";
  const review = reviewId ? getReviewById(reviewId) : filmId ? getReviewByFilmId(filmId) : null;

  if (!review) {
    return NextResponse.json({ message: "A stored movie review is required." }, { status: 404 });
  }

  const target = getRadarrTarget();
  if (!target.baseUrl || !target.apiKey) {
    return NextResponse.json(
      { message: "Configure Radarr in Settings before refreshing movie metadata." },
      { status: 400 },
    );
  }

  const metadata = await refreshMetadataForReview(review);
  return NextResponse.json({ metadata });
}
