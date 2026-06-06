import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  handle: text("handle").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

/**
 * Singleton (id = 1) describing the Radarr endpoint and automation prefs.
 * Kept as a row (not env-only) so the background worker can read it.
 */
export const radarrTargets = sqliteTable("radarr_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  baseUrl: text("base_url").notNull().default(""),
  apiKeyEncrypted: text("api_key_encrypted").notNull().default(""),
  qualityProfileId: integer("quality_profile_id"),
  qualityProfileName: text("quality_profile_name"),
  rootFolderPath: text("root_folder_path"),
  minAvailability: text("min_availability").notNull().default("announced"),
  autoThreshold: real("auto_threshold").notNull().default(4),
  monitored: integer("monitored", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    rating: real("rating").notNull(),
    reviewedAt: text("reviewed_at"),
    posterUrl: text("poster_url"),
    reviewText: text("review_text"),
    letterboxdUrl: text("letterboxd_url"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [
    uniqueIndex("reviews_user_guid_unique").on(table.userId, table.guid),
    index("reviews_user_rating_idx").on(table.userId, table.rating),
    index("reviews_user_reviewed_idx").on(table.userId, table.reviewedAt),
  ],
);

export const syncResults = sqliteTable(
  "sync_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    radarrTmdbId: integer("radarr_tmdb_id"),
    message: text("message").notNull().default(""),
    attempts: integer("attempts").notNull().default(1),
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [index("sync_results_review_idx").on(table.reviewId)],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type SyncResultRow = typeof syncResults.$inferSelect;
export type RadarrTargetRow = typeof radarrTargets.$inferSelect;
