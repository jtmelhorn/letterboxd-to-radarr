import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { getRadarrOptions, normalizeRadarrUrl, RadarrError } from "@/app/lib/radarr";
import { getRadarrTarget } from "@/app/lib/repos/settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const target = getRadarrTarget();
  const baseUrl = normalizeRadarrUrl(target.baseUrl);

  if (!baseUrl || !target.apiKey) {
    return NextResponse.json(
      { message: "Configure the Radarr Base URL and API key first." },
      { status: 400 },
    );
  }

  try {
    const options = await getRadarrOptions(baseUrl, target.apiKey);
    return NextResponse.json(options);
  } catch (error) {
    if (error instanceof RadarrError) {
      return NextResponse.json({ message: error.message }, { status: error.httpStatus });
    }
    console.error("Failed to load Radarr options", error);
    return NextResponse.json(
      { message: "Unable to load Radarr quality profiles and root folders." },
      { status: 502 },
    );
  }
}
