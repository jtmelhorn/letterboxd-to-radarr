import { describe, expect, it } from "vitest";

import {
  evaluateSyncFilters,
  normalizeSyncFilters,
  syncFiltersNeedGenreMetadata,
  validateSyncFilters,
} from "@/app/lib/syncFilters";

function movie(input: { year: number | null; genres?: string[] }) {
  return {
    title: "Test Movie",
    year: input.year,
    genres: input.genres ?? [],
    metadataLookupStatus: input.genres ? "matched" : "pending",
  } as const;
}

describe("sync filters", () => {
  it("allows all movies when filters are missing", () => {
    const filters = normalizeSyncFilters(undefined);

    expect(evaluateSyncFilters(movie({ year: 2026, genres: ["Documentary"] }), filters).allowed).toBe(true);
  });

  it("allows only the required release year", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "exact", exactYear: 2026 },
      genres: { include: [], exclude: [] },
    });

    expect(evaluateSyncFilters(movie({ year: 2026 }), filters).allowed).toBe(true);

    const result = evaluateSyncFilters(movie({ year: 2025 }), filters);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("release year 2025 does not match exact year 2026");
  });

  it("skips safely when release year is required but unknown", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "exact", exactYear: 2026 },
      genres: { include: [], exclude: [] },
    });

    const result = evaluateSyncFilters(movie({ year: null }), filters);

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("release year is unknown and must equal 2026");
  });

  it("supports minimum year filtering", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "gte", minYear: 2020 },
      genres: { include: [], exclude: [] },
    });

    expect(evaluateSyncFilters(movie({ year: 2026 }), filters).allowed).toBe(true);

    const result = evaluateSyncFilters(movie({ year: 2018 }), filters);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("release year 2018 is before minimum year 2020");
  });

  it("supports maximum year filtering", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "lte", maxYear: 1999 },
      genres: { include: [], exclude: [] },
    });

    expect(evaluateSyncFilters(movie({ year: 1995 }), filters).allowed).toBe(true);

    const result = evaluateSyncFilters(movie({ year: 2001 }), filters);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("release year 2001 is after maximum year 1999");
  });

  it("supports inclusive year ranges", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "between", minYear: 1990, maxYear: 2010 },
      genres: { include: [], exclude: [] },
    });

    expect(evaluateSyncFilters(movie({ year: 1990 }), filters).allowed).toBe(true);
    expect(evaluateSyncFilters(movie({ year: 2010 }), filters).allowed).toBe(true);

    const low = evaluateSyncFilters(movie({ year: 1989 }), filters);
    const high = evaluateSyncFilters(movie({ year: 2011 }), filters);
    expect(low.reasons).toContain("release year 1989 is before minimum year 1990");
    expect(high.reasons).toContain("release year 2011 is after maximum year 2010");
  });

  it("rejects invalid ranges", () => {
    expect(() =>
      validateSyncFilters({
        year: { mode: "between", minYear: 2010, maxYear: 1990 },
        genres: { include: [], exclude: [] },
      }),
    ).toThrow("Minimum year cannot be greater than maximum year.");
  });

  it("requires included genre matches", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "any" },
      genres: { include: ["Horror", "Thriller"], exclude: [] },
    });

    expect(evaluateSyncFilters(movie({ year: 2026, genres: ["Thriller"] }), filters).allowed).toBe(true);

    const result = evaluateSyncFilters(movie({ year: 2026, genres: ["Comedy"] }), filters);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("movie does not match included genres: Horror, Thriller");
  });

  it("excludes genres case-insensitively after normalization", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "any" },
      genres: { include: [], exclude: ["documentary"] },
    });

    const result = evaluateSyncFilters(movie({ year: 2026, genres: ["DocuMentary"] }), filters);

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("genre Documentary is excluded");
  });

  it("applies included and excluded genres together", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "any" },
      genres: { include: ["Horror", "Thriller"], exclude: ["Documentary"] },
    });

    expect(evaluateSyncFilters(movie({ year: 2026, genres: ["Horror"] }), filters).allowed).toBe(true);

    const excluded = evaluateSyncFilters(movie({ year: 2026, genres: ["Horror", "Documentary"] }), filters);
    const missingInclude = evaluateSyncFilters(movie({ year: 2026, genres: ["Comedy"] }), filters);
    expect(excluded.reasons).toContain("genre Documentary is excluded");
    expect(missingInclude.reasons).toContain("movie does not match included genres: Horror, Thriller");
  });

  it("skips safely when excluded-genre filtering needs missing metadata", () => {
    const filters = normalizeSyncFilters({
      year: { mode: "any" },
      genres: { include: [], exclude: ["Documentary"] },
    });

    const result = evaluateSyncFilters(movie({ year: 2026 }), filters);

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("genre metadata is unavailable for excluded-genre filtering");
  });

  it("normalizes legacy v1 rule filters", () => {
    const filters = normalizeSyncFilters({
      version: 1,
      rules: [
        { type: "releaseYear", operator: "equals", value: 2026 },
        { type: "genre", operator: "excludesAny", values: ["documentary", "Short"] },
      ],
    });

    expect(filters).toEqual({
      year: { mode: "exact", exactYear: 2026 },
      genres: { include: [], exclude: ["Documentary", "Short"] },
    });
  });

  it("detects when group filters require genre metadata", () => {
    expect(
      syncFiltersNeedGenreMetadata({
        year: { mode: "exact", exactYear: 2026 },
        genres: { include: [], exclude: [] },
      }),
    ).toBe(false);

    expect(
      syncFiltersNeedGenreMetadata({
        year: { mode: "any" },
        genres: { include: ["Action"], exclude: [] },
      }),
    ).toBe(true);
  });
});
