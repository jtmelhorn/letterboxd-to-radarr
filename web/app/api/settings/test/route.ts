import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { normalizeRadarrUrl, testConnection } from "@/app/lib/radarr";
import { getRadarrTarget } from "@/app/lib/repos/settings";

export const runtime = "nodejs";

interface TestRequestBody {
  radarrUrl?: unknown;
  radarrApiKey?: unknown;
}

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  let body: TestRequestBody;
  try {
    body = (await request.json()) as TestRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const stored = getRadarrTarget();
  const radarrUrlValue =
    typeof body.radarrUrl === "string" && body.radarrUrl.trim()
      ? body.radarrUrl.trim()
      : stored.baseUrl;
  // Fall back to the stored (encrypted) key when the form leaves it blank.
  const radarrApiKey =
    typeof body.radarrApiKey === "string" && body.radarrApiKey.trim()
      ? body.radarrApiKey.trim()
      : stored.apiKey;

  if (!radarrUrlValue) {
    return NextResponse.json(
      { success: false, message: "Radarr Base URL is required to test connection." },
      { status: 400 },
    );
  }

  const baseUrl = normalizeRadarrUrl(radarrUrlValue);
  if (!baseUrl) {
    return NextResponse.json(
      { success: false, message: "Radarr Base URL must be a valid http or https URL." },
      { status: 400 },
    );
  }

  const result = await testConnection(baseUrl, radarrApiKey);
  return NextResponse.json(result);
}
