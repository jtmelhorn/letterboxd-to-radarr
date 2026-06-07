import type { RadarrOptionsResponse, ResolvedRadarrTarget } from "@/app/types/movie";

const REQUEST_TIMEOUT_MS = 10_000;

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
  genres?: string[];
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

export interface AddMovieInput {
  title: string;
  year: number | null;
  tmdbId?: number | null;
}

export interface MovieMetadataLookupInput {
  title: string;
  year: number | null;
  tmdbMovieId?: number | null;
}

export interface MovieMetadataLookupResult {
  status: "matched" | "not_found" | "error";
  message: string;
  httpStatus: number;
  movie?: {
    title: string;
    year: number;
    tmdbId: number;
    genres: string[];
    posterUrl?: string;
    backdropUrl?: string;
  };
}

export interface AddMovieResult {
  status: "added" | "exists" | "not_found" | "error";
  message: string;
  httpStatus: number;
  movie?: { title: string; year: number; tmdbId: number };
}

export class RadarrError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "RadarrError";
    this.httpStatus = httpStatus;
  }
}

export function normalizeRadarrUrl(radarrUrl: string): string | null {
  try {
    const url = new URL(radarrUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function headers(apiKey: string): Record<string, string> {
  return { Accept: "application/json", "X-Api-Key": apiKey };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (typeof body === "string") return body;
  if (Array.isArray(body)) {
    const messages = body
      .map((item) =>
        item && typeof item === "object" && "errorMessage" in item
          ? String((item as { errorMessage: unknown }).errorMessage)
          : "",
      )
      .filter(Boolean);
    return messages.length > 0 ? messages.join(" ") : fallback;
  }
  if (body && typeof body === "object") {
    if ("message" in body && typeof (body as { message: unknown }).message === "string") {
      return (body as { message: string }).message;
    }
    if ("error" in body && typeof (body as { error: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  }
  return fallback;
}

function isAlreadyExistsMessage(message: string): boolean {
  return /already|exists|has been added/i.test(message);
}

function normalizeLookupTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an)\s+/, "")
    .trim();
}

function genreList(genres: unknown): string[] {
  if (!Array.isArray(genres)) return [];
  return [...new Set(genres.map((genre) => (typeof genre === "string" ? genre.trim() : "")).filter(Boolean))];
}

function imageUrl(images: RadarrImage[] | undefined, coverTypes: string[]): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const wanted = new Set(coverTypes.map((coverType) => coverType.toLowerCase()));
  const image = images.find((item) => item.coverType && wanted.has(item.coverType.toLowerCase()));
  return image?.remoteUrl || image?.url || undefined;
}

function radarrFetch(baseUrl: string, apiKey: string, path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers(apiKey), ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export async function testConnection(
  baseUrl: string,
  apiKey: string,
): Promise<ConnectionTestResult> {
  try {
    const response = await radarrFetch(baseUrl, apiKey, "/api/v3/system/status", {
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 401) {
      return { success: false, message: "Unauthorized. Please verify your Radarr API key." };
    }
    if (!response.ok) {
      return {
        success: false,
        message: `Radarr responded with status ${response.status}: ${response.statusText}`,
      };
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const version = data && typeof data.version === "string" ? data.version : "";
    return {
      success: true,
      message: version
        ? `Successfully connected to Radarr! (Version: ${version})`
        : "Successfully connected to Radarr!",
    };
  } catch (error) {
    let message =
      "Unable to connect to Radarr. Ensure the URL is correct, Radarr is running, and accessible.";
    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.message.includes("timeout")) {
        message = "Connection timed out. Check that Radarr is running and reachable.";
      } else {
        message = `Connection failed: ${error.message}`;
      }
    }
    return { success: false, message };
  }
}

export async function getRadarrOptions(
  baseUrl: string,
  apiKey: string,
): Promise<RadarrOptionsResponse> {
  const [profileResponse, rootFolderResponse] = await Promise.all([
    radarrFetch(baseUrl, apiKey, "/api/v3/qualityprofile"),
    radarrFetch(baseUrl, apiKey, "/api/v3/rootfolder"),
  ]);

  if (!profileResponse.ok) {
    throw new RadarrError(
      errorMessageFromBody(await readBody(profileResponse), "Unable to fetch quality profiles."),
      profileResponse.status,
    );
  }
  if (!rootFolderResponse.ok) {
    throw new RadarrError(
      errorMessageFromBody(await readBody(rootFolderResponse), "Unable to fetch root folders."),
      rootFolderResponse.status,
    );
  }

  const profiles = (await profileResponse.json()) as RadarrQualityProfile[];
  const folders = (await rootFolderResponse.json()) as RadarrRootFolder[];

  return {
    qualityProfiles: profiles
      .filter((p): p is { id: number; name: string } => typeof p.id === "number")
      .map((p) => ({ id: p.id, name: p.name ?? `Profile ${p.id}` })),
    rootFolders: folders
      .filter((f): f is { path: string } => typeof f.path === "string" && Boolean(f.path))
      .map((f) => ({ path: f.path })),
  };
}

function pickBestMatch(
  results: RadarrLookupMovie[],
  input: AddMovieInput,
): RadarrLookupMovie | null {
  const valid = results.filter((r) => r.tmdbId && r.title && r.year);
  if (valid.length === 0) return null;

  if (input.tmdbId) {
    const byId = valid.find((r) => r.tmdbId === input.tmdbId);
    if (byId) return byId;
  }

  const titleLower = input.title.trim().toLowerCase();
  const normalizedTitle = normalizeLookupTitle(input.title);
  if (input.year) {
    const exact = valid.find(
      (r) => r.year === input.year && r.title?.trim().toLowerCase() === titleLower,
    );
    if (exact) return exact;
    const normalizedExact = valid.find(
      (r) => r.year === input.year && normalizeLookupTitle(r.title ?? "") === normalizedTitle,
    );
    if (normalizedExact) return normalizedExact;
    const nearbyYear = valid.find(
      (r) =>
        typeof r.year === "number" &&
        Math.abs(r.year - input.year!) <= 1 &&
        normalizeLookupTitle(r.title ?? "") === normalizedTitle,
    );
    if (nearbyYear) return nearbyYear;
    const byYear = valid.find((r) => r.year === input.year);
    if (byYear) return byYear;
  }

  const byTitle = valid.find((r) => r.title?.trim().toLowerCase() === titleLower);
  const normalizedByTitle = valid.find((r) => normalizeLookupTitle(r.title ?? "") === normalizedTitle);
  return byTitle ?? normalizedByTitle ?? valid[0];
}

/**
 * Use Radarr's existing movie lookup endpoint as the public metadata provider.
 * Radarr already fronts TMDB metadata for configured users, so this avoids a
 * separate TMDB/OMDb key while still letting us prefer RSS tmdb:movieId matches.
 */
export async function lookupMovieMetadata(
  target: ResolvedRadarrTarget,
  input: MovieMetadataLookupInput,
): Promise<MovieMetadataLookupResult> {
  const baseUrl = normalizeRadarrUrl(target.baseUrl);
  if (!baseUrl) {
    return { status: "error", message: "Radarr Base URL is invalid.", httpStatus: 400 };
  }
  if (!target.apiKey) {
    return { status: "error", message: "Radarr API key is not configured.", httpStatus: 400 };
  }

  const lookupTerm = input.tmdbMovieId
    ? `tmdb:${input.tmdbMovieId}`
    : `${input.title}${input.year ? ` ${input.year}` : ""}`;

  try {
    const lookupResponse = await radarrFetch(
      baseUrl,
      target.apiKey,
      `/api/v3/movie/lookup?term=${encodeURIComponent(lookupTerm)}`,
    );
    if (!lookupResponse.ok) {
      return {
        status: "error",
        message: errorMessageFromBody(await readBody(lookupResponse), "Unable to look up movie metadata."),
        httpStatus: lookupResponse.status,
      };
    }

    const results = (await lookupResponse.json()) as RadarrLookupMovie[];
    const match = pickBestMatch(Array.isArray(results) ? results : [], {
      title: input.title,
      year: input.year,
      tmdbId: input.tmdbMovieId,
    });
    if (!match?.tmdbId || !match.title || !match.year) {
      return {
        status: "not_found",
        message: "No matching movie metadata was found in Radarr lookup.",
        httpStatus: 404,
      };
    }

    return {
      status: "matched",
      message: "Movie metadata matched through Radarr lookup.",
      httpStatus: 200,
      movie: {
        title: match.title,
        year: match.year,
        tmdbId: match.tmdbId,
        genres: genreList(match.genres),
        posterUrl: imageUrl(match.images, ["poster"]),
        backdropUrl: imageUrl(match.images, ["fanart", "background", "banner"]),
      },
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to communicate with Radarr.",
      httpStatus: 502,
    };
  }
}

/**
 * Resolve a movie via lookup and add it to Radarr using the configured quality
 * profile and root folder (falling back to the first available when unset).
 */
export async function addMovie(
  target: ResolvedRadarrTarget,
  input: AddMovieInput,
): Promise<AddMovieResult> {
  const baseUrl = normalizeRadarrUrl(target.baseUrl);
  if (!baseUrl) {
    return { status: "error", message: "Radarr Base URL is invalid.", httpStatus: 400 };
  }
  if (!target.apiKey) {
    return { status: "error", message: "Radarr API key is not configured.", httpStatus: 400 };
  }

  const lookupTerm = input.tmdbId
    ? `tmdb:${input.tmdbId}`
    : `${input.title}${input.year ? ` ${input.year}` : ""}`;

  const lookupResponse = await radarrFetch(
    baseUrl,
    target.apiKey,
    `/api/v3/movie/lookup?term=${encodeURIComponent(lookupTerm)}`,
  );
  if (!lookupResponse.ok) {
    return {
      status: "error",
      message: errorMessageFromBody(await readBody(lookupResponse), "Unable to look up movie."),
      httpStatus: lookupResponse.status,
    };
  }

  const results = (await lookupResponse.json()) as RadarrLookupMovie[];
  const match = pickBestMatch(Array.isArray(results) ? results : [], input);
  if (!match?.tmdbId || !match.title || !match.year) {
    return {
      status: "not_found",
      message: "No matching movie was found in Radarr lookup.",
      httpStatus: 404,
    };
  }

  // Resolve quality profile + root folder, honoring configured values.
  let qualityProfileId = target.qualityProfileId;
  let rootFolderPath = target.rootFolderPath;

  if (!qualityProfileId || !rootFolderPath) {
    const options = await getRadarrOptions(baseUrl, target.apiKey);
    if (!qualityProfileId) {
      qualityProfileId = options.qualityProfiles[0]?.id ?? null;
    }
    if (!rootFolderPath) {
      rootFolderPath = options.rootFolders[0]?.path ?? null;
    }
  }

  if (!qualityProfileId) {
    return {
      status: "error",
      message: "No Radarr quality profile is available or configured.",
      httpStatus: 502,
    };
  }
  if (!rootFolderPath) {
    return {
      status: "error",
      message: "No Radarr root folder is available or configured.",
      httpStatus: 502,
    };
  }

  const addPayload = {
    title: match.title,
    tmdbId: match.tmdbId,
    year: match.year,
    qualityProfileId,
    rootFolderPath,
    monitored: target.monitored,
    addOptions: { searchForMovie: true },
    minimumAvailability: target.minAvailability || "announced",
    titleSlug: match.titleSlug,
    images: match.images,
  };

  const addResponse = await radarrFetch(baseUrl, target.apiKey, "/api/v3/movie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(addPayload),
  });

  const addBody = await readBody(addResponse);

  if (!addResponse.ok) {
    const message = errorMessageFromBody(addBody, "Unable to add movie to Radarr.");
    if (isAlreadyExistsMessage(message)) {
      return {
        status: "exists",
        message: "Already exists in Radarr.",
        httpStatus: 200,
        movie: { title: match.title, year: match.year, tmdbId: match.tmdbId },
      };
    }
    return { status: "error", message, httpStatus: addResponse.status };
  }

  return {
    status: "added",
    message: "Movie added to Radarr.",
    httpStatus: 200,
    movie: { title: match.title, year: match.year, tmdbId: match.tmdbId },
  };
}

export interface DeleteMovieResult {
  status: "deleted" | "not_found" | "error";
  message: string;
  httpStatus: number;
}

export async function deleteMovie(
  target: ResolvedRadarrTarget,
  tmdbId: number,
): Promise<DeleteMovieResult> {
  const baseUrl = normalizeRadarrUrl(target.baseUrl);
  if (!baseUrl) {
    return { status: "error", message: "Radarr Base URL is invalid.", httpStatus: 400 };
  }
  if (!target.apiKey) {
    return { status: "error", message: "Radarr API key is not configured.", httpStatus: 400 };
  }

  try {
    const listResponse = await radarrFetch(baseUrl, target.apiKey, `/api/v3/movie?tmdbId=${tmdbId}`);
    if (!listResponse.ok) {
      return {
        status: "error",
        message: errorMessageFromBody(await readBody(listResponse), "Unable to list movies from Radarr."),
        httpStatus: listResponse.status,
      };
    }

    const movies = (await listResponse.json()) as Array<{ id: number; tmdbId: number }>;
    const match = Array.isArray(movies)
      ? movies.find((m) => m.tmdbId === tmdbId)
      : null;

    if (!match) {
      return {
        status: "not_found",
        message: "Movie not found in Radarr.",
        httpStatus: 404,
      };
    }

    const deleteResponse = await radarrFetch(
      baseUrl,
      target.apiKey,
      `/api/v3/movie/${match.id}?deleteFiles=true&addExclusion=true`,
      { method: "DELETE" },
    );

    if (deleteResponse.status === 404) {
      return { status: "not_found", message: "Movie not found in Radarr.", httpStatus: 404 };
    }
    if (!deleteResponse.ok) {
      return {
        status: "error",
        message: errorMessageFromBody(
          await readBody(deleteResponse),
          "Unable to delete movie from Radarr.",
        ),
        httpStatus: deleteResponse.status,
      };
    }

    return { status: "deleted", message: "Movie removed from Radarr.", httpStatus: 200 };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to communicate with Radarr.",
      httpStatus: 502,
    };
  }
}
