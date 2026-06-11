"use client";

import { useEffect, useState } from "react";
import type { DragEvent } from "react";

import {
  draftToSyncFilters,
  filtersToDraft,
  SyncFilterControls,
  validateSyncFilterDraft,
} from "@/app/components/SyncFilterControls";
import type { SyncFilterDraft } from "@/app/components/SyncFilterControls";
import { formatRelativeTime } from "@/app/lib/format";
import type { ReviewerDto, ReviewerGroupDto, SyncInterval } from "@/app/types/movie";

type GroupUpdate = Partial<
  Pick<
    ReviewerGroupDto,
    | "name"
    | "enabled"
    | "ratingThreshold"
    | "syncInterval"
    | "requiresManualApproval"
    | "filters"
    | "reviewerHandles"
  >
>;

interface SyncConfigurationPanelProps {
  reviewers: ReviewerDto[];
  reviewerGroups: ReviewerGroupDto[];
  genreOptions: string[];
  pendingApprovalCount: number;
  ratingOptions: number[];
  syncIntervalOptions: Array<{ value: SyncInterval; label: string }>;
  /** True when SYNC_CRON globally overrides per-group sync intervals. */
  syncCronOverride?: boolean;
  onAddReviewer: (handle: string) => Promise<boolean>;
  onRemoveReviewer: (handle: string) => Promise<void>;
  onCreateGroup: (input: { name: string; ratingThreshold: number }) => Promise<boolean>;
  onSaveGroup: (group: ReviewerGroupDto, update: GroupUpdate) => Promise<boolean>;
  onDeleteGroup: (group: ReviewerGroupDto) => Promise<void>;
}

interface DraggedReviewer {
  handle: string;
  source: "pool" | "group";
  groupId?: number;
}

interface GroupDraft {
  name: string;
  enabled: boolean;
  ratingThreshold: number;
  syncInterval: SyncInterval;
  requiresManualApproval: boolean;
  filters: SyncFilterDraft;
}



const inputCls =
  "h-11 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-4 text-sm text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25 disabled:cursor-not-allowed disabled:opacity-60";
const smallInputCls =
  "h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25 disabled:cursor-not-allowed disabled:opacity-60";
const primaryBtnCls =
  "rounded-[var(--radius-control)] bg-pine text-ink font-bold transition hover:bg-pine/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-pine/35 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnCls =
  "rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 font-bold text-cornsilk/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-cornsilk disabled:cursor-not-allowed disabled:opacity-45";
const dangerBtnCls =
  "rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 font-bold text-cornsilk/65 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-45";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-cornsilk/70";
const helperCls = "text-xs leading-relaxed text-cornsilk/70";

