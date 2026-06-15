"use client";

import type { RefObject } from "react";

import type { AggregatedMovieDto } from "@/app/types/movie";
import { Button } from "@/app/components/ui";

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
        className="modal-shell w-full max-w-sm rounded-[var(--radius-card)] p-5"
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
          <Button disabled={isRemoving} variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={isRemoving} variant="danger" onClick={onConfirm}>
            {isRemoving ? "Removing..." : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}
