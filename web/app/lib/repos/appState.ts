import { eq, sql } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { appState } from "@/app/lib/db/schema";

const APP_STATE_ID = 1;

export interface AppStateSnapshot {
  adminPasswordHash: string;
  setupCompletedAt: string | null;
  defaultGroupId: number | null;
  sessionEpoch: number;
}

export function getAppState(): AppStateSnapshot {
  const db = getDb();
  const row = db.select().from(appState).where(eq(appState.id, APP_STATE_ID)).get();
  return {
    adminPasswordHash: row?.adminPasswordHash ?? "",
    setupCompletedAt: row?.setupCompletedAt ?? null,
    defaultGroupId: row?.defaultGroupId ?? null,
    sessionEpoch: row?.sessionEpoch ?? 0,
  };
}

export function getSessionEpoch(): number {
  return getAppState().sessionEpoch;
}

export function getDefaultReviewerGroupId(): number | null {
  return getAppState().defaultGroupId;
}

export function hasStoredAdminPassword(): boolean {
  return getAppState().adminPasswordHash.length > 0;
}

export function isSetupComplete(): boolean {
  return getAppState().setupCompletedAt !== null;
}

export function setAdminPassword(hash: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  // Bumping the epoch invalidates all previously issued session tokens.
  // Limitation: changes to the env APP_PASSWORD cannot be detected here, so
  // they do not invalidate existing sessions.
  db.update(appState)
    .set({ adminPasswordHash: hash, sessionEpoch: sql`session_epoch + 1`, updatedAt: now })
    .where(eq(appState.id, APP_STATE_ID))
    .run();
}

export function markSetupComplete(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(appState)
    .set({ setupCompletedAt: now, updatedAt: now })
    .where(eq(appState.id, APP_STATE_ID))
    .run();
}