function lastSyncedLabel(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "Never synced";
  const at = Date.parse(lastSyncedAt);
  return Number.isNaN(at) ? "Never synced" : `Last synced ${formatRelativeTime(at)}`;
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ratingOptionLabel(rating: number): string {
  return rating === -1 ? "Disabled (no auto-sync)" : `Avg >= ${rating.toFixed(1)} stars`;
}

function draftFromGroup(group: ReviewerGroupDto): GroupDraft {
  return {
    name: group.name,
    enabled: group.enabled,
    ratingThreshold: group.ratingThreshold ?? group.autoThreshold,
    syncInterval: group.syncInterval,
    requiresManualApproval: group.requiresManualApproval,
    filters: filtersToDraft(group.filters),
  };
}

function ReviewerChip({
  handle,
  draggable,
  onDragEnd,
  onDragStart,
  onRemove,
}: {
  handle: string;
  draggable: boolean;
  onDragEnd?: () => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`group flex max-w-full items-center gap-1.5 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/25 px-2.5 py-1.5 text-xs font-bold text-cornsilk/80 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      draggable={draggable}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      <span className="truncate">@{handle}</span>
      {onRemove && (
        <button
          aria-label={`Remove @${handle}`}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-cornsilk/70 transition hover:bg-rose-500/15 hover:text-rose-300"
          type="button"
          onClick={onRemove}
        >
          <XIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function SyncConfigurationPanel({
  genreOptions,
  pendingApprovalCount,
  ratingOptions,
  reviewerGroups,
  reviewers,
  syncIntervalOptions,
  syncCronOverride = false,
  onAddReviewer,
  onCreateGroup,
  onDeleteGroup,
  onRemoveReviewer,
  onSaveGroup,
}: SyncConfigurationPanelProps) {
  const [newReviewerInput, setNewReviewerInput] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupThreshold, setNewGroupThreshold] = useState(4);
  const [draggedReviewer, setDraggedReviewer] = useState<DraggedReviewer | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<"pool" | number | null>(null);
  const [groupDrafts, setGroupDrafts] = useState<Record<number, GroupDraft>>({});
  const [groupErrors, setGroupErrors] = useState<Record<number, string | null>>({});
  const [savingGroupId, setSavingGroupId] = useState<number | null>(null);

  useEffect(() => {
    setGroupDrafts(
      Object.fromEntries(reviewerGroups.map((group) => [group.id, draftFromGroup(group)])) as Record<
        number,
        GroupDraft
      >,
    );
    setGroupErrors({});
  }, [reviewerGroups]);

  function updateDraft(groupId: number, updater: (draft: GroupDraft) => GroupDraft) {
    setGroupDrafts((current) => {
      const group = reviewerGroups.find((candidate) => candidate.id === groupId);
      const existing = current[groupId] ?? (group ? draftFromGroup(group) : null);
      if (!existing) return current;
      return { ...current, [groupId]: updater(existing) };
    });
    setGroupErrors((current) => ({ ...current, [groupId]: null }));
  }

  async function addReviewer() {
    const handle = newReviewerInput.trim();
    if (!handle) return;
    if (await onAddReviewer(handle)) {
      setNewReviewerInput("");
    }
  }

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    if (await onCreateGroup({ name, ratingThreshold: newGroupThreshold })) {
      setNewGroupName("");
      setNewGroupThreshold(4);
    }
  }

  function startReviewerDrag(event: DragEvent<HTMLElement>, payload: DraggedReviewer) {
    setDraggedReviewer(payload);
    event.dataTransfer.effectAllowed = payload.source === "pool" ? "copy" : "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.handle);
  }

  function draggedReviewerFromEvent(event: DragEvent<HTMLElement>): DraggedReviewer | null {
    if (draggedReviewer) return draggedReviewer;
    try {
      const data = event.dataTransfer.getData("application/json");
      return data ? (JSON.parse(data) as DraggedReviewer) : null;
    } catch {
      return null;
    }
  }

  async function dropReviewerOnGroup(event: DragEvent<HTMLElement>, group: ReviewerGroupDto) {
    event.preventDefault();
    const payload = draggedReviewerFromEvent(event);
    setActiveDropZone(null);
    setDraggedReviewer(null);
    if (!payload) return;
    if (payload.source === "group" && payload.groupId === group.id) return;

    const targetSaved = group.reviewerHandles.includes(payload.handle)
      ? true
      : await onSaveGroup(group, { reviewerHandles: [...group.reviewerHandles, payload.handle] });
    if (!targetSaved) return;

    if (payload.source === "group" && typeof payload.groupId === "number") {
      const sourceGroup = reviewerGroups.find((candidate) => candidate.id === payload.groupId);
      if (sourceGroup) {
        await onSaveGroup(sourceGroup, {
          reviewerHandles: sourceGroup.reviewerHandles.filter((handle) => handle !== payload.handle),
        });
      }
    }
  }

  async function dropReviewerOnPool(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const payload = draggedReviewerFromEvent(event);
    setActiveDropZone(null);
    setDraggedReviewer(null);
    if (!payload || payload.source !== "group") return;
    const group = reviewerGroups.find((candidate) => candidate.id === payload.groupId);
    if (!group) return;
    await onSaveGroup(group, {
      reviewerHandles: group.reviewerHandles.filter((handle) => handle !== payload.handle),
    });
  }

  async function saveGroupDraft(group: ReviewerGroupDto) {
    const draft = groupDrafts[group.id] ?? draftFromGroup(group);
    const filterError = validateSyncFilterDraft(draft.filters);
    if (filterError) {
      setGroupErrors((current) => ({ ...current, [group.id]: filterError }));
      return;
    }

    const name = draft.name.trim();
    if (!name) {
      setGroupErrors((current) => ({ ...current, [group.id]: "Group name is required." }));
      return;
    }

    setSavingGroupId(group.id);
    try {
      const saved = await onSaveGroup(group, {
        name,
        enabled: draft.enabled,
        ratingThreshold: draft.ratingThreshold,
        syncInterval: draft.syncInterval,
        requiresManualApproval: draft.requiresManualApproval,
        filters: draftToSyncFilters(draft.filters),
      });
      if (saved) setGroupErrors((current) => ({ ...current, [group.id]: null }));
    } catch (error) {
      setGroupErrors((current) => ({
        ...current,
        [group.id]: error instanceof Error ? error.message : "Unable to save reviewer group.",
      }));
    } finally {
      setSavingGroupId(null);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
      <div className="mb-4 space-y-1">
        <h3 className="text-base font-extrabold tracking-tight text-cornsilk">Sync Configuration</h3>
        <p className={helperCls}>
          Add reviewers, assign them to sync groups, and configure thresholds, timing, approval, and filters in one flow.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]">
        <aside className="space-y-4">
          <div className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className={labelCls}>Reviewer pool</p>
                <p className="mt-1 text-[11px] leading-relaxed text-cornsilk/70">
                  Reviewers here can be added to custom groups.
                </p>
              </div>
              {pendingApprovalCount > 0 && (
                <span className="rounded-full border border-gold/20 bg-gold/10 px-2 py-0.5 text-[11px] font-bold text-gold">
                  {pendingApprovalCount} pending
                </span>
              )}
            </div>

            <div className="mb-3 grid grid-cols-1 gap-2">
              <input
                className={inputCls}
                placeholder="letterboxd-handle"
                value={newReviewerInput}
                onChange={(event) => setNewReviewerInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addReviewer();
                  }
                }}
              />
              <button
                className={`${primaryBtnCls} h-10 px-4 text-sm`}
                disabled={!newReviewerInput.trim()}
                type="button"
                onClick={() => void addReviewer()}
              >
                Add reviewer
              </button>
            </div>

            <div
              className={`min-h-28 rounded-[var(--radius-control)] border border-dashed p-3 transition ${
                activeDropZone === "pool" ? "border-pine/70 bg-pine/10" : "border-cornsilk/10 bg-black/15"
              }`}
              onDragLeave={() => setActiveDropZone(null)}
              onDragOver={(event) => {
                event.preventDefault();
                setActiveDropZone("pool");
              }}
              onDrop={(event) => void dropReviewerOnPool(event)}
            >
              <div className="flex flex-wrap gap-2">
                {reviewers.map((reviewer) => (
                  <ReviewerChip
                    key={reviewer.handle}
                    draggable
                    handle={reviewer.handle}
                    onDragEnd={() => {
                      setDraggedReviewer(null);
                      setActiveDropZone(null);
                    }}
                    onDragStart={(event) => startReviewerDrag(event, { handle: reviewer.handle, source: "pool" })}
                    onRemove={() => void onRemoveReviewer(reviewer.handle)}
                  />
                ))}
                {reviewers.length === 0 && (
                  <span className="text-xs text-cornsilk/70">No reviewers added yet.</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 p-3">
            <p className={labelCls}>Create group</p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <input
                className={inputCls}
                placeholder="Group name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
              />
              <select
                className={inputCls}
                value={newGroupThreshold}
                onChange={(event) => setNewGroupThreshold(Number(event.target.value))}
              >
                {ratingOptions.map((rating) => (
                  <option key={rating} value={rating}>
                    {ratingOptionLabel(rating)}
                  </option>
                ))}
              </select>
              <button
                className={`${primaryBtnCls} h-10 px-4 text-sm`}
                disabled={!newGroupName.trim()}
                type="button"
                onClick={() => void createGroup()}
              >
                Create group
              </button>
            </div>
          </div>
        </aside>

        <div className="space-y-3">
          <div>
            <p className={labelCls}>Sync groups</p>
            <p className="mt-1 text-[11px] leading-relaxed text-cornsilk/70">
              Enabled groups control sync timing, threshold, approvals, and movie filters. Custom groups are optional.
            </p>
            {syncCronOverride && (
              <p className="mt-1 text-[11px] font-bold leading-relaxed text-gold/90">
                Background schedule overridden by SYNC_CRON — every enabled group runs on that
                global cron and per-group intervals are ignored for scheduled syncs.
              </p>
            )}
          </div>

          {reviewerGroups.map((group) => {
            const draft = groupDrafts[group.id] ?? draftFromGroup(group);
            const isDirty = JSON.stringify(draft) !== JSON.stringify(draftFromGroup(group));

            return (
              <article
                key={group.id}
                className={`rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 p-3 text-xs text-cornsilk/70 ${
                  draft.enabled ? "" : "opacity-80"
                }`}
              >
                <div className="space-y-3">
                  <p className="text-[11px] text-cornsilk/55">{lastSyncedLabel(group.lastSyncedAt)}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                    <label className="space-y-1">
                      <span className={labelCls}>Group name</span>
                      <input
                        aria-label={`${group.name} group name`}
                        className={`${smallInputCls} font-extrabold`}
                        value={draft.name}
                        onChange={(event) =>
                          updateDraft(group.id, (current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </label>
                    <label className="mt-5 flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/75 transition hover:border-white/20 hover:bg-white/[0.05]">
                      <input
                        checked={draft.enabled}
                        className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                        type="checkbox"
                        onChange={(event) =>
                          updateDraft(group.id, (current) => ({
                            ...current,
                            enabled: event.target.checked,
                          }))
                        }
                      />
                      <span>{draft.enabled ? "Enabled" : "Disabled"}</span>
                    </label>
                    <button
                      aria-label={`Delete ${group.name}`}
                      className={`${dangerBtnCls} mt-5 flex h-9 w-full items-center justify-center gap-2 px-3 text-xs sm:w-auto`}
                      type="button"
                      onClick={() => void onDeleteGroup(group)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <label className="space-y-1">
                      <span className={labelCls}>Threshold</span>
                      <select
                        className={smallInputCls}
                        value={draft.ratingThreshold}
                        onChange={(event) =>
                          updateDraft(group.id, (current) => ({
                            ...current,
                            ratingThreshold: Number(event.target.value),
                          }))
                        }
                      >
                        {ratingOptions.map((rating) => (
                          <option key={rating} value={rating}>
                            {ratingOptionLabel(rating)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className={labelCls}>Sync timing</span>
                      <select
                        className={smallInputCls}
                        value={draft.syncInterval}
                        onChange={(event) =>
                          updateDraft(group.id, (current) => ({
                            ...current,
                            syncInterval: event.target.value as SyncInterval,
                          }))
                        }
                      >
                        {syncIntervalOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 md:mt-5">
                      <input
                        checked={draft.requiresManualApproval}
                        className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                        type="checkbox"
                        onChange={(event) =>
                          updateDraft(group.id, (current) => ({
                            ...current,
                            requiresManualApproval: event.target.checked,
                          }))
                        }
                      />
                      <span className="text-xs font-bold text-cornsilk/75">Require approval</span>
                    </label>
                  </div>

                  <SyncFilterControls
                    draft={draft.filters}
                    error={groupErrors[group.id] ?? null}
                    genreOptions={genreOptions}
                    onChange={(filters) => updateDraft(group.id, (current) => ({ ...current, filters }))}
                  />

                  <div
                    className={`min-h-20 rounded-[var(--radius-control)] border border-dashed p-3 transition ${
                      activeDropZone === group.id ? "border-pine/70 bg-pine/10" : "border-cornsilk/10 bg-black/20"
                    }`}
                    onDragLeave={() => setActiveDropZone(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setActiveDropZone(group.id);
                    }}
                    onDrop={(event) => void dropReviewerOnGroup(event, group)}
                  >
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className={labelCls}>Assigned reviewers</p>
                      {reviewers.length > 0 && (
                        <select
                          aria-label={`Add reviewer to ${group.name}`}
                          className={`${smallInputCls} sm:w-48`}
                          value=""
                          onChange={(event) => {
                            const handle = event.target.value;
                            if (handle && !group.reviewerHandles.includes(handle)) {
                              void onSaveGroup(group, {
                                reviewerHandles: [...group.reviewerHandles, handle],
                              });
                            }
                          }}
                        >
                          <option value="">Add reviewer...</option>
                          {reviewers
                            .filter((reviewer) => !group.reviewerHandles.includes(reviewer.handle))
                            .map((reviewer) => (
                              <option key={reviewer.handle} value={reviewer.handle}>
                                @{reviewer.handle}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.reviewerHandles.map((handle) => (
                        <ReviewerChip
                          key={handle}
                          draggable
                          handle={handle}
                          onDragEnd={() => {
                            setDraggedReviewer(null);
                            setActiveDropZone(null);
                          }}
                          onDragStart={(event) =>
                            startReviewerDrag(event, { handle, source: "group", groupId: group.id })
                          }
                          onRemove={() =>
                            void onSaveGroup(group, {
                              reviewerHandles: group.reviewerHandles.filter((candidate) => candidate !== handle),
                            })
                          }
                        />
                      ))}
                      {group.reviewerHandles.length === 0 && (
                        <span className="text-xs font-semibold text-cornsilk/70">Drag reviewers here</span>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-cornsilk/70">
                      Membership changes save immediately.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {isDirty && savingGroupId !== group.id && (
                      <span className="text-[11px] font-bold text-gold/80 sm:mr-1">Unsaved changes</span>
                    )}
                    <button
                      className={`${ghostBtnCls} h-9 px-3 text-xs`}
                      type="button"
                      onClick={() => {
                        updateDraft(group.id, () => draftFromGroup(group));
                        setGroupErrors((current) => ({ ...current, [group.id]: null }));
                      }}
                    >
                      Reset
                    </button>
                    <button
                      className={`${primaryBtnCls} h-9 px-3 text-xs`}
                      disabled={savingGroupId === group.id || !isDirty}
                      type="button"
                      onClick={() => void saveGroupDraft(group)}
                    >
                      {savingGroupId === group.id ? "Saving..." : "Save group"}
                      {isDirty && savingGroupId !== group.id && <span aria-hidden="true"> •</span>}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
