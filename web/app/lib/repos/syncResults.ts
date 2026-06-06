import { desc, eq } from "drizzle-orm";

import { getDb } from "@/app/lib/db";
import { reviews, syncResults } from "@/app/lib/db/schema";
import type { SyncResultItem } from "@/app/types/movie";

export interface RecordSyncInput {
  reviewId: number;
  status: "added" | "exists" | "error";
  radarrTmdbId?: number | null;
  message: string;
  auto: boolean;
}

export function recordSyncResult(input: RecordSyncInput): void {
  const db = getDb();
  db.insert(syncResults)
    .values({
      reviewId: input.reviewId,
      status: input.status,
      radarrTmdbId: input.radarrTmdbId ?? null,
      message: input.message,
      auto: input.auto,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function getRecentSyncResults(userId: number, limit = 100): SyncResultItem[] {
  const db = getDb();
  const rows = db
    .select({
      id: syncResults.id,
      reviewId: syncResults.reviewId,
      status: syncResults.status,
      message: syncResults.message,
      auto: syncResults.auto,
      createdAt: syncResults.createdAt,
      title: reviews.title,
      year: reviews.year,
    })
    .from(syncResults)
    .innerJoin(reviews, eq(syncResults.reviewId, reviews.id))
    .where(eq(reviews.userId, userId))
    .orderBy(desc(syncResults.createdAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    reviewId: row.reviewId,
    title: row.title,
    year: row.year,
    status: row.status,
    message: row.message,
    auto: row.auto,
    at: Date.parse(row.createdAt) || Date.now(),
  }));
}
