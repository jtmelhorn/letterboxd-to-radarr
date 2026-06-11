"use client";

import { useState, type RefObject } from "react";

import { formatRelativeTime } from "@/app/lib/format";
import { ArrowPathIcon, InboxIcon, XIcon } from "@/app/components/icons";
import type { PendingApprovalDto } from "@/app/types/movie";




export function pendingApprovalMatchesSearch(approval: PendingApprovalDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    approval.title.toLowerCase().includes(q) ||
    (typeof approval.year === "number" && String(approval.year).includes(q)) ||
    approval.groupName.toLowerCase().includes(q) ||
    approval.status.toLowerCase().includes(q)
  );
}

type RowAction = "approve" | "reject" | "reject_blocklist" | "reset";

export interface ApprovalsPanelProps {
  approvals: PendingApprovalDto[];
  panelRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onRefresh: () => void;
  /** Each action resolves to null on success or an error message to render inline. */
  onApprove: (approval: PendingApprovalDto) => Promise<string | null>;
  onReject: (approval: PendingApprovalDto) => Promise<string | null>;
  onRejectAndBlocklist: (approval: PendingApprovalDto) => Promise<string | null>;
  onReset: (approval: PendingApprovalDto) => Promise<string | null>;
}

export function ApprovalsPanel({
  approvals,
  panelRef,
  onClose,
  onRefresh,
  onApprove,
  onReject,
  onRejectAndBlocklist,
  onReset,
}: ApprovalsPanelProps) {
  const [search, setSearch] = useState("");
  const [busyRows, setBusyRows] = useState<Record<number, RowAction>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const matching = approvals.filter((approval) => pendingApprovalMatchesSearch(approval, search));
  const pending = matching.filter((approval) => approval.status === "pending");
  const resolved = matching.filter((approval) => approval.status !== "pending");

  async function runRowAction(
    approval: PendingApprovalDto,
    action: RowAction,
    handler: (approval: PendingApprovalDto) => Promise<string | null>,
  ) {
    setBusyRows((current) => ({ ...current, [approval.id]: action }));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[approval.id];
      return next;
    });
    try {
      const error = await handler(approval);
      if (error) {
        setRowErrors((current) => ({ ...current, [approval.id]: error }));
      }
    } finally {
      setBusyRows((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
    }
  }

  function rowMeta(approval: PendingApprovalDto): string {
    const at = Date.parse(approval.status === "pending" ? approval.createdAt : approval.updatedAt);
    const when = Number.isNaN(at) ? "" : ` · ${formatRelativeTime(at)}`;
    return `${approval.groupName} · Avg ${approval.averageRating.toFixed(1)} ★${when}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-all duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        aria-labelledby="approvals-title"
        aria-modal="true"
        className="glass-modal animate-fade-in flex h-full w-full max-w-md flex-col border-l border-cornsilk/10 shadow-2xl"
        role="dialog"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
          <div>
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-cornsilk/70">
              Manual approvals
            </p>
            <h2 className="text-xl font-black tracking-tight text-cornsilk" id="approvals-title">
              Approval Queue
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Refresh approval queue"
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
              onClick={onRefresh}
              type="button"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </button>
            <button
              aria-label="Close approval queue"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
              onClick={onClose}
              type="button"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-1">
          <input
            aria-label="Search approvals"
            className="h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
            placeholder="Search by title, year, group, or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {approvals.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                <InboxIcon className="h-6 w-6" />
              </div>
              <h3 className="text-base font-extrabold text-cornsilk">No approvals yet</h3>
              <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                Movies from groups that require manual approval will wait here before being sent to
                Radarr.
              </p>
            </div>
          ) : matching.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <h3 className="text-base font-extrabold text-cornsilk">No approvals match</h3>
              <p className="mt-1 max-w-xs text-xs text-cornsilk/70">
                Try a different title, year, group, or status.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-2">
                {pending.map((approval) => {
                  const busyAction = busyRows[approval.id];
                  const error = rowErrors[approval.id];
                  return (
                    <li
                      key={approval.id}
                      className="flex flex-col gap-3 rounded-xl border border-cornsilk/10 bg-ink/30 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-cornsilk">
                          {approval.title}
                          {approval.year != null && (
                            <span className="ml-1 font-medium text-cornsilk/70">{approval.year}</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-cornsilk/60">{rowMeta(approval)}</p>
                        {error && (
                          <p className="mt-1 text-xs text-rose-300/90" role="alert">
                            {error}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="h-9 rounded-[var(--radius-control)] bg-pine px-3 text-xs font-bold text-ink transition hover:bg-pine/90 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(busyAction)}
                          onClick={() => void runRowAction(approval, "approve", onApprove)}
                          type="button"
                        >
                          {busyAction === "approve" ? "Approving…" : "Approve"}
                        </button>
                        <button
                          className="h-9 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/70 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(busyAction)}
                          onClick={() => void runRowAction(approval, "reject", onReject)}
                          type="button"
                        >
                          {busyAction === "reject" ? "Rejecting…" : "Reject"}
                        </button>
                        <button
                          className="h-9 rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 text-xs font-bold text-rose-200 transition hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            void runRowAction(approval, "reject_blocklist", onRejectAndBlocklist)
                          }
                          type="button"
                        >
                          {busyAction === "reject_blocklist" ? "Blocking…" : "Reject + blocklist"}
                        </button>
                      </div>
                    </li>
                  );
                })}
                {pending.length === 0 && (
                  <li className="rounded-xl border border-cornsilk/10 bg-ink/30 px-3 py-3 text-xs text-cornsilk/70">
                    No movies are waiting for approval.
                  </li>
                )}
              </ul>

              {resolved.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-cornsilk/55">
                    Recently resolved
                  </p>
                  <ul className="space-y-2">
                    {resolved.map((approval) => {
                      const busyAction = busyRows[approval.id];
                      const error = rowErrors[approval.id];
                      const chip =
                        approval.status === "approved"
                          ? "border-pine/30 bg-pine/10 text-chartreuse"
                          : approval.status === "error"
                            ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
                            : "border-cornsilk/15 bg-black/20 text-cornsilk/70";
                      return (
                        <li
                          key={approval.id}
                          className="flex flex-col gap-2 rounded-xl border border-cornsilk/5 bg-ink/20 p-3 opacity-70"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-cornsilk">
                                {approval.title}
                                {approval.year != null && (
                                  <span className="ml-1 font-medium text-cornsilk/70">
                                    {approval.year}
                                  </span>
                                )}
                              </p>
                              <p className="mt-1 text-xs text-cornsilk/60">{rowMeta(approval)}</p>
                              {approval.message && (
                                <p className="mt-1 text-xs text-cornsilk/65">{approval.message}</p>
                              )}
                              {error && (
                                <p className="mt-1 text-xs text-rose-300/90" role="alert">
                                  {error}
                                </p>
                              )}
                            </div>
                            <span
                              className={`w-fit flex-shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${chip}`}
                            >
                              {approval.status}
                            </span>
                          </div>
                          {(approval.status === "rejected" || approval.status === "error") && (
                            <button
                              className="h-8 w-fit rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/70 transition hover:border-white/20 hover:text-cornsilk disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={Boolean(busyAction)}
                              onClick={() => void runRowAction(approval, "reset", onReset)}
                              type="button"
                            >
                              {busyAction === "reset" ? "Resetting…" : "Reset"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
