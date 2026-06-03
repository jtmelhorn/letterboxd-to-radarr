import { parse } from "csv-parse/sync";
import JSZip from "jszip";

import type { MovieReview } from "@/app/types/movie";

type CsvRow = Record<string, string | undefined>;

export interface ParsedImportFile {
  fileName: string;
  movies: MovieReview[];
}

export interface LetterboxdImportResult {
  importedMovies: MovieReview[];
  importedFiles: Array<{
    fileName: string;
    importedCount: number;
  }>;
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

function summarizeParsedFiles(parsedFiles: ParsedImportFile[]): LetterboxdImportResult {
  const importedMovies = parsedFiles.flatMap((parsedFile) => parsedFile.movies);
  const importedFiles = parsedFiles
    .filter((parsedFile) => parsedFile.movies.length > 0)
    .map((parsedFile) => ({
      fileName: parsedFile.fileName,
      importedCount: parsedFile.movies.length,
    }));

  return {
    importedMovies,
    importedFiles,
  };
}

export function parseLetterboxdCsv(fileName: string, csv: string): ParsedImportFile {
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

export async function parseLetterboxdZip(buffer: ArrayBuffer): Promise<ParsedImportFile[]> {
  const zip = await JSZip.loadAsync(buffer);
  const csvFiles = Object.values(zip.files).filter(
    (entry) => !entry.dir && exportCsvFilePattern.test(entry.name),
  );

  return Promise.all(
    csvFiles.map(async (entry) => parseLetterboxdCsv(entry.name, await entry.async("string"))),
  );
}

export async function parseLetterboxdUpload(file: File): Promise<LetterboxdImportResult> {
  const fileName = file.name.toLowerCase();
  let parsedFiles: ParsedImportFile[];

  if (fileName.endsWith(".zip")) {
    parsedFiles = await parseLetterboxdZip(await file.arrayBuffer());
  } else if (fileName.endsWith(".csv") || file.type === "text/csv") {
    parsedFiles = [parseLetterboxdCsv(file.name || "uploaded.csv", await file.text())];
  } else {
    throw new Error("Unsupported file type.");
  }

  return summarizeParsedFiles(parsedFiles);
}

export async function parseLetterboxdExportResponse(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<LetterboxdImportResult> {
  if (fileName.toLowerCase().endsWith(".zip")) {
    return summarizeParsedFiles(await parseLetterboxdZip(buffer));
  }

  const text = new TextDecoder().decode(buffer);
  return summarizeParsedFiles([parseLetterboxdCsv(fileName, text)]);
}
