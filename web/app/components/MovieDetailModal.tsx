"use client";

import type { RefObject } from "react";

import {
  ArrowPathIcon,
  CheckIcon,
  ExclamationIcon,
  FilmIcon,
  RadarrIcon,
  TrashIcon,
  XIcon,
} from "@/app/components/icons";
import { Badge, Button } from "@/app/components/ui";
import { movieGenres, UNKNOWN_GENRE } from "@/app/lib/format";
import type { SendState } from "@/app/lib/format";
import type { AggregatedMovieDto } from "@/app/types/movie";

export function MovieDetailModal({
  movie,
  sendState,
  message,
  metadataRefreshing,
  metadataMessage,
  modalRef,
  onClose,
  onSend,
  onRemove,
  onRefreshMetadata,
}: {
  movie: AggregatedMovieDto;
  sendState: SendState;
  message: string | null;
  metadataRefreshing: boolean;
  metadataMessage: string | null;
  modalRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onSend: (movie: AggregatedMovieDto) => void;
  onRemove: (movie: AggregatedMovieDto) => void;
  onRefreshMetadata: (movie: AggregatedMovieDto) => void;
}) {
  return (
    <div
      className="modal-overlay items-end justify-center p-0 md:items-center md:justify-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        aria-labelledby="movie-detail-title"
        aria-modal="true"
        className="modal-shell animate-fade-in h-[92vh] w-full rounded-t-3xl border-cornsilk/10 md:h-auto md:max-h-[92vh] md:max-w-xl md:rounded-[var(--radius-card)]"
        role="dialog"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
          <div>
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-cornsilk/70">
              Movie details
            </p>
            <h2 className="text-xl font-black tracking-tight text-cornsilk" id="movie-detail-title">
              {movie.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {movie.letterboxdUrl && (
              <a
                className="ui-btn ui-btn-secondary ui-btn-sm hidden sm:inline-flex"
                href={movie.letterboxdUrl}
                rel="noreferrer"
                target="_blank"
              >
                Letterboxd ↗
              </a>
            )}
            <button
              aria-label="Close details"
              className="ui-icon-btn"
              onClick={onClose}
              type="button"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
            <aside className="md:w-2/5 md:flex-shrink-0">
              <div className="modal-poster-frame">
                {movie.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={`${movie.title} poster`} src={movie.posterUrl} />
                ) : (
                  <div className="modal-poster-placeholder">
                    <FilmIcon className="h-12 w-12 text-cornsilk/45" />
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-cornsilk/60">
                    {movie.year ?? "Unknown year"}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-lg font-black text-gold">
                  <Star />
                  <span>{movie.averageRating.toFixed(1)}</span>
                </div>
              </div>
              {movie.letterboxdUrl && (
                <a
                  className="ui-btn ui-btn-secondary ui-btn-sm mt-3 w-full sm:hidden"
                  href={movie.letterboxdUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open on Letterboxd ↗
                </a>
              )}
            </aside>

            <section className="min-w-0 flex-1 space-y-4">
              <div className="ui-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="ui-label">Genres</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {movieGenres(movie).length === 0 ? (
                        <span className="text-xs text-cornsilk/50">No genres cached</span>
                      ) : (
                        movieGenres(movie).map((genre) => (
                          <Badge
                            key={genre}
                            tone={genre === UNKNOWN_GENRE ? "slate" : "green"}
                          >
                            {genre}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <Button
                    disabled={metadataRefreshing}
                    size="sm"
                    variant="secondary"
                    onClick={() => onRefreshMetadata(movie)}
                  >
                    {metadataRefreshing ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <ArrowPathIcon className="h-3.5 w-3.5" />
                    )}
                    Refresh metadata
                  </Button>
                </div>
                {metadataMessage && (
                  <p className="ui-helper mt-2">{metadataMessage}</p>
                )}
              </div>

              <div className="ui-surface p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="ui-label">Reviewer notes</p>
                  <span className="text-xs font-medium text-cornsilk/60">
                    {movie.reviewerCount} reviewer{movie.reviewerCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-3">
                  {movie.reviews.map((review) => (
                    <div key={review.id} className="rounded-xl border border-cornsilk/10 bg-black/15 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-extrabold text-cornsilk">
                          @{review.reviewerHandle}
                        </span>
                        <span className="text-sm font-black text-gold">★ {review.rating.toFixed(1)}</span>
                      </div>
                      {review.reviewText ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-cornsilk/78 italic">
                          &quot;{review.reviewText}&quot;
                        </p>
                      ) : (
                        <p className="text-xs italic text-cornsilk/70">No written review for this film.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {sendState === "added" ? (
                  <>
                    <div className="ui-status-banner green">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-pine/20">
                        <CheckIcon className="h-4 w-4 text-cornsilk" />
                      </div>
                      <div>
                        <p className="text-sm font-extrabold text-cornsilk">Sent to Radarr</p>
                        <p className="mt-0.5 text-xs text-cornsilk/70">
                          {message || "Film successfully synchronized."}
                        </p>
                      </div>
                    </div>
                    <Button size="lg" variant="secondary" onClick={() => onSend(movie)}>
                      <ArrowPathIcon className="h-4 w-4" />
                      Resend to Radarr
                    </Button>
                    <Button size="lg" variant="danger" onClick={() => onRemove(movie)}>
                      <TrashIcon className="h-4 w-4" />
                      Remove from Radarr
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      isLoading={sendState === "loading"}
                      size="lg"
                      variant="primary"
                      onClick={() => onSend(movie)}
                    >
                      {sendState === "error" ? (
                        <ArrowPathIcon className="h-4 w-4" />
                      ) : (
                        <RadarrIcon className="h-4 w-4" />
                      )}
                      {sendState === "loading"
                        ? "Sending to Radarr…"
                        : sendState === "error"
                          ? "Retry add to Radarr"
                          : "Add to Radarr Library"}
                    </Button>

                    {sendState === "error" && message && (
                      <div className="ui-status-banner red">
                        <ExclamationIcon className="h-4 w-4 flex-shrink-0 text-rose-500" />
                        <span className="text-xs leading-relaxed text-rose-200">{message}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Star({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}
