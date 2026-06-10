import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { RadarrError } from "@/app/lib/radarr";
import { reconcileSyncedMovies } from "@/app/lib/reconcile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await reconcileSyncedMovies();
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to verify the library against Radarr.";
    const status = error instanceof RadarrError && error.httpStatus === 400 ? 400 : 502;
    return NextResponse.json({ message }, { status });
  }
}
