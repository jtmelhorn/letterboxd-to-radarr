import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { isValidHandle } from "@/app/lib/letterboxd";
import { getAggregatedMovies } from "@/app/lib/repos/aggregatedReviews";
import { getOrCreateUser } from "@/app/lib/repos/users";
import { reviewerScopeFromSearchParams } from "@/app/lib/reviewerScope";
import { refreshScopeReviews } from "@/app/lib/sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.trim() ?? searchParams.get("username")?.trim();
  const refresh = searchParams.get("refresh") === "1";
  const scope = reviewerScopeFromSearchParams(searchParams);

  if (handle && !isValidHandle(handle)) {
    return NextResponse.json(
      { message: "Handle can only contain letters, numbers, underscores, and hyphens." },
      { status: 400 },
    );
  }
  if (handle) getOrCreateUser(handle);

  if (refresh) {
    try {
      await refreshScopeReviews(scope);
    } catch (error) {
      console.error("Failed to refresh Letterboxd reviews", error);
      const cached = getAggregatedMovies(scope);
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

  return NextResponse.json({ reviews: getAggregatedMovies(scope) });
}
