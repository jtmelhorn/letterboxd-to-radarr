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

export const reviewerGroups = sqliteTable("reviewer_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  autoThreshold: real("auto_threshold").notNull().default(4),
  syncInterval: text("sync_interval").notNull().default("1d"),
  requiresManualApproval: integer("requires_manual_approval", { mode: "boolean" }).notNull().default(false),
  filtersJson: text("filters_json").notNull().default('{"year":{"mode":"any"},"genres":{"include":[],"exclude":[]}}'),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const reviewerGroupMembers = sqliteTable(
  "reviewer_group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => reviewerGroups.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [
    uniqueIndex("reviewer_group_members_unique").on(table.groupId, table.userId),
    index("reviewer_group_members_user_idx").on(table.userId),
  ],
);

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
  autoFetchMetadata: integer("auto_fetch_metadata", { mode: "boolean" }).notNull().default(true),
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
    backdropUrl: text("backdrop_url"),
    reviewText: text("review_text"),
    letterboxdUrl: text("letterboxd_url"),
    tmdbMovieId: integer("tmdb_movie_id"),
    tmdbTvId: integer("tmdb_tv_id"),
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

export const movieMetadata = sqliteTable(
  "movie_metadata",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    filmId: text("film_id").notNull().unique(),
    normalizedTitle: text("normalized_title").notNull(),
    year: integer("year"),
    genresJson: text("genres_json").notNull().default("[]"),
    metadataSource: text("metadata_source"),
    metadataId: text("metadata_id"),
    metadataMediaType: text("metadata_media_type"),
    metadataLookupStatus: text("metadata_lookup_status").notNull().default("pending"),
    metadataLastFetchedAt: text("metadata_last_fetched_at"),
    posterUrl: text("poster_url"),
    backdropUrl: text("backdrop_url"),
    lookupError: text("lookup_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [
    index("movie_metadata_title_year_idx").on(table.normalizedTitle, table.year),
    index("movie_metadata_status_idx").on(table.metadataLookupStatus),
  ],
);

export const syncResults = sqliteTable(
  "sync_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    filmId: text("film_id"),
    status: text("status").notNull(),
    radarrTmdbId: integer("radarr_tmdb_id"),
    radarrMovieId: integer("radarr_movie_id"),
    message: text("message").notNull().default(""),
    attempts: integer("attempts").notNull().default(1),
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [
    index("sync_results_review_idx").on(table.reviewId),
    index("sync_results_film_created_idx").on(table.filmId, table.createdAt),
  ],
);

export const pendingApprovals = sqliteTable(
  "pending_approvals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .notNull()
      .references(() => reviewerGroups.id, { onDelete: "cascade" }),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    filmId: text("film_id").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    averageRating: real("average_rating").notNull(),
    status: text("status").notNull().default("pending"),
    message: text("message").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [
    index("pending_approvals_group_idx").on(table.groupId),
    index("pending_approvals_status_idx").on(table.status),
    index("pending_approvals_film_idx").on(table.filmId),
  ],
);

/** Singleton (id = 1) for admin auth and first-launch setup tracking. */
export const appState = sqliteTable("app_state", {
  id: integer("id").primaryKey(),
  adminPasswordHash: text("admin_password_hash").notNull().default(""),
  setupCompletedAt: text("setup_completed_at"),
  defaultGroupId: integer("default_group_id").references(() => reviewerGroups.id, { onDelete: "set null" }),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const movieBlocklist = sqliteTable(
  "movie_blocklist",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tmdbId: integer("tmdb_id"),
    imdbId: text("imdb_id"),
    radarrMovieId: integer("radarr_movie_id"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull().default(""),
    year: integer("year"),
    filmId: text("film_id").notNull(),
    source: text("source").notNull().default("manually_blocked"),
    message: text("message").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => [
    uniqueIndex("movie_blocklist_tmdb_idx").on(table.tmdbId).where(sql`tmdb_id IS NOT NULL`),
    index("movie_blocklist_imdb_idx").on(table.imdbId),
    index("movie_blocklist_title_year_idx").on(table.normalizedTitle, table.year),
    index("movie_blocklist_film_idx").on(table.filmId),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type MovieMetadataRow = typeof movieMetadata.$inferSelect;
export type SyncResultRow = typeof syncResults.$inferSelect;
export type PendingApprovalRow = typeof pendingApprovals.$inferSelect;
export type RadarrTargetRow = typeof radarrTargets.$inferSelect;
export type AppStateRow = typeof appState.$inferSelect;
export type ReviewerGroupRow = typeof reviewerGroups.$inferSelect;
export type MovieBlocklistRow = typeof movieBlocklist.$inferSelect;
