import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { getPendingApproval, resolvePendingApproval } from "@/app/lib/repos/pendingApprovals";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "A valid pending approval id is required." }, { status: 400 });
  }

  const pending = getPendingApproval(id);
  if (!pending || pending.status !== "pending") {
    return NextResponse.json({ message: "Pending approval was not found." }, { status: 404 });
  }

  const updated = resolvePendingApproval(id, "rejected", "Rejected before Radarr sync.");
  return NextResponse.json({ pendingApproval: updated });
}
