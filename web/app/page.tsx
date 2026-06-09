"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { canCompleteSetup, ControlPanelForm } from "@/app/components/ControlPanelForm";
import { SyncConfigurationPanel } from "@/app/components/SyncConfigurationPanel";
import { evaluateSyncFilters, normalizeGenreKey, normalizeGenreLabel } from "@/app/lib/syncFilters";
import type {
  AggregatedMovieDto,
  AuthStatusResponse,
  BlocklistedMovieDto,
  PendingApprovalDto,
  PublicSettings,
  RadarrAddResponse,
  RadarrOptionsResponse,
  ReviewerDto,
  ReviewerGroupDto,
  ReviewerScope,
  SyncInterval,
  SyncResultItem,
  SyncRunSummary,
} from "@/app/types/movie";

interface LocalConfig {
  username: string;
  searchQuery?: string;
}

type SendState = "idle" | "loading" | "added" | "error";

type ActivityStatus = "added" | "exists" | "error" | "skipped" | "removed" | "blocklisted" | "failed_remove";

interface ActivityEntry {
  id: string;
  reviewId: number | null;
  title: string;
  year: number | null;
  status: ActivityStatus;
  outcome: "added" | "error" | "skipped";
  message: string;
  at: number;
  auto: boolean;
}

function isActivityBadgeWorthy(entry: ActivityEntry): boolean {
  return entry.status === "error";
}

interface AutoSyncSummary {
  count: number;
  threshold: number;
}

const STORAGE_KEY = "letterboxdarr-local-config";
const LEGACY_STORAGE_KEY = "letterboxd-to-radarr-local-config";
const UNKNOWN_GENRE = "Unknown genre";
const ratingOptions = Array.from({ length: 9 }, (_, i) => 1 + i * 0.5);
const groupRatingOptions = [3, 3.5, 4, 4.5, 5];
const commonExcludedGenreOptions = ["Documentary", "Short", "Reality", "TV Movie"];
const syncIntervalOptions: Array<{ value: SyncInterval; label: string }> = [
  { value: "manual", label: "Manual only" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "12h", label: "Every 12 hours" },
  { value: "1d", label: "Daily" },
  { value: "1w", label: "Weekly" },
];

type BootPhase = "loading" | "needsPasswordSetup" | "needsLogin" | "needsSetup" | "ready";
type ScopeSelection = "all" | `reviewer:${string}` | `group:${number}`;

const defaultConfig: LocalConfig = { username: "", searchQuery: "" };

const defaultSettings: PublicSettings = {
  reviewer: "",
  radarrUrl: "",
  hasRadarrApiKey: false,
  qualityProfileId: null,
  qualityProfileName: null,
  rootFolderPath: null,
  minAvailability: "announced",
  autoThreshold: 4,
  monitored: true,
  dataDir: "",
  authEnabled: false,
  setupComplete: false,
};

function resolveBootPhase(status: AuthStatusResponse): BootPhase {
  if (status.needsPasswordSetup) return "needsPasswordSetup";
  if (status.needsLogin) return "needsLogin";
  if (!status.setupComplete) return "needsSetup";
  return "ready";
}

function movieKey(movie: AggregatedMovieDto): string {
  return String(movie.id);
}

function apiMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return fallback;
}

