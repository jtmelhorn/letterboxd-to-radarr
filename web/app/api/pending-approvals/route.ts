import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { listPendingApprovals } from "@/app/lib/repos/pendingApprovals";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  return NextResponse.json({
    pendingApprovals: listPendingApprovals(searchParams.get("includeResolved") === "1"),
  });
}
