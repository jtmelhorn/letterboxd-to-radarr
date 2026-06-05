export interface MovieReview {
  title: string;
  year: number | null;
  rating: number;
  reviewedAt?: string;
  posterUrl?: string;
  reviewText?: string;
  letterboxdUrl?: string;
}

export interface LetterboxdResponse {
  movies: MovieReview[];
}

export interface RadarrAddRequest {
  title: string;
  year: number | null;
  radarrUrl: string;
  radarrApiKey: string;
}

export interface RadarrAddResponse {
  message: string;
  movie?: {
    title: string;
    year: number;
    tmdbId: number;
  };
}

export interface PublicSettings {
  reviewer: string;
  radarrUrl: string;
  hasRadarrApiKey: boolean;
  dataDir: string;
}
