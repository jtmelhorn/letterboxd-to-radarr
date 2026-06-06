import { NextResponse } from "next/server";

import { getSettings, saveSettings, toPublicSettings } from "@/app/lib/storage";

export const runtime = "nodejs";

interface SettingsRequestBody {
  radarrUrl?: unknown;
  radarrApiKey?: unknown;
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

  const settings = {
    radarrUrl,
    radarrApiKey,
  };

  try {
    await saveSettings(settings);
  } catch (error) {
    console.error("Unable to save settings.", error);
    return NextResponse.json(
      { message: "Unable to save settings. Check that the container can write to /data." },
      { status: 500 },
    );
  }

  return NextResponse.json(toPublicSettings(settings));
}
