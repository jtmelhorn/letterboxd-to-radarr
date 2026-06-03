import { NextResponse } from "next/server";

import { getSettings, saveSettings, toPublicSettings } from "@/app/lib/storage";

export const runtime = "nodejs";

interface SettingsRequestBody {
  radarrUrl?: unknown;
  radarrApiKey?: unknown;
  letterboxdExportUrl?: unknown;
  letterboxdCookie?: unknown;
}

function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function GET() {
  const settings = await getSettings();

  return NextResponse.json(toPublicSettings(settings));
}

export async function PUT(request: Request) {
  let body: SettingsRequestBody;

  try {
    body = (await request.json()) as SettingsRequestBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const currentSettings = await getSettings();
  const radarrUrlValue = typeof body.radarrUrl === "string" ? body.radarrUrl : currentSettings.radarrUrl;
  const radarrUrl = normalizeHttpUrl(radarrUrlValue);

  if (radarrUrl === null) {
    return NextResponse.json(
      { message: "Radarr Base URL must be a valid http or https URL." },
      { status: 400 },
    );
  }

  const radarrApiKey =
    typeof body.radarrApiKey === "string" && body.radarrApiKey.trim()
      ? body.radarrApiKey.trim()
      : currentSettings.radarrApiKey;
  const letterboxdExportUrlValue =
    typeof body.letterboxdExportUrl === "string"
      ? body.letterboxdExportUrl
      : currentSettings.letterboxdExportUrl;
  const letterboxdExportUrl = normalizeHttpUrl(letterboxdExportUrlValue);

  if (letterboxdExportUrl === null || !letterboxdExportUrl.includes("letterboxd.com")) {
    return NextResponse.json(
      { message: "Letterboxd export URL must be a valid Letterboxd http or https URL." },
      { status: 400 },
    );
  }

  const letterboxdCookie =
    typeof body.letterboxdCookie === "string" && body.letterboxdCookie.trim()
      ? body.letterboxdCookie.trim()
      : currentSettings.letterboxdCookie;

  const settings = {
    radarrUrl,
    radarrApiKey,
    letterboxdExportUrl,
    letterboxdCookie,
  };

  await saveSettings(settings);

  return NextResponse.json(toPublicSettings(settings));
}
