"use client";

import type { RefObject } from "react";

import {
  ArrowPathIcon,
  CheckIcon,
  ClockIcon,
  ExclamationIcon,
  InfoIcon,
  TrashIcon,
} from "@/app/components/icons";
import { Badge, DrawerHeader, EmptyState, IconButton, Input } from "@/app/components/ui";
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
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        aria-labelledby="activity-title"
        aria-modal="true"
        className="drawer-shell animate-fade-in w-full max-w-md"
        role="dialog"
      >
        <DrawerHeader
          closeLabel="Close activity"
          eyebrow="Recent syncs"
          onClose={onClose}
          title="Sync Activity"
          titleId="activity-title"
        >
          {activityLog.length > 0 && (
            <IconButton aria-label="Clear activity" onClick={onClearRequest}>
              <TrashIcon className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton aria-label="Refresh activity" onClick={onRefresh}>
            <ArrowPathIcon className="h-4 w-4" />
          </IconButton>
        </DrawerHeader>

        <div className="px-4 pb-2 pt-3">
          <Input
            aria-label="Search sync activity"
            className="ui-input-sm"
            placeholder="Search by title, year, status, or message…"
            value={activitySearch}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {activityLog.length === 0 ? (
            <EmptyState
              description="Sync results appear here. The badge only highlights new failures that need attention."
              icon={<ClockIcon className="h-6 w-6" />}
              title="No sync activity yet"
            />
          ) : filteredActivityLog.length === 0 ? (
            <EmptyState
              description="Try a different movie, year, status, or message."
              icon={<ClockIcon className="h-6 w-6" />}
              title="No activity matches"
            />
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
                    <h4 className="truncate text-sm font-bold text-cornsilk">
                      {entry.title}
                      {entry.year != null && (
                        <span className="ml-1 font-medium text-cornsilk/70">{entry.year}</span>
                      )}
                    </h4>
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
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          entry.outcome === "skipped"
                            ? "blue"
                            : entry.auto
                              ? "slate"
                              : "slate"
                        }
                      >
                        {entry.outcome === "skipped" ? "Skipped" : entry.auto ? "Auto" : "Manual"}
                      </Badge>
                      <span className="text-[11px] text-cornsilk/70">{formatRelativeTime(entry.at)}</span>
                      {entry.outcome === "error" && (entry.filmId != null || entry.reviewId != null) && (
                        <button
                          className="ui-btn ui-btn-secondary ui-btn-sm ml-auto"
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
