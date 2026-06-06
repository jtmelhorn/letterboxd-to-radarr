import { NextResponse } from "next/server";

import { isHttpsRequest, SESSION_COOKIE } from "@/app/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}
