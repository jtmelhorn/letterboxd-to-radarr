import { describe, expect, it } from "vitest";

import { evaluateSyncFilters, normalizeSyncFilters } from "@/app/lib/syncFilters";

function movie(input: { year: number | null; genres?: string[] }) {
  return {
    title: "Test Movie",
    year: input.year,
    genres: input.genres ?? [],
    metadataLookupStatus: input.genres ? "matched" : "pending",
  } as const;
}

describe("sync filters", () => {
  it("allows only the required release year", () => {
    const filters = normalizeSyncFilters({
      version: 1,
      rules: [{ type: "releaseYear", operator: "equals", value: 2026 }],
    });

    expect(evaluateSyncFilters(movie({ year: 2026 }), filters).allowed).toBe(true);

    const result = evaluateSyncFilters(movie({ year: 2025 }), filters);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("release year 2025 does not equal 2026");
  });

  it("skips safely when release year is required but unknown", () => {
    const filters = normalizeSyncFilters({
      version: 1,
      rules: [{ type: "releaseYear", operator: "equals", value: 2026 }],
    });

    const result = evaluateSyncFilters(movie({ year: null }), filters);

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("release year is unknown and must equal 2026");
  });

  it("excludes genres case-insensitively after normalization", () => {
    const filters = normalizeSyncFilters({
      version: 1,
      rules: [{ type: "genre", operator: "excludesAny", values: ["documentary"] }],
    });

    const result = evaluateSyncFilters(movie({ year: 2026, genres: ["DocuMentary"] }), filters);

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("genre Documentary is excluded");
  });

  it("skips safely when excluded-genre filtering needs missing metadata", () => {
    const filters = normalizeSyncFilters({
      version: 1,
      rules: [{ type: "genre", operator: "excludesAny", values: ["Documentary"] }],
    });

    const result = evaluateSyncFilters(movie({ year: 2026 }), filters);

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("genre metadata is unavailable for excluded-genre filtering");
  });
});

