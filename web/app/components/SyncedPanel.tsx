"use client";

import type { RefObject } from "react";

import { ArrowPathIcon, CheckIcon, FilmIcon, TrashIcon } from "@/app/components/icons";
import { AlertBanner, DrawerHeader, EmptyState, IconButton, Input } from "@/app/components/ui";
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
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        aria-labelledby="synced-title"
        aria-modal="true"
        className="drawer-shell animate-fade-in w-full max-w-md"
        role="dialog"
      >
        <DrawerHeader
          closeLabel="Close synced movies"
          eyebrow="Radarr library"
          onClose={onClose}
          title="Synced Movies"
          titleId="synced-title"
        >
          <button
            className="ui-btn ui-btn-secondary ui-btn-sm"
            disabled={isReconciling}
            onClick={onReconcile}
            type="button"
          >
            {isReconciling ? "Verifying…" : "Verify against Radarr"}
          </button>
          <IconButton aria-label="Refresh synced movies" onClick={onRefresh}>
            <ArrowPathIcon className="h-4 w-4" />
          </IconButton>
        </DrawerHeader>

        {reconcileResult && (
          <div className="px-4 pt-3">
            <AlertBanner title="Radarr verification" tone={reconcileResult.error ? "error" : "success"}>
              {reconcileResult.message}
            </AlertBanner>
          </div>
        )}

        <div className="px-4 pb-2 pt-3">
          <Input
            aria-label="Search synced movies"
            className="ui-input-sm"
            placeholder="Search movies, year, reviewer, or genre…"
            value={syncedSearch}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {syncedMovies.length === 0 ? (
            <EmptyState
              description={
                !isAllScope && (allSyncedCount ?? 0) > 0
                  ? `Switch the scope to "All enabled groups" to see ${allSyncedCount} synced ${allSyncedCount === 1 ? "movie" : "movies"}.`
                  : "Movies successfully added to Radarr will appear here."
              }
              icon={<CheckIcon className="h-6 w-6" />}
              title={
                !isAllScope && (allSyncedCount ?? 0) > 0
                  ? "No synced movies in this scope"
                  : "No synced movies yet"
              }
            />
          ) : filteredSyncedMovies.length === 0 ? (
            <EmptyState
              description="Try a different title, year, reviewer, or genre."
              icon={<FilmIcon className="h-6 w-6" />}
              title="No synced movies match"
            />
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
                      className="ui-icon-btn opacity-0 transition group-hover:opacity-100 focus:opacity-100"
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
