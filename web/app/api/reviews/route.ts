import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { isValidHandle } from "@/app/lib/letterboxd";
import { getAggregatedMovies } from "@/app/lib/repos/aggregatedReviews";
import {
  groupCoversReviewer,
  getReviewerGroup,
  listReviewerGroups,
} from "@/app/lib/repos/reviewerGroups";
import { getOrCreateUser, listUsers } from "@/app/lib/repos/users";
import { reviewerScopeFromSearchParams } from "@/app/lib/reviewerScope";
import { refreshReviewer } from "@/app/lib/sync";
import { syncFiltersNeedGenreMetadata } from "@/app/lib/syncFilters";
import type { ReviewerScope } from "@/app/types/movie";

export const runtime = "nodejs";

async function refreshScope(scope: ReviewerScope): Promise<void> {
  if (scope.type === "reviewer" && scope.reviewer) {
    await refreshReviewer(scope.reviewer, { fetchMetadata: scopeNeedsGenreMetadata(scope) });
    return;
  }
  if (scope.type === "group" && typeof scope.groupId === "number") {
    const group = getReviewerGroup(scope.groupId);
    for (const handle of group?.reviewerHandles ?? []) {
      await refreshReviewer(handle, { fetchMetadata: scopeNeedsGenreMetadata(scope) });
    }
    return;
  }
  const fetchMetadata = scopeNeedsGenreMetadata(scope);
  for (const reviewer of listUsers()) {
    await refreshReviewer(reviewer.handle, { fetchMetadata });
  }
}

function scopeNeedsGenreMetadata(scope: ReviewerScope): boolean {
  if (scope.type === "group" && typeof scope.groupId === "number") {
    const group = getReviewerGroup(scope.groupId);
    return Boolean(group?.enabled && syncFiltersNeedGenreMetadata(group.filters));
  }

  if (scope.type === "reviewer" && scope.reviewer) {
    return listReviewerGroups().some(
      (group) =>
        group.enabled &&
        groupCoversReviewer(group, scope.reviewer ?? "") &&
        syncFiltersNeedGenreMetadata(group.filters),
    );
  }

  return listReviewerGroups().some((group) => group.enabled && syncFiltersNeedGenreMetadata(group.filters));
}

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
      await refreshScope(scope);
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
