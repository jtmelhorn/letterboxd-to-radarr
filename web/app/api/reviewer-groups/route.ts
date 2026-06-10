import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import {
  deleteReviewerGroup,
  isValidSyncInterval,
  listReviewerGroups,
  upsertReviewerGroup,
} from "@/app/lib/repos/reviewerGroups";
import { SyncFilterValidationError } from "@/app/lib/syncFilters";
import type { SyncInterval } from "@/app/types/movie";

export const runtime = "nodejs";

interface ReviewerGroupRequestBody {
  id?: unknown;
  name?: unknown;
  enabled?: unknown;
  autoThreshold?: unknown;
  ratingThreshold?: unknown;
  syncInterval?: unknown;
  requiresManualApproval?: unknown;
  filters?: unknown;
  reviewerHandles?: unknown;
}

// Omitted fields stay undefined so updates merge with the stored row instead
// of silently resetting it to defaults; creates apply defaults in the repo.
function parseGroupBody(body: ReviewerGroupRequestBody) {
  const id = typeof body.id === "number" ? body.id : undefined;
  const name = typeof body.name === "string" ? body.name : undefined;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const ratingThreshold =
    typeof body.ratingThreshold === "number"
      ? body.ratingThreshold
      : typeof body.autoThreshold === "number"
        ? body.autoThreshold
        : undefined;
  const syncInterval =
    typeof body.syncInterval === "string" ? (body.syncInterval as SyncInterval) : undefined;
  const requiresManualApproval =
    typeof body.requiresManualApproval === "boolean" ? body.requiresManualApproval : undefined;
  const reviewerHandles = Array.isArray(body.reviewerHandles)
    ? body.reviewerHandles.filter((h): h is string => typeof h === "string")
    : undefined;

  return {
    id,
    name,
    enabled,
    ratingThreshold,
    syncInterval,
    requiresManualApproval,
    filters: body.filters,
    reviewerHandles,
  };
}

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ groups: listReviewerGroups() });
}

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: ReviewerGroupRequestBody;
  try {
    body = (await request.json()) as ReviewerGroupRequestBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const group = upsertReviewerGroup(parseGroupBody(body));
    return NextResponse.json({ group, groups: listReviewerGroups() });
  } catch (error) {
    if (error instanceof SyncFilterValidationError) {
      return NextResponse.json({ message: error.message, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to save reviewer group." },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "A valid group id is required." }, { status: 400 });
  }

  try {
    deleteReviewerGroup(id);
    return NextResponse.json({ groups: listReviewerGroups() });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to delete reviewer group." },
      { status: 400 },
    );
  }
}
