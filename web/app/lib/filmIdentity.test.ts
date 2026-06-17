import { describe, expect, it } from "vitest";

import { canonicalFilmGuid } from "@/app/lib/filmIdentity";

describe("canonicalFilmGuid", () => {
  it("extracts the film slug from a review url", () => {
    expect(
      canonicalFilmGuid({
        title: "Inception",
        year: 2010,
        letterboxdUrl: "https://letterboxd.com/alice/film/inception/",
      }),
    ).toBe("film:inception");
  });

  it("extracts the slug from a raw rss guid when no link is present", () => {
    expect(
      canonicalFilmGuid({
        title: "Inception",
        year: 2010,
        guid: "letterboxd:bob/review/film/inception/",
      }),
    ).toBe("film:inception");
  });

  it("falls back to title-year when no film slug is available", () => {
    expect(canonicalFilmGuid({ title: "Inception", year: 2010 })).toBe("film:inception-2010");
    expect(canonicalFilmGuid({ title: "Inception" })).toBe("film:inception-unknown");
  });

  it("is idempotent for an already-canonical guid without a /film/ link", () => {
    // Stored review rows carry a canonical guid like "film:inception" (no
    // surrounding slashes). Re-canonicalizing must preserve it instead of
    // dropping back to the title-year fallback.
    expect(
      canonicalFilmGuid({
        title: "Inception",
        year: 2010,
        letterboxdUrl: null,
        guid: "film:inception",
      }),
    ).toBe("film:inception");
  });

  it("normalizes an already-canonical guid to lowercase", () => {
    expect(
      canonicalFilmGuid({ title: "Inception", year: 2010, guid: "film:Inception" }),
    ).toBe("film:inception");
  });

  it("preserves a legacy title-year fallback guid instead of re-deriving it", () => {
    expect(
      canonicalFilmGuid({
        title: "Inception",
        year: 2010,
        letterboxdUrl: null,
        guid: "film:inception-2010",
      }),
    ).toBe("film:inception-2010");
  });

  it("keeps the same identity across reviewers regardless of link form", () => {
    const fromReviewLink = canonicalFilmGuid({
      title: "Inception",
      year: 2010,
      letterboxdUrl: "https://letterboxd.com/alice/film/inception/",
      guid: "film:inception",
    });
    const fromShortLink = canonicalFilmGuid({
      title: "Inception",
      year: 2010,
      letterboxdUrl: "https://boxd.it/AbCd",
      guid: "film:inception",
    });
    const fromMissingLink = canonicalFilmGuid({
      title: "Inception",
      year: 2010,
      letterboxdUrl: null,
      guid: "film:inception",
    });

    expect(fromReviewLink).toBe(fromShortLink);
    expect(fromReviewLink).toBe(fromMissingLink);
    expect(fromReviewLink).toBe("film:inception");
  });

  it("ignores a guid that is not in canonical form when a /film/ link is present", () => {
    expect(
      canonicalFilmGuid({
        title: "Inception",
        year: 2010,
        letterboxdUrl: "https://letterboxd.com/alice/film/inception/",
        guid: "not-canonical",
      }),
    ).toBe("film:inception");
  });
});
