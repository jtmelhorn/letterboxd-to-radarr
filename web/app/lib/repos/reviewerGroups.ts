import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviewerGroupMembers, reviewerGroups, users } from "@/app/lib/db/schema";
import { parseSyncFiltersJson, stringifySyncFilters } from "@/app/lib/syncFilters";
import type { ReviewerGroupDto, SyncInterval } from "@/app/types/movie";

export const DEFAULT_REVIEWER_GROUP_ID = 1;

function normalizeGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeThreshold(value: number): number {
  return value === -1 ? -1 : Math.round(value * 2) / 2;
}

const validSyncIntervals = new Set<SyncInterval>(["manual", "30m", "1h", "12h", "1d", "1w"]);

export function isValidSyncInterval(value: string): value is SyncInterval {
  return validSyncIntervals.has(value as SyncInterval);
}

export function isValidAutoThreshold(value: number): boolean {
  if (value === -1) return true;
  return Number.isFinite(value) && value >= 1 && value <= 5 && Number.isInteger(value * 2);
}

function handlesForGroup(groupId: number): string[] {
  const db = getDb();
  return db
    .select({ handle: users.handle })
    .from(reviewerGroupMembers)
    .innerJoin(users, eq(reviewerGroupMembers.userId, users.id))
    .where(eq(reviewerGroupMembers.groupId, groupId))
    .orderBy(asc(users.handle))
    .all()
    .map((row) => row.handle);
}

function toReviewerGroupDto(group: typeof reviewerGroups.$inferSelect): ReviewerGroupDto {
  return {
    id: group.id,
    name: group.name,
    autoThreshold: group.autoThreshold,
    ratingThreshold: group.autoThreshold,
    syncInterval: isValidSyncInterval(group.syncInterval) ? group.syncInterval : "1d",
    requiresManualApproval: group.requiresManualApproval,
    filters: parseSyncFiltersJson(group.filtersJson),
    reviewerHandles: handlesForGroup(group.id),
  };
}

export function listReviewerGroups(): ReviewerGroupDto[] {
  const db = getDb();
  const groups = db.select().from(reviewerGroups).orderBy(asc(reviewerGroups.id)).all();
  return groups.map(toReviewerGroupDto);
}

export function getReviewerGroup(groupId: number): ReviewerGroupDto | null {
  const db = getDb();
  const group = db.select().from(reviewerGroups).where(eq(reviewerGroups.id, groupId)).get();
  return group ? toReviewerGroupDto(group) : null;
}

function reviewerIdsFromHandles(handles: string[]): number[] {
  const normalized = [...new Set(handles.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (normalized.length === 0) return [];

  const db = getDb();
  const rows = db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.handle, normalized))
    .all();
  return rows.map((row) => row.id);
}

export function upsertReviewerGroup(input: {
  id?: number;
  name: string;
  autoThreshold?: number;
  ratingThreshold?: number;
  syncInterval?: SyncInterval;
  requiresManualApproval?: boolean;
  filters?: unknown;
  reviewerHandles: string[];
}): ReviewerGroupDto {
  const name = normalizeGroupName(input.name);
  if (!name) {
    throw new Error("Group name is required.");
  }
  const rawThreshold = input.ratingThreshold ?? input.autoThreshold ?? 4;
  if (!isValidAutoThreshold(rawThreshold)) {
    throw new Error("Auto-sync threshold must be disabled or between 1.0 and 5.0.");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const existingGroup =
    typeof input.id === "number"
      ? db.select().from(reviewerGroups).where(eq(reviewerGroups.id, input.id)).get()
      : null;
  const autoThreshold = normalizeThreshold(rawThreshold);
  const syncInterval = input.syncInterval ?? "1d";
  if (!isValidSyncInterval(syncInterval)) {
    throw new Error("Sync interval is not supported.");
  }
  const requiresManualApproval = input.requiresManualApproval ?? false;
  const filtersJson =
    input.filters === undefined && existingGroup ? existingGroup.filtersJson : stringifySyncFilters(input.filters);
  const memberIds =
    typeof input.id === "number" && input.id === DEFAULT_REVIEWER_GROUP_ID
      ? []
      : reviewerIdsFromHandles(input.reviewerHandles);

  const group = db.transaction((tx) => {
    const saved =
      typeof input.id === "number"
        ? tx
            .update(reviewerGroups)
            .set({ name, autoThreshold, syncInterval, requiresManualApproval, filtersJson, updatedAt: now })
            .where(eq(reviewerGroups.id, input.id))
            .returning()
            .get()
        : tx
            .insert(reviewerGroups)
            .values({
              name,
              autoThreshold,
              syncInterval,
              requiresManualApproval,
              filtersJson,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();

    if (!saved) {
      throw new Error("Reviewer group was not found.");
    }

    if (saved.id !== DEFAULT_REVIEWER_GROUP_ID) {
      tx.delete(reviewerGroupMembers).where(eq(reviewerGroupMembers.groupId, saved.id)).run();
      for (const userId of memberIds) {
        tx.insert(reviewerGroupMembers)
          .values({ groupId: saved.id, userId })
          .onConflictDoNothing()
          .run();
      }
    }

    return saved;
  });

  return toReviewerGroupDto(group);
}

export function updateDefaultGroupThreshold(autoThreshold: number): ReviewerGroupDto {
  const existing = getReviewerGroup(DEFAULT_REVIEWER_GROUP_ID);
  return upsertReviewerGroup({
    id: DEFAULT_REVIEWER_GROUP_ID,
    name: existing?.name ?? "All reviewers",
    ratingThreshold: autoThreshold,
    syncInterval: existing?.syncInterval ?? "1d",
    requiresManualApproval: existing?.requiresManualApproval ?? false,
    filters: existing?.filters,
    reviewerHandles: existing?.reviewerHandles ?? [],
  });
}

export function deleteReviewerGroup(groupId: number): boolean {
  if (groupId === DEFAULT_REVIEWER_GROUP_ID) {
    throw new Error("The default reviewer group cannot be deleted.");
  }

  const db = getDb();
  const result = db.delete(reviewerGroups).where(eq(reviewerGroups.id, groupId)).run();
  return (result.changes ?? 0) > 0;
}

export function listEnabledReviewerGroups(): ReviewerGroupDto[] {
  return listReviewerGroups().filter(
    (group) =>
      group.ratingThreshold !== -1 && group.syncInterval !== "manual" && group.reviewerHandles.length > 0,
  );
}
