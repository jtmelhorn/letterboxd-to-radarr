import { NextResponse } from "next/server";

import { buildSessionToken, isHttpsRequest, isPasswordConfigured, SESSION_COOKIE, SESSION_MAX_AGE, verifyPassword } from "@/app/lib/auth";

export const runtime = "nodejs";

interface LoginBody {
  password?: unknown;
}

export async function POST(request: Request) {
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { success: false, message: "Set an admin password before signing in." },
      { status: 403 },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyPassword(password)) {
    return NextResponse.json({ success: false, message: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, buildSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Only mark Secure on HTTPS so cookies still work for plain-HTTP LAN setups.
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
