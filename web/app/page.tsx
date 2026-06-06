"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  PublicSettings,
  RadarrAddResponse,
  RadarrOptionsResponse,
  ReviewDto,
  SyncResultItem,
  SyncRunSummary,
} from "@/app/types/movie";

interface LocalConfig {
  username: string;
}

type SendState = "idle" | "loading" | "added" | "error";

interface ActivityEntry {
  id: string;
  title: string;
  year: number | null;
  outcome: "added" | "error";
  message: string;
  at: number;
  auto: boolean;
}

interface AutoSyncSummary {
  count: number;
  threshold: number;
}

const STORAGE_KEY = "letterboxd-to-radarr-local-config";
const ratingOptions = Array.from({ length: 9 }, (_, i) => 1 + i * 0.5);

const defaultConfig: LocalConfig = { username: "" };

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
};

function movieKey(movie: ReviewDto): string {
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

function reviewTime(movie: ReviewDto): number {
  if (!movie.reviewedAt) return 0;
  const time = Date.parse(movie.reviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

function sortMoviesByRecencyAndStars(movies: ReviewDto[]): ReviewDto[] {
  return [...movies].sort((a, b) => {
    const recencyDifference = reviewTime(b) - reviewTime(a);
    if (recencyDifference !== 0) return recencyDifference;

    const ratingDifference = b.rating - a.rating;
    if (ratingDifference !== 0) return ratingDifference;

    const titleDifference = a.title.localeCompare(b.title);
    if (titleDifference !== 0) return titleDifference;

    return (b.year ?? 0) - (a.year ?? 0);
  });
}

function statusToSendState(status: ReviewDto["status"]): SendState {
  if (status === "added" || status === "exists") return "added";
  if (status === "error") return "error";
  return "idle";
}

function syncResultToActivity(item: SyncResultItem): ActivityEntry {
  return {
    id: String(item.id),
    title: item.title,
    year: item.year,
    outcome: item.status === "error" ? "error" : "added",
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
  if (state === "added") return "ring-2 ring-pine/80 ring-offset-2 ring-offset-ink";
  if (state === "error") return "ring-2 ring-rose-500/70 ring-offset-2 ring-offset-ink";
  if (state === "loading") return "ring-2 ring-gold/50 ring-offset-2 ring-offset-ink animate-pulse";
  return "ring-1 ring-cornsilk/5";
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

  // Auth gate
  const [authRequired, setAuthRequired] = useState(false);
  const [isAuthed, setIsAuthed] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
  const [movies, setMovies] = useState<ReviewDto[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasAutoFetched, setHasAutoFetched] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [sendMessages, setSendMessages] = useState<Record<string, string>>({});
  const [activeMovieKey, setActiveMovieKey] = useState<string | null>(null);

  const [autoSyncSummary, setAutoSyncSummary] = useState<AutoSyncSummary | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [isActivityOpen, setIsActivityOpen] = useState(false);

  // ── localStorage hydration (username + display filter only) ─────────────
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<LocalConfig> & { minimumRating?: number };
        setConfig({ username: parsed.username ?? "" });
        if (typeof parsed.minimumRating === "number") setMinimumRating(parsed.minimumRating);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHasLoadedConfig(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedConfig) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, minimumRating }));
  }, [config, hasLoadedConfig, minimumRating]);

  const loadActivity = useCallback(async (handle: string) => {
    if (!handle) return;
    try {
      const res = await fetch(`/api/sync?handle=${encodeURIComponent(handle)}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { results: SyncResultItem[] };
      setActivityLog(body.results.map(syncResultToActivity));
    } catch {
      // non-fatal
    }
  }, []);

  const loadReviews = useCallback(
    async (handle: string, refresh: boolean) => {
      if (!handle) {
        setFetchError("Enter a Letterboxd username.");
        return;
      }
      setIsFetching(true);
      setFetchError(null);
      try {
        const res = await fetch(
          `/api/reviews?handle=${encodeURIComponent(handle)}${refresh ? "&refresh=1" : ""}`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => null)) as
          | { reviews?: ReviewDto[]; stale?: boolean; message?: string }
          | null;
        if (res.status === 401) {
          setAuthRequired(true);
          setIsAuthed(false);
          return;
        }
        if (!res.ok || !body?.reviews) {
          throw new Error(apiMessage(body, "Unable to fetch Letterboxd reviews."));
        }
        const sorted = sortMoviesByRecencyAndStars(body.reviews);
        setMovies(sorted);
        const states: Record<string, SendState> = {};
        for (const review of sorted) {
          states[movieKey(review)] = statusToSendState(review.status);
        }
        setSendStates(states);
        setSendMessages({});
        void loadActivity(handle);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Unable to fetch Letterboxd reviews.");
      } finally {
        setIsFetching(false);
      }
    },
    [loadActivity],
  );

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.status === 401) {
        setAuthRequired(true);
        setIsAuthed(false);
        return;
      }
      const body = (await res.json().catch(() => null)) as PublicSettings | null;
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to load settings."));
      setAuthRequired(body.authEnabled);
      setIsAuthed(true);
      setSettings(body);
      if (body.reviewer) {
        setConfig((current) => (current.username.trim() ? current : { username: body.reviewer }));
      }
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
        autoThreshold: body.autoThreshold,
        qualityProfileId: body.qualityProfileId ?? "",
        rootFolderPath: body.rootFolderPath ?? "",
      });
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to load settings.");
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // ── Auto-load reviews once settings + username are known ────────────────
  useEffect(() => {
    if (!hasLoadedConfig || !isAuthed || hasAutoFetched || isFetching) return;
    const username = config.username.trim() || settings.reviewer.trim();
    if (!username) return;
    setHasAutoFetched(true);
    void loadReviews(username, true);
  }, [config.username, hasAutoFetched, hasLoadedConfig, isAuthed, isFetching, loadReviews, settings.reviewer]);

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
      if (isSettingsOpen) setIsSettingsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeMovieKey, isActivityOpen, isSettingsOpen]);

  useEffect(() => {
    if (!activeMovieKey || sendStates[activeMovieKey] !== "added") return;
    const t = setTimeout(() => setActiveMovieKey(null), 2000);
    return () => clearTimeout(t);
  }, [activeMovieKey, sendStates]);

  useEffect(() => {
    if (!autoSyncSummary) return;
    const t = setTimeout(() => setAutoSyncSummary(null), 6000);
    return () => clearTimeout(t);
  }, [autoSyncSummary]);

  // ── Derived state ──────────────────────────────────────────────────────
  const filteredMovies = useMemo(
    () => sortMoviesByRecencyAndStars(movies.filter((m) => m.rating >= minimumRating)),
    [movies, minimumRating],
  );

  const activeMovie = useMemo(
    () => (activeMovieKey ? (filteredMovies.find((m) => movieKey(m) === activeMovieKey) ?? null) : null),
    [activeMovieKey, filteredMovies],
  );

  const activeSendState: SendState = activeMovieKey ? (sendStates[activeMovieKey] ?? "idle") : "idle";
  const activeMessage = activeMovieKey ? sendMessages[activeMovieKey] : undefined;

  const stats = useMemo(() => {
    const total = movies.length;
    const filtered = filteredMovies.length;
    const values = Object.values(sendStates);
    const synced = values.filter((s) => s === "added").length;
    const failed = values.filter((s) => s === "error").length;
    const syncing = values.filter((s) => s === "loading").length;
    const averageRating =
      total > 0 ? (movies.reduce((acc, m) => acc + m.rating, 0) / total).toFixed(1) : "0.0";
    return { total, filtered, synced, failed, syncing, averageRating };
  }, [movies, filteredMovies, sendStates]);

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateConfig(field: keyof LocalConfig, value: string) {
    setConfig((c) => ({ ...c, [field]: value }));
  }

  // ── Auth ───────────────────────────────────────────────────────────────
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
      setIsAuthed(true);
      setHasAutoFetched(false);
      await loadSettings();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setIsLoggingIn(false);
    }
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
      const qualityProfileId =
        settingsDraft.qualityProfileId === "" ? null : Number(settingsDraft.qualityProfileId);
      const qualityProfileName =
        qualityProfileId != null
          ? (radarrOptions?.qualityProfiles.find((p) => p.id === qualityProfileId)?.name ?? null)
          : null;
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radarrUrl: settingsDraft.radarrUrl,
          radarrApiKey: settingsDraft.radarrApiKey,
          autoThreshold: settingsDraft.autoThreshold,
          qualityProfileId,
          qualityProfileName,
          rootFolderPath: settingsDraft.rootFolderPath || null,
        }),
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
      setSettingsMessage("Settings successfully saved.");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to save settings.");
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
    const username = config.username.trim() || settings.reviewer.trim();
    if (!username) {
      setFetchError("Enter a Letterboxd username.");
      return;
    }
    setIsSyncing(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: username }),
      });
      const body = (await res.json().catch(() => null)) as Partial<SyncRunSummary> | null;
      if (res.status === 401) {
        setAuthRequired(true);
        setIsAuthed(false);
        return;
      }
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to sync."));
      if (typeof body.added === "number" && typeof body.threshold === "number" && body.added > 0) {
        setAutoSyncSummary({ count: body.added, threshold: body.threshold });
      } else {
        setAutoSyncSummary(null);
      }
      await loadReviews(username, false);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unable to sync.");
    } finally {
      setIsSyncing(false);
    }
  }

  function logActivity(movie: ReviewDto, outcome: "added" | "error", message: string, auto: boolean) {
    setActivityLog((log) =>
      [
        {
          id: `${movieKey(movie)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: movie.title,
          year: movie.year,
          outcome,
          message,
          at: Date.now(),
          auto,
        },
        ...log,
      ].slice(0, 100),
    );
  }

  async function sendToRadarr(movie: ReviewDto) {
    const key = movieKey(movie);
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
        body: JSON.stringify({ reviewId: movie.id }),
      });
      const body = (await res.json().catch(() => null)) as Partial<RadarrAddResponse> | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to add this movie to Radarr."));
      const message = body?.message ?? "Movie successfully added.";
      setSendStates((c) => ({ ...c, [key]: "added" }));
      setSendMessages((c) => ({ ...c, [key]: message }));
      logActivity(movie, "added", message, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add this movie to Radarr.";
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({ ...c, [key]: message }));
      logActivity(movie, "error", message, false);
    }
  }

  // ── CSS Style presets ──────────────────────────────────────────────────
  const inputCls =
    "h-11 rounded-xl border border-cornsilk/10 bg-ink/60 px-4 text-sm text-cornsilk placeholder-peach/50 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold/40 transition-all duration-200";

  const labelCls = "text-xs font-bold uppercase tracking-wider text-cornsilk/60";

  const isRadarrSetup = settings.radarrUrl && settings.hasRadarrApiKey;
  const isUserSetup = config.username.trim().length > 0;
  const busy = isFetching || isSyncing;

  const connectionDot = isTestingConnection
    ? { dotClass: "bg-gold animate-pulse", textClass: "text-gold", label: "Testing…" }
    : connectionTestResult?.success
      ? { dotClass: "bg-pine", textClass: "text-peach", label: "Connected" }
      : connectionTestResult
        ? { dotClass: "bg-rose-500", textClass: "text-rose-400", label: "Failed" }
        : { dotClass: "bg-pine/50", textClass: "text-peach/70", label: "Not tested" };

  // ── Login gate ─────────────────────────────────────────────────────────
  if (authRequired && !isAuthed) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-card w-full max-w-sm rounded-2xl p-8 space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-pine to-gold shadow-md shadow-gold/20">
              <LockIcon className="h-6 w-6 text-ink" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-cornsilk">Sign in</h1>
              <p className="text-xs text-peach/70 mt-1">This instance is password protected.</p>
            </div>
          </div>
          <form className="space-y-3" onSubmit={submitLogin}>
            <input
              autoFocus
              className={`${inputCls} w-full`}
              placeholder="Password"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            {loginError && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
                {loginError}
              </div>
            )}
            <button
              className="h-11 w-full rounded-xl bg-gradient-to-r from-pine to-gold text-sm font-bold text-ink shadow-md shadow-gold/20 transition hover:from-gold hover:to-peach disabled:opacity-50"
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

  return (
    <>
      {/* ── Fixed glassmorphic navigation bar ──────────────────────────────── */}
      <nav className="fixed inset-x-0 top-0 z-40 h-16 border-b border-cornsilk/5 bg-ink/70 backdrop-blur-xl transition-all duration-200">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex flex-shrink-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-pine to-gold shadow-md shadow-gold/20">
              <FilmIcon className="h-5 w-5 text-ink" />
            </div>
            <span className="font-extrabold text-base tracking-tight text-cornsilk">
              LB<span className="text-gold">→</span>Radarr
            </span>
          </div>

          <form className="flex min-w-0 max-w-xl flex-1 items-center gap-2" onSubmit={syncFeed}>
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-peach/70">
                <UserIcon className="h-4 w-4" />
              </span>
              <input
                className="h-10 w-full rounded-xl border border-cornsilk/10 bg-ink/40 pl-10 pr-4 text-sm text-cornsilk placeholder-peach/50 transition-all duration-200 focus:border-gold/40 focus:outline-none focus:ring-1 focus:ring-gold"
                placeholder="Letterboxd username"
                value={config.username}
                onChange={(e) => updateConfig("username", e.target.value)}
              />
            </div>

            <button
              className="h-10 flex-shrink-0 rounded-xl bg-gradient-to-r from-pine to-gold px-5 text-sm font-bold text-ink shadow-md shadow-gold/10 transition-all duration-200 hover:from-gold hover:to-peach focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              type="submit"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cornsilk/30 border-t-cornsilk" />
                  {isSyncing ? "Syncing" : "Fetching"}
                </span>
              ) : (
                "Sync Feed"
              )}
            </button>
          </form>

          <div className="flex items-center gap-2">
            <button
              aria-label="Open sync activity"
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-cornsilk/10 bg-ink/40 text-cornsilk/60 transition-all duration-200 hover:bg-cornsilk/5 hover:text-cornsilk focus:outline-none focus:ring-1 focus:ring-cornsilk/20"
              onClick={() => setIsActivityOpen(true)}
              type="button"
            >
              <ClockIcon className="h-5 w-5" />
              {activityLog.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-ink shadow">
                  {activityLog.length > 99 ? "99+" : activityLog.length}
                </span>
              )}
            </button>
            <button
              aria-label="Open settings"
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-cornsilk/10 bg-ink/40 text-cornsilk/60 transition-all duration-200 hover:bg-cornsilk/5 hover:text-cornsilk focus:outline-none focus:ring-1 focus:ring-cornsilk/20"
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
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Dashboard Layout ────────────────────────────────────────── */}
      <main className="min-h-screen pt-16 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl py-6">
          {movies.length === 0 && !busy && (
            <div className="animate-fade-in grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-10 md:py-16">
              <div className="lg:col-span-7 space-y-6 text-left">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold border border-gold/10">
                  <SparklesIcon className="h-3.5 w-3.5" />
                  Premium Media Connector
                </span>
                <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight text-cornsilk">
                  Seamlessly Sync Your <br />
                  <span className="bg-gradient-to-r from-gold to-peach bg-clip-text text-transparent">
                    Letterboxd Reviews
                  </span>{" "}
                  to Radarr
                </h1>
                <p className="text-cornsilk/60 text-base md:text-lg max-w-xl leading-relaxed">
                  Breathe life into your movie library. Letterboxd-to-Radarr parses your RSS feeds on
                  a schedule and queues films directly into your home theater setup based on your
                  review stars.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  <div className="glass-card p-4 rounded-xl flex gap-3">
                    <div className="text-gold mt-0.5">
                      <CheckIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-cornsilk">Background Syncing</h4>
                      <p className="text-xs text-peach/70 mt-1">
                        A server scheduler keeps Radarr in sync even when this tab is closed.
                      </p>
                    </div>
                  </div>
                  <div className="glass-card p-4 rounded-xl flex gap-3">
                    <div className="text-gold mt-0.5">
                      <CheckIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-cornsilk">Configurable Automation</h4>
                      <p className="text-xs text-peach/70 mt-1">
                        Set thresholds, quality profile, and root folder for hands-off downloads.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="glass-card rounded-2xl p-6 md:p-8 space-y-6">
                  <h3 className="text-lg font-extrabold text-cornsilk flex items-center gap-2">
                    Quick Connection Guide
                  </h3>

                  <div className="space-y-4">
                    <div className="flex gap-4 relative">
                      <div className="absolute left-[17px] top-9 bottom-0 w-[1px] bg-pine" />
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                          isRadarrSetup
                            ? "border-pine/30 bg-pine/15 text-peach"
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
                        <p className="text-xs text-cornsilk/60">
                          Configure your Radarr base URL and API key in Settings to permit syncs.
                        </p>
                        {!isRadarrSetup && (
                          <button
                            className="mt-2 text-xs font-semibold text-gold hover:text-peach inline-flex items-center gap-1 transition-colors"
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
                            ? "border-pine/30 bg-pine/15 text-peach"
                            : "border-cornsilk/10 bg-ink/60 text-cornsilk/60"
                        }`}
                      >
                        {isUserSetup ? <CheckIcon className="h-4 w-4" /> : "2"}
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-cornsilk">Enter Letterboxd Handle</h4>
                        <p className="text-xs text-cornsilk/60">
                          Provide your Letterboxd username in the navigation bar to parse reviews.
                        </p>
                        {!isUserSetup && (
                          <div className="mt-2.5 flex max-w-xs gap-1.5">
                            <input
                              className="h-8 rounded-lg border border-cornsilk/5 bg-ink/40 px-2.5 text-xs text-cornsilk placeholder-peach/40 focus:outline-none focus:ring-1 focus:ring-gold"
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
                        <p className="text-xs text-cornsilk/60">
                          Click &quot;Sync Feed&quot; to inspect, filter, and sync your favorite movies.
                        </p>
                        {isRadarrSetup && isUserSetup && (
                          <button
                            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-1.5 text-xs font-bold text-ink shadow-lg shadow-gold/20 hover:bg-gold transition"
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
            <div className="space-y-6 py-6">
              <div className="h-6 w-48 rounded bg-cornsilk/5 animate-pulse" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="glass-card aspect-[2/3] rounded-xl overflow-hidden shimmer-wrapper">
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
          )}

          {movies.length > 0 && (
            <div className="space-y-6">
              {autoSyncSummary && (
                <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-pine/30 bg-pine/10 px-4 py-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-pine shadow-md shadow-pine/20">
                    <SparklesIcon className="h-4 w-4 text-cornsilk" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-peach">
                      {autoSyncSummary.count} {autoSyncSummary.count === 1 ? "film" : "films"} rated ≥
                      {autoSyncSummary.threshold.toFixed(1)}★ sent to Radarr automatically
                    </p>
                    <p className="text-[11px] text-peach/70">Track each result in the activity panel.</p>
                  </div>
                  <button
                    className="text-xs font-semibold text-peach/80 hover:text-peach transition-colors"
                    onClick={() => setIsActivityOpen(true)}
                    type="button"
                  >
                    View activity
                  </button>
                  <button
                    aria-label="Dismiss auto-sync summary"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-peach/70 transition hover:bg-cornsilk/5 hover:text-cornsilk"
                    onClick={() => setAutoSyncSummary(null)}
                    type="button"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold">
                    <UserIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-peach/70">Letterboxd User</p>
                    <h3
                      className="text-base font-extrabold text-cornsilk truncate max-w-[160px]"
                      title={config.username || settings.reviewer}
                    >
                      {config.username || settings.reviewer}
                    </h3>
                    <p className="text-[11px] text-cornsilk/60">{stats.total} total films found</p>
                  </div>
                </div>

                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-peach/10 text-peach">
                    <ServerIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-peach/70">Auto-Download</p>
                    <h3 className="text-base font-extrabold text-cornsilk flex items-center gap-1.5">
                      {settings.autoThreshold === -1 ? (
                        <span className="text-peach/70 text-sm">Disabled</span>
                      ) : (
                        <span className="text-peach text-sm">
                          Active (≥{settings.autoThreshold.toFixed(1)}★)
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-cornsilk/60">Runs on a schedule + on sync</p>
                  </div>
                </div>

                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine/15 text-peach">
                    <CheckIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-peach/70">Synchronization</p>
                    <h3 className="text-base font-extrabold text-cornsilk flex items-center gap-2">
                      <span>{stats.synced} Synced</span>
                    </h3>
                    <p className="text-[11px] text-cornsilk/60">
                      {stats.failed} failed, {stats.syncing} active
                    </p>
                  </div>
                </div>

                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold">
                    <StarIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-peach/70">Average Rating</p>
                    <h3 className="text-base font-extrabold text-cornsilk">{stats.averageRating} ★</h3>
                    <p className="text-[11px] text-cornsilk/60">
                      {stats.filtered} syncable (≥{minimumRating.toFixed(1)}★)
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-cornsilk/5 bg-ink/30 px-5 py-4">
                <div className="flex items-center gap-2 text-sm text-cornsilk/60">
                  <span>Displaying</span>
                  <strong className="text-cornsilk font-extrabold">{stats.filtered}</strong>
                  <span>of</span>
                  <strong className="text-cornsilk/80">{stats.total}</strong>
                  <span>cached movies.</span>
                  {fetchError && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/10 px-2 py-0.5 rounded">
                      <ExclamationIcon className="h-3 w-3" /> {fetchError}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="group relative flex items-center gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-peach/70">
                      Show Rated ≥
                    </label>
                    <span className="text-peach/50 transition-colors hover:text-cornsilk/80" tabIndex={0}>
                      <InfoIcon className="h-3.5 w-3.5" />
                    </span>
                    <span
                      className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-60 rounded-lg border border-cornsilk/10 bg-ink px-3 py-2 text-[11px] font-medium leading-relaxed text-cornsilk/80 opacity-0 shadow-xl transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                      role="tooltip"
                    >
                      This only changes which films are shown here. What gets downloaded is controlled
                      by the Auto-Download threshold in Settings.
                    </span>
                  </span>
                  <div className="flex h-9 rounded-lg border border-cornsilk/5 bg-ink/60 p-0.5">
                    {[3.0, 3.5, 4.0, 4.5, 5.0].map((val) => (
                      <button
                        key={val}
                        className={`h-full px-3 text-xs font-bold rounded-md transition-all ${
                          minimumRating === val ? "bg-gold text-ink shadow" : "text-cornsilk/60 hover:text-cornsilk"
                        }`}
                        onClick={() => setMinimumRating(val)}
                        type="button"
                      >
                        {val.toFixed(1)}★
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {filteredMovies.length === 0 ? (
                <div className="glass-card flex flex-col items-center justify-center py-20 text-center rounded-2xl">
                  <div className="h-12 w-12 rounded-full bg-ink flex items-center justify-center text-peach/70 mb-3">
                    <FilmIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-cornsilk">No reviews found matching filter</h3>
                  <p className="text-xs text-peach/70 mt-1 max-w-xs">
                    There are no reviews rated {minimumRating.toFixed(1)}★ or higher. Adjust your filter
                    controls above to view more.
                  </p>
                </div>
              ) : (
                <div className="animate-fade-in grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 py-2">
                  {filteredMovies.map((movie) => {
                    const key = movieKey(movie);
                    const sendState = sendStates[key] ?? "idle";

                    return (
                      <button
                        key={key}
                        aria-label={`${movie.title} (${movie.year ?? "unknown"}) — ${movie.rating.toFixed(1)} stars`}
                        className={`poster-card aspect-[2/3] overflow-hidden rounded-xl bg-ink/60 text-left focus:outline-none ${posterRingClass(sendState)}`}
                        onClick={() => setActiveMovieKey(key)}
                        type="button"
                      >
                        {movie.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                            loading="lazy"
                            src={movie.posterUrl}
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-pine to-ink p-4">
                            <FilmIcon className="h-9 w-9 text-pine/70" />
                            <span className="line-clamp-3 text-center text-[10px] font-bold leading-tight text-peach/70">
                              {movie.title}
                            </span>
                          </div>
                        )}

                        <div className="poster-gradient absolute inset-0 pointer-events-none" />

                        <div className="absolute inset-x-2 top-2 flex justify-between pointer-events-none">
                          <div className="rounded-lg bg-black/60 px-2 py-0.5 backdrop-blur-md border border-cornsilk/5">
                            <span className="text-[10px] font-bold text-gold flex items-center gap-0.5">
                              ★ {movie.rating.toFixed(1)}
                            </span>
                          </div>

                          {sendState === "added" && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-pine shadow-md shadow-pine/30 border border-peach/30">
                              <CheckIcon className="h-3 w-3 text-cornsilk" />
                            </div>
                          )}
                          {sendState === "error" && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 shadow-md shadow-rose-500/30 border border-rose-400/20">
                              <XIcon className="h-2.5 w-2.5 text-cornsilk" />
                            </div>
                          )}
                          {sendState === "loading" && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gold shadow-md shadow-gold/30 border border-gold/20 animate-spin">
                              <span className="h-2 w-2 rounded-full border-b border-cornsilk" />
                            </div>
                          )}
                        </div>

                        <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none">
                          <p className="mb-0.5 text-[10px] font-bold text-cornsilk/60">{movie.year ?? "—"}</p>
                          <h3 className="line-clamp-2 text-xs font-extrabold leading-snug text-cornsilk group-hover:text-gold transition-colors">
                            {movie.title}
                          </h3>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Movie Detail Modal ─────────────────────────────────────────────── */}
      {activeMovieKey && activeMovie && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveMovieKey(null);
          }}
        >
          <div className="glass-modal animate-fade-in flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-md sm:rounded-2xl transition-all border border-cornsilk/10">
            <div className="relative h-40 flex-shrink-0 overflow-hidden bg-ink">
              {activeMovie.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-20 scale-110 blur-xl"
                  src={activeMovie.posterUrl}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-pine to-ink" />
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-ink to-transparent" />

              <div className="absolute inset-x-4 top-4 flex justify-between items-center">
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

              <div className="absolute left-6 bottom-[-20px] h-24 w-16 overflow-hidden rounded-lg shadow-md border border-cornsilk/10 bg-ink">
                {activeMovie.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="h-full w-full object-cover" src={activeMovie.posterUrl} />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-ink">
                    <FilmIcon className="h-5 w-5 text-pine/70" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pt-6">
              <div className="px-6 pb-4 pt-2 border-b border-cornsilk/5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl font-extrabold leading-tight text-cornsilk tracking-tight">
                      {activeMovie.title}
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-cornsilk/60">
                      {activeMovie.year ?? "Unknown year"}
                    </p>
                  </div>

                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className="text-xl font-black text-gold flex items-center gap-1">
                      ★ {activeMovie.rating.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-peach/70 font-medium">Review Score</span>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5 border-b border-cornsilk/5 bg-ink/20">
                {activeMovie.reviewText ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-peach/70">
                      My Written Review
                    </p>
                    <div className="relative pl-4 border-l-2 border-gold/50">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-cornsilk/80 italic">
                        &quot;{activeMovie.reviewText}&quot;
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs italic text-peach/70">No review text written for this film.</p>
                )}
              </div>

              <div className="px-6 py-5 bg-ink/40">
                {activeSendState === "added" ? (
                  <div className="flex items-center gap-3.5 rounded-xl border border-pine/30 bg-pine/10 p-4 animate-fade-in">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-pine shadow-md shadow-pine/20">
                      <CheckIcon className="h-4 w-4 text-cornsilk" />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-peach">Added to Radarr</p>
                      <p className="mt-0.5 text-xs text-peach/70">
                        {activeMessage || "Film successfully synchronized."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pine to-gold py-3.5 text-sm font-extrabold text-ink shadow-lg shadow-gold/20 transition hover:from-gold hover:to-peach active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={activeSendState === "loading"}
                      onClick={() => void sendToRadarr(activeMovie)}
                      type="button"
                    >
                      {activeSendState === "loading" ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-cornsilk/30 border-t-cornsilk" />
                          Sending to Radarr…
                        </>
                      ) : activeSendState === "error" ? (
                        <>
                          <ArrowPathIcon className="h-4 w-4" />
                          Retry Connection
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
          <aside className="glass-modal animate-fade-in flex h-full w-full max-w-md flex-col border-l border-cornsilk/10 shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-cornsilk/5 px-6 pb-4 pt-5">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-peach/70">
                  Recent Syncs
                </p>
                <h2 className="text-lg font-extrabold text-cornsilk">Sync Activity</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label="Refresh activity"
                  className="h-8 rounded-lg border border-cornsilk/10 bg-ink/60 px-3 text-xs font-bold text-cornsilk/80 transition hover:bg-cornsilk/5 hover:text-cornsilk"
                  onClick={() => void loadActivity(config.username.trim() || settings.reviewer.trim())}
                  type="button"
                >
                  Refresh
                </button>
                <button
                  aria-label="Close activity"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cornsilk/5 text-cornsilk/60 border border-cornsilk/5 transition hover:bg-cornsilk/10 hover:text-cornsilk"
                  onClick={() => setIsActivityOpen(false)}
                  type="button"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {activityLog.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-peach/70">
                    <ClockIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-cornsilk">No sync activity yet</h3>
                  <p className="mt-1 max-w-xs text-xs text-peach/70">
                    Films added to Radarr—automatically or manually—will appear here with their outcome.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {activityLog.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start gap-3 rounded-xl border border-cornsilk/5 bg-ink/30 p-3"
                    >
                      <div
                        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                          entry.outcome === "added"
                            ? "bg-pine/20 text-peach"
                            : "bg-rose-500/15 text-rose-400"
                        }`}
                      >
                        {entry.outcome === "added" ? (
                          <CheckIcon className="h-3.5 w-3.5" />
                        ) : (
                          <ExclamationIcon className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-bold text-cornsilk">
                            {entry.title}
                            {entry.year != null && (
                              <span className="ml-1 font-medium text-peach/70">{entry.year}</span>
                            )}
                          </h4>
                        </div>
                        <p
                          className={`mt-0.5 line-clamp-2 text-xs leading-relaxed ${
                            entry.outcome === "added" ? "text-cornsilk/60" : "text-rose-400/80"
                          }`}
                        >
                          {entry.message}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              entry.auto
                                ? "bg-peach/10 text-peach border border-peach/20"
                                : "bg-cornsilk/5 text-cornsilk/60 border border-cornsilk/5"
                            }`}
                          >
                            {entry.auto ? "Auto" : "Manual"}
                          </span>
                          <span className="text-[10px] text-peach/70">{formatRelativeTime(entry.at)}</span>
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

      {/* ── Settings Modal ─────────────────────────────────────────────────── */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSettingsOpen(false);
          }}
        >
          <div className="glass-modal flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-xl sm:rounded-2xl border border-cornsilk/10">
            <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-cornsilk/5 px-6 pb-4 pt-5">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-peach/70">
                  Control Panel
                </p>
                <h2 className="text-lg font-extrabold text-cornsilk">Application Settings</h2>
              </div>
              <button
                aria-label="Close settings"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cornsilk/5 text-cornsilk/60 border border-cornsilk/5 transition hover:bg-cornsilk/10 hover:text-cornsilk"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <form className="space-y-4" onSubmit={saveSettings}>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gold flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  Radarr Endpoint Configuration
                </h4>

                <div className="grid grid-cols-1 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2">
                      <span className={labelCls}>Radarr Base URL</span>
                      <span className={`flex items-center gap-1 text-[10px] font-bold ${connectionDot.textClass}`}>
                        <span className={`h-2 w-2 rounded-full ${connectionDot.dotClass}`} />
                        {connectionDot.label}
                      </span>
                    </span>
                    <input
                      className={inputCls}
                      placeholder="e.g. http://192.168.1.100:7878"
                      value={settingsDraft.radarrUrl}
                      onBlur={maybeAutoTestConnection}
                      onChange={(e) => setSettingsDraft((c) => ({ ...c, radarrUrl: e.target.value }))}
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>API Token Key</span>
                    <input
                      className={inputCls}
                      placeholder={
                        settings.hasRadarrApiKey ? "Saved — leave blank to keep unchanged" : "Paste Radarr API Key"
                      }
                      type="password"
                      value={settingsDraft.radarrApiKey}
                      onBlur={maybeAutoTestConnection}
                      onChange={(e) => setSettingsDraft((c) => ({ ...c, radarrApiKey: e.target.value }))}
                    />
                  </label>
                </div>

                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gold flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  Radarr Library Targets
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Quality Profile</span>
                    <div className="relative">
                      <select
                        className="h-11 w-full rounded-xl border border-cornsilk/10 bg-ink/60 px-4 pr-10 text-sm text-cornsilk appearance-none focus:outline-none focus:ring-1 focus:ring-gold cursor-pointer disabled:opacity-50"
                        disabled={!radarrOptions}
                        value={settingsDraft.qualityProfileId === "" ? "" : String(settingsDraft.qualityProfileId)}
                        onChange={(e) =>
                          setSettingsDraft((c) => ({
                            ...c,
                            qualityProfileId: e.target.value === "" ? "" : Number(e.target.value),
                          }))
                        }
                      >
                        <option value="">{isLoadingOptions ? "Loading…" : "Auto (first available)"}</option>
                        {radarrOptions?.qualityProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-peach/70 text-xs">
                        ▼
                      </span>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Root Folder</span>
                    <div className="relative">
                      <select
                        className="h-11 w-full rounded-xl border border-cornsilk/10 bg-ink/60 px-4 pr-10 text-sm text-cornsilk appearance-none focus:outline-none focus:ring-1 focus:ring-gold cursor-pointer disabled:opacity-50"
                        disabled={!radarrOptions}
                        value={settingsDraft.rootFolderPath}
                        onChange={(e) => setSettingsDraft((c) => ({ ...c, rootFolderPath: e.target.value }))}
                      >
                        <option value="">{isLoadingOptions ? "Loading…" : "Auto (first available)"}</option>
                        {radarrOptions?.rootFolders.map((f) => (
                          <option key={f.path} value={f.path}>
                            {f.path}
                          </option>
                        ))}
                      </select>
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-peach/70 text-xs">
                        ▼
                      </span>
                    </div>
                  </label>
                </div>
                {!radarrOptions && (
                  <p className="text-[11px] text-peach/70 leading-normal">
                    Test the connection to load available quality profiles and root folders.
                  </p>
                )}

                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gold flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  Auto-Sync Preferences
                </h4>

                <div className="flex flex-col gap-1.5">
                  <span className={labelCls}>Trigger Auto-Download Threshold</span>
                  <div className="relative">
                    <select
                      className="h-11 w-full rounded-xl border border-cornsilk/10 bg-ink/60 px-4 pr-10 text-sm text-cornsilk appearance-none focus:outline-none focus:ring-1 focus:ring-gold cursor-pointer"
                      value={settingsDraft.autoThreshold}
                      onChange={(e) =>
                        setSettingsDraft((c) => ({ ...c, autoThreshold: Number(e.target.value) }))
                      }
                    >
                      <option value={-1}>Disable Automatic Syncing</option>
                      {ratingOptions.map((r) => (
                        <option key={r} value={r}>
                          Sync Rated ≥ {r.toFixed(1)} ★
                        </option>
                      ))}
                    </select>
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-peach/70 text-xs">
                      ▼
                    </span>
                  </div>
                  <p className="text-[11px] text-peach/70 leading-normal">
                    The background scheduler and the Sync Feed button add movies rated at or above this
                    threshold to your Radarr library automatically.
                  </p>
                </div>

                <div className="rounded-xl border border-cornsilk/5 bg-ink/20 p-4 space-y-1.5 text-xs text-peach/70">
                  <p>
                    <span className="font-semibold text-cornsilk/60">Server Path: </span>
                    {settings.dataDir || "Fetching data path..."}
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    Settings and cached reviews are stored in a SQLite database in this directory. Your
                    Radarr API key is encrypted at rest.
                  </p>
                </div>

                {connectionTestResult && (
                  <div
                    className={`rounded-xl border p-3.5 flex items-start gap-2.5 text-xs animate-fade-in ${
                      connectionTestResult.success
                        ? "border-pine/30 bg-pine/10 text-peach"
                        : "border-rose-500/20 bg-rose-500/5 text-rose-400"
                    }`}
                  >
                    {connectionTestResult.success ? (
                      <CheckIcon className="h-4 w-4 flex-shrink-0 text-peach" />
                    ) : (
                      <ExclamationIcon className="h-4 w-4 flex-shrink-0 text-rose-400" />
                    )}
                    <div className="space-y-1">
                      <p className="font-extrabold">
                        {connectionTestResult.success ? "Success" : "Connection Failed"}
                      </p>
                      <p className="leading-relaxed text-cornsilk/60">{connectionTestResult.message}</p>
                    </div>
                  </div>
                )}

                {settingsMessage && (
                  <div className="rounded-xl border border-pine/30 bg-pine/10 px-4 py-3 text-xs font-semibold text-peach">
                    {settingsMessage}
                  </div>
                )}
                {settingsError && (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-semibold text-rose-400">
                    {settingsError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    className="h-10 rounded-xl border border-cornsilk/10 bg-ink/60 px-5 text-xs font-bold text-cornsilk/80 transition hover:bg-cornsilk/5 hover:text-cornsilk disabled:opacity-50"
                    disabled={isTestingConnection || !settingsDraft.radarrUrl}
                    onClick={testConnection}
                    type="button"
                  >
                    {isTestingConnection ? "Testing Connection..." : "Test Connection"}
                  </button>

                  <button
                    className="h-10 rounded-xl bg-gradient-to-r from-pine to-gold px-6 text-xs font-bold text-ink shadow-md shadow-gold/20 transition hover:from-gold hover:to-peach disabled:opacity-50"
                    disabled={isSavingSettings}
                    type="submit"
                  >
                    {isSavingSettings ? "Saving..." : "Save Settings"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
