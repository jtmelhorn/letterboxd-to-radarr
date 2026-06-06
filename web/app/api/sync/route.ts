import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { isValidHandle } from "@/app/lib/letterboxd";
import { clearAllSyncResults, clearSyncResultsForUser, getRecentSyncResults } from "@/app/lib/repos/syncResults";
import { findUser } from "@/app/lib/repos/users";
import { reviewerScopeFromBody } from "@/app/lib/reviewerScope";
import { runSyncScope } from "@/app/lib/sync";

export const runtime = "nodejs";

interface SyncRequestBody {
  handle?: unknown;
  username?: unknown;
  reviewer?: unknown;
  scope?: unknown;
  groupId?: unknown;
  force?: unknown;
}

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.trim() ?? searchParams.get("username")?.trim();
  if (handle && !isValidHandle(handle)) {
    return NextResponse.json({ message: "A valid Letterboxd handle is required." }, { status: 400 });
  }

  const user = handle ? findUser(handle) : null;
  return NextResponse.json({
    results: handle ? (user ? getRecentSyncResults(user.id, 100) : []) : getRecentSyncResults(undefined, 100),
  });
}

export async function DELETE(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.trim() ?? searchParams.get("username")?.trim();
  if (handle && !isValidHandle(handle)) {
    return NextResponse.json({ message: "A valid Letterboxd handle is required." }, { status: 400 });
  }

  const user = handle ? findUser(handle) : null;
  const cleared = handle ? (user ? clearSyncResultsForUser(user.id) : 0) : clearAllSyncResults();
  return NextResponse.json({ cleared });
}

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: SyncRequestBody;
  try {
    body = (await request.json()) as SyncRequestBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const scope = reviewerScopeFromBody(body);
  const handle = scope.type === "reviewer" ? scope.reviewer?.trim() ?? "" : "";

  if (handle && !isValidHandle(handle)) {
    return NextResponse.json({ message: "A valid Letterboxd handle is required." }, { status: 400 });
  }

  try {
    const summary = await runSyncScope(scope, { auto: false, force: body.force === true });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Sync failed", error);
    return NextResponse.json(
      { message: "Unable to sync. Check the Letterboxd handle and Radarr connection." },
      { status: 502 },
    );
  }
}
