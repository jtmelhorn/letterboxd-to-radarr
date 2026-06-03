import { NextResponse } from "next/server";
import Parser from "rss-parser";

import { getCachedReviews, mergeCachedReviews } from "@/app/lib/storage";
import type { MovieReview } from "@/app/types/movie";

interface LetterboxdFeedItem {
  title?: string;
  filmTitle?: string;
  filmYear?: string;
  memberRating?: string;
  "letterboxd:filmTitle"?: string;
  "letterboxd:filmYear"?: string;
  "letterboxd:memberRating"?: string;
}

export const runtime = "nodejs";

const parser = new Parser<Record<string, never>, LetterboxdFeedItem>({
  customFields: {
    item: [
      ["letterboxd:filmTitle", "filmTitle"],
      ["letterboxd:filmYear", "filmYear"],
      ["letterboxd:memberRating", "memberRating"],
    ],
  },
});

function textValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return textValue(value[0]);
  }

  return "";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username")?.trim();

  if (!username) {
    return NextResponse.json(
      { message: "Letterboxd username is required." },
      { status: 400 },
    );
  }

  if (!/^[A-Za-z0-9_-]+$/.test(username)) {
    return NextResponse.json(
      { message: "Letterboxd username can only contain letters, numbers, underscores, and hyphens." },
      { status: 400 },
    );
  }

  try {
    const feed = await parser.parseURL(`https://letterboxd.com/${username}/rss/`);

    const movies: MovieReview[] = feed.items
      .map((item) => {
        const title = textValue(item.filmTitle ?? item["letterboxd:filmTitle"] ?? item.title);
        const yearValue = textValue(item.filmYear ?? item["letterboxd:filmYear"]);
        const ratingValue = textValue(item.memberRating ?? item["letterboxd:memberRating"]);
        const year = Number.parseInt(yearValue, 10);
        const rating = Number.parseFloat(ratingValue);

        if (!title || Number.isNaN(rating)) {
          return null;
        }

        return {
          title,
          year: Number.isNaN(year) ? null : year,
          rating,
        };
      })
      .filter((movie): movie is MovieReview => movie !== null);

    const cachedMovies = await mergeCachedReviews(username, movies);

    return NextResponse.json(cachedMovies);
  } catch (error) {
    console.error("Failed to fetch Letterboxd RSS feed", error);

    const cachedMovies = await getCachedReviews(username);

    if (cachedMovies.length > 0) {
      return NextResponse.json(cachedMovies);
    }

    return NextResponse.json(
      { message: "Unable to fetch or parse the Letterboxd RSS feed." },
      { status: 502 },
    );
  }
}
