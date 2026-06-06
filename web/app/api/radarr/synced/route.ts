import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { getAggregatedMovies } from "@/app/lib/repos/aggregatedReviews";
import { reviewerScopeFromSearchParams } from "@/app/lib/reviewerScope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scope = reviewerScopeFromSearchParams(searchParams);
  return NextResponse.json({ movies: getAggregatedMovies(scope, { onlySynced: true }) });
}
