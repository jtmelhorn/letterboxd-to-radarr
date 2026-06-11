"use client";

import type { RefObject } from "react";

import {
  ArrowPathIcon,
  CheckIcon,
  ClockIcon,
  ExclamationIcon,
  InfoIcon,
  TrashIcon,
  XIcon,
} from "@/app/components/icons";
import { formatRelativeTime } from "@/app/lib/format";
import type { ActivityEntry, SendState } from "@/app/lib/format";

export function ActivityPanel({
  activityLog,
  filteredActivityLog,
  activitySearch,
  activityRetryNotices,
  sendStates,
  panelRef,
  onSearchChange,
  onClose,
  onRefresh,
  onClearRequest,
  onRetry,
}: {
  activityLog: ActivityEntry[];
  filteredActivityLog: ActivityEntry[];
  activitySearch: string;
  activityRetryNotices: Record<string, string>;
  sendStates: Record<string, SendState>;
  panelRef?: RefObject<HTMLElement | null>;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onRefresh: () => void;
  onClearRequest: () => void;
  onRetry: (entry: ActivityEntry) => void;
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
        aria-labelledby="activity-title"
        aria-modal="true"
        className="glass-modal animate-fade-in flex h-full w-full max-w-md flex-col border-l border-cornsilk/10 shadow-2xl"
        role="dialog"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
          <div>
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-cornsilk/70">
              Recent syncs
            </p>
            <h2 className="text-xl font-black tracking-tight text-cornsilk" id="activity-title">
              Sync Activity
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {activityLog.length > 0 && (
              <button
                aria-label="Clear activity"
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                onClick={onClearRequest}
                type="button"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
            <button
              aria-label="Refresh activity"
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
              onClick={onRefresh}
              type="button"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </button>
            <button
              aria-label="Close activity"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
              onClick={onClose}
              type="button"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-4 pb-1 pt-3">
          <input
            aria-label="Search sync activity"
            className="h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
            placeholder="Search by title, year, status, or message…"
            value={activitySearch}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {activityLog.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                <ClockIcon className="h-6 w-6" />
              </div>
              <h3 className="text-base font-extrabold text-cornsilk">No sync activity yet</h3>
              <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                Sync results appear here. The badge only highlights new failures that need attention.
              </p>
            </div>
          ) : filteredActivityLog.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                <ClockIcon className="h-6 w-6" />
              </div>
              <h3 className="text-base font-extrabold text-cornsilk">No activity matches</h3>
              <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                Try a different movie, year, status, or message.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredActivityLog.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 rounded-xl border border-cornsilk/5 bg-ink/30 p-3"
                >
                  <div
                    className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                      entry.outcome === "added"
                        ? "bg-pine/20 text-cornsilk"
                        : entry.outcome === "skipped"
                          ? "bg-azure/15 text-azure"
                          : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {entry.outcome === "added" ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : entry.outcome === "skipped" ? (
                      <InfoIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ExclamationIcon className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-sm font-bold text-cornsilk">
                        {entry.title}
                        {entry.year != null && (
                          <span className="ml-1 font-medium text-cornsilk/70">{entry.year}</span>
                        )}
                      </h4>
                    </div>
                    <p
                      className={`mt-0.5 line-clamp-2 text-xs leading-relaxed ${
                        entry.outcome === "added"
                          ? "text-cornsilk/60"
                          : entry.outcome === "skipped"
                            ? "text-azure/80"
                            : "text-rose-400/80"
                      }`}
                    >
                      {entry.message}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          entry.outcome === "skipped"
                            ? "bg-azure/10 text-azure border border-azure/20"
                            : entry.auto
                            ? "bg-granite/20 text-cornsilk/75 border border-granite/30"
                            : "bg-cornsilk/5 text-cornsilk/70 border border-cornsilk/5"
                        }`}
                      >
                        {entry.outcome === "skipped" ? "Skipped" : entry.auto ? "Auto" : "Manual"}
                      </span>
                      <span className="text-[11px] text-cornsilk/70">{formatRelativeTime(entry.at)}</span>
                      {entry.outcome === "error" && (entry.filmId != null || entry.reviewId != null) && (
                        <button
                          className="ml-auto rounded-md border border-cornsilk/10 bg-ink/60 px-2 py-0.5 text-[11px] font-bold text-cornsilk/80 transition hover:border-gold/30 hover:text-cornsilk disabled:opacity-50"
                          disabled={entry.filmId != null && sendStates[entry.filmId] === "loading"}
                          onClick={() => onRetry(entry)}
                          type="button"
                        >
                          {entry.filmId != null && sendStates[entry.filmId] === "loading"
                            ? "Sending…"
                            : "Retry"}
                        </button>
                      )}
                    </div>
                    {activityRetryNotices[entry.id] && (
                      <p className="mt-1 text-[11px] text-azure/80">{activityRetryNotices[entry.id]}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
