export interface MovieReview {
  title: string;
  year: number | null;
  rating: number;
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
  radarrUrl: string;
  hasRadarrApiKey: boolean;
  letterboxdExportUrl: string;
  hasLetterboxdCookie: boolean;
  dataDir: string;
}

export interface LetterboxdImportResponse {
  importedCount: number;
  importedFiles?: Array<{
    fileName: string;
    importedCount: number;
  }>;
  totalCached: number;
  movies: MovieReview[];
}
