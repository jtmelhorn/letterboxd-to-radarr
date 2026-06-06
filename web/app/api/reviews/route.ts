import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { fetchLetterboxdReviews, isValidHandle } from "@/app/lib/letterboxd";
import { getReviewDtos, upsertReviews } from "@/app/lib/repos/reviews";
import { getOrCreateUser } from "@/app/lib/repos/users";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.trim() ?? searchParams.get("username")?.trim();
  const refresh = searchParams.get("refresh") === "1";

  if (!handle) {
    return NextResponse.json({ message: "A Letterboxd handle is required." }, { status: 400 });
  }
  if (!isValidHandle(handle)) {
    return NextResponse.json(
      { message: "Handle can only contain letters, numbers, underscores, and hyphens." },
      { status: 400 },
    );
  }

  const user = getOrCreateUser(handle);

  if (refresh) {
    try {
      const movies = await fetchLetterboxdReviews(handle);
      upsertReviews(user.id, movies);
    } catch (error) {
      console.error("Failed to refresh Letterboxd reviews", error);
      const cached = getReviewDtos(user.id);
      if (cached.length === 0) {
        return NextResponse.json(
          { message: "Unable to fetch or parse the Letterboxd RSS feed." },
          { status: 502 },
        );
      }
      // Serve cached data on a transient upstream failure.
      return NextResponse.json({ reviews: cached, stale: true });
    }
  }

  return NextResponse.json({ reviews: getReviewDtos(user.id) });
}
