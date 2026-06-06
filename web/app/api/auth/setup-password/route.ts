import { NextResponse } from "next/server";

import {
  buildSessionToken,
  isHttpsRequest,
  isPasswordConfigured,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/app/lib/auth";
import { hashPassword } from "@/app/lib/crypto";
import { setAdminPassword } from "@/app/lib/repos/appState";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;

interface SetupPasswordBody {
  password?: unknown;
  confirmPassword?: unknown;
}

function setSessionCookie(response: NextResponse, request: Request): void {
  response.cookies.set(SESSION_COOKIE, buildSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function POST(request: Request) {
  if (isPasswordConfigured()) {
    return NextResponse.json(
      { success: false, message: "Admin password is already configured." },
      { status: 403 },
    );
  }

  let body: SetupPasswordBody;
  try {
    body = (await request.json()) as SetupPasswordBody;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { success: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json({ success: false, message: "Passwords do not match." }, { status: 400 });
  }

  setAdminPassword(hashPassword(password));

  const response = NextResponse.json({ success: true });
  setSessionCookie(response, request);
  return response;
}
