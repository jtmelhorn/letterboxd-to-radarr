"use client";

import { ArrowPathIcon, ClockIcon, FilmIcon, GearIcon, InboxIcon } from "@/app/components/icons";
import { IconButton } from "@/app/components/ui";

const brandIconCls =
  "flex items-center justify-center rounded-2xl bg-pine text-ink shadow-lg shadow-pine/10";

export function DashboardNav({
  busy,
  activityUnreadCount,
  pendingApprovalCount,
  isRadarrSetup,
  onSyncFeed,
  onOpenActivity,
  onOpenApprovals,
  onOpenSettings,
}: {
  busy: boolean;
  activityUnreadCount: number;
  pendingApprovalCount: number;
  isRadarrSetup: boolean;
  onSyncFeed: () => void;
  onOpenActivity: () => void;
  onOpenApprovals: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 top-0 z-40 h-16 border-b border-white/10 bg-ink/90 backdrop-blur-xl">
      <div className="content-shell flex h-full items-center justify-between gap-4">
        <div className="flex flex-shrink-0 items-center gap-3">
          <div className={`${brandIconCls} h-9 w-9`}>
            <FilmIcon className="h-5 w-5" />
          </div>
          <span className="brand-wordmark text-lg">letterboxdarr</span>
        </div>

        <div className="flex items-center gap-2">
          <IconButton aria-label="Sync Letterboxd feed" disabled={busy} onClick={onSyncFeed}>
            <ArrowPathIcon className={`h-5 w-5 ${busy ? "animate-spin" : ""}`} />
          </IconButton>

          <IconButton aria-label="Open sync activity" onClick={onOpenActivity}>
            <ClockIcon className="h-5 w-5" />
            {activityUnreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-ink shadow">
                {activityUnreadCount > 99 ? "99+" : activityUnreadCount}
              </span>
            )}
          </IconButton>

          <IconButton aria-label="Open approval queue" onClick={onOpenApprovals}>
            <InboxIcon className="h-5 w-5" />
            {pendingApprovalCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-ink shadow">
                {pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}
              </span>
            )}
          </IconButton>

          <IconButton aria-label="Open settings" onClick={onOpenSettings}>
            <GearIcon className="h-5 w-5" />
            {!isRadarrSetup && (
              <span
                aria-label="Radarr setup needed"
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-gold ring-2 ring-ink"
              />
            )}
          </IconButton>
        </div>
      </div>
    </nav>
  );
}
