import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";

import { mergeCachedReviews } from "@/app/lib/storage";
import type { MovieReview } from "@/app/types/movie";

export const runtime = "nodejs";

type CsvRow = Record<string, string | undefined>;

function pick(row: CsvRow, names: string[]): string {
  for (const name of names) {
    const value = row[name];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function parseRating(value: string): number {
  const numeric = Number.parseFloat(value);

  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  const fullStars = (value.match(/★/g) ?? []).length;
  const halfStars = (value.match(/½/g) ?? []).length;

  return fullStars + halfStars * 0.5;
}

function rowToMovie(row: CsvRow): MovieReview | null {
  const title = pick(row, ["Name", "Title", "Film", "filmTitle"]);
  const yearValue = pick(row, ["Year", "Released", "filmYear"]);
  const ratingValue = pick(row, ["Rating", "memberRating"]);
  const year = Number.parseInt(yearValue, 10);
  const rating = parseRating(ratingValue);

  if (!title || Number.isNaN(rating) || rating <= 0) {
    return null;
  }

  return {
    title,
    year: Number.isNaN(year) ? null : year,
    rating,
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = formData.get("username");
  const file = formData.get("file");

  if (typeof username !== "string" || !username.trim()) {
    return NextResponse.json(
      { message: "Letterboxd username is required for imports." },
      { status: 400 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: "Upload the reviews.csv file from your Letterboxd export." },
      { status: 400 },
    );
  }

  try {
    const csv = await file.text();
    const rows = parse(csv, {
      bom: true,
      columns: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    }) as CsvRow[];

    const importedMovies = rows
      .map(rowToMovie)
      .filter((movie): movie is MovieReview => movie !== null);

    if (importedMovies.length === 0) {
      return NextResponse.json(
        { message: "No rated movies were found in the uploaded CSV." },
        { status: 400 },
      );
    }

    const movies = await mergeCachedReviews(username, importedMovies);

    return NextResponse.json({
      importedCount: importedMovies.length,
      totalCached: movies.length,
      movies,
    });
  } catch (error) {
    console.error("Failed to import Letterboxd CSV", error);

    return NextResponse.json(
      { message: "Unable to parse the uploaded Letterboxd CSV." },
      { status: 400 },
    );
  }
}
