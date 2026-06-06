import { NextResponse } from "next/server";

import { getAuthStatus } from "@/app/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json(getAuthStatus(request));
}
