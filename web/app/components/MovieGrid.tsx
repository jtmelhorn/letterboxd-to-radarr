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
            className={`poster-card group relative w-full min-h-0 aspect-[2/3] overflow-hidden rounded-2xl bg-ink/60 text-left ${posterRingClass(sendState)}`}
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
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-pine/30 to-ink p-4">
                  <FilmIcon className="h-9 w-9 text-cornsilk/40" />
                  <span className="line-clamp-3 text-center text-[11px] font-bold leading-tight text-cornsilk/80">
                    {movie.title}
                  </span>
                </div>
              )}

              <div className="poster-gradient absolute inset-0 pointer-events-none" />

              <div className="absolute inset-x-2 top-2 flex items-start justify-between pointer-events-none">
                <div className="ui-badge ui-badge-gold">
                  <span>★</span>
                  <span>{movie.averageRating.toFixed(1)}</span>
                </div>
              </div>

              <div className="poster-view-details pointer-events-none absolute inset-0 flex items-center justify-center px-3 transition-opacity duration-200">
                <span className="rounded-full bg-black/50 px-3 py-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-gold backdrop-blur-sm">
                  View details
                </span>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none">
                <p className="mb-0.5 text-[11px] font-bold text-cornsilk/70">{movie.year ?? "—"}</p>
                <h3 className="line-clamp-2 text-xs font-extrabold leading-snug text-cornsilk transition-colors group-hover:text-gold">
                  {movie.title}
                </h3>
              </div>
            </button>

            <div className="absolute right-2 top-2 z-10">
              <PosterRadarrAction movie={movie} onSend={onSend} onRemove={onRemove} sendState={sendState} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
