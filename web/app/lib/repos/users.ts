import { eq } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { users } from "@/app/lib/db/schema";

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
    return { id: existing.id, handle: existing.handle };
  }

  const inserted = db.insert(users).values({ handle: normalized }).returning().get();
  return { id: inserted.id, handle: inserted.handle };
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
