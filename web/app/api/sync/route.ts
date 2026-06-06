import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { isValidHandle } from "@/app/lib/letterboxd";
import { getRecentSyncResults } from "@/app/lib/repos/syncResults";
import { findUser } from "@/app/lib/repos/users";
import { runSync } from "@/app/lib/sync";

export const runtime = "nodejs";

interface SyncRequestBody {
  handle?: unknown;
  username?: unknown;
  force?: unknown;
}

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.trim() ?? searchParams.get("username")?.trim();
  if (!handle || !isValidHandle(handle)) {
    return NextResponse.json({ message: "A valid Letterboxd handle is required." }, { status: 400 });
  }

  const user = findUser(handle);
  return NextResponse.json({ results: user ? getRecentSyncResults(user.id, 100) : [] });
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

  const handleValue =
    typeof body.handle === "string" ? body.handle : typeof body.username === "string" ? body.username : "";
  const handle = handleValue.trim();

  if (!handle || !isValidHandle(handle)) {
    return NextResponse.json({ message: "A valid Letterboxd handle is required." }, { status: 400 });
  }

  try {
    const summary = await runSync(handle, { auto: false, force: body.force === true });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Sync failed", error);
    return NextResponse.json(
      { message: "Unable to sync. Check the Letterboxd handle and Radarr connection." },
      { status: 502 },
    );
  }
}
