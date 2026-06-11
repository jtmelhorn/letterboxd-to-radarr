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
import { movieGenres, UNKNOWN_GENRE } from "@/app/lib/format";
import type { SendState } from "@/app/lib/format";
import type { AggregatedMovieDto } from "@/app/types/movie";

const primaryBtnCls =
  "rounded-[var(--radius-control)] bg-pine text-ink font-bold transition hover:bg-pine/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-pine/35 disabled:cursor-not-allowed disabled:opacity-50";

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        aria-labelledby="movie-detail-title"
        aria-modal="true"
        className="glass-modal animate-fade-in flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden rounded-t-3xl border border-cornsilk/10 shadow-2xl transition-all sm:max-w-4xl sm:rounded-[var(--radius-card)]"
        role="dialog"
      >
        {/* Header bar */}
        <div className="flex flex-shrink-0 items-center justify-between px-6 py-4 border-b border-cornsilk/5">
          {movie.letterboxdUrl ? (
            <a
              className="inline-flex items-center gap-1 rounded-full bg-ink/60 px-3 py-1 text-xs font-bold text-cornsilk/80 backdrop-blur-md border border-cornsilk/5 hover:bg-ink transition-all hover:text-cornsilk"
              href={movie.letterboxdUrl}
              rel="noreferrer"
              target="_blank"
            >
              Letterboxd ↗
            </a>
          ) : (
            <div />
          )}

          <button
            aria-label="Close details"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-cornsilk/60 backdrop-blur-sm border border-cornsilk/5 transition hover:text-cornsilk hover:bg-ink"
            onClick={onClose}
            type="button"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
            <aside className="modal-movie-card md:sticky md:top-0">
              <div className="modal-poster-frame">
                {movie.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={movie.posterUrl} />
                ) : (
                  <div className="modal-poster-placeholder">
                    <FilmIcon className="h-12 w-12 text-cornsilk/45" />
                  </div>
                )}
              </div>
              <div className="px-1 pt-3 text-center">
                <h2
                  className="text-base font-extrabold leading-tight text-cornsilk tracking-tight"
                  id="movie-detail-title"
                >
                  {movie.title}
                </h2>
                <p className="mt-1 text-xs font-semibold text-cornsilk/60">
                  {movie.year ?? "Unknown year"}
                </p>
              </div>
            </aside>

            <section className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-cornsilk/10 bg-ink/20">
              <div className="flex items-start justify-between gap-4 border-b border-cornsilk/5 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-cornsilk/70">
                    Reviewer notes
                  </p>
                </div>

                <div className="flex flex-shrink-0 flex-col items-end">
                  <span className="flex items-center gap-1 text-xl font-black text-gold">
                    ★ {movie.averageRating.toFixed(1)}
                  </span>
                  <span className="text-[11px] font-medium text-cornsilk/70">
                    {movie.reviewerCount} reviewer{movie.reviewerCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="space-y-4 border-b border-cornsilk/5 px-4 py-5 sm:px-5">
                <div className="rounded-xl border border-cornsilk/10 bg-black/15 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-cornsilk/70">
                        Genres
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {movieGenres(movie).map((genre) => (
                          <span
                            key={genre}
                            className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                              genre === UNKNOWN_GENRE
                                ? "border-cornsilk/10 bg-cornsilk/5 text-cornsilk/60"
                                : "border-pine/25 bg-pine/10 text-chartreuse"
                            }`}
                          >
                            {genre}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-cornsilk/10 bg-ink/60 px-3 text-xs font-bold text-cornsilk/75 transition hover:border-gold/30 hover:bg-ink hover:text-cornsilk disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={metadataRefreshing}
                      onClick={() => onRefreshMetadata(movie)}
                      type="button"
                    >
                      {metadataRefreshing ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cornsilk/25 border-t-cornsilk" />
                      ) : (
                        <ArrowPathIcon className="h-3.5 w-3.5" />
                      )}
                      Refresh metadata
                    </button>
                  </div>
                  {metadataMessage && (
                    <p className="mt-3 text-xs leading-relaxed text-cornsilk/60">
                      {metadataMessage}
                    </p>
                  )}
                </div>

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

              <div className="bg-ink/40 px-4 py-5 sm:px-5">
                {sendState === "added" ? (
                  <div className="space-y-3 animate-fade-in">
                    <div className="flex items-center gap-3.5 rounded-xl border border-chartreuse/30 bg-chartreuse/10 p-4">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-chartreuse">
                        <CheckIcon className="h-4 w-4 text-ink" />
                      </div>
                      <div>
                        <p className="text-sm font-extrabold text-cornsilk">Sent to Radarr</p>
                        <p className="mt-0.5 text-xs text-cornsilk/70">
                          {message || "Film successfully synchronized."}
                        </p>
                      </div>
                    </div>
                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-cornsilk/10 bg-ink/60 py-3 text-sm font-bold text-cornsilk transition hover:border-gold/30 hover:bg-ink focus:outline-none focus:ring-2 focus:ring-gold/40"
                      onClick={() => onSend(movie)}
                      type="button"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      Resend to Radarr
                    </button>
                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 py-3 text-sm font-bold text-rose-300 transition hover:border-rose-500/40 hover:bg-rose-500/20 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                      onClick={() => onRemove(movie)}
                      type="button"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Remove from Radarr
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      className={`${primaryBtnCls} flex w-full items-center justify-center gap-2 py-3.5 text-sm font-extrabold`}
                      disabled={sendState === "loading"}
                      onClick={() => onSend(movie)}
                      type="button"
                    >
                      {sendState === "loading" ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                          Sending to Radarr…
                        </>
                      ) : sendState === "error" ? (
                        <>
                          <ArrowPathIcon className="h-4 w-4" />
                          Retry add to Radarr
                        </>
                      ) : (
                        <>
                          <RadarrIcon className="h-4 w-4" />
                          Add to Radarr Library
                        </>
                      )}
                    </button>

                    {sendState === "error" && message && (
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-center text-xs text-rose-400 animate-fade-in flex items-start gap-2">
                        <ExclamationIcon className="h-4 w-4 flex-shrink-0 text-rose-500" />
                        <span className="text-left leading-relaxed">{message}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
