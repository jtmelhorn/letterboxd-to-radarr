import { normalizeGenreLabel } from "@/app/lib/syncFilters";
import type { AggregatedMovieDto, BlocklistedMovieDto, SyncResultItem } from "@/app/types/movie";

export type SendState = "idle" | "loading" | "added" | "error";

export type ActivityStatus =
  | "added"
  | "exists"
  | "error"
  | "skipped"
  | "removed"
  | "blocklisted"
  | "failed_remove";

export interface ActivityEntry {
  id: string;
  reviewId: number | null;
  filmId: string | null;
  title: string;
  year: number | null;
  status: ActivityStatus;
  outcome: "added" | "error" | "skipped";
  message: string;
  at: number;
  auto: boolean;
}

export const UNKNOWN_GENRE = "Unknown genre";

export function formatRelativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function reviewTime(movie: AggregatedMovieDto): number {
  if (!movie.latestReviewedAt) return 0;
  const time = Date.parse(movie.latestReviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

export function sortMoviesByRating(movies: AggregatedMovieDto[]): AggregatedMovieDto[] {
  return [...movies].sort((a, b) => {
    const ratingDifference = b.averageRating - a.averageRating;
    if (ratingDifference !== 0) return ratingDifference;

    const recencyDifference = reviewTime(b) - reviewTime(a);
    if (recencyDifference !== 0) return recencyDifference;

    const titleDifference = a.title.localeCompare(b.title);
    if (titleDifference !== 0) return titleDifference;

    return (b.year ?? 0) - (a.year ?? 0);
  });
}

export function movieGenres(movie: AggregatedMovieDto): string[] {
  return movie.genres.length > 0 ? movie.genres.map(normalizeGenreLabel).filter(Boolean) : [UNKNOWN_GENRE];
}

function searchText(value: string): string {
  return value.trim().toLowerCase();
}

export function movieMatchesSearch(movie: AggregatedMovieDto, query: string): boolean {
  const q = searchText(query);
  if (!q) return true;
  return (
    movie.title.toLowerCase().includes(q) ||
    (typeof movie.year === "number" && String(movie.year).includes(q)) ||
    movie.reviewerHandles.some((handle) => handle.toLowerCase().includes(q)) ||
    movie.genres.some((genre) => genre.toLowerCase().includes(q)) ||
    movie.id.toLowerCase().includes(q)
  );
}

export function activityMatchesSearch(entry: ActivityEntry, query: string): boolean {
  const q = searchText(query);
  if (!q) return true;
  return (
    entry.title.toLowerCase().includes(q) ||
    (typeof entry.year === "number" && String(entry.year).includes(q)) ||
    entry.message.toLowerCase().includes(q) ||
    entry.status.toLowerCase().includes(q)
  );
}

export function blocklistMatchesSearch(movie: BlocklistedMovieDto, query: string): boolean {
  const q = searchText(query);
  if (!q) return true;
  return (
    movie.title.toLowerCase().includes(q) ||
    (typeof movie.year === "number" && String(movie.year).includes(q)) ||
    movie.source.toLowerCase().includes(q) ||
    (movie.imdbId?.toLowerCase().includes(q) ?? false) ||
    (typeof movie.tmdbId === "number" && String(movie.tmdbId).includes(q))
  );
}

export function statusToSendState(status: AggregatedMovieDto["status"]): SendState {
  if (status === "added" || status === "exists") return "added";
  if (status === "error") return "error";
  return "idle";
}

export function syncResultToActivity(item: SyncResultItem): ActivityEntry {
  const status: ActivityStatus =
    item.status === "error"
      ? "error"
      : item.status === "skipped"
        ? "skipped"
        : item.status === "exists"
          ? "exists"
          : item.status === "removed" || item.status === "missing_in_radarr"
            ? "removed"
            : item.status === "blocklisted"
              ? "blocklisted"
              : item.status === "failed_remove"
                ? "failed_remove"
                : "added";
  return {
    id: String(item.id),
    reviewId: item.reviewId,
    filmId: item.filmId ?? null,
    title: item.title,
    year: item.year,
    status,
    outcome:
      status === "error" || status === "failed_remove"
        ? "error"
        : status === "skipped" || status === "removed" || status === "blocklisted"
          ? "skipped"
          : "added",
    message: item.message,
    at: item.at,
    auto: item.auto,
  };
}
