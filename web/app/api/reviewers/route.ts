import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { getConfiguredReviewer } from "@/app/lib/config";
import { isValidHandle } from "@/app/lib/letterboxd";
import { deleteUser, getOrCreateUser, listUsers } from "@/app/lib/repos/users";

export const runtime = "nodejs";

interface ReviewerRequestBody {
  handle?: unknown;
}

function publicReviewers() {
  const configured = getConfiguredReviewer();
  if (configured && isValidHandle(configured)) {
    getOrCreateUser(configured);
  }
  return listUsers().map((reviewer) => ({ id: reviewer.id, handle: reviewer.handle }));
}

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ reviewers: publicReviewers() });
}

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: ReviewerRequestBody;
  try {
    body = (await request.json()) as ReviewerRequestBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  if (!handle || !isValidHandle(handle)) {
    return NextResponse.json(
      { message: "Handle can only contain letters, numbers, underscores, and hyphens." },
      { status: 400 },
    );
  }

  const reviewer = getOrCreateUser(handle);
  return NextResponse.json({ reviewer, reviewers: publicReviewers() });
}

export async function DELETE(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.trim() ?? "";
  if (!handle || !isValidHandle(handle)) {
    return NextResponse.json({ message: "A valid Letterboxd handle is required." }, { status: 400 });
  }

  deleteUser(handle);
  return NextResponse.json({ reviewers: publicReviewers() });
}
