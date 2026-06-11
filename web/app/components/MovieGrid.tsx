"use client";

import { FilmIcon } from "@/app/components/icons";
import { PosterRadarrAction, posterRingClass } from "@/app/components/PosterCard";
import type { SendState } from "@/app/lib/format";
import type { AggregatedMovieDto } from "@/app/types/movie";

export function MovieGrid({
  movies,
  sendStates,
  onOpenMovie,
  onSend,
  onRemove,
}: {
  movies: AggregatedMovieDto[];
  sendStates: Record<string, SendState>;
  onOpenMovie: (key: string) => void;
  onSend: (movie: AggregatedMovieDto) => void;
  onRemove: (movie: AggregatedMovieDto) => void;
}) {
  return (
    <div className="poster-grid animate-fade-in">
      {movies.map((movie) => {
        const key = String(movie.id);
        const sendState = sendStates[key] ?? "idle";

        return (
          <div
            key={key}
            className={`poster-card group w-full min-h-0 aspect-[2/3] overflow-hidden rounded-2xl bg-ink/60 text-left ${posterRingClass(sendState)}`}
          >
            <button
              aria-label={`${movie.title} (${movie.year ?? "unknown"}) — ${movie.averageRating.toFixed(1)} average stars${
                sendState === "added" ? " — already in Radarr" : ""
              }`}
              className="absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/80"
              onClick={() => onOpenMovie(key)}
              type="button"
            >
              {movie.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                  src={movie.posterUrl}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-pine to-ink p-4">
                  <FilmIcon className="h-9 w-9 text-granite/70" />
                  <span className="line-clamp-3 text-center text-[11px] font-bold leading-tight text-cornsilk/75">
                    {movie.title}
                  </span>
                </div>
              )}

              <div className="poster-gradient absolute inset-0 pointer-events-none" />

              <div className="absolute inset-x-2 top-2 flex justify-start pointer-events-none">
                <div className="rounded-lg bg-black/60 px-2 py-0.5 backdrop-blur-md border border-cornsilk/5">
                  <span className="text-[11px] font-bold text-gold flex items-center gap-0.5">
                    ★ {movie.averageRating.toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3">
                <span className="rounded-full bg-black/0 px-3 py-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-transparent transition duration-200 group-hover:bg-black/45 group-hover:text-gold group-focus-within:bg-black/45 group-focus-within:text-gold">
                  Click for review
                </span>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none">
                <p className="mb-0.5 text-[11px] font-bold text-cornsilk/70">{movie.year ?? "—"}</p>
                <h3 className="line-clamp-2 text-xs font-extrabold leading-snug text-cornsilk group-hover:text-gold transition-colors">
                  {movie.title}
                </h3>
              </div>
            </button>

            <div className="absolute top-2 right-2 z-10">
              <PosterRadarrAction
                movie={movie}
                onSend={onSend}
                onRemove={onRemove}
                sendState={sendState}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
