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

const actionBase =
  "pointer-events-auto flex h-7 w-7 items-center justify-center rounded-xl border border-cornsilk/10 bg-ink/85 text-cornsilk shadow-sm backdrop-blur-md transition hover:border-pine hover:bg-pine hover:text-ink";

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
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-ink/85 backdrop-blur-md border border-cornsilk/10">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cornsilk/30 border-t-cornsilk" />
      </span>
    );
  }

  if (sendState === "idle") {
    return (
      <div className="poster-reveal transition-opacity duration-200">
        <button
          aria-label={`Send ${movie.title} to Radarr`}
          className={actionBase}
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
          <div className="ui-badge ui-badge-green">
            <CheckIcon className="h-3 w-3" />
          </div>
        ) : (
          <div className="ui-badge ui-badge-red">
            <XIcon className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className="poster-hover-only absolute right-0 top-0 flex gap-1.5 transition-opacity duration-200">
        <button
          aria-label={sendState === "added" ? `Resend ${movie.title} to Radarr` : `Retry sending ${movie.title} to Radarr`}
          className={actionBase}
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
            className={`${actionBase} hover:border-rose-500 hover:bg-rose-500 hover:text-white`}
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
