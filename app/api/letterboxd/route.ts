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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
}

function extractFromContent(content: string): { posterUrl?: string; reviewText?: string } {
  if (!content) return {};

  // Extract the first poster image URL from the content HTML
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/i);
  const posterUrl = imgMatch?.[1] ?? undefined;

  // Strip HTML tags but preserve paragraph breaks as newlines
  const withBreaks = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const decoded = decodeHtmlEntities(withBreaks);

  // Split into non-empty lines and filter out auto-generated "Watched…" lines
  const lines = decoded
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => !/^Watched\s+.+\s+(on|\.)\s*/i.test(line) && !/^Watched\s*$/.test(line));

  const reviewText = lines.join("\n\n").trim() || undefined;

  return { posterUrl, reviewText };
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

        const { posterUrl, reviewText } = extractFromContent(
          typeof item.content === "string" ? item.content : "",
        );

        const letterboxdUrl = typeof item.link === "string" && item.link ? item.link : undefined;

        return {
          title,
          year: Number.isNaN(year) ? null : year,
          rating,
          ...(posterUrl && { posterUrl }),
          ...(reviewText && { reviewText }),
          ...(letterboxdUrl && { letterboxdUrl }),
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
