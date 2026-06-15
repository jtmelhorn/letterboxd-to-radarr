"use client";

import { useState, type RefObject } from "react";

import { formatRelativeTime } from "@/app/lib/format";
import { ArrowPathIcon, InboxIcon } from "@/app/components/icons";
import { Badge, Button, DrawerHeader, EmptyState, IconButton, Input } from "@/app/components/ui";
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
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        aria-labelledby="approvals-title"
        aria-modal="true"
        className="drawer-shell animate-fade-in w-full max-w-md"
        role="dialog"
      >
        <DrawerHeader
          closeLabel="Close approval queue"
          eyebrow="Manual approvals"
          onClose={onClose}
          title="Approval Queue"
          titleId="approvals-title"
        >
          <IconButton aria-label="Refresh approval queue" onClick={onRefresh}>
            <ArrowPathIcon className="h-4 w-4" />
          </IconButton>
        </DrawerHeader>

        <div className="px-4 pb-2 pt-3">
          <Input
            aria-label="Search approvals"
            className="ui-input-sm"
            placeholder="Search by title, year, group, or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {approvals.length === 0 ? (
            <EmptyState
              description="Movies from groups that require manual approval will wait here before being sent to Radarr."
              icon={<InboxIcon className="h-6 w-6" />}
              title="No approvals yet"
            />
          ) : matching.length === 0 ? (
            <EmptyState
              description="Try a different title, year, group, or status."
              icon={<InboxIcon className="h-6 w-6" />}
              title="No approvals match"
            />
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
                        <Button
                          disabled={Boolean(busyAction)}
                          size="sm"
                          variant="primary"
                          onClick={() => void runRowAction(approval, "approve", onApprove)}
                        >
                          {busyAction === "approve" ? "Approving…" : "Approve"}
                        </Button>
                        <Button
                          disabled={Boolean(busyAction)}
                          size="sm"
                          variant="secondary"
                          onClick={() => void runRowAction(approval, "reject", onReject)}
                        >
                          {busyAction === "reject" ? "Rejecting…" : "Reject"}
                        </Button>
                        <Button
                          disabled={Boolean(busyAction)}
                          size="sm"
                          variant="danger"
                          onClick={() => void runRowAction(approval, "reject_blocklist", onRejectAndBlocklist)}
                        >
                          {busyAction === "reject_blocklist" ? "Blocking…" : "Reject + blocklist"}
                        </Button>
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
                      const tone =
                        approval.status === "approved"
                          ? "green"
                          : approval.status === "error"
                            ? "red"
                            : "slate";
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
                            <Badge tone={tone} className="capitalize">
                              {approval.status}
                            </Badge>
                          </div>
                          {(approval.status === "rejected" || approval.status === "error") && (
                            <Button
                              disabled={Boolean(busyAction)}
                              size="sm"
                              variant="secondary"
                              onClick={() => void runRowAction(approval, "reset", onReset)}
                            >
                              {busyAction === "reset" ? "Resetting…" : "Reset"}
                            </Button>
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
