"use client";

import type { RefObject } from "react";

import type { AggregatedMovieDto } from "@/app/types/movie";

export function RemoveMovieDialog({
  movie,
  deleteFiles,
  blockFutureSync,
  isRemoving,
  removeError,
  dialogRef,
  onDeleteFilesChange,
  onBlockFutureSyncChange,
  onCancel,
  onConfirm,
}: {
  movie: AggregatedMovieDto;
  deleteFiles: boolean;
  blockFutureSync: boolean;
  isRemoving: boolean;
  removeError: string | null;
  dialogRef?: RefObject<HTMLDivElement | null>;
  onDeleteFilesChange: (value: boolean) => void;
  onBlockFutureSyncChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        aria-modal="true"
        className="glass-modal w-full max-w-sm rounded-[var(--radius-card)] border border-cornsilk/10 p-5 shadow-2xl"
        role="dialog"
      >
        <h3 className="text-base font-extrabold text-cornsilk">Remove from Radarr?</h3>
        <p className="mt-2 text-sm text-cornsilk/70">
          This will remove <strong className="text-cornsilk">{movie.title}</strong>
          {movie.year != null && <span className="text-cornsilk/70"> ({movie.year})</span>} from your
          Radarr library.
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              checked={deleteFiles}
              className="mt-0.5 h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
              onChange={(e) => onDeleteFilesChange(e.target.checked)}
              type="checkbox"
            />
            <div>
              <span className="text-sm font-bold text-cornsilk/80">Also delete files from disk</span>
              <p className="mt-0.5 text-xs text-cornsilk/70">
                Deletes the movie folder and files through Radarr.
              </p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              checked={blockFutureSync}
              className="mt-0.5 h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
              onChange={(e) => onBlockFutureSyncChange(e.target.checked)}
              type="checkbox"
            />
            <div>
              <span className="text-sm font-bold text-cornsilk/80">Block this movie from future auto-sync</span>
              <p className="mt-0.5 text-xs text-cornsilk/70">
                Prevents this app from adding the movie again during future syncs.
              </p>
            </div>
          </label>
        </div>

        {removeError && (
          <p
            className="mt-4 rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200"
            role="alert"
          >
            {removeError}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="h-9 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-4 text-xs font-bold text-cornsilk/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-cornsilk"
            disabled={isRemoving}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-9 rounded-[var(--radius-control)] bg-rose-500 px-4 text-xs font-bold text-white transition hover:bg-rose-600 disabled:opacity-50"
            disabled={isRemoving}
            onClick={onConfirm}
            type="button"
          >
            {isRemoving ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
