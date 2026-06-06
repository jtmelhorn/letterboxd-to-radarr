const REQUEST_TIMEOUT_MS = 10_000;

interface TvmazeImage {
  medium?: string;
  original?: string;
}

interface TvmazeShow {
  id?: number;
  name?: string;
  premiered?: string | null;
  genres?: string[];
  image?: TvmazeImage | null;
}

interface TvmazeSearchResult {
  show?: TvmazeShow;
}

export interface TvmazeMetadataInput {
  title: string;
  year: number | null;
}

export interface TvmazeMetadataResult {
  status: "matched" | "not_found" | "error";
  message: string;
  httpStatus: number;
  show?: {
    id: number;
    title: string;
    year: number | null;
    genres: string[];
    posterUrl?: string;
  };
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

function yearFromPremiered(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function genreList(genres: unknown): string[] {
  if (!Array.isArray(genres)) return [];
  return [...new Set(genres.map((genre) => (typeof genre === "string" ? genre.trim() : "")).filter(Boolean))];
}

function pickBestShow(results: TvmazeSearchResult[], input: TvmazeMetadataInput): TvmazeShow | null {
  const valid = results
    .map((result) => result.show)
    .filter((show): show is TvmazeShow => Boolean(show?.id && show.name));
  if (valid.length === 0) return null;

  const normalizedTitle = normalizeLookupTitle(input.title);
  if (input.year) {
    const exact = valid.find(
      (show) => normalizeLookupTitle(show.name ?? "") === normalizedTitle && yearFromPremiered(show.premiered) === input.year,
    );
    if (exact) return exact;

    const nearbyYear = valid.find((show) => {
      const showYear = yearFromPremiered(show.premiered);
      return (
        normalizeLookupTitle(show.name ?? "") === normalizedTitle &&
        typeof showYear === "number" &&
        Math.abs(showYear - input.year!) <= 1
      );
    });
    if (nearbyYear) return nearbyYear;
  }

  const byTitle = valid.find((show) => normalizeLookupTitle(show.name ?? "") === normalizedTitle);
  return byTitle ?? valid[0];
}

export async function lookupTvmazeMetadata(input: TvmazeMetadataInput): Promise<TvmazeMetadataResult> {
  try {
    const response = await fetch(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(input.title)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      return {
        status: "error",
        message: `TVmaze responded with status ${response.status}.`,
        httpStatus: response.status,
      };
    }

    const results = (await response.json()) as TvmazeSearchResult[];
    const show = pickBestShow(Array.isArray(results) ? results : [], input);
    if (!show?.id || !show.name) {
      return {
        status: "not_found",
        message: "No matching TV metadata was found in TVmaze lookup.",
        httpStatus: 404,
      };
    }

    return {
      status: "matched",
      message: "TV metadata matched through TVmaze lookup.",
      httpStatus: 200,
      show: {
        id: show.id,
        title: show.name,
        year: yearFromPremiered(show.premiered),
        genres: genreList(show.genres),
        posterUrl: show.image?.original || show.image?.medium || undefined,
      },
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to communicate with TVmaze.",
      httpStatus: 502,
    };
  }
}
