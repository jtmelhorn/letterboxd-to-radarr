import { NextResponse } from "next/server";

import { parseLetterboxdExportResponse } from "@/app/lib/letterboxd-export";
import { getSettings, mergeCachedReviews } from "@/app/lib/storage";

export const runtime = "nodejs";

interface ExportRequestBody {
  username?: unknown;
}

function filenameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  const plainMatch = disposition.match(/filename=([^;]+)/i);
  const value = utf8Match?.[1] ?? quotedMatch?.[1] ?? plainMatch?.[1];

  if (!value) {
    return fallback;
  }

  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

function responseLooksLikeExport(response: Response, fileName: string): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const lowerFileName = fileName.toLowerCase();

  return (
    lowerFileName.endsWith(".zip") ||
    lowerFileName.endsWith(".csv") ||
    contentType.includes("zip") ||
    contentType.includes("csv") ||
    contentType.includes("octet-stream")
  );
}

export async function POST(request: Request) {
  let body: ExportRequestBody;

  try {
    body = (await request.json()) as ExportRequestBody;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";

  if (!username) {
    return NextResponse.json(
      { message: "Letterboxd username is required before fetching an export." },
      { status: 400 },
    );
  }

  const settings = await getSettings();

  if (!settings.letterboxdCookie) {
    return NextResponse.json(
      { message: "Save your Letterboxd session cookie in Settings before fetching the export." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(settings.letterboxdExportUrl, {
      headers: {
        Accept: "application/zip,text/csv,application/octet-stream,*/*",
        Cookie: settings.letterboxdCookie,
        "User-Agent": "Mozilla/5.0 LetterboxdToRadarr/1.0",
      },
      cache: "no-store",
    });
    const fileName = filenameFromResponse(response, "letterboxd-export.zip");

    if (!response.ok) {
      return NextResponse.json(
        {
          message:
            response.status === 403
              ? "Letterboxd blocked the export request. Refresh the saved session cookie and try again."
              : "Letterboxd export request failed.",
        },
        { status: response.status },
      );
    }

    if (!responseLooksLikeExport(response, fileName)) {
      return NextResponse.json(
        {
          message:
            "Letterboxd did not return an export file. The saved session cookie may be expired or missing required values.",
        },
        { status: 401 },
      );
    }

    const { importedMovies, importedFiles } = await parseLetterboxdExportResponse(
      fileName,
      await response.arrayBuffer(),
    );

    if (importedMovies.length === 0) {
      return NextResponse.json(
        { message: "The fetched Letterboxd export did not contain rated movies." },
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
    console.error("Failed to fetch Letterboxd export", error);

    return NextResponse.json(
      { message: "Unable to fetch or parse the Letterboxd export." },
      { status: 502 },
    );
  }
}
