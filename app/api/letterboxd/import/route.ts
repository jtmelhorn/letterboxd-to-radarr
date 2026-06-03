import { NextResponse } from "next/server";

import { parseLetterboxdUpload } from "@/app/lib/letterboxd-export";
import { mergeCachedReviews } from "@/app/lib/storage";

export const runtime = "nodejs";

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
    const { importedMovies, importedFiles } = await parseLetterboxdUpload(file);

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
