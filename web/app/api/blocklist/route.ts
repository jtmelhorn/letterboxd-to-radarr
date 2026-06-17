import { NextResponse } from "next/server";

import { isRequestAuthorized } from "@/app/lib/auth";
import {
  addToBlocklist,
  listBlocklistedMovies,
  unblockByFilmId,
  unblockByTmdbId,
} from "@/app/lib/repos/movieBlocklist";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ blocklist: listBlocklistedMovies() });
}

export async function POST(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: {
    tmdbId?: number | null;
    imdbId?: string | null;
    radarrMovieId?: number | null;
    title?: string;
    year?: number | null;
    filmId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.title || !body.filmId) {
    return NextResponse.json(
      { message: "title and filmId are required." },
      { status: 400 },
    );
  }

  addToBlocklist({
    tmdbId: body.tmdbId ?? null,
    imdbId: body.imdbId ?? null,
    radarrMovieId: body.radarrMovieId ?? null,
    title: body.title,
    year: body.year ?? null,
    filmId: body.filmId,
    source: "manually_blocked",
    message: "Manually blocked.",
  });

  return NextResponse.json({ message: "Movie blocklisted." });
}

export async function DELETE(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: { filmId?: string; tmdbId?: number };
  try {
    body = (await request.json()) as { filmId?: string; tmdbId?: number };
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  let removed = 0;
  if (typeof body.tmdbId === "number") {
    removed += unblockByTmdbId(body.tmdbId);
  }
  if (body.filmId) {
    removed += unblockByFilmId(body.filmId);
  }

  if (removed === 0) {
    return NextResponse.json({ message: "Movie not found in blocklist." }, { status: 404 });
  }

  return NextResponse.json({ message: "Movie unblocked." });
}
