import type { AggregatedMovieDto, LegacySyncFilterRule, SyncFilters, SyncYearFilterMode } from "@/app/types/movie";

export const MIN_SYNC_YEAR = 1888;
export const MAX_SYNC_YEAR = 2200;

export const EMPTY_SYNC_FILTERS: SyncFilters = {
  year: { mode: "any" },
  genres: { include: [], exclude: [] },
};

const VALID_YEAR_MODES = new Set<SyncYearFilterMode>(["any", "exact", "gte", "lte", "between"]);

const DEFAULT_FILTER_LABEL_BY_KEY = new Map<string, string>([
  ["documentary", "Documentary"],
  ["short", "Short"],
  ["reality", "Reality"],
  ["tv movie", "TV Movie"],
]);

export class SyncFilterValidationError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "SyncFilterValidationError";
    this.errors = errors;
  }
}

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

function cloneFilters(filters: SyncFilters): SyncFilters {
  return {
    year: { ...filters.year },
    genres: {
      include: [...filters.genres.include],
      exclude: [...filters.genres.exclude],
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidYear(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SYNC_YEAR && value <= MAX_SYNC_YEAR;
}

function coerceYear(value: unknown): number | null {
  if (typeof value === "number" && isValidYear(value)) return value;
  if (typeof value === "string" && /^\d{4}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return isValidYear(parsed) ? parsed : null;
  }
  return null;
}

function normalizeLegacyRule(value: unknown): LegacySyncFilterRule | null {
  if (!isObject(value)) return null;

  if (value.type === "releaseYear" && value.operator === "equals") {
    const year = coerceYear(value.value);
    return year == null ? null : { type: "releaseYear", operator: "equals", value: year };
  }

  if (value.type === "genre" && value.operator === "excludesAny") {
    const values = Array.isArray(value.values)
      ? uniqueLabels(value.values.filter((item): item is string => typeof item === "string"))
      : [];
    return values.length > 0 ? { type: "genre", operator: "excludesAny", values } : null;
  }

  return null;
}

function filtersFromLegacyRules(rules: LegacySyncFilterRule[]): SyncFilters {
  const filters = cloneFilters(EMPTY_SYNC_FILTERS);

  const yearRule = rules.find(
    (rule): rule is Extract<LegacySyncFilterRule, { type: "releaseYear" }> =>
      rule.type === "releaseYear" && rule.operator === "equals",
  );
  if (yearRule) {
    filters.year = { mode: "exact", exactYear: yearRule.value };
  }

  const genreRule = rules.find(
    (rule): rule is Extract<LegacySyncFilterRule, { type: "genre" }> =>
      rule.type === "genre" && rule.operator === "excludesAny",
  );
  if (genreRule) {
    filters.genres.exclude = uniqueLabels(genreRule.values);
  }

  return filters;
}

function normalizeLenient(value: unknown): SyncFilters {
  if (!isObject(value)) return cloneFilters(EMPTY_SYNC_FILTERS);

  if (Array.isArray(value.rules)) {
    return filtersFromLegacyRules(
      value.rules.map(normalizeLegacyRule).filter((rule): rule is LegacySyncFilterRule => rule !== null),
    );
  }

  const filters = cloneFilters(EMPTY_SYNC_FILTERS);
  const rawYear = isObject(value.year) ? value.year : {};
  const mode = typeof rawYear.mode === "string" && VALID_YEAR_MODES.has(rawYear.mode as SyncYearFilterMode)
    ? (rawYear.mode as SyncYearFilterMode)
    : "any";
  const exactYear = coerceYear(rawYear.exactYear);
  const minYear = coerceYear(rawYear.minYear);
  const maxYear = coerceYear(rawYear.maxYear);

  if (mode === "exact" && exactYear != null) filters.year = { mode, exactYear };
  else if (mode === "gte" && minYear != null) filters.year = { mode, minYear };
  else if (mode === "lte" && maxYear != null) filters.year = { mode, maxYear };
  else if (mode === "between" && minYear != null && maxYear != null && minYear <= maxYear) {
    filters.year = { mode, minYear, maxYear };
  }

  const rawGenres = isObject(value.genres) ? value.genres : {};
  filters.genres = {
    include: Array.isArray(rawGenres.include)
      ? uniqueLabels(rawGenres.include.filter((item): item is string => typeof item === "string"))
      : [],
    exclude: Array.isArray(rawGenres.exclude)
      ? uniqueLabels(rawGenres.exclude.filter((item): item is string => typeof item === "string"))
      : [],
  };

  return filters;
}

function validateYearField(value: unknown, label: string, errors: string[]): number | undefined {
  if (value === undefined || value === null || value === "") {
    errors.push(`${label} is required.`);
    return undefined;
  }
  const year = coerceYear(value);
  if (year == null) {
    errors.push(`${label} must be a valid four-digit year from ${MIN_SYNC_YEAR} to ${MAX_SYNC_YEAR}.`);
    return undefined;
  }
  return year;
}

function validateGenreList(value: unknown, label: string, errors: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be a list of genres.`);
    return [];
  }
  const invalid = value.some((item) => typeof item !== "string");
  if (invalid) {
    errors.push(`${label} must only contain genre names.`);
    return [];
  }
  return uniqueLabels(value);
}

export function validateSyncFilters(value: unknown): SyncFilters {
  if (!isObject(value)) return cloneFilters(EMPTY_SYNC_FILTERS);

  if (Array.isArray(value.rules)) {
    return filtersFromLegacyRules(
      value.rules.map(normalizeLegacyRule).filter((rule): rule is LegacySyncFilterRule => rule !== null),
    );
  }

  const errors: string[] = [];
  const rawYear = isObject(value.year) ? value.year : {};
  const rawMode = rawYear.mode;
  const mode: SyncYearFilterMode =
    typeof rawMode === "string" && VALID_YEAR_MODES.has(rawMode as SyncYearFilterMode)
      ? (rawMode as SyncYearFilterMode)
      : "any";
  if (rawMode !== undefined && rawMode !== mode) {
    errors.push("Release year filter mode is not supported.");
  }

  const filters = cloneFilters(EMPTY_SYNC_FILTERS);
  if (mode === "exact") {
    const exactYear = validateYearField(rawYear.exactYear, "Exact year", errors);
    if (exactYear != null) filters.year = { mode, exactYear };
  } else if (mode === "gte") {
    const minYear = validateYearField(rawYear.minYear, "Minimum year", errors);
    if (minYear != null) filters.year = { mode, minYear };
  } else if (mode === "lte") {
    const maxYear = validateYearField(rawYear.maxYear, "Maximum year", errors);
    if (maxYear != null) filters.year = { mode, maxYear };
  } else if (mode === "between") {
    const minYear = validateYearField(rawYear.minYear, "Minimum year", errors);
    const maxYear = validateYearField(rawYear.maxYear, "Maximum year", errors);
    if (minYear != null && maxYear != null) {
      if (minYear > maxYear) {
        errors.push("Minimum year cannot be greater than maximum year.");
      } else {
        filters.year = { mode, minYear, maxYear };
      }
    }
  }

  const rawGenres = isObject(value.genres) ? value.genres : {};
  filters.genres = {
    include: validateGenreList(rawGenres.include, "Included genres", errors),
    exclude: validateGenreList(rawGenres.exclude, "Excluded genres", errors),
  };

  if (errors.length > 0) {
    throw new SyncFilterValidationError(errors);
  }

  return filters;
}

export function normalizeSyncFilters(value: unknown): SyncFilters {
  return normalizeLenient(value);
}

export function parseSyncFiltersJson(value: string | null | undefined): SyncFilters {
  if (!value) return cloneFilters(EMPTY_SYNC_FILTERS);
  try {
    return normalizeSyncFilters(JSON.parse(value) as unknown);
  } catch {
    return cloneFilters(EMPTY_SYNC_FILTERS);
  }
}

export function stringifySyncFilters(value: unknown): string {
  return JSON.stringify(validateSyncFilters(value));
}

function movieYear(movie: Pick<AggregatedMovieDto, "year">): number | null {
  return typeof movie.year === "number" && Number.isFinite(movie.year) ? movie.year : null;
}

function movieGenreKeys(movie: Pick<AggregatedMovieDto, "genres">): Map<string, string> {
  const genreKeys = new Map<string, string>();
  for (const genre of movie.genres ?? []) {
    const label = normalizeGenreLabel(genre);
    const key = normalizeGenreKey(label);
    if (key) genreKeys.set(key, label);
  }
  return genreKeys;
}

function yearFilterReasons(year: number | null, filters: SyncFilters): string[] {
  const { mode } = filters.year;
  if (mode === "any") return [];
  if (year == null) {
    if (mode === "exact") return [`release year is unknown and must equal ${filters.year.exactYear}`];
    if (mode === "gte") return [`release year is unknown and must be ${filters.year.minYear} or later`];
    if (mode === "lte") return [`release year is unknown and must be ${filters.year.maxYear} or earlier`];
    return [
      `release year is unknown and must be between ${filters.year.minYear} and ${filters.year.maxYear}`,
    ];
  }

  if (mode === "exact" && year !== filters.year.exactYear) {
    return [`release year ${year} does not match exact year ${filters.year.exactYear}`];
  }
  if (mode === "gte" && filters.year.minYear != null && year < filters.year.minYear) {
    return [`release year ${year} is before minimum year ${filters.year.minYear}`];
  }
  if (mode === "lte" && filters.year.maxYear != null && year > filters.year.maxYear) {
    return [`release year ${year} is after maximum year ${filters.year.maxYear}`];
  }
  if (mode === "between") {
    if (filters.year.minYear != null && year < filters.year.minYear) {
      return [`release year ${year} is before minimum year ${filters.year.minYear}`];
    }
    if (filters.year.maxYear != null && year > filters.year.maxYear) {
      return [`release year ${year} is after maximum year ${filters.year.maxYear}`];
    }
  }

  return [];
}

function genreFilterReasons(genreKeys: Map<string, string>, filters: SyncFilters): string[] {
  const reasons: string[] = [];
  const included = filters.genres.include
    .map((value) => ({ key: normalizeGenreKey(value), label: normalizeGenreLabel(value) }))
    .filter((item) => item.key);
  const excluded = filters.genres.exclude
    .map((value) => ({ key: normalizeGenreKey(value), label: normalizeGenreLabel(value) }))
    .filter((item) => item.key);

  if (included.length > 0 && !included.some((item) => genreKeys.has(item.key))) {
    reasons.push(`movie does not match included genres: ${included.map((item) => item.label).join(", ")}`);
  }

  const matchedExcluded = excluded.find((item) => genreKeys.has(item.key));
  if (matchedExcluded) {
    reasons.push(`genre ${genreKeys.get(matchedExcluded.key) ?? matchedExcluded.label} is excluded`);
  } else if (excluded.length > 0 && genreKeys.size === 0) {
    reasons.push("genre metadata is unavailable for excluded-genre filtering");
  }

  return reasons;
}

export function evaluateSyncFilters(
  movie: Pick<AggregatedMovieDto, "title" | "year" | "genres" | "metadataLookupStatus">,
  filters: SyncFilters,
): { allowed: boolean; reasons: string[] } {
  const normalized = normalizeSyncFilters(filters);
  const reasons = [
    ...yearFilterReasons(movieYear(movie), normalized),
    ...genreFilterReasons(movieGenreKeys(movie), normalized),
  ];

  return { allowed: reasons.length === 0, reasons };
}
