import { NextResponse } from "next/server";

import { getSettings } from "@/app/lib/storage";
import type { RadarrAddRequest, RadarrAddResponse } from "@/app/types/movie";

export const runtime = "nodejs";

interface RadarrImage {
  coverType?: string;
  url?: string;
  remoteUrl?: string;
}

interface RadarrLookupMovie {
  title?: string;
  titleSlug?: string;
  year?: number;
  tmdbId?: number;
  images?: RadarrImage[];
}

interface RadarrQualityProfile {
  id?: number;
  name?: string;
}

interface RadarrRootFolder {
  id?: number;
  path?: string;
}

interface RadarrAddMoviePayload {
  title: string;
  tmdbId: number;
  year: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored: true;
  addOptions: {
    searchForMovie: true;
  };
  minimumAvailability: "announced";
  titleSlug?: string;
  images?: RadarrImage[];
}

function normalizeRadarrUrl(radarrUrl: string): string | null {
  try {
    const url = new URL(radarrUrl.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (typeof body === "string") {
    return body;
  }

  if (Array.isArray(body)) {
    const messages = body
      .map((item) => {
        if (item && typeof item === "object" && "errorMessage" in item) {
          return String(item.errorMessage);
        }

        return "";
      })
      .filter(Boolean);

    return messages.length > 0 ? messages.join(" ") : fallback;
  }

  if (body && typeof body === "object") {
    if ("message" in body && typeof body.message === "string") {
      return body.message;
    }

    if ("error" in body && typeof body.error === "string") {
      return body.error;
    }
  }

  return fallback;
}

function isAlreadyExistsMessage(message: string): boolean {
  return /already|exists|has been added/i.test(message);
}

function firstNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function POST(request: Request) {
  let body: Partial<RadarrAddRequest>;

  try {
    body = (await request.json()) as Partial<RadarrAddRequest>;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const settings = await getSettings();
  const title = body.title?.trim();
  const radarrUrl = body.radarrUrl?.trim() || settings.radarrUrl;
  const radarrApiKey = body.radarrApiKey?.trim() || settings.radarrApiKey;
  const year = firstNumber(body.year);

  if (!title) {
    return NextResponse.json({ message: "title is required." }, { status: 400 });
  }

  if (!radarrUrl || !radarrApiKey) {
    return NextResponse.json(
      { message: "Configure the Radarr Base URL and API key in Settings first." },
      { status: 400 },
    );
  }

  const baseUrl = normalizeRadarrUrl(radarrUrl);

  if (!baseUrl) {
    return NextResponse.json(
      { message: "Radarr Base URL must be a valid http or https URL." },
      { status: 400 },
    );
  }

  const apiHeaders = {
    Accept: "application/json",
    "X-Api-Key": radarrApiKey,
  };

  try {
    const lookupTerm = `${title}${year ? ` ${year}` : ""}`;
    const lookupResponse = await fetch(
      `${baseUrl}/api/v3/movie/lookup?term=${encodeURIComponent(lookupTerm)}`,
      {
        headers: apiHeaders,
        cache: "no-store",
      },
    );

    if (!lookupResponse.ok) {
      const lookupBody = await readResponseBody(lookupResponse);
      const message = errorMessageFromBody(lookupBody, "Unable to look up movie in Radarr.");

      return NextResponse.json({ message }, { status: lookupResponse.status });
    }

    const lookupResults = (await lookupResponse.json()) as RadarrLookupMovie[];
    const lookupMovie = Array.isArray(lookupResults) ? lookupResults[0] : null;

    if (!lookupMovie?.tmdbId || !lookupMovie.title || !lookupMovie.year) {
      return NextResponse.json(
        { message: "No matching movie was found in Radarr lookup." },
        { status: 404 },
      );
    }

    const [qualityProfileResponse, rootFolderResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v3/qualityprofile`, {
        headers: apiHeaders,
        cache: "no-store",
      }),
      fetch(`${baseUrl}/api/v3/rootfolder`, {
        headers: apiHeaders,
        cache: "no-store",
      }),
    ]);

    if (!qualityProfileResponse.ok) {
      const profileBody = await readResponseBody(qualityProfileResponse);
      const message = errorMessageFromBody(profileBody, "Unable to fetch Radarr quality profiles.");

      return NextResponse.json({ message }, { status: qualityProfileResponse.status });
    }

    if (!rootFolderResponse.ok) {
      const rootFolderBody = await readResponseBody(rootFolderResponse);
      const message = errorMessageFromBody(rootFolderBody, "Unable to fetch Radarr root folders.");

      return NextResponse.json({ message }, { status: rootFolderResponse.status });
    }

    const qualityProfiles = (await qualityProfileResponse.json()) as RadarrQualityProfile[];
    const rootFolders = (await rootFolderResponse.json()) as RadarrRootFolder[];
    const qualityProfile = qualityProfiles.find((profile) => typeof profile.id === "number");
    const rootFolder = rootFolders.find((folder) => typeof folder.path === "string" && folder.path);

    if (!qualityProfile?.id) {
      return NextResponse.json(
        { message: "Radarr did not return an available quality profile." },
        { status: 502 },
      );
    }

    if (!rootFolder?.path) {
      return NextResponse.json(
        { message: "Radarr did not return an available root folder." },
        { status: 502 },
      );
    }

    const addPayload: RadarrAddMoviePayload = {
      title: lookupMovie.title,
      tmdbId: lookupMovie.tmdbId,
      year: lookupMovie.year,
      qualityProfileId: qualityProfile.id,
      rootFolderPath: rootFolder.path,
      monitored: true,
      addOptions: {
        searchForMovie: true,
      },
      minimumAvailability: "announced",
      titleSlug: lookupMovie.titleSlug,
      images: lookupMovie.images,
    };

    const addResponse = await fetch(`${baseUrl}/api/v3/movie`, {
      method: "POST",
      headers: {
        ...apiHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(addPayload),
      cache: "no-store",
    });

    const addResponseBody = await readResponseBody(addResponse);

    if (!addResponse.ok) {
      const message = errorMessageFromBody(addResponseBody, "Unable to add movie to Radarr.");
      if (isAlreadyExistsMessage(message)) {
        return NextResponse.json({ message: "Already exists in Radarr." });
      }

      return NextResponse.json(
        { message },
        { status: addResponse.status },
      );
    }

    const response: RadarrAddResponse = {
      message: "Movie added to Radarr.",
      movie: {
        title: lookupMovie.title,
        year: lookupMovie.year,
        tmdbId: lookupMovie.tmdbId,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to communicate with Radarr", error);

    return NextResponse.json(
      { message: "Unable to communicate with Radarr. Check the URL, API key, and network access." },
      { status: 502 },
    );
  }
}
