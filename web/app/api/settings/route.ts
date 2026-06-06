import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import { getRadarrTarget, saveSettings, toPublicSettings } from "@/app/lib/repos/settings";
import type { SettingsUpdate } from "@/app/types/movie";

export const runtime = "nodejs";

interface SettingsRequestBody {
  radarrUrl?: unknown;
  radarrApiKey?: unknown;
  qualityProfileId?: unknown;
  qualityProfileName?: unknown;
  rootFolderPath?: unknown;
  minAvailability?: unknown;
  autoThreshold?: unknown;
  monitored?: unknown;
}

function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json(toPublicSettings(getRadarrTarget()));
}

export async function PUT(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: SettingsRequestBody;
  try {
    body = (await request.json()) as SettingsRequestBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const update: SettingsUpdate = {};

  if (typeof body.radarrUrl === "string") {
    const radarrUrl = normalizeHttpUrl(body.radarrUrl);
    if (radarrUrl === null) {
      return NextResponse.json(
        { message: "Radarr Base URL must be a valid http or https URL." },
        { status: 400 },
      );
    }
    update.radarrUrl = radarrUrl;
  }

  if (typeof body.radarrApiKey === "string" && body.radarrApiKey.trim()) {
    update.radarrApiKey = body.radarrApiKey.trim();
  }
  if (body.qualityProfileId === null || typeof body.qualityProfileId === "number") {
    update.qualityProfileId = body.qualityProfileId;
  }
  if (body.qualityProfileName === null || typeof body.qualityProfileName === "string") {
    update.qualityProfileName = body.qualityProfileName;
  }
  if (body.rootFolderPath === null || typeof body.rootFolderPath === "string") {
    update.rootFolderPath = body.rootFolderPath;
  }
  if (typeof body.minAvailability === "string") {
    update.minAvailability = body.minAvailability;
  }
  if (typeof body.autoThreshold === "number") {
    update.autoThreshold = body.autoThreshold;
  }
  if (typeof body.monitored === "boolean") {
    update.monitored = body.monitored;
  }

  try {
    saveSettings(update);
  } catch (error) {
    console.error("Unable to save settings.", error);
    return NextResponse.json(
      { message: "Unable to save settings. Check that the container can write to the data dir." },
      { status: 500 },
    );
  }

  return NextResponse.json(toPublicSettings(getRadarrTarget()));
}
