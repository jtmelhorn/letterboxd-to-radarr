export interface MovieReview {
  title: string;
  year: number | null;
  rating: number;
  reviewedAt?: string;
  posterUrl?: string;
  reviewText?: string;
  letterboxdUrl?: string;
  /** Stable identity from the Letterboxd RSS guid (or a derived fallback). */
  guid?: string;
}

export interface LetterboxdResponse {
  movies: MovieReview[];
}

/** A stored review enriched with its id and latest Radarr sync status. */
export interface ReviewDto extends MovieReview {
  id: number;
  status: "added" | "exists" | "error" | null;
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
  title: string;
  year: number | null;
  status: string;
  message: string;
  auto: boolean;
  at: number;
}

export interface SyncRunSummary {
  fetched: number;
  added: number;
  exists: number;
  failed: number;
  threshold: number;
  results: SyncResultItem[];
}
