import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { pendingApprovals, reviewerGroups } from "@/app/lib/db/schema";
import type { PendingApprovalDto } from "@/app/types/movie";

export interface CreatePendingApprovalInput {
  groupId: number;
  reviewId: number;
  filmId: string;
  title: string;
  year: number | null;
  averageRating: number;
  message?: string;
}

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10;
}

function toDto(row: {
  id: number;
  groupId: number;
  groupName: string | null;
  reviewId: number;
  filmId: string;
  title: string;
  year: number | null;
  averageRating: number;
  status: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}): PendingApprovalDto {
  const status =
    row.status === "approved" || row.status === "rejected" || row.status === "error"
      ? row.status
      : "pending";
  return {
    id: row.id,
    groupId: row.groupId,
    groupName: row.groupName ?? "Deleted group",
    reviewId: row.reviewId,
    filmId: row.filmId,
    title: row.title,
    year: row.year,
    averageRating: row.averageRating,
    status,
    message: row.message,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPendingApprovals(includeResolved = false): PendingApprovalDto[] {
  const db = getDb();
  const query = db
    .select({
      id: pendingApprovals.id,
      groupId: pendingApprovals.groupId,
      groupName: reviewerGroups.name,
      reviewId: pendingApprovals.reviewId,
      filmId: pendingApprovals.filmId,
      title: pendingApprovals.title,
      year: pendingApprovals.year,
      averageRating: pendingApprovals.averageRating,
      status: pendingApprovals.status,
      message: pendingApprovals.message,
      createdAt: pendingApprovals.createdAt,
      updatedAt: pendingApprovals.updatedAt,
    })
    .from(pendingApprovals)
    .leftJoin(reviewerGroups, eq(pendingApprovals.groupId, reviewerGroups.id))
    .$dynamic();

  const rows = (includeResolved ? query : query.where(eq(pendingApprovals.status, "pending")))
    .orderBy(desc(pendingApprovals.createdAt))
    .all();

  return rows.map(toDto);
}

export function getPendingApproval(id: number): PendingApprovalDto | null {
  const db = getDb();
  const row = db
    .select({
      id: pendingApprovals.id,
      groupId: pendingApprovals.groupId,
      groupName: reviewerGroups.name,
      reviewId: pendingApprovals.reviewId,
      filmId: pendingApprovals.filmId,
      title: pendingApprovals.title,
      year: pendingApprovals.year,
      averageRating: pendingApprovals.averageRating,
      status: pendingApprovals.status,
      message: pendingApprovals.message,
      createdAt: pendingApprovals.createdAt,
      updatedAt: pendingApprovals.updatedAt,
    })
    .from(pendingApprovals)
    .leftJoin(reviewerGroups, eq(pendingApprovals.groupId, reviewerGroups.id))
    .where(eq(pendingApprovals.id, id))
    .get();

  return row ? toDto(row) : null;
}

export function createPendingApproval(input: CreatePendingApprovalInput): PendingApprovalDto | null {
  const db = getDb();
  const existing = db
    .select({ id: pendingApprovals.id })
    .from(pendingApprovals)
    .where(
      and(
        eq(pendingApprovals.groupId, input.groupId),
        eq(pendingApprovals.filmId, input.filmId),
        eq(pendingApprovals.status, "pending"),
      ),
    )
    .get();

  if (existing) return null;

  const rejected = db
    .select({
      id: pendingApprovals.id,
      averageRating: pendingApprovals.averageRating,
    })
    .from(pendingApprovals)
    .where(
      and(
        eq(pendingApprovals.groupId, input.groupId),
        eq(pendingApprovals.filmId, input.filmId),
        eq(pendingApprovals.status, "rejected"),
      ),
    )
    .orderBy(desc(pendingApprovals.updatedAt))
    .get();

  // Re-open a rejected approval only when the group average improves enough to
  // change the displayed one-decimal rating; otherwise rejection stays sticky.
  if (rejected && roundedRating(input.averageRating) <= roundedRating(rejected.averageRating)) {
    return null;
  }

  const now = new Date().toISOString();
  const inserted = db
    .insert(pendingApprovals)
    .values({
      groupId: input.groupId,
      reviewId: input.reviewId,
      filmId: input.filmId,
      title: input.title,
      year: input.year,
      averageRating: input.averageRating,
      status: "pending",
      message: input.message ?? "Waiting for manual approval.",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: pendingApprovals.id })
    .get();

  return getPendingApproval(inserted.id);
}

export function resolvePendingApproval(
  id: number,
  status: "approved" | "rejected" | "error",
  message: string,
): PendingApprovalDto | null {
  const db = getDb();
  const updated = db
    .update(pendingApprovals)
    .set({ status, message, updatedAt: new Date().toISOString() })
    .where(eq(pendingApprovals.id, id))
    .returning({ id: pendingApprovals.id })
    .get();

  return updated ? getPendingApproval(updated.id) : null;
}

export function resetPendingApproval(id: number): boolean {
  const db = getDb();
  const result = db.delete(pendingApprovals).where(eq(pendingApprovals.id, id)).run();
  return (result.changes ?? 0) > 0;
}
