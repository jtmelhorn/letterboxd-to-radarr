export type MetadataLookupStatus = "pending" | "matched" | "not_found" | "error";
export type MetadataMediaType = "movie" | "tv";
export type SyncMovieStatus =
  | "added"
  | "exists"
  | "error"
  | "skipped"
  | "removed"
  | "blocklisted"
  | "failed_remove"
  | "missing_in_radarr";

export interface MovieReview {
  title: string;
  year: number | null;
  rating: number;
  reviewedAt?: string;
  posterUrl?: string;
  backdropUrl?: string;
  reviewText?: string;
  letterboxdUrl?: string;
  tmdbMovieId?: number;
  imdbId?: string;
  tmdbTvId?: number;
  genres?: string[];
  metadataSource?: string | null;
  metadataId?: string | null;
  metadataMediaType?: MetadataMediaType | null;
  metadataLookupStatus?: MetadataLookupStatus;
  metadataLastFetchedAt?: string | null;
  /** Stable identity from the Letterboxd RSS guid (or a derived fallback). */
  guid?: string;
}

export interface LetterboxdResponse {
  movies: MovieReview[];
}

/** A stored review enriched with its id and latest Radarr sync status. */
export interface ReviewDto extends MovieReview {
  id: number;
  status: SyncMovieStatus | null;
}

export interface ReviewerDto {
  id: number;
  handle: string;
}

export type SyncYearFilterMode = "any" | "exact" | "gte" | "lte" | "between";

export interface SyncYearFilter {
  mode: SyncYearFilterMode;
  exactYear?: number;
  minYear?: number;
  maxYear?: number;
}

export interface SyncGenreFilters {
  include: string[];
  exclude: string[];
}

export interface SyncFilters {
  year: SyncYearFilter;
  genres: SyncGenreFilters;
}

export interface LegacyReleaseYearSyncFilterRule {
  type: "releaseYear";
  operator: "equals";
  value: number;
}

export interface LegacyGenreSyncFilterRule {
  type: "genre";
  operator: "excludesAny";
  values: string[];
}

export type LegacySyncFilterRule = LegacyReleaseYearSyncFilterRule | LegacyGenreSyncFilterRule;

export interface LegacySyncFilters {
  version: 1;
  rules: LegacySyncFilterRule[];
}

export interface ReviewerGroupDto {
  id: number;
  name: string;
  enabled: boolean;
  /** @deprecated Use ratingThreshold. */
  autoThreshold: number;
  ratingThreshold: number;
  syncInterval: SyncInterval;
  requiresManualApproval: boolean;
  filters: SyncFilters;
  reviewerHandles: string[];
}

export type SyncInterval = "manual" | "30m" | "1h" | "12h" | "1d" | "1w";

export interface PendingApprovalDto {
  id: number;
  groupId: number;
  groupName: string;
  reviewId: number;
  filmId: string;
  title: string;
  year: number | null;
  averageRating: number;
  status: "pending" | "approved" | "rejected" | "error";
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface AggregatedReviewDto extends MovieReview {
  id: number;
  reviewerId: number;
  reviewerHandle: string;
  status: SyncMovieStatus | null;
}

export interface AggregatedMovieDto {
  id: string;
  title: string;
  year: number | null;
  averageRating: number;
  latestReviewedAt?: string;
  posterUrl?: string;
  backdropUrl?: string;
  letterboxdUrl?: string;
  tmdbMovieId?: number;
  imdbId?: string;
  tmdbTvId?: number;
  genres: string[];
  metadataSource: string | null;
  metadataId: string | null;
  metadataMediaType: MetadataMediaType | null;
  metadataLookupStatus: MetadataLookupStatus;
  metadataLastFetchedAt: string | null;
  reviewerCount: number;
  reviewerHandles: string[];
  reviews: AggregatedReviewDto[];
  status: SyncMovieStatus | null;
}

export interface RadarrAddRequest {
  /** Preferred: reference a stored review by id. */
  reviewId?: number;
  /** Fallback: identify the movie directly. */
  title?: string;
  year?: number | null;
}

export interface RadarrAddResponse {
  message: string;
  status?: "added" | "exists" | "not_found" | "error";
  movie?: {
    title: string;
    year: number;
    tmdbId: number;
    radarrMovieId?: number | null;
  };
}

/** Effective, resolved Radarr connection + automation preferences. */
export interface ResolvedRadarrTarget {
  baseUrl: string;
  apiKey: string;
  qualityProfileId: number | null;
  qualityProfileName: string | null;
  rootFolderPath: string | null;
  minAvailability: string;
  autoThreshold: number;
  monitored: boolean;
}

export interface SettingsUpdate {
  radarrUrl?: string;
  radarrApiKey?: string;
  qualityProfileId?: number | null;
  qualityProfileName?: string | null;
  rootFolderPath?: string | null;
  minAvailability?: string;
  autoThreshold?: number;
  monitored?: boolean;
}

export interface PublicSettings {
  reviewer: string;
  radarrUrl: string;
  hasRadarrApiKey: boolean;
  qualityProfileId: number | null;
  qualityProfileName: string | null;
  rootFolderPath: string | null;
  minAvailability: string;
  autoThreshold: number;
  monitored: boolean;
  dataDir: string;
  authEnabled: boolean;
  setupComplete: boolean;
}

export interface AuthStatusResponse {
  needsPasswordSetup: boolean;
  needsLogin: boolean;
  setupComplete: boolean;
  authEnabled: boolean;
}

export interface RadarrQualityProfileOption {
  id: number;
  name: string;
}

export interface RadarrRootFolderOption {
  path: string;
}

export interface RadarrOptionsResponse {
  qualityProfiles: RadarrQualityProfileOption[];
  rootFolders: RadarrRootFolderOption[];
}

export interface SyncResultItem {
  id: number;
  reviewId: number | null;
  filmId?: string;
  title: string;
  year: number | null;
  status: string;
  radarrMovieId?: number | null;
  message: string;
  auto: boolean;
  at: number;
}

export interface SyncRunSummary {
  fetched: number;
  added: number;
  exists: number;
  failed: number;
  pending?: number;
  skipped?: number;
  threshold: number;
  results: SyncResultItem[];
}

export interface ReviewerScope {
  type: "all" | "reviewer" | "group";
  reviewer?: string;
  groupId?: number;
}

export interface BlocklistedMovieDto {
  id: number;
  tmdbId: number | null;
  imdbId: string | null;
  radarrMovieId: number | null;
  title: string;
  year: number | null;
  filmId: string;
  source: string;
  message: string;
  createdAt: string;
}