function formatRelativeTime(at: number): string {
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

function sortMoviesByRating(movies: AggregatedMovieDto[]): AggregatedMovieDto[] {
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

function isAddedToRadarr(movie: AggregatedMovieDto, sendStates: Record<string, SendState>): boolean {
  const state = sendStates[movieKey(movie)] ?? statusToSendState(movie.status);
  return state === "added";
}

function movieGenres(movie: AggregatedMovieDto): string[] {
  return movie.genres.length > 0 ? movie.genres.map(normalizeGenreLabel).filter(Boolean) : [UNKNOWN_GENRE];
}

function searchText(value: string): string {
  return value.trim().toLowerCase();
}

function movieMatchesSearch(movie: AggregatedMovieDto, query: string): boolean {
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

function pendingApprovalMatchesSearch(approval: PendingApprovalDto, query: string): boolean {
  const q = searchText(query);
  if (!q) return true;
  return (
    approval.title.toLowerCase().includes(q) ||
    (typeof approval.year === "number" && String(approval.year).includes(q)) ||
    approval.groupName.toLowerCase().includes(q)
  );
}

function activityMatchesSearch(entry: ActivityEntry, query: string): boolean {
  const q = searchText(query);
  if (!q) return true;
  return (
    entry.title.toLowerCase().includes(q) ||
    (typeof entry.year === "number" && String(entry.year).includes(q)) ||
    entry.message.toLowerCase().includes(q) ||
    entry.status.toLowerCase().includes(q)
  );
}

function blocklistMatchesSearch(movie: BlocklistedMovieDto, query: string): boolean {
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

function statusToSendState(status: AggregatedMovieDto["status"]): SendState {
  if (status === "added" || status === "exists") return "added";
  if (status === "error") return "error";
  return "idle";
}

function syncResultToActivity(item: SyncResultItem): ActivityEntry {
  const status: ActivityStatus =
    item.status === "error"
      ? "error"
      : item.status === "skipped"
        ? "skipped"
        : item.status === "exists"
          ? "exists"
          : item.status === "removed"
            ? "removed"
            : item.status === "blocklisted"
              ? "blocklisted"
              : item.status === "failed_remove"
                ? "failed_remove"
                : "added";
  return {
    id: String(item.id),
    reviewId: item.reviewId,
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

// ── SVG Icons ────────────────────────────────────────────────────────────────

function FilmIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" width="20" x="2" y="3" />
      <line x1="7" x2="7" y1="3" y2="21" />
      <line x1="17" x2="17" y1="3" y2="21" />
      <line x1="2" x2="22" y1="8" y2="8" />
      <line x1="2" x2="22" y1="16" y2="16" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function RadarrIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
    </svg>
  );
}

function ArrowPathIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <rect height="6" rx="2" width="20" x="2" y="2" />
      <rect height="6" rx="2" width="20" x="2" y="9" />
      <rect height="6" rx="2" width="20" x="2" y="16" />
      <line x1="6" x2="6" y1="5" y2="5" />
      <line x1="6" x2="6" y1="12" y2="12" />
      <line x1="6" x2="6" y1="19" y2="19" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ExclamationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="11" y2="16" />
      <line x1="12" x2="12.01" y1="8" y2="8" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <rect height="11" rx="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ── Status badge ring class ─────────────────────────────────────────────────

function posterRingClass(state: SendState): string {
  if (state === "added") return "ring-2 ring-inset ring-chartreuse/80";
  if (state === "error") return "ring-2 ring-inset ring-rose-500/70";
  if (state === "loading") return "ring-2 ring-inset ring-gold/50 animate-pulse";
  return "ring-1 ring-inset ring-cornsilk/5";
}

function PosterRadarrAction({
  movie,
  sendState,
  onSend,
  onRemove,
}: {
  movie: AggregatedMovieDto;
  sendState: SendState;
  onSend: (movie: AggregatedMovieDto) => void;
  onRemove?: (movie: AggregatedMovieDto) => void;
}) {
  if (sendState === "loading") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink/85 backdrop-blur-sm border border-cornsilk/10">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-cornsilk/30 border-t-cornsilk" />
      </span>
    );
  }

  if (sendState === "idle") {
    return (
      <div className="opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          aria-label={`Send ${movie.title} to Radarr`}
          className="poster-action-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSend(movie);
          }}
          type="button"
        >
          <RadarrIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="transition-opacity duration-200 sm:group-hover:opacity-0 sm:group-hover:pointer-events-none sm:group-focus-within:opacity-0">
        {sendState === "added" ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-chartreuse/90 border border-chartreuse/40">
            <CheckIcon className="h-3 w-3 text-ink" />
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 border border-rose-400/20">
            <XIcon className="h-2.5 w-2.5 text-cornsilk" />
          </div>
        )}
      </div>
      <div className="absolute right-0 top-0 flex gap-1 opacity-0 transition-opacity duration-200 pointer-events-none sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100">
        <button
          aria-label={sendState === "added" ? `Resend ${movie.title} to Radarr` : `Retry sending ${movie.title} to Radarr`}
          className="poster-action-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSend(movie);
          }}
          type="button"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" />
        </button>
        {sendState === "added" && onRemove && (
          <button
            aria-label={`Remove ${movie.title} from Radarr`}
            className="poster-action-btn border-rose-500/30 hover:bg-rose-500/15 hover:text-rose-300"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(movie);
            }}
            type="button"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function AlertBanner({
  tone,
  title,
  children,
  action,
}: {
  tone: "success" | "error" | "info";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    success: "border-pine/30 bg-pine/10 text-cornsilk",
    error: "border-rose-500/25 bg-rose-500/10 text-rose-100",
    info: "border-azure/20 bg-azure/10 text-cornsilk",
  }[tone];
  const icon =
    tone === "success" ? (
      <SparklesIcon className="h-4 w-4 text-pine" />
    ) : tone === "error" ? (
      <ExclamationIcon className="h-4 w-4 text-rose-300" />
    ) : (
      <InfoIcon className="h-4 w-4 text-azure" />
    );

  return (
    <div
      className={`animate-fade-in flex flex-col gap-3 rounded-[var(--radius-card)] border px-4 py-3 sm:flex-row sm:items-center ${styles}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black/20">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-extrabold">{title}</p>
          <div className="mt-0.5 text-xs leading-relaxed text-cornsilk/70">{children}</div>
        </div>
      </div>
      {action && <div className="flex flex-shrink-0 items-center gap-2 sm:justify-end">{action}</div>}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-black/25 text-gold">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-cornsilk/55">{label}</p>
          <div className="mt-1 truncate text-lg font-black leading-tight text-cornsilk">{value}</div>
          <p className="mt-1 text-xs text-cornsilk/62">{detail}</p>
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        className="glass-card rounded-[var(--radius-card)] p-4 text-left transition hover:border-gold/25 hover:bg-white/[0.055]"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="glass-card rounded-[var(--radius-card)] p-4">
      {content}
    </div>
  );
}

function ModalHeader({
  eyebrow,
  title,
  titleId,
  onClose,
  closeLabel,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
      <div>
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-cornsilk/55">{eyebrow}</p>
        <h2 className="text-xl font-black tracking-tight text-cornsilk" id={titleId}>{title}</h2>
      </div>
      <button
        aria-label={closeLabel}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-cornsilk/65 transition hover:bg-white/[0.08] hover:text-cornsilk"
        onClick={onClose}
        type="button"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Home() {
  const [config, setConfig] = useState<LocalConfig>(defaultConfig);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [settings, setSettings] = useState<PublicSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState({
    radarrUrl: "",
    radarrApiKey: "",
    autoThreshold: 4,
    qualityProfileId: "" as number | "",
    rootFolderPath: "",
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Auth / boot gate
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading");
  const [passwordInput, setPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  // Connection Test States
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Radarr options (quality profiles + root folders)
  const [radarrOptions, setRadarrOptions] = useState<RadarrOptionsResponse | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);

  const lastAutoTestRef = useRef<string | null>(null);

  const [minimumRating, setMinimumRating] = useState(4);
  const [hideAdded, setHideAdded] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [isGenreFilterOpen, setIsGenreFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [movies, setMovies] = useState<AggregatedMovieDto[]>([]);
  const [syncedMovies, setSyncedMovies] = useState<AggregatedMovieDto[]>([]);
  const [blocklistedMovies, setBlocklistedMovies] = useState<BlocklistedMovieDto[]>([]);
  const [reviewers, setReviewers] = useState<ReviewerDto[]>([]);
  const [reviewerGroups, setReviewerGroups] = useState<ReviewerGroupDto[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalDto[]>([]);
  const [scopeSelection, setScopeSelection] = useState<ScopeSelection>("all");
  const [isFetching, setIsFetching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncedOpen, setIsSyncedOpen] = useState(false);
  const [hasAutoFetched, setHasAutoFetched] = useState(false);
  const [removingMovie, setRemovingMovie] = useState<AggregatedMovieDto | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [blockFutureSync, setBlockFutureSync] = useState(true);
  const [syncedSearch, setSyncedSearch] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [blocklistSearch, setBlocklistSearch] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [sendMessages, setSendMessages] = useState<Record<string, string>>({});
  const [metadataMessages, setMetadataMessages] = useState<Record<string, string>>({});
  const [activeMovieKey, setActiveMovieKey] = useState<string | null>(null);
  const [refreshingMetadataKey, setRefreshingMetadataKey] = useState<string | null>(null);

  const [autoSyncSummary, setAutoSyncSummary] = useState<AutoSyncSummary | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activitySeenAt, setActivitySeenAt] = useState(() => Date.now());
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isClearActivityConfirmOpen, setIsClearActivityConfirmOpen] = useState(false);

  const isDesktop = useMediaQuery("(min-width: 640px)");

  const activityUnreadCount = useMemo(
    () => activityLog.filter((entry) => isActivityBadgeWorthy(entry) && entry.at > activitySeenAt).length,
    [activityLog, activitySeenAt],
  );
  const pendingApprovalCount = pendingApprovals.filter((approval) => approval.status === "pending").length;
  const hasManualApprovalGroups = reviewerGroups.some((group) => group.requiresManualApproval);
  const enabledSyncGroupCount = reviewerGroups.filter(
    (group) => group.enabled && group.reviewerHandles.length > 0,
  ).length;

  const openActivity = useCallback(() => {
    setActivitySeenAt(Date.now());
    setIsActivityOpen(true);
  }, []);

  // ── localStorage hydration (username + display filter only) ─────────────
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<LocalConfig> & {
          minimumRating?: number;
          hideAdded?: boolean;
          selectedGenres?: unknown;
        };
        setConfig({ username: parsed.username ?? "", searchQuery: parsed.searchQuery ?? "" });
        if (typeof parsed.minimumRating === "number") setMinimumRating(parsed.minimumRating);
        if (typeof parsed.hideAdded === "boolean") setHideAdded(parsed.hideAdded);
        if (Array.isArray(parsed.selectedGenres)) {
          setSelectedGenres(parsed.selectedGenres.filter((genre): genre is string => typeof genre === "string"));
        }
        if (typeof parsed.searchQuery === "string") setSearchQuery(parsed.searchQuery);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    setHasLoadedConfig(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedConfig) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...config, minimumRating, hideAdded, selectedGenres, searchQuery }),
    );
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [config, hasLoadedConfig, hideAdded, minimumRating, selectedGenres, searchQuery]);

  const currentScope = useMemo<ReviewerScope>(() => {
    if (scopeSelection.startsWith("reviewer:")) {
      return { type: "reviewer", reviewer: scopeSelection.slice("reviewer:".length) };
    }
    if (scopeSelection.startsWith("group:")) {
      const groupId = Number(scopeSelection.slice("group:".length));
      return Number.isInteger(groupId) ? { type: "group", groupId } : { type: "all" };
    }
    return { type: "all" };
  }, [scopeSelection]);

  const activeReviewerGroup = useMemo(
    () =>
      currentScope.type === "group" && typeof currentScope.groupId === "number"
        ? (reviewerGroups.find((group) => group.id === currentScope.groupId) ?? null)
        : null,
    [currentScope, reviewerGroups],
  );

  // Mirror display filters from active sync group when scoped to a group
  useEffect(() => {
    if (activeReviewerGroup) {
      setMinimumRating(activeReviewerGroup.ratingThreshold ?? 0);
      setSelectedGenres(
        (activeReviewerGroup.filters?.genres?.include ?? []).map(normalizeGenreLabel).filter(Boolean),
      );
      return;
    }
    setMinimumRating(0);
    setSelectedGenres([]);
  }, [activeReviewerGroup]);

  const scopeQuery = useCallback(
    (extra = "") => {
      const params = new URLSearchParams();
      if (currentScope.type === "reviewer" && currentScope.reviewer) {
        params.set("reviewer", currentScope.reviewer);
      } else if (currentScope.type === "group" && typeof currentScope.groupId === "number") {
        params.set("scope", "group");
        params.set("groupId", String(currentScope.groupId));
      } else {
        params.set("scope", "all");
      }
      if (extra) {
        const extraParams = new URLSearchParams(extra);
        extraParams.forEach((value, key) => params.set(key, value));
      }
      return params.toString();
    },
    [currentScope],
  );

  const scopeBody = useCallback(() => {
    if (currentScope.type === "reviewer") {
      return { scope: "reviewer", reviewer: currentScope.reviewer };
    }
    if (currentScope.type === "group") {
      return { scope: "group", groupId: currentScope.groupId };
    }
    return { scope: "all" };
  }, [currentScope]);

  const loadReviewers = useCallback(async () => {
    try {
      const res = await fetch("/api/reviewers", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { reviewers?: ReviewerDto[] };
      setReviewers(body.reviewers ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadReviewerGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/reviewer-groups", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { groups?: ReviewerGroupDto[] };
      setReviewerGroups(body.groups ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadPendingApprovals = useCallback(async () => {
    try {
      const res = await fetch("/api/pending-approvals", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { pendingApprovals?: PendingApprovalDto[] };
      setPendingApprovals(body.pendingApprovals ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadBlocklist = useCallback(async () => {
    try {
      const res = await fetch("/api/blocklist", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { blocklist?: BlocklistedMovieDto[] };
      setBlocklistedMovies(body.blocklist ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/sync?${scopeQuery()}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { results: SyncResultItem[] };
      setActivityLog(body.results.map(syncResultToActivity));
    } catch {
      // non-fatal
    }
  }, [scopeQuery]);

  const clearActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/sync?${scopeQuery()}`, { method: "DELETE" });
      if (res.ok) {
        setActivityLog([]);
        setIsClearActivityConfirmOpen(false);
      }
    } catch {
      // non-fatal
    }
  }, [scopeQuery]);

  const loadReviews = useCallback(
    async (refresh: boolean) => {
      if (reviewers.length === 0) {
        setFetchError("Add at least one Letterboxd reviewer.");
        return;
      }
      setIsFetching(true);
      setFetchError(null);
      try {
        const res = await fetch(`/api/reviews?${scopeQuery(refresh ? "refresh=1" : "")}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as
          | { reviews?: AggregatedMovieDto[]; stale?: boolean; message?: string }
          | null;
        if (res.status === 401) {
          setBootPhase("needsLogin");
          return;
        }
        if (!res.ok || !body?.reviews) {
          throw new Error(apiMessage(body, "Unable to fetch Letterboxd reviews."));
        }
        const sorted = sortMoviesByRating(body.reviews);
        setMovies(sorted);
        const states: Record<string, SendState> = {};
        for (const review of sorted) {
          states[movieKey(review)] = statusToSendState(review.status);
        }
        setSendStates(states);
        setSendMessages({});
        void loadActivity();
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Unable to fetch Letterboxd reviews.");
      } finally {
        setIsFetching(false);
      }
    },
    [loadActivity, reviewers.length, scopeQuery],
  );

  const loadSyncedMovies = useCallback(async () => {
    try {
      const res = await fetch(`/api/radarr/synced?${scopeQuery()}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { movies?: AggregatedMovieDto[] };
      setSyncedMovies(body.movies ?? []);
    } catch {
      // non-fatal
    }
  }, [scopeQuery]);

  const removeSyncedMovie = useCallback(async () => {
    if (!removingMovie) return;
    const representative = removingMovie.reviews[0];
    if (!representative) {
      setRemovingMovie(null);
      return;
    }
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/movies/${encodeURIComponent(removingMovie.id)}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteFiles,
          blockFutureSync,
        }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.ok) {
        setSyncedMovies((current) => current.filter((m) => m.id !== removingMovie.id));
        await Promise.all([loadActivity(), loadBlocklist(), loadReviews(false)]);
      } else {
        alert(body?.message ?? "Failed to remove movie from Radarr.");
      }
    } catch {
      alert("Failed to remove movie from Radarr.");
    } finally {
      setIsRemoving(false);
      setRemovingMovie(null);
      setDeleteFiles(false);
      setBlockFutureSync(true);
    }
  }, [removingMovie, deleteFiles, blockFutureSync, loadActivity, loadBlocklist, loadReviews]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.status === 401) {
        setBootPhase("needsLogin");
        return;
      }
      const body = (await res.json().catch(() => null)) as PublicSettings | null;
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to load settings."));
      setSettings(body);
      if (body.reviewer) {
        setConfig((current) => (current.username.trim() ? current : { username: body.reviewer }));
      }
      await Promise.all([loadReviewers(), loadReviewerGroups(), loadPendingApprovals(), loadBlocklist()]);
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
        autoThreshold: body.autoThreshold,
        qualityProfileId: body.qualityProfileId ?? "",
        rootFolderPath: body.rootFolderPath ?? "",
      });
      return body;
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to load settings.");
      return null;
    }
  }, [loadBlocklist, loadPendingApprovals, loadReviewerGroups, loadReviewers]);

  const refreshBootPhase = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      const status = (await res.json()) as AuthStatusResponse;
      const phase = resolveBootPhase(status);
      setBootPhase(phase);
      if (phase === "needsSetup" || phase === "ready") {
        await loadSettings();
      }
      return phase;
    } catch {
      setBootPhase("needsPasswordSetup");
      return "needsPasswordSetup" as BootPhase;
    }
  }, [loadSettings]);

  useEffect(() => {
    void refreshBootPhase();
  }, [refreshBootPhase]);

  useEffect(() => {
    if (bootPhase !== "needsSetup" && bootPhase !== "ready") return;
    if (settings.radarrUrl && settings.hasRadarrApiKey) {
      void loadRadarrOptions();
    }
  }, [bootPhase, settings.hasRadarrApiKey, settings.radarrUrl]);

  // ── Auto-load reviews once settings + reviewers are known ───────────────
  useEffect(() => {
    if (bootPhase !== "ready" || !hasLoadedConfig || hasAutoFetched || isFetching) return;
    if (reviewers.length === 0) return;
    setHasAutoFetched(true);
    void loadReviews(true);
  }, [
    bootPhase,
    hasAutoFetched,
    hasLoadedConfig,
    isFetching,
    loadReviews,
    reviewers.length,
  ]);

  // ── Close modals on ESC ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (activeMovieKey) {
        setActiveMovieKey(null);
        return;
      }
      if (isActivityOpen) {
        setIsActivityOpen(false);
        return;
      }
      if (isGenreFilterOpen) {
        setIsGenreFilterOpen(false);
        return;
      }
      if (isSyncedOpen) {
        setIsSyncedOpen(false);
        return;
      }
      if (bootPhase === "ready" && isSettingsOpen) setIsSettingsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeMovieKey, bootPhase, isActivityOpen, isGenreFilterOpen, isSettingsOpen, isSyncedOpen]);

  useEffect(() => {
    if (!autoSyncSummary) return;
    const t = setTimeout(() => setAutoSyncSummary(null), 6000);
    return () => clearTimeout(t);
  }, [autoSyncSummary]);

  // ── Derived state ──────────────────────────────────────────────────────
  const genreOptions = useMemo(() => {
    const genres = new Set<string>();
    for (const movie of movies) {
      for (const genre of movieGenres(movie)) {
        genres.add(normalizeGenreLabel(genre));
      }
    }
    return Array.from(genres).sort((a, b) => {
      if (a === UNKNOWN_GENRE) return 1;
      if (b === UNKNOWN_GENRE) return -1;
      return a.localeCompare(b);
    });
  }, [movies]);

  const groupGenreOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const genre of [...commonExcludedGenreOptions, ...genreOptions]) {
      if (genre === UNKNOWN_GENRE) continue;
      const label = normalizeGenreLabel(genre);
      const key = normalizeGenreKey(label);
      if (key) options.set(key, label);
    }
    return Array.from(options.values()).sort((a, b) => a.localeCompare(b));
  }, [genreOptions]);

  const genreFilterLabel =
    selectedGenres.length === 0
      ? "All genres"
      : selectedGenres.length === 1
        ? selectedGenres[0]
        : `${selectedGenres.length} genres`;

  const filteredMovies = useMemo(
    () =>
      sortMoviesByRating(
        movies.filter((m) => {
          if (activeReviewerGroup) {
            if (m.averageRating < activeReviewerGroup.ratingThreshold) return false;
            if (!evaluateSyncFilters(m, activeReviewerGroup.filters).allowed) return false;
          } else if (minimumRating > 0 && m.averageRating < minimumRating) {
            return false;
          }
          if (hideAdded && isAddedToRadarr(m, sendStates)) return false;
          if (!activeReviewerGroup && selectedGenres.length > 0) {
            const genres = movieGenres(m);
            if (!selectedGenres.some((genre) => genres.includes(genre))) return false;
          }
          if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            const matchTitle = m.title.toLowerCase().includes(q);
            const matchYear = typeof m.year === "number" ? String(m.year).includes(q) : false;
            const matchReviewers = m.reviewerHandles.some((h) => h.toLowerCase().includes(q));
            const matchGenres = m.genres.some((g) => g.toLowerCase().includes(q));
            const matchId = m.id.toLowerCase().includes(q);
            if (!matchTitle && !matchYear && !matchReviewers && !matchGenres && !matchId) return false;
          }
          return true;
        }),
      ),
    [activeReviewerGroup, hideAdded, minimumRating, movies, selectedGenres, searchQuery, sendStates],
  );

  const filteredSyncedMovies = useMemo(
    () => syncedMovies.filter((movie) => movieMatchesSearch(movie, syncedSearch)),
    [syncedMovies, syncedSearch],
  );

  const filteredActivityLog = useMemo(
    () => activityLog.filter((entry) => activityMatchesSearch(entry, activitySearch)),
    [activityLog, activitySearch],
  );

  const filteredPendingApprovals = useMemo(
    () => pendingApprovals.filter((approval) => pendingApprovalMatchesSearch(approval, pendingSearch)),
    [pendingApprovals, pendingSearch],
  );

  const filteredBlocklistedMovies = useMemo(
    () => blocklistedMovies.filter((movie) => blocklistMatchesSearch(movie, blocklistSearch)),
    [blocklistedMovies, blocklistSearch],
  );

  const activeMovie = useMemo(
    () =>
      activeMovieKey
        ? (movies.find((m) => movieKey(m) === activeMovieKey) ??
          syncedMovies.find((m) => movieKey(m) === activeMovieKey) ??
          null)
        : null,
    [activeMovieKey, movies, syncedMovies],
  );

  const activeSendState: SendState = activeMovieKey ? (sendStates[activeMovieKey] ?? "idle") : "idle";
  const activeMessage = activeMovieKey ? sendMessages[activeMovieKey] : undefined;
  const activeMetadataMessage = activeMovieKey ? metadataMessages[activeMovieKey] : undefined;
  const activeMetadataRefreshing = activeMovieKey ? refreshingMetadataKey === activeMovieKey : false;

  const stats = useMemo(() => {
    const total = movies.length;
    const filtered = filteredMovies.length;
    const values = Object.values(sendStates);
    const synced = values.filter((s) => s === "added").length;
    const failed = values.filter((s) => s === "error").length;
    const syncing = values.filter((s) => s === "loading").length;
    const averageRating =
      filtered > 0
        ? (filteredMovies.reduce((acc, m) => acc + m.averageRating, 0) / filtered).toFixed(1)
        : "0.0";
    return { total, filtered, synced, failed, syncing, averageRating };
  }, [movies, filteredMovies, sendStates]);

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateConfig(field: keyof LocalConfig, value: string) {
    setConfig((c) => ({ ...c, [field]: value }));
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  async function submitSetupPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSettingPassword(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput, confirmPassword: confirmPasswordInput }),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (!res.ok || !body?.success) {
        throw new Error(apiMessage(body, "Unable to set admin password."));
      }
      setPasswordInput("");
      setConfirmPasswordInput("");
      setHasAutoFetched(false);
      await refreshBootPhase();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Unable to set admin password.");
    } finally {
      setIsSettingPassword(false);
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (!res.ok || !body?.success) {
        throw new Error(apiMessage(body, "Incorrect password."));
      }
      setPasswordInput("");
      setHasAutoFetched(false);
      await refreshBootPhase();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function persistSettings(options: { includeAutoThreshold?: boolean } = {}): Promise<PublicSettings> {
    const qualityProfileId =
      settingsDraft.qualityProfileId === "" ? null : Number(settingsDraft.qualityProfileId);
    const qualityProfileName =
      qualityProfileId != null
        ? (radarrOptions?.qualityProfiles.find((p) => p.id === qualityProfileId)?.name ?? null)
        : null;
    const bodyPayload: Record<string, unknown> = {
      radarrUrl: settingsDraft.radarrUrl,
      radarrApiKey: settingsDraft.radarrApiKey,
      qualityProfileId,
      qualityProfileName,
      rootFolderPath: settingsDraft.rootFolderPath || null,
    };
    if (options.includeAutoThreshold) {
      bodyPayload.autoThreshold = settingsDraft.autoThreshold;
    }

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
    const body = (await res.json().catch(() => null)) as PublicSettings | null;
    if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to save settings."));
    setSettings(body);
    setSettingsDraft({
      radarrUrl: body.radarrUrl,
      radarrApiKey: "",
      autoThreshold: body.autoThreshold,
      qualityProfileId: body.qualityProfileId ?? "",
      rootFolderPath: body.rootFolderPath ?? "",
    });
    return body;
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async function loadRadarrOptions() {
    setIsLoadingOptions(true);
    try {
      const res = await fetch("/api/radarr/options", { cache: "no-store" });
      if (!res.ok) {
        setRadarrOptions(null);
        return;
      }
      const body = (await res.json()) as RadarrOptionsResponse;
      setRadarrOptions(body);
      setSettingsDraft((current) => ({
        ...current,
        qualityProfileId:
          current.qualityProfileId === "" ? (body.qualityProfiles[0]?.id ?? "") : current.qualityProfileId,
        rootFolderPath: current.rootFolderPath || body.rootFolders[0]?.path || "",
      }));
    } catch {
      setRadarrOptions(null);
    } finally {
      setIsLoadingOptions(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      await persistSettings();
      setSettingsMessage("Settings successfully saved.");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to save settings.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function addReviewer(handleInput: string): Promise<boolean> {
    const handle = handleInput.trim();
    if (!handle) return false;
    setSettingsError(null);
    try {
      const res = await fetch("/api/reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const body = (await res.json().catch(() => null)) as { reviewers?: ReviewerDto[]; message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to add reviewer."));
      setReviewers(body?.reviewers ?? []);
      await loadReviewerGroups();
      await loadPendingApprovals();
      await loadBlocklist();
      return true;
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to add reviewer.");
      return false;
    }
  }

  async function removeReviewer(handle: string) {
    setSettingsError(null);
    try {
      const res = await fetch(`/api/reviewers?handle=${encodeURIComponent(handle)}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { reviewers?: ReviewerDto[]; message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to remove reviewer."));
      setReviewers(body?.reviewers ?? []);
      await Promise.all([loadReviewerGroups(), loadPendingApprovals()]);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to remove reviewer.");
    }
  }

  async function saveReviewerGroup(
    group: ReviewerGroupDto,
    update: Partial<
      Pick<
        ReviewerGroupDto,
        | "name"
        | "enabled"
        | "ratingThreshold"
        | "syncInterval"
        | "requiresManualApproval"
        | "filters"
        | "reviewerHandles"
      >
    >,
  ): Promise<boolean> {
    const next = {
      id: group.id,
      name: update.name ?? group.name,
      enabled: update.enabled ?? group.enabled,
      ratingThreshold: update.ratingThreshold ?? group.ratingThreshold ?? group.autoThreshold,
      syncInterval: update.syncInterval ?? group.syncInterval,
      requiresManualApproval: update.requiresManualApproval ?? group.requiresManualApproval,
      filters: update.filters ?? group.filters,
      reviewerHandles: update.reviewerHandles ?? group.reviewerHandles,
    };
    setSettingsError(null);
    try {
      const res = await fetch("/api/reviewer-groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = (await res.json().catch(() => null)) as { groups?: ReviewerGroupDto[]; message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to save reviewer group."));
      setReviewerGroups(body?.groups ?? []);
      await loadPendingApprovals();
      return true;
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to save reviewer group.");
      return false;
    }
  }

  async function deleteGroup(group: ReviewerGroupDto) {
    setSettingsError(null);
    try {
      const res = await fetch(`/api/reviewer-groups?id=${group.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { groups?: ReviewerGroupDto[]; message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to delete reviewer group."));
      setReviewerGroups(body?.groups ?? []);
      if (scopeSelection === `group:${group.id}`) setScopeSelection("all");
      await loadPendingApprovals();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to delete reviewer group.");
    }
  }

  async function createReviewerGroup(input: { name: string; ratingThreshold: number }): Promise<boolean> {
    const name = input.name.trim();
    if (!name) return false;
    setSettingsError(null);
    try {
      const res = await fetch("/api/reviewer-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enabled: true,
          ratingThreshold: input.ratingThreshold,
          syncInterval: "1d",
          requiresManualApproval: false,
          filters: { year: { mode: "any" }, genres: { include: [], exclude: [] } },
          reviewerHandles: [],
        }),
      });
      const body = (await res.json().catch(() => null)) as { groups?: ReviewerGroupDto[]; message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to create reviewer group."));
      setReviewerGroups(body?.groups ?? []);
      await loadPendingApprovals();
      return true;
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to create reviewer group.");
      return false;
    }
  }

  async function resolvePendingApproval(id: number, action: "approve" | "reject") {
    setSettingsError(null);
    try {
      const res = await fetch(`/api/pending-approvals/${id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, `Unable to ${action} pending movie.`));
      await Promise.all([loadPendingApprovals(), loadActivity(), loadSyncedMovies(), loadReviews(false)]);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : `Unable to ${action} pending movie.`);
    }
  }

  async function rejectAndBlocklistPendingApproval(approval: PendingApprovalDto) {
    setSettingsError(null);
    try {
      const rejectRes = await fetch(`/api/pending-approvals/${approval.id}/reject`, { method: "POST" });
      const rejectBody = (await rejectRes.json().catch(() => null)) as { message?: string } | null;
      if (!rejectRes.ok) throw new Error(apiMessage(rejectBody, "Unable to reject pending movie."));

      const blockRes = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: approval.title,
          year: approval.year,
          filmId: approval.filmId,
        }),
      });
      const blockBody = (await blockRes.json().catch(() => null)) as { message?: string } | null;
      if (!blockRes.ok) throw new Error(apiMessage(blockBody, "Unable to blocklist movie."));

      await Promise.all([loadPendingApprovals(), loadBlocklist(), loadActivity(), loadSyncedMovies(), loadReviews(false)]);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to reject and blocklist pending movie.");
    }
  }

  async function completeSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      const reviewerHandle = config.username.trim() || settings.reviewer.trim();
      if (reviewerHandle) {
        const reviewerRes = await fetch("/api/reviewers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: reviewerHandle }),
        });
        const reviewerBody = (await reviewerRes.json().catch(() => null)) as { message?: string } | null;
        if (!reviewerRes.ok) throw new Error(apiMessage(reviewerBody, "Unable to save reviewer."));
      }
      await persistSettings({ includeAutoThreshold: true });
      const res = await fetch("/api/setup/complete", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { message?: string; success?: boolean } | null;
      if (!res.ok || !body?.success) {
        throw new Error(apiMessage(body, "Unable to complete setup."));
      }
      setHasAutoFetched(false);
      setBootPhase("ready");
      await loadSettings();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to complete setup.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function testConnection() {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radarrUrl: settingsDraft.radarrUrl,
          radarrApiKey: settingsDraft.radarrApiKey,
        }),
      });
      const data = (await res.json()) as { success: boolean; message: string };
      setConnectionTestResult({ success: data.success, message: data.message });
      if (data.success) void loadRadarrOptions();
    } catch (err) {
      setConnectionTestResult({
        success: false,
        message: err instanceof Error ? err.message : "An unexpected network error occurred.",
      });
    } finally {
      setIsTestingConnection(false);
    }
  }

  function maybeAutoTestConnection() {
    const url = settingsDraft.radarrUrl.trim();
    const key = settingsDraft.radarrApiKey.trim();
    if (!url || isTestingConnection) return;
    // Allow auto-test with a saved (blank) key; the server falls back to it.
    const signature = `${url}::${key}`;
    if (lastAutoTestRef.current === signature) return;
    lastAutoTestRef.current = signature;
    void testConnection();
  }

  // ── Sync + manual add ──────────────────────────────────────────────────
  async function syncFeed(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (reviewers.length === 0) {
      setFetchError("Add at least one Letterboxd reviewer.");
      return;
    }
    setIsSyncing(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeBody()),
      });
      const body = (await res.json().catch(() => null)) as Partial<SyncRunSummary> | null;
      if (res.status === 401) {
        setBootPhase("needsLogin");
        return;
      }
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to sync."));
      if (typeof body.added === "number" && typeof body.threshold === "number" && body.added > 0) {
        setAutoSyncSummary({ count: body.added, threshold: body.threshold });
      } else {
        setAutoSyncSummary(null);
      }
      await loadReviews(false);
      await loadSyncedMovies();
      await loadPendingApprovals();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unable to sync.");
    } finally {
      setIsSyncing(false);
    }
  }

  function logActivity(movie: AggregatedMovieDto, status: ActivityStatus, message: string, auto: boolean) {
    const outcome: ActivityEntry["outcome"] = status === "error" ? "error" : "added";
    const entry: ActivityEntry = {
      id: `${movieKey(movie)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      reviewId: movie.reviews[0]?.id ?? null,
      title: movie.title,
      year: movie.year,
      status,
      outcome,
      message,
      at: Date.now(),
      auto,
    };
    setActivityLog((log) => [entry, ...log].slice(0, 100));
  }

  async function retryFromActivity(reviewId: number | null) {
    if (reviewId == null) return;
    const movie = movies.find((m) => m.reviews.some((review) => review.id === reviewId));
    if (!movie) return;
    await sendToRadarr(movie);
  }

  async function unblockMovie(blocklistId: number) {
    try {
      const res = await fetch(`/api/blocklist/${blocklistId}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to unblock movie."));
      await loadBlocklist();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to unblock movie.");
    }
  }

  async function sendToRadarr(movie: AggregatedMovieDto) {
    const key = movieKey(movie);
    const representativeReview = movie.reviews[0];
    if (!representativeReview) return;
    if (!settings.radarrUrl || !settings.hasRadarrApiKey) {
      const message = "Set up your Radarr Connection in Settings first.";
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({ ...c, [key]: message }));
      logActivity(movie, "error", message, false);
      return;
    }
    setSendStates((c) => ({ ...c, [key]: "loading" }));
    setSendMessages((c) => ({ ...c, [key]: "" }));
    try {
      const res = await fetch("/api/radarr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: representativeReview.id }),
      });
      const body = (await res.json().catch(() => null)) as Partial<RadarrAddResponse> | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to add this movie to Radarr."));
      const message = body?.message ?? "Movie successfully added.";
      const status: ActivityStatus =
        body?.status === "error" ? "error" : body?.status === "exists" ? "exists" : "added";
      if (status === "error") {
        setSendStates((c) => ({ ...c, [key]: "error" }));
        setSendMessages((c) => ({ ...c, [key]: message }));
        logActivity(movie, status, message, false);
        return;
      }
      setSendStates((c) => ({ ...c, [key]: "added" }));
      setSendMessages((c) => ({ ...c, [key]: message }));
      logActivity(movie, status, message, false);
      await loadSyncedMovies();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add this movie to Radarr.";
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({ ...c, [key]: message }));
      logActivity(movie, "error", message, false);
    }
  }

  async function refreshMetadata(movie: AggregatedMovieDto) {
    const key = movieKey(movie);
    const representativeReview = movie.reviews[0];
    if (!representativeReview) return;

    setRefreshingMetadataKey(key);
    setMetadataMessages((current) => ({ ...current, [key]: "" }));
    try {
      const res = await fetch("/api/metadata/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: representativeReview.id }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to refresh metadata."));
      setMetadataMessages((current) => ({ ...current, [key]: "Metadata refreshed." }));
      await Promise.all([loadReviews(false), loadSyncedMovies()]);
    } catch (err) {
      setMetadataMessages((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Unable to refresh metadata.",
      }));
    } finally {
      setRefreshingMetadataKey(null);
    }
  }

  // ── CSS Style presets ──────────────────────────────────────────────────
  const inputCls =
    "h-11 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-4 text-sm text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25";

  const primaryBtnCls =
    "rounded-[var(--radius-control)] bg-pine text-ink font-bold transition hover:bg-pine/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-pine/35 disabled:cursor-not-allowed disabled:opacity-50";

  const brandIconCls =
    "flex items-center justify-center rounded-2xl bg-pine text-ink shadow-lg shadow-pine/10";

  const isRadarrSetup = settings.radarrUrl && settings.hasRadarrApiKey;
  const isUserSetup = reviewers.length > 0 || config.username.trim().length > 0;
  const busy = isFetching || isSyncing;

  const connectionDot = isTestingConnection
    ? { dotClass: "bg-gold animate-pulse", textClass: "text-gold", label: "Testing…" }
    : connectionTestResult?.success
      ? { dotClass: "bg-pine", textClass: "text-chartreuse", label: "Connected" }
      : connectionTestResult
        ? { dotClass: "bg-rose-500", textClass: "text-rose-400", label: "Failed" }
        : { dotClass: "bg-pine/50", textClass: "text-cornsilk/55", label: "Not tested" };

  const setupReady = canCompleteSetup(settings, settingsDraft, config.username || reviewers[0]?.handle || "");

  // ── Boot gates ─────────────────────────────────────────────────────────
  if (bootPhase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-cornsilk/60">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-cornsilk/20 border-t-cornsilk" />
          <p className="text-sm font-semibold">Loading…</p>
        </div>
      </div>
    );
  }

  if (bootPhase === "needsPasswordSetup") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="glass-card w-full max-w-md rounded-[var(--radius-card)] p-7 sm:p-8 space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className={`${brandIconCls} h-12 w-12`}>
              <LockIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-cornsilk">Set admin password</h1>
              <p className="mt-2 text-sm leading-relaxed text-cornsilk/65">
                Create a password to protect this instance. It will be stored in your data volume.
              </p>
            </div>
          </div>
          <form className="space-y-4" onSubmit={submitSetupPassword}>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-cornsilk" htmlFor="setup-admin-password">
                Password
              </label>
              <input
                autoComplete="new-password"
                autoFocus
                className={`${inputCls} w-full`}
                id="setup-admin-password"
                placeholder="Minimum 8 characters"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-cornsilk" htmlFor="setup-admin-confirm">
                Confirm password
              </label>
              <input
                autoComplete="new-password"
                className={`${inputCls} w-full`}
                id="setup-admin-confirm"
                placeholder="Re-enter password"
                type="password"
                value={confirmPasswordInput}
                onChange={(e) => setConfirmPasswordInput(e.target.value)}
              />
            </div>
            {loginError && (
              <div className="rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
                {loginError}
              </div>
            )}
            <button
              className={`${primaryBtnCls} h-11 w-full text-sm`}
              disabled={
                isSettingPassword ||
                passwordInput.length < 8 ||
                passwordInput !== confirmPasswordInput
              }
              type="submit"
            >
              {isSettingPassword ? "Saving…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (bootPhase === "needsLogin") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="glass-card w-full max-w-md rounded-[var(--radius-card)] p-7 sm:p-8 space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className={`${brandIconCls} h-12 w-12`}>
              <LockIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-cornsilk">Sign in</h1>
              <p className="mt-2 text-sm text-cornsilk/65">This instance is password protected.</p>
            </div>
          </div>
          <form className="space-y-4" onSubmit={submitLogin}>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-cornsilk" htmlFor="login-password">
                Password
              </label>
              <input
                autoComplete="current-password"
                autoFocus
                className={`${inputCls} w-full`}
                id="login-password"
                placeholder="Enter password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
              />
            </div>
            {loginError && (
              <div className="rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
                {loginError}
              </div>
            )}
            <button
              className={`${primaryBtnCls} h-11 w-full text-sm`}
              disabled={isLoggingIn || !passwordInput}
              type="submit"
            >
              {isLoggingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (bootPhase === "needsSetup") {
    return (
      <div className="min-h-screen px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className={`${brandIconCls} h-12 w-12`}>
              <GearIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-gold">First-run setup</p>
              <h1 className="brand-wordmark text-3xl">letterboxdarr</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-cornsilk/65">
                Add your Letterboxd handle, verify Radarr, and choose the library destination before the
                dashboard starts syncing.
              </p>
            </div>
          </div>
          <div className="grid gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-3 text-xs text-cornsilk/70 sm:grid-cols-3">
            <div className="rounded-2xl bg-black/20 p-3">
              <span className="font-extrabold text-cornsilk">1. Account</span>
              <p className="mt-1">Letterboxd username</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-3">
              <span className="font-extrabold text-cornsilk">2. Connection</span>
              <p className="mt-1">Radarr URL and API key</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-3">
              <span className="font-extrabold text-cornsilk">3. Default group</span>
              <p className="mt-1">Profile, folder, threshold</p>
            </div>
          </div>
          <div className="glass-card rounded-[var(--radius-card)] p-4 sm:p-6">
            <ControlPanelForm
              canSubmit={setupReady}
              connectionDot={connectionDot}
              connectionTestResult={connectionTestResult}
              isLoadingOptions={isLoadingOptions}
              isSaving={isSavingSettings}
              isTestingConnection={isTestingConnection}
              letterboxdUsername={config.username}
              mode="setup"
              onAutoTestConnection={maybeAutoTestConnection}
              onDraftChange={(updater) => setSettingsDraft(updater)}
              onLetterboxdUsernameChange={(value) => updateConfig("username", value)}
              onSubmit={completeSetup}
              onTestConnection={testConnection}
              radarrOptions={radarrOptions}
              ratingOptions={ratingOptions}
              settings={settings}
              settingsDraft={settingsDraft}
              settingsError={settingsError}
              settingsMessage={settingsMessage}
              submitLabel="Complete setup"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Fixed glassmorphic navigation bar ──────────────────────────────── */}
      <nav className="fixed inset-x-0 top-0 z-40 h-16 border-b border-white/10 bg-ink/90 backdrop-blur-xl transition-all duration-200">
        <div className="content-shell flex h-full items-center justify-between gap-4">
          <div className="flex flex-shrink-0 items-center gap-3">
            <div className={`${brandIconCls} h-9 w-9`}>
              <FilmIcon className="h-5 w-5" />
            </div>
            <span className="brand-wordmark text-lg">letterboxdarr</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              aria-label="Sync Letterboxd feed"
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.035] text-cornsilk/70 transition hover:bg-white/[0.075] hover:text-cornsilk disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => void syncFeed()}
              type="button"
            >
              <ArrowPathIcon className={`h-5 w-5 ${busy ? "animate-spin" : ""}`} />
            </button>
            <button
              aria-label="Open sync activity"
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.035] text-cornsilk/70 transition hover:bg-white/[0.075] hover:text-cornsilk"
              onClick={openActivity}
              type="button"
            >
              <ClockIcon className="h-5 w-5" />
              {activityUnreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-ink shadow">
                  {activityUnreadCount > 99 ? "99+" : activityUnreadCount}
                </span>
              )}
            </button>
            <button
              aria-label="Open settings"
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.035] text-cornsilk/70 transition hover:bg-white/[0.075] hover:text-cornsilk"
              onClick={() => {
                setSettingsDraft({
                  radarrUrl: settings.radarrUrl,
                  radarrApiKey: "",
                  autoThreshold: settings.autoThreshold,
                  qualityProfileId: settings.qualityProfileId ?? "",
                  rootFolderPath: settings.rootFolderPath ?? "",
                });
                setSettingsMessage(null);
                setSettingsError(null);
                setConnectionTestResult(null);
                lastAutoTestRef.current = null;
                setIsSettingsOpen(true);
                void loadReviewers();
                void loadReviewerGroups();
                void loadPendingApprovals();
                if (settings.radarrUrl && settings.hasRadarrApiKey) void loadRadarrOptions();
              }}
              type="button"
            >
              <GearIcon className="h-5 w-5" />
              {!isRadarrSetup && (
                <span
                  aria-label="Radarr setup needed"
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-gold ring-2 ring-ink"
                />
              )}
              {isRadarrSetup && pendingApprovalCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-ink shadow">
                  {pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Dashboard Layout ────────────────────────────────────────── */}
      <main className="flex h-[100dvh] flex-col overflow-hidden pt-16">
        {movies.length > 0 ? (
          <div className="content-shell flex h-full min-h-0 flex-col gap-3 overflow-hidden py-3">
            <div className="shrink-0 flex flex-col gap-3">
              {autoSyncSummary && (
                <AlertBanner
                  action={
                    <>
                      <button
                        className="rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-cornsilk/80 transition hover:bg-white/[0.08] hover:text-cornsilk"
                        onClick={openActivity}
                        type="button"
                      >
                        View activity
                      </button>
                      <button
                        aria-label="Dismiss auto-sync summary"
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
                        onClick={() => setAutoSyncSummary(null)}
                        type="button"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </>
                  }
                  title={`${autoSyncSummary.count} ${
                    autoSyncSummary.count === 1 ? "film" : "films"
                  } sent to Radarr`}
                  tone="success"
                >
                  Rated ≥ {autoSyncSummary.threshold.toFixed(1)}★ and synced automatically. Track each
                  result in the activity panel.
                </AlertBanner>
              )}

              {fetchError && (
                <AlertBanner title="Sync needs attention" tone="error">
                  {fetchError}
                </AlertBanner>
              )}

              <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  detail={`${stats.total} total films found`}
                  icon={<UserIcon className="h-5 w-5" />}
                  label="Letterboxd"
                  value={
                    <span title={currentScope.type === "all" ? "All enabled groups" : scopeSelection}>
                      {currentScope.type === "all"
                        ? `${reviewers.length} reviewers`
                        : currentScope.type === "group"
                          ? (reviewerGroups.find((group) => group.id === currentScope.groupId)?.name ?? "Group")
                          : `@${currentScope.reviewer}`}
                    </span>
                  }
                />
                <StatCard
                  detail="Configured in Sync groups"
                  icon={<ServerIcon className="h-5 w-5" />}
                  label="Sync groups"
                  value={
                    enabledSyncGroupCount === 0 ? (
                      <span className="text-cornsilk/65">None enabled</span>
                    ) : (
                      <span className="text-gold">{enabledSyncGroupCount} enabled</span>
                    )
                  }
                />
                <StatCard
                  detail={`${stats.failed} failed, ${stats.syncing} active`}
                  icon={<CheckIcon className="h-5 w-5" />}
                  label="Radarr status"
                  onClick={() => {
                    void loadSyncedMovies();
                    setIsSyncedOpen(true);
                  }}
                  value={`${stats.synced} synced`}
                />
                <StatCard
                  detail={`${stats.filtered} shown ${
                    activeReviewerGroup
                      ? "(group filters)"
                      : minimumRating > 0
                      ? `(≥${minimumRating.toFixed(1)}★${selectedGenres.length ? ", genre filtered" : ""})`
                      : selectedGenres.length
                        ? "(genre filtered)"
                        : "(all ratings)"
                  }`}
                  icon={<StarIcon className="h-5 w-5" />}
                  label="Average rating"
                  value={`${stats.averageRating} ★`}
                />
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] px-3 py-3 sm:px-4">
                <div className="flex min-w-[min(100%,14rem)] flex-[1_1_220px] flex-wrap items-center gap-x-2 gap-y-1 text-sm text-cornsilk/60">
                  <span>Displaying</span>
                  <strong className="text-cornsilk font-extrabold">{stats.filtered}</strong>
                  <span>of</span>
                  <strong className="text-cornsilk/80">{stats.total}</strong>
                  <span>cached movies.</span>
                </div>

                <div className="flex min-w-0 flex-[0_1_auto] flex-wrap items-center gap-2 sm:gap-3">
                  <div className="relative max-w-full flex-[0_1_14rem]">
                    <select
                      aria-label="Reviewer scope"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 pr-8 text-xs font-bold text-cornsilk focus:outline-none focus:ring-2 focus:ring-gold/30"
                      value={scopeSelection}
                      onChange={(event) => {
                        setScopeSelection(event.target.value as ScopeSelection);
                        setHasAutoFetched(false);
                      }}
                    >
                      <option value="all">All enabled groups</option>
                      {reviewers.map((reviewer) => (
                        <option key={reviewer.handle} value={`reviewer:${reviewer.handle}`}>
                          @{reviewer.handle}
                        </option>
                      ))}
                      {reviewerGroups.map((group) => (
                        <option key={group.id} value={`group:${group.id}`}>
                          Group: {group.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {currentScope.type === "group" ? (
                    <span className="flex h-10 flex-[0_0_auto] items-center rounded-[var(--radius-control)] border border-pine/20 bg-pine/10 px-3 text-xs font-bold text-chartreuse">
                      Using group filters
                    </span>
                  ) : (
                    <>
                      <span className="group relative flex h-10 flex-[0_0_auto] items-center gap-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-cornsilk/55">
                          Min. rating ≥
                        </label>
                        <span className="text-cornsilk/45 transition-colors hover:text-cornsilk/80" tabIndex={0}>
                          <InfoIcon className="h-3.5 w-3.5" />
                        </span>
                        <span
                          className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-60 rounded-lg border border-cornsilk/10 bg-ink px-3 py-2 text-[11px] font-medium leading-relaxed text-cornsilk/80 opacity-0 shadow-xl transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                          role="tooltip"
                        >
                          Filter which movies appear in the grid. Auto-sync to Radarr uses thresholds in Sync groups.
                        </span>
                      </span>
                      <div className="flex min-h-10 flex-[0_1_auto] flex-wrap rounded-[var(--radius-control)] border border-white/10 bg-black/20 p-0.5">
                        <button
                          className={`h-9 rounded-md px-2.5 text-xs font-bold transition-all sm:px-3 ${
                            minimumRating === 0 ? "bg-pine text-ink shadow" : "text-cornsilk/65 hover:text-cornsilk"
                          }`}
                          onClick={() => setMinimumRating(0)}
                          type="button"
                        >
                          All
                        </button>
                        {[3.0, 3.5, 4.0, 4.5, 5.0].map((val) => (
                          <button
                            key={val}
                            className={`h-9 rounded-md px-2.5 text-xs font-bold transition-all sm:px-3 ${
                              minimumRating === val
                                ? "bg-pine text-ink shadow"
                                : "text-cornsilk/65 hover:text-cornsilk"
                            }`}
                            onClick={() => setMinimumRating(val)}
                            type="button"
                          >
                            {val.toFixed(1)}★
                          </button>
                        ))}
                      </div>

                      <div className="relative max-w-full flex-[0_1_10rem]">
                        <button
                          className="flex h-10 w-full min-w-32 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/75 transition hover:border-white/20 hover:text-cornsilk"
                          onClick={() => setIsGenreFilterOpen((open) => !open)}
                          type="button"
                        >
                          <span className="truncate">{genreFilterLabel}</span>
                          <span className="text-cornsilk/45">▼</span>
                        </button>
                        {isGenreFilterOpen && (
                          <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-cornsilk/10 bg-ink p-2 shadow-2xl">
                            <div className="flex items-center justify-between gap-2 border-b border-cornsilk/10 px-2 pb-2">
                              <span className="text-xs font-extrabold text-cornsilk">Genres</span>
                              {selectedGenres.length > 0 && (
                                <button
                                  className="text-xs font-bold text-pine transition hover:text-chartreuse"
                                  onClick={() => setSelectedGenres([])}
                                  type="button"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            <div className="max-h-64 overflow-y-auto py-1">
                              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-cornsilk/75 transition hover:bg-white/[0.06]">
                                <input
                                  checked={selectedGenres.length === 0}
                                  className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                                  onChange={() => setSelectedGenres([])}
                                  type="checkbox"
                                />
                                All genres
                              </label>
                              {genreOptions.length === 0 ? (
                                <p className="px-2 py-3 text-xs leading-relaxed text-cornsilk/55">
                                  Cached genres will appear after metadata refresh.
                                </p>
                              ) : (
                                genreOptions.map((genre) => (
                                  <label
                                    key={genre}
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-cornsilk/75 transition hover:bg-white/[0.06]"
                                  >
                                    <input
                                      checked={selectedGenres.includes(genre)}
                                      className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                                      onChange={(e) =>
                                        setSelectedGenres((current) =>
                                          e.target.checked
                                            ? [...new Set([...current, genre])]
                                            : current.filter((item) => item !== genre),
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    <span className="truncate">{genre}</span>
                                  </label>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <label className="flex h-10 flex-[0_0_auto] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3">
                    <input
                      checked={hideAdded}
                      className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                      onChange={(e) => setHideAdded(e.target.checked)}
                      type="checkbox"
                    />
                    <span className="text-xs font-bold text-cornsilk/70 whitespace-nowrap">Hide in Radarr</span>
                  </label>
                </div>

                <div className="min-w-[min(100%,260px)] flex-[1_1_280px] lg:ml-auto lg:max-w-sm xl:max-w-md">
                  <input
                    aria-label="Search movies"
                    className="h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
                    placeholder="Search movies, year, reviewer, or group"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {filteredMovies.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                <div className="glass-card flex w-full flex-col items-center justify-center rounded-[var(--radius-card)] px-6 py-14">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-black/25 text-cornsilk/65">
                    <FilmIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-black tracking-tight text-cornsilk">No movies match this filter</h3>
                   <p className="mt-2 max-w-sm text-sm leading-relaxed text-cornsilk/65">
                    {hideAdded
                      ? "All visible movies are already in Radarr, or none meet the current filter. Adjust the filters above."
                      : searchQuery.trim()
                        ? "No movies match your search. Try a different query."
                        : selectedGenres.length > 0
                        ? "No movies match the selected genre filter. Clear genres or choose a different selection above."
                        : minimumRating > 0
                        ? `No movies rated ${minimumRating.toFixed(1)}★ or higher. Choose All or lower the minimum rating above.`
                        : "No movies cached yet. Sync your Letterboxd feed to get started."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="poster-grid animate-fade-in">
                  {filteredMovies.map((movie) => {
                    const key = movieKey(movie);
                    const sendState = sendStates[key] ?? "idle";

                    return (
                      <div
                        key={key}
                        className={`poster-card group w-full min-h-0 aspect-[2/3] overflow-hidden rounded-2xl bg-ink/60 text-left ${posterRingClass(sendState)}`}
                      >
                        <button
                          aria-label={`${movie.title} (${movie.year ?? "unknown"}) — ${movie.averageRating.toFixed(1)} average stars`}
                          className="absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/80"
                          onClick={() => setActiveMovieKey(key)}
                          type="button"
                        >
                          {movie.posterUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              loading="lazy"
                              src={movie.posterUrl}
                            />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-pine to-ink p-4">
                              <FilmIcon className="h-9 w-9 text-granite/70" />
                              <span className="line-clamp-3 text-center text-[10px] font-bold leading-tight text-cornsilk/55">
                                {movie.title}
                              </span>
                            </div>
                          )}

                          <div className="poster-gradient absolute inset-0 pointer-events-none" />

                          <div className="absolute inset-x-2 top-2 flex justify-start pointer-events-none">
                            <div className="rounded-lg bg-black/60 px-2 py-0.5 backdrop-blur-md border border-cornsilk/5">
                              <span className="text-[10px] font-bold text-gold flex items-center gap-0.5">
                                ★ {movie.averageRating.toFixed(1)}
                              </span>
                            </div>
                          </div>

                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3">
                            <span className="rounded-full bg-black/0 px-3 py-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-transparent transition duration-200 group-hover:bg-black/45 group-hover:text-gold group-focus-within:bg-black/45 group-focus-within:text-gold">
                              Click for review
                            </span>
                          </div>

                          <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none">
                            <p className="mb-0.5 text-[10px] font-bold text-cornsilk/60">{movie.year ?? "—"}</p>
                            <h3 className="line-clamp-2 text-xs font-extrabold leading-snug text-cornsilk group-hover:text-gold transition-colors">
                              {movie.title}
                            </h3>
                          </div>
                        </button>

                        <div className="absolute top-2 right-2 z-10">
                          <PosterRadarrAction
                            movie={movie}
                            onSend={(m) => void sendToRadarr(m)}
                            onRemove={(m) => setRemovingMovie(m)}
                            sendState={sendState}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
        <div className="content-shell flex h-full min-h-0 flex-col py-3">
          {fetchError && (
            <AlertBanner title="Unable to sync feed" tone="error">
              {fetchError}
            </AlertBanner>
          )}
          {movies.length === 0 && !busy && (
            <div className="animate-fade-in flex flex-1 flex-col justify-center gap-8 overflow-y-auto py-4 lg:grid lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-7 space-y-6 text-left">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/15 bg-gold/10 px-3 py-1 text-xs font-bold text-gold">
                  <SparklesIcon className="h-3.5 w-3.5" />
                  Private media automation
                </span>
                <h1 className="text-4xl font-black leading-tight tracking-tight text-cornsilk md:text-5xl">
                  <span className="brand-wordmark">letterboxdarr</span> turns high-rated reviews into Radarr adds.
                </h1>
                <p className="max-w-xl text-base leading-relaxed text-cornsilk/68 md:text-lg">
                  Configure Radarr once, enter your public Letterboxd handle, then sync. Movies that meet
                  enabled group rules can be queued automatically while the dashboard stays readable and manual.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  <div className="glass-card flex gap-3 rounded-[var(--radius-card)] p-4">
                    <div className="text-gold mt-0.5">
                      <CheckIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-cornsilk">Background Syncing</h4>
                      <p className="mt-1 text-xs leading-relaxed text-cornsilk/65">
                        A server scheduler keeps Radarr in sync even when this tab is closed.
                      </p>
                    </div>
                  </div>
                  <div className="glass-card flex gap-3 rounded-[var(--radius-card)] p-4">
                    <div className="text-gold mt-0.5">
                      <CheckIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-cornsilk">Sync Groups</h4>
                      <p className="mt-1 text-xs leading-relaxed text-cornsilk/65">
                        Set thresholds, timing, approvals, and filters for hands-off downloads.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="glass-card rounded-[var(--radius-card)] p-6 md:p-8 space-y-6">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">Get started</p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-cornsilk">Connection checklist</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="flex gap-4 relative">
                      <div className="absolute left-[17px] top-9 bottom-0 w-[1px] bg-pine" />
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                          isRadarrSetup
                            ? "border-pine/30 bg-pine/15 text-cornsilk"
                            : "border-cornsilk/10 bg-ink/60 text-cornsilk/60"
                        }`}
                      >
                        {isRadarrSetup ? <CheckIcon className="h-4 w-4" /> : "1"}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-cornsilk">Configure Radarr Server</h4>
                          {!isRadarrSetup && (
                            <span className="rounded bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold border border-gold/10">
                              Setup Needed
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-cornsilk/65">
                          Configure your Radarr base URL and API key in Settings to permit syncs.
                        </p>
                        {!isRadarrSetup && (
                          <button
                            className="mt-2 text-xs font-semibold text-gold hover:text-cornsilk inline-flex items-center gap-1 transition-colors"
                            onClick={() => setIsSettingsOpen(true)}
                          >
                            Configure Connection ↗
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-4 relative">
                      <div className="absolute left-[17px] top-9 bottom-0 w-[1px] bg-pine" />
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                          isUserSetup
                            ? "border-pine/30 bg-pine/15 text-cornsilk"
                            : "border-cornsilk/10 bg-ink/60 text-cornsilk/60"
                        }`}
                      >
                        {isUserSetup ? <CheckIcon className="h-4 w-4" /> : "2"}
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-cornsilk">Enter Letterboxd Handle</h4>
                        <p className="text-xs leading-relaxed text-cornsilk/65">
                          Enter your Letterboxd username, then use Sync Feed to fetch reviews.
                        </p>
                        {!isUserSetup && (
                          <div className="mt-2.5 flex max-w-xs gap-1.5">
                            <input
                              aria-label="Letterboxd username"
                              className="h-9 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 focus:outline-none focus:ring-2 focus:ring-gold/30"
                              placeholder="e.g. username"
                              value={config.username}
                              onChange={(e) => updateConfig("username", e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                          isRadarrSetup && isUserSetup
                            ? "border-gold/20 bg-gold/10 text-gold"
                            : "border-cornsilk/10 bg-ink/60 text-cornsilk/60"
                        }`}
                      >
                        <SparklesIcon className="h-4.5 w-4.5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-cornsilk">Load Feed &amp; Start Syncing</h4>
                        <p className="text-xs leading-relaxed text-cornsilk/65">
                          Click Sync Feed to inspect, filter, and send movies into Radarr.
                        </p>
                        {isRadarrSetup && isUserSetup && (
                          <button
                            className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-pine px-4 py-2 text-xs font-extrabold text-ink transition hover:bg-pine/90"
                            onClick={(e) => {
                              e.preventDefault();
                              void syncFeed();
                            }}
                          >
                            Sync Now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {busy && movies.length === 0 && (
            <div className="flex flex-1 flex-col gap-3 overflow-hidden">
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-cornsilk/25 border-t-pine" />
                  <div>
                    <p className="text-sm font-extrabold text-cornsilk">
                      {isSyncing ? "Syncing Letterboxd and Radarr…" : "Loading Letterboxd reviews…"}
                    </p>
                    <p className="mt-0.5 text-xs text-cornsilk/60">
                      Posters and review details will appear as soon as the feed is ready.
                    </p>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="poster-grid">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <div key={i} className="glass-card aspect-[2/3] overflow-hidden rounded-2xl shimmer-wrapper">
                      <div className="h-full w-full bg-ink/40 flex flex-col justify-between p-3.5">
                        <div className="h-6 w-11 rounded bg-cornsilk/5 animate-pulse" />
                        <div className="space-y-2">
                          <div className="h-3 w-10 rounded bg-cornsilk/5 animate-pulse" />
                          <div className="h-4 w-3/4 rounded bg-cornsilk/5 animate-pulse" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </main>

      {/* ── Movie Detail Modal ─────────────────────────────────────────────── */}
      {activeMovieKey && activeMovie && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveMovieKey(null);
          }}
        >
          <div
            aria-labelledby="movie-detail-title"
            aria-modal="true"
            className="glass-modal animate-fade-in flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden rounded-t-3xl border border-cornsilk/10 shadow-2xl transition-all sm:max-w-4xl sm:rounded-[var(--radius-card)]"
            role="dialog"
          >
            {/* Header bar */}
            <div className="flex flex-shrink-0 items-center justify-between px-6 py-4 border-b border-cornsilk/5">
              {activeMovie.letterboxdUrl ? (
                <a
                  className="inline-flex items-center gap-1 rounded-full bg-ink/60 px-3 py-1 text-xs font-bold text-cornsilk/80 backdrop-blur-md border border-cornsilk/5 hover:bg-ink transition-all hover:text-cornsilk"
                  href={activeMovie.letterboxdUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Letterboxd ↗
                </a>
              ) : (
                <div />
              )}

              <button
                aria-label="Close details"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-cornsilk/60 backdrop-blur-sm border border-cornsilk/5 transition hover:text-cornsilk hover:bg-ink"
                onClick={() => setActiveMovieKey(null)}
                type="button"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
                <aside className="modal-movie-card md:sticky md:top-0">
                  <div className="modal-poster-frame">
                    {activeMovie.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={activeMovie.posterUrl} />
                    ) : (
                      <div className="modal-poster-placeholder">
                        <FilmIcon className="h-12 w-12 text-cornsilk/45" />
                      </div>
                    )}
                  </div>
                  <div className="px-1 pt-3 text-center">
                    <h2
                      className="text-base font-extrabold leading-tight text-cornsilk tracking-tight"
                      id="movie-detail-title"
                    >
                      {activeMovie.title}
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-cornsilk/60">
                      {activeMovie.year ?? "Unknown year"}
                    </p>
                  </div>
                </aside>

                <section className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-cornsilk/10 bg-ink/20">
                  <div className="flex items-start justify-between gap-4 border-b border-cornsilk/5 px-4 py-4 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-cornsilk/55">
                        Reviewer notes
                      </p>
                    </div>

                    <div className="flex flex-shrink-0 flex-col items-end">
                      <span className="flex items-center gap-1 text-xl font-black text-gold">
                        ★ {activeMovie.averageRating.toFixed(1)}
                      </span>
                      <span className="text-[10px] font-medium text-cornsilk/55">
                        {activeMovie.reviewerCount} reviewer{activeMovie.reviewerCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4 border-b border-cornsilk/5 px-4 py-5 sm:px-5">
                    <div className="rounded-xl border border-cornsilk/10 bg-black/15 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cornsilk/55">
                            Genres
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {movieGenres(activeMovie).map((genre) => (
                              <span
                                key={genre}
                                className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                                  genre === UNKNOWN_GENRE
                                    ? "border-cornsilk/10 bg-cornsilk/5 text-cornsilk/60"
                                    : "border-pine/25 bg-pine/10 text-chartreuse"
                                }`}
                              >
                                {genre}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-cornsilk/10 bg-ink/60 px-3 text-xs font-bold text-cornsilk/75 transition hover:border-gold/30 hover:bg-ink hover:text-cornsilk disabled:cursor-not-allowed disabled:opacity-55"
                          disabled={activeMetadataRefreshing}
                          onClick={() => void refreshMetadata(activeMovie)}
                          type="button"
                        >
                          {activeMetadataRefreshing ? (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cornsilk/25 border-t-cornsilk" />
                          ) : (
                            <ArrowPathIcon className="h-3.5 w-3.5" />
                          )}
                          Refresh metadata
                        </button>
                      </div>
                      {activeMetadataMessage && (
                        <p className="mt-3 text-xs leading-relaxed text-cornsilk/60">
                          {activeMetadataMessage}
                        </p>
                      )}
                    </div>

                    {activeMovie.reviews.map((review) => (
                      <div key={review.id} className="rounded-xl border border-cornsilk/10 bg-black/15 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-extrabold text-cornsilk">
                            @{review.reviewerHandle}
                          </span>
                          <span className="text-sm font-black text-gold">★ {review.rating.toFixed(1)}</span>
                        </div>
                        {review.reviewText ? (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-cornsilk/78 italic">
                            &quot;{review.reviewText}&quot;
                          </p>
                        ) : (
                          <p className="text-xs italic text-cornsilk/55">No written review for this film.</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="bg-ink/40 px-4 py-5 sm:px-5">
                    {activeSendState === "added" ? (
                      <div className="space-y-3 animate-fade-in">
                        <div className="flex items-center gap-3.5 rounded-xl border border-chartreuse/30 bg-chartreuse/10 p-4">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-chartreuse">
                            <CheckIcon className="h-4 w-4 text-ink" />
                          </div>
                          <div>
                            <p className="text-sm font-extrabold text-cornsilk">Sent to Radarr</p>
                            <p className="mt-0.5 text-xs text-cornsilk/70">
                              {activeMessage || "Film successfully synchronized."}
                            </p>
                          </div>
                        </div>
                        <button
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-cornsilk/10 bg-ink/60 py-3 text-sm font-bold text-cornsilk transition hover:border-gold/30 hover:bg-ink focus:outline-none focus:ring-2 focus:ring-gold/40"
                          onClick={() => void sendToRadarr(activeMovie)}
                          type="button"
                        >
                          <ArrowPathIcon className="h-4 w-4" />
                          Resend to Radarr
                        </button>
                        <button
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 py-3 text-sm font-bold text-rose-300 transition hover:border-rose-500/40 hover:bg-rose-500/20 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                          onClick={() => setRemovingMovie(activeMovie)}
                          type="button"
                        >
                          <TrashIcon className="h-4 w-4" />
                          Remove from Radarr
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <button
                          className={`${primaryBtnCls} flex w-full items-center justify-center gap-2 py-3.5 text-sm font-extrabold`}
                          disabled={activeSendState === "loading"}
                          onClick={() => void sendToRadarr(activeMovie)}
                          type="button"
                        >
                          {activeSendState === "loading" ? (
                            <>
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                              Sending to Radarr…
                            </>
                          ) : activeSendState === "error" ? (
                            <>
                              <ArrowPathIcon className="h-4 w-4" />
                              Retry add to Radarr
                            </>
                          ) : (
                            <>
                              <RadarrIcon className="h-4 w-4" />
                              Add to Radarr Library
                            </>
                          )}
                        </button>

                        {activeSendState === "error" && activeMessage && (
                          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-center text-xs text-rose-400 animate-fade-in flex items-start gap-2">
                            <ExclamationIcon className="h-4 w-4 flex-shrink-0 text-rose-500" />
                            <span className="text-left leading-relaxed">{activeMessage}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync Activity Slide-over ───────────────────────────────────────── */}
      {isActivityOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsActivityOpen(false);
          }}
        >
          <aside
            aria-labelledby="activity-title"
            aria-modal="true"
            className="glass-modal animate-fade-in flex h-full w-full max-w-md flex-col border-l border-cornsilk/10 shadow-2xl"
            role="dialog"
          >
            <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-cornsilk/55">
                  Recent syncs
                </p>
                <h2 className="text-xl font-black tracking-tight text-cornsilk" id="activity-title">
                  Sync Activity
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {activityLog.length > 0 && (
                  <button
                    aria-label="Clear activity"
                    className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => setIsClearActivityConfirmOpen(true)}
                    type="button"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  aria-label="Refresh activity"
                  className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
                  onClick={() => void loadActivity()}
                  type="button"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
                <button
                  aria-label="Close activity"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
                  onClick={() => setIsActivityOpen(false)}
                  type="button"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-4 pb-1 pt-3">
              <input
                aria-label="Search sync activity"
                className="h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
                placeholder="Search movies, year, reviewer, or genre…"
                value={activitySearch}
                onChange={(e) => setActivitySearch(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {activityLog.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                    <ClockIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-cornsilk">No sync activity yet</h3>
                  <p className="mt-1 max-w-xs text-xs text-cornsilk/55">
                    Sync results appear here. The badge only highlights new failures that need attention.
                  </p>
                </div>
              ) : filteredActivityLog.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                    <ClockIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-cornsilk">No activity matches</h3>
                  <p className="mt-1 max-w-xs text-xs text-cornsilk/55">
                    Try a different movie, year, status, or message.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredActivityLog.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start gap-3 rounded-xl border border-cornsilk/5 bg-ink/30 p-3"
                    >
                      <div
                        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                          entry.outcome === "added"
                            ? "bg-pine/20 text-cornsilk"
                            : entry.outcome === "skipped"
                              ? "bg-azure/15 text-azure"
                              : "bg-rose-500/15 text-rose-400"
                        }`}
                      >
                        {entry.outcome === "added" ? (
                          <CheckIcon className="h-3.5 w-3.5" />
                        ) : entry.outcome === "skipped" ? (
                          <InfoIcon className="h-3.5 w-3.5" />
                        ) : (
                          <ExclamationIcon className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-bold text-cornsilk">
                            {entry.title}
                            {entry.year != null && (
                              <span className="ml-1 font-medium text-cornsilk/55">{entry.year}</span>
                            )}
                          </h4>
                        </div>
                        <p
                          className={`mt-0.5 line-clamp-2 text-xs leading-relaxed ${
                            entry.outcome === "added"
                              ? "text-cornsilk/60"
                              : entry.outcome === "skipped"
                                ? "text-azure/80"
                                : "text-rose-400/80"
                          }`}
                        >
                          {entry.message}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              entry.outcome === "skipped"
                                ? "bg-azure/10 text-azure border border-azure/20"
                                : entry.auto
                                ? "bg-granite/20 text-cornsilk/70 border border-granite/30"
                                : "bg-cornsilk/5 text-cornsilk/60 border border-cornsilk/5"
                            }`}
                          >
                            {entry.outcome === "skipped" ? "Skipped" : entry.auto ? "Auto" : "Manual"}
                          </span>
                          <span className="text-[10px] text-cornsilk/55">{formatRelativeTime(entry.at)}</span>
                          {entry.outcome === "error" && entry.reviewId != null && (
                            <button
                              className="ml-auto rounded-md border border-cornsilk/10 bg-ink/60 px-2 py-0.5 text-[10px] font-bold text-cornsilk/80 transition hover:border-gold/30 hover:text-cornsilk disabled:opacity-50"
                              disabled={sendStates[String(entry.reviewId)] === "loading"}
                              onClick={() => void retryFromActivity(entry.reviewId)}
                              type="button"
                            >
                              {sendStates[String(entry.reviewId)] === "loading" ? "Sending…" : "Retry"}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ── Synced Movies Slide-over ─────────────────────────────────────── */}
      {isSyncedOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSyncedOpen(false);
          }}
        >
          <aside
            aria-labelledby="synced-title"
            aria-modal="true"
            className="glass-modal animate-fade-in flex h-full w-full max-w-md flex-col border-l border-cornsilk/10 shadow-2xl"
            role="dialog"
          >
            <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-cornsilk/55">
                  Radarr library
                </p>
                <h2 className="text-xl font-black tracking-tight text-cornsilk" id="synced-title">
                  Synced Movies
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label="Refresh synced movies"
                  className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
                  onClick={() => void loadSyncedMovies()}
                  type="button"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
                <button
                  aria-label="Close synced movies"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-cornsilk/10 bg-white/[0.035] text-cornsilk/60 transition hover:bg-white/[0.08] hover:text-cornsilk"
                  onClick={() => {
                    setIsSyncedOpen(false);
                    setSyncedSearch("");
                  }}
                  type="button"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-4 pt-3 pb-1">
              <input
                aria-label="Search synced movies"
                className="h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
                placeholder="Search movies, year, reviewer, or genre…"
                value={syncedSearch}
                onChange={(e) => setSyncedSearch(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {syncedMovies.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                    <CheckIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-cornsilk">No synced movies yet</h3>
                  <p className="mt-1 max-w-xs text-xs text-cornsilk/55">
                    Movies successfully added to Radarr will appear here.
                  </p>
                </div>
              ) : filteredSyncedMovies.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cornsilk/55">
                    <FilmIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-cornsilk">No synced movies match</h3>
                  <p className="mt-1 max-w-xs text-xs text-cornsilk/55">
                    Try a different title, year, reviewer, or genre.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredSyncedMovies.map((movie) => (
                    <li key={movie.id} className="group relative">
                      <button
                        className="flex w-full items-center gap-3 rounded-xl border border-cornsilk/5 bg-ink/30 p-3 text-left transition hover:border-gold/20 hover:bg-ink/45"
                        onClick={() => {
                          setIsSyncedOpen(false);
                          setActiveMovieKey(movie.id);
                        }}
                        type="button"
                      >
                        <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded-md bg-black/30">
                          {movie.posterUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" className="h-full w-full object-cover" src={movie.posterUrl} />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <FilmIcon className="h-4 w-4 text-cornsilk/40" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-bold text-cornsilk">
                            {movie.title}
                            {movie.year != null && (
                              <span className="ml-1 font-medium text-cornsilk/55">{movie.year}</span>
                            )}
                          </h4>
                          <p className="mt-0.5 text-xs text-cornsilk/60">
                            ★ {movie.averageRating.toFixed(1)} average from {movie.reviewerCount} reviewer
                            {movie.reviewerCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <button
                          aria-label={`Remove ${movie.title} from Radarr`}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-cornsilk/10 bg-black/30 text-cornsilk/45 opacity-0 transition hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRemovingMovie(movie);
                          }}
                          type="button"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ── Clear activity confirmation dialog ────────────────────────────── */}
      {isClearActivityConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-modal w-full max-w-sm rounded-[var(--radius-card)] border border-cornsilk/10 p-5 shadow-2xl">
            <h3 className="text-base font-extrabold text-cornsilk">Clear activity?</h3>
            <p className="mt-2 text-sm text-cornsilk/70">
              This clears the visible sync history. Movies already sent to Radarr will not be re-added.
            </p>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-9 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-4 text-xs font-bold text-cornsilk/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-cornsilk"
                onClick={() => setIsClearActivityConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-[var(--radius-control)] bg-rose-500 px-4 text-xs font-bold text-white transition hover:bg-rose-600"
                onClick={() => void clearActivity()}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove confirmation dialog ─────────────────────────────────────── */}
      {removingMovie && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-modal w-full max-w-sm rounded-[var(--radius-card)] border border-cornsilk/10 p-5 shadow-2xl">
            <h3 className="text-base font-extrabold text-cornsilk">Remove from Radarr?</h3>
            <p className="mt-2 text-sm text-cornsilk/70">
              This will remove <strong className="text-cornsilk">{removingMovie.title}</strong>
              {removingMovie.year != null && <span className="text-cornsilk/50"> ({removingMovie.year})</span>} from your
              Radarr library.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  checked={deleteFiles}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  type="checkbox"
                />
                <div>
                  <span className="text-sm font-bold text-cornsilk/80">Also delete files from disk</span>
                  <p className="mt-0.5 text-xs text-cornsilk/55">
                    Deletes the movie folder and files through Radarr.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  checked={blockFutureSync}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                  onChange={(e) => setBlockFutureSync(e.target.checked)}
                  type="checkbox"
                />
                <div>
                  <span className="text-sm font-bold text-cornsilk/80">Block this movie from future auto-sync</span>
                  <p className="mt-0.5 text-xs text-cornsilk/55">
                    Prevents this app from adding the movie again during future syncs.
                  </p>
                </div>
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-9 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-4 text-xs font-bold text-cornsilk/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-cornsilk"
                disabled={isRemoving}
                onClick={() => {
                  setRemovingMovie(null);
                  setDeleteFiles(false);
                  setBlockFutureSync(true);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-[var(--radius-control)] bg-rose-500 px-4 text-xs font-bold text-white transition hover:bg-rose-600 disabled:opacity-50"
                disabled={isRemoving}
                onClick={() => void removeSyncedMovie()}
                type="button"
              >
                {isRemoving ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Modal ─────────────────────────────────────────────────── */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSettingsOpen(false);
          }}
        >
          <div
            aria-labelledby="settings-title"
            aria-modal="true"
            className="glass-modal flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-cornsilk/10 shadow-2xl sm:max-w-4xl sm:rounded-[var(--radius-card)]"
            role="dialog"
          >
            <ModalHeader
              closeLabel="Close settings"
              eyebrow="Control panel"
              onClose={() => setIsSettingsOpen(false)}
              title="Sync Configuration"
              titleId="settings-title"
            />

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <SyncConfigurationPanel
                genreOptions={groupGenreOptions}
                pendingApprovalCount={pendingApprovalCount}
                ratingOptions={groupRatingOptions}
                reviewerGroups={reviewerGroups}
                reviewers={reviewers}
                syncIntervalOptions={syncIntervalOptions}
                onAddReviewer={addReviewer}
                onCreateGroup={createReviewerGroup}
                onDeleteGroup={deleteGroup}
                onRemoveReviewer={removeReviewer}
                onSaveGroup={saveReviewerGroup}
              />

              {(hasManualApprovalGroups || pendingApprovalCount > 0) && (
                <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-base font-extrabold tracking-tight text-cornsilk">
                        Pending approvals
                      </h3>
                      <p className="text-xs leading-relaxed text-cornsilk/65">
                        Review movies held by groups that require approval before Radarr sync.
                      </p>
                    </div>
                    <span className="w-fit rounded-full border border-gold/20 bg-gold/10 px-2.5 py-1 text-xs font-bold text-gold">
                      {pendingApprovalCount} pending
                    </span>
                  </div>
                  <input
                    aria-label="Search pending approvals"
                    className="mb-3 h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
                    placeholder="Search movies, year, reviewer, or genre…"
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                  />
                  <div className="space-y-2">
                    {filteredPendingApprovals.map((approval) => (
                      <div
                        key={approval.id}
                        className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-cornsilk">
                            {approval.title}
                            {approval.year != null && (
                              <span className="ml-1 font-medium text-cornsilk/55">{approval.year}</span>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-cornsilk/60">
                            {approval.groupName} · Avg {approval.averageRating.toFixed(1)} stars
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={`${primaryBtnCls} h-9 px-3 text-xs`}
                            onClick={() => void resolvePendingApproval(approval.id, "approve")}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            className="h-9 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/70 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                            onClick={() => void resolvePendingApproval(approval.id, "reject")}
                            type="button"
                          >
                            Reject
                          </button>
                          <button
                            className="h-9 rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 text-xs font-bold text-rose-200 transition hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-white"
                            onClick={() => void rejectAndBlocklistPendingApproval(approval)}
                            type="button"
                          >
                            Reject + blocklist
                          </button>
                        </div>
                      </div>
                    ))}
                    {pendingApprovals.length === 0 && (
                      <p className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 px-3 py-3 text-xs text-cornsilk/55">
                        No movies are waiting for approval.
                      </p>
                    )}
                    {pendingApprovals.length > 0 && filteredPendingApprovals.length === 0 && (
                      <p className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 px-3 py-3 text-xs text-cornsilk/55">
                        No pending approvals match your search.
                      </p>
                    )}
                  </div>
                </section>
              )}

              <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <h3 className="text-base font-extrabold tracking-tight text-cornsilk">
                      Blocklisted movies
                    </h3>
                    <p className="text-xs leading-relaxed text-cornsilk/65">
                      Movies listed here are skipped before approvals or Radarr adds.
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-200">
                    {blocklistedMovies.length} blocked
                  </span>
                </div>
                <input
                  aria-label="Search blocklisted movies"
                  className="mb-3 h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25"
                  placeholder="Search movies, year, reviewer, or genre…"
                  value={blocklistSearch}
                  onChange={(e) => setBlocklistSearch(e.target.value)}
                />
                <div className="space-y-2">
                  {filteredBlocklistedMovies.map((movie) => (
                    <div
                      key={movie.id}
                      className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-cornsilk">
                          {movie.title}
                          {movie.year != null && (
                            <span className="ml-1 font-medium text-cornsilk/55">{movie.year}</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-cornsilk/60">
                          {movie.source === "removed_from_radarr" ? "Removed from Radarr" : "Manually blocked"}
                          {movie.tmdbId != null && <span> · TMDB {movie.tmdbId}</span>}
                        </p>
                      </div>
                      <button
                        className="h-9 rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/70 transition hover:border-pine/30 hover:bg-pine/10 hover:text-cornsilk"
                        onClick={() => void unblockMovie(movie.id)}
                        type="button"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                  {blocklistedMovies.length === 0 && (
                    <p className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 px-3 py-3 text-xs text-cornsilk/55">
                      No movies are blocklisted.
                    </p>
                  )}
                  {blocklistedMovies.length > 0 && filteredBlocklistedMovies.length === 0 && (
                    <p className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 px-3 py-3 text-xs text-cornsilk/55">
                      No blocklisted movies match your search.
                    </p>
                  )}
                </div>
              </section>

              <ControlPanelForm
                connectionDot={connectionDot}
                connectionTestResult={connectionTestResult}
                isLoadingOptions={isLoadingOptions}
                isSaving={isSavingSettings}
                isTestingConnection={isTestingConnection}
                mode="modal"
                onAutoTestConnection={maybeAutoTestConnection}
                onDraftChange={(updater) => setSettingsDraft(updater)}
                onSubmit={saveSettings}
                onTestConnection={testConnection}
                radarrOptions={radarrOptions}
                ratingOptions={ratingOptions}
                settings={settings}
                settingsDraft={settingsDraft}
                settingsError={settingsError}
                settingsMessage={settingsMessage}
                submitLabel="Save Settings"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
