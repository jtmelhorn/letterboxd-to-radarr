import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { isSetupComplete, markSetupComplete } from "@/app/lib/repos/appState";
import { validateSetupReady } from "@/app/lib/setup";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  if (isSetupComplete()) {
    return NextResponse.json({ message: "Setup is already complete." }, { status: 400 });
  }

  const validation = validateSetupReady();
  if (!validation.ok) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  markSetupComplete();
  return NextResponse.json({ success: true, setupComplete: true });
}
