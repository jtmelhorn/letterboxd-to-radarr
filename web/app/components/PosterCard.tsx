"use client";

import { ArrowPathIcon, CheckIcon, RadarrIcon, TrashIcon, XIcon } from "@/app/components/icons";
import type { SendState } from "@/app/lib/format";
import type { AggregatedMovieDto } from "@/app/types/movie";

export function posterRingClass(state: SendState): string {
  if (state === "added") return "ring-2 ring-inset ring-chartreuse/80";
  if (state === "error") return "ring-2 ring-inset ring-rose-500/70";
  if (state === "loading") return "ring-2 ring-inset ring-gold/50 animate-pulse";
  return "ring-1 ring-inset ring-cornsilk/5";
}

export function PosterRadarrAction({
  movie,
  sendState,
  onSend,
  onRemove,
}: {
  movie: AggregatedMovieDto;
  sendState: SendState;
  onSend: (movie: AggregatedMovieDto) => void;
  onRemove?: (movie: AggregatedMovieDto) => void;
}) {
  if (sendState === "loading") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink/85 backdrop-blur-sm border border-cornsilk/10">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-cornsilk/30 border-t-cornsilk" />
      </span>
    );
  }

  if (sendState === "idle") {
    return (
      <div className="poster-reveal transition-opacity duration-200">
        <button
          aria-label={`Send ${movie.title} to Radarr`}
          className="poster-action-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSend(movie);
          }}
          type="button"
        >
          <RadarrIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="poster-swap-out transition-opacity duration-200">
        {sendState === "added" ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-chartreuse/90 border border-chartreuse/40">
            <CheckIcon className="h-3 w-3 text-ink" />
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 border border-rose-400/20">
            <XIcon className="h-2.5 w-2.5 text-cornsilk" />
          </div>
        )}
      </div>
      <div className="poster-hover-only absolute right-0 top-0 flex gap-1 transition-opacity duration-200">
        <button
          aria-label={sendState === "added" ? `Resend ${movie.title} to Radarr` : `Retry sending ${movie.title} to Radarr`}
          className="poster-action-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSend(movie);
          }}
          type="button"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" />
        </button>
        {sendState === "added" && onRemove && (
          <button
            aria-label={`Remove ${movie.title} from Radarr`}
            className="poster-action-btn border-rose-500/30 hover:bg-rose-500/15 hover:text-rose-300"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(movie);
            }}
            type="button"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
