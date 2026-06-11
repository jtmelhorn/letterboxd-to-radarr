"use client";

import type { RefObject } from "react";

import { ArrowPathIcon, CheckIcon, FilmIcon, TrashIcon, XIcon } from "@/app/components/icons";
import { AlertBanner } from "@/app/components/ui";
import type { AggregatedMovieDto } from "@/app/types/movie";

export function SyncedPanel({
  syncedMovies,
  filteredSyncedMovies,
  syncedSearch,
  allSyncedCount,
  isAllScope,
  isReconciling,
  reconcileResult,
  panelRef,
  onSearchChange,
  onClose,
  onRefresh,
  onReconcile,
  onOpenMovie,
  onRemoveMovie,
}: {
  syncedMovies: AggregatedMovieDto[];
  filteredSyncedMovies: AggregatedMovieDto[];
  syncedSearch: string;
  allSyncedCount: number | null;
  isAllScope: boolean;
  isReconciling: boolean;
  reconcileResult: { message: string; error: boolean } | null;
  panelRef?: RefObject<HTMLElement | null>;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onRefresh: () => void;
  onReconcile: () => void;
  onOpenMovie: (movie: AggregatedMovieDto) => void;
  onRemoveMovie: (movie: AggregatedMovieDto) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-all duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        aria-labelledby="synced-title"
        aria-modal="true"
        className="glass-modal animate-fade-in flex h-full w-full max-w-md flex-col border-l border-cornsilk/10 shadow-2xl"
        role="dialog"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
          <div>
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-cornsilk/70">
              Radarr library
            </p>
            <h2 className="text-xl font-black tracking-tight text-cornsilk" id="synced-title">
              Synced Movies
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex h-9 items-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] px-3 text-xs font-bold text-cornsilk/70 transition hover:bg-white/[0.08] hover:text-cornsilk disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isReconciling}
              onClick={onReconcile}
              type="button"
            >
              {isReconciling ? "Verifying…" : "Verify against Radarr"}
            </button>
            <button
              aria-label="Refresh synced movies"
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
              onClick={onRefresh}
              type="button"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </button>
            <button
              aria-label="Close synced movies"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
              onClick={onClose}
              type="button"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {reconcileResult && (
          <div className="px-4 pt-3">
            <AlertBanner
              title="Radarr verification"
              tone={reconcileResult.error ? "error" : "success"}
            >
              {reconcileResult.message}
            </AlertBanner>
          </div>
        )}

        <div className="px-4 pt-3 pb-1">
          <input
            aria-label="Search synced movies"
            className="h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
            placeholder="Search movies, year, reviewer, or genre…"
            value={syncedSearch}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {syncedMovies.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                <CheckIcon className="h-6 w-6" />
              </div>
              {!isAllScope && (allSyncedCount ?? 0) > 0 ? (
                <>
                  <h3 className="text-base font-extrabold text-cornsilk">No synced movies in this scope</h3>
                  <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                    Switch the scope to “All enabled groups” to see {allSyncedCount} synced{" "}
                    {allSyncedCount === 1 ? "movie" : "movies"}.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-base font-extrabold text-cornsilk">No synced movies yet</h3>
                  <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                    Movies successfully added to Radarr will appear here.
                  </p>
                </>
              )}
            </div>
          ) : filteredSyncedMovies.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                <FilmIcon className="h-6 w-6" />
              </div>
              <h3 className="text-base font-extrabold text-cornsilk">No synced movies match</h3>
              <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                Try a different title, year, reviewer, or genre.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredSyncedMovies.map((movie) => (
                <li key={movie.id} className="group relative">
                  <button
                    className="flex w-full items-center gap-3 rounded-xl border border-cornsilk/5 bg-ink/30 p-3 text-left transition hover:border-gold/20 hover:bg-ink/45"
                    onClick={() => onOpenMovie(movie)}
                    type="button"
                  >
                    <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded-md bg-black/30">
                      {movie.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" className="h-full w-full object-cover" src={movie.posterUrl} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <FilmIcon className="h-4 w-4 text-cornsilk/40" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-bold text-cornsilk">
                        {movie.title}
                        {movie.year != null && (
                          <span className="ml-1 font-medium text-cornsilk/70">{movie.year}</span>
                        )}
                      </h4>
                      <p className="mt-0.5 text-xs text-cornsilk/60">
                        ★ {movie.averageRating.toFixed(1)} average from {movie.reviewerCount} reviewer
                        {movie.reviewerCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <button
                      aria-label={`Remove ${movie.title} from Radarr`}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-cornsilk/10 bg-black/30 text-cornsilk/70 opacity-0 transition hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveMovie(movie);
                      }}
                      type="button"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
