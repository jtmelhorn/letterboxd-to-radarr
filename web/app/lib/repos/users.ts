import { eq } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviewerGroupMembers, users } from "@/app/lib/db/schema";

export const DEFAULT_GROUP_ID = 1;

export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export function getOrCreateUser(handle: string): { id: number; handle: string } {
  const normalized = normalizeHandle(handle);
  if (!normalized) {
    throw new Error("A Letterboxd handle is required.");
  }

  const db = getDb();
  const existing = db.select().from(users).where(eq(users.handle, normalized)).get();
  if (existing) {
    ensureDefaultGroupMembership(existing.id);
    return { id: existing.id, handle: existing.handle };
  }

  const inserted = db.insert(users).values({ handle: normalized }).returning().get();
  ensureDefaultGroupMembership(inserted.id);
  return { id: inserted.id, handle: inserted.handle };
}

export function ensureDefaultGroupMembership(userId: number): void {
  const db = getDb();
  db.insert(reviewerGroupMembers)
    .values({ groupId: DEFAULT_GROUP_ID, userId })
    .onConflictDoNothing()
    .run();
}

export function listUsers(): { id: number; handle: string }[] {
  const db = getDb();
  return db.select().from(users).all().map((u) => ({ id: u.id, handle: u.handle }));
}

export function findUser(handle: string): { id: number; handle: string } | null {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;

  const db = getDb();
  const existing = db.select().from(users).where(eq(users.handle, normalized)).get();
  return existing ? { id: existing.id, handle: existing.handle } : null;
}

export function deleteUser(handle: string): boolean {
  const user = findUser(handle);
  if (!user) return false;

  const db = getDb();
  const result = db.delete(users).where(eq(users.id, user.id)).run();
  return (result.changes ?? 0) > 0;
}
