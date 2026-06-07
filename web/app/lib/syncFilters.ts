import type { AggregatedMovieDto, SyncFilters, SyncFilterRule } from "@/app/types/movie";

export const EMPTY_SYNC_FILTERS: SyncFilters = { version: 1, rules: [] };

const DEFAULT_FILTER_LABEL_BY_KEY = new Map<string, string>([
  ["documentary", "Documentary"],
  ["short", "Short"],
  ["reality", "Reality"],
  ["tv movie", "TV Movie"],
]);

export function normalizeGenreKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeGenreLabel(value: string): string {
  const key = normalizeGenreKey(value);
  if (!key) return "";
  const known = DEFAULT_FILTER_LABEL_BY_KEY.get(key);
  if (known) return known;
  return key
    .split(" ")
    .map((part) => (part ? `${part[0]?.toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}

function uniqueLabels(values: string[]): string[] {
  const labels = new Map<string, string>();
  for (const value of values) {
    const label = normalizeGenreLabel(value);
    const key = normalizeGenreKey(label);
    if (key) labels.set(key, label);
  }
  return Array.from(labels.values()).sort((a, b) => a.localeCompare(b));
}

function normalizeRule(value: unknown): SyncFilterRule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  if (raw.type === "releaseYear" && raw.operator === "equals") {
    const year = typeof raw.value === "number" ? raw.value : Number(raw.value);
    if (Number.isInteger(year) && year >= 1888 && year <= 2200) {
      return { type: "releaseYear", operator: "equals", value: year };
    }
    return null;
  }

  if (raw.type === "genre" && raw.operator === "excludesAny") {
    const values = Array.isArray(raw.values)
      ? uniqueLabels(raw.values.filter((item): item is string => typeof item === "string"))
      : [];
    if (values.length > 0) {
      return { type: "genre", operator: "excludesAny", values };
    }
  }

  return null;
}

export function normalizeSyncFilters(value: unknown): SyncFilters {
  if (!value || typeof value !== "object") return EMPTY_SYNC_FILTERS;
  const raw = value as Record<string, unknown>;
  const rules = Array.isArray(raw.rules) ? raw.rules.map(normalizeRule).filter((rule): rule is SyncFilterRule => rule !== null) : [];
  return { version: 1, rules };
}

export function parseSyncFiltersJson(value: string | null | undefined): SyncFilters {
  if (!value) return EMPTY_SYNC_FILTERS;
  try {
    return normalizeSyncFilters(JSON.parse(value) as unknown);
  } catch {
    return EMPTY_SYNC_FILTERS;
  }
}

export function stringifySyncFilters(value: unknown): string {
  return JSON.stringify(normalizeSyncFilters(value));
}

function movieYear(movie: Pick<AggregatedMovieDto, "year">): number | null {
  return typeof movie.year === "number" && Number.isFinite(movie.year) ? movie.year : null;
}

export function evaluateSyncFilters(
  movie: Pick<AggregatedMovieDto, "title" | "year" | "genres" | "metadataLookupStatus">,
  filters: SyncFilters,
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const year = movieYear(movie);
  const genreKeys = new Map<string, string>();
  for (const genre of movie.genres ?? []) {
    const label = normalizeGenreLabel(genre);
    const key = normalizeGenreKey(label);
    if (key) genreKeys.set(key, label);
  }

  for (const rule of filters.rules) {
    if (rule.type === "releaseYear" && rule.operator === "equals") {
      if (year !== rule.value) {
        reasons.push(
          year == null
            ? `release year is unknown and must equal ${rule.value}`
            : `release year ${year} does not equal ${rule.value}`,
        );
      }
      continue;
    }

    if (rule.type === "genre" && rule.operator === "excludesAny") {
      const excluded = rule.values
        .map((value) => ({ key: normalizeGenreKey(value), label: normalizeGenreLabel(value) }))
        .filter((item) => item.key);
      const matched = excluded.find((item) => genreKeys.has(item.key));
      if (matched) {
        reasons.push(`genre ${genreKeys.get(matched.key) ?? matched.label} is excluded`);
      } else if (excluded.length > 0 && genreKeys.size === 0) {
        reasons.push("genre metadata is unavailable for excluded-genre filtering");
      }
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

