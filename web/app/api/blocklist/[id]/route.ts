import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { unblockById } from "@/app/lib/repos/movieBlocklist";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "A valid blocklist id is required." }, { status: 400 });
  }

  if (!unblockById(id)) {
    return NextResponse.json({ message: "Movie not found in blocklist." }, { status: 404 });
  }

  return NextResponse.json({ message: "Movie unblocked." });
}
