import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import JSZip from "jszip";

import { mergeCachedReviews } from "@/app/lib/storage";
import type { MovieReview } from "@/app/types/movie";

export const runtime = "nodejs";

type CsvRow = Record<string, string | undefined>;

interface ParsedImportFile {
  fileName: string;
  movies: MovieReview[];
}

const exportCsvFilePattern = /(^|\/)(reviews|ratings|diary)\.csv$/i;

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(row: CsvRow, names: string[]): string {
  const normalizedNames = new Set(names.map(normalizeHeader));

  for (const name of names) {
    const value = row[name];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (normalizedNames.has(normalizeHeader(key)) && typeof value === "string" && value.trim()) {
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
  const title = pick(row, ["Name", "Title", "Film", "filmTitle", "Movie"]);
  const yearValue = pick(row, ["Year", "Released", "filmYear", "Release Year"]);
  const ratingValue = pick(row, ["Rating", "memberRating", "Member Rating", "Stars"]);
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

function parseCsvFile(fileName: string, csv: string): ParsedImportFile {
  const rows = parse(csv, {
    bom: true,
    columns: true,
    relaxColumnCount: true,
    skipEmptyLines: true,
    trim: true,
  }) as CsvRow[];

  return {
    fileName,
    movies: rows.map(rowToMovie).filter((movie): movie is MovieReview => movie !== null),
  };
}

async function parseZipExport(file: File): Promise<ParsedImportFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const csvFiles = Object.values(zip.files).filter(
    (entry) => !entry.dir && exportCsvFilePattern.test(entry.name),
  );

  return Promise.all(
    csvFiles.map(async (entry) => parseCsvFile(entry.name, await entry.async("string"))),
  );
}

async function parseUploadedFile(file: File): Promise<ParsedImportFile[]> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".zip")) {
    return parseZipExport(file);
  }

  if (fileName.endsWith(".csv") || file.type === "text/csv") {
    return [parseCsvFile(file.name || "uploaded.csv", await file.text())];
  }

  throw new Error("Unsupported file type.");
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
      { message: "Upload your Letterboxd export .zip, or a reviews.csv, ratings.csv, or diary.csv file." },
      { status: 400 },
    );
  }

  try {
    const parsedFiles = await parseUploadedFile(file);
    const importedMovies = parsedFiles.flatMap((parsedFile) => parsedFile.movies);
    const importedFiles = parsedFiles
      .filter((parsedFile) => parsedFile.movies.length > 0)
      .map((parsedFile) => ({
        fileName: parsedFile.fileName,
        importedCount: parsedFile.movies.length,
      }));

    if (importedMovies.length === 0) {
      return NextResponse.json(
        { message: "No rated movies were found in the uploaded Letterboxd export." },
        { status: 400 },
      );
    }

    const movies = await mergeCachedReviews(username, importedMovies);

    return NextResponse.json({
      importedCount: importedMovies.length,
      importedFiles,
      totalCached: movies.length,
      movies,
    });
  } catch (error) {
    console.error("Failed to import Letterboxd export", error);

    return NextResponse.json(
      { message: "Unable to parse the uploaded Letterboxd export." },
      { status: 400 },
    );
  }
}
