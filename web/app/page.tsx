"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import type {
  MovieReview,
  PublicSettings,
  RadarrAddResponse,
} from "@/app/types/movie";

interface LocalConfig {
  username: string;
}

type SendState = "idle" | "loading" | "added" | "error";

const STORAGE_KEY = "letterboxd-to-radarr-local-config";
const ratingOptions = Array.from({ length: 9 }, (_, i) => 1 + i * 0.5);

const defaultConfig: LocalConfig = { username: "" };

const defaultSettings: PublicSettings = {
  reviewer: "",
  radarrUrl: "",
  hasRadarrApiKey: false,
  dataDir: "",
};

function movieKey(movie: MovieReview): string {
  return `${movie.title}-${movie.year ?? "unknown"}`;
}

function apiMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return fallback;
}

function isMovieReview(value: unknown): value is MovieReview {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.title === "string" &&
    (typeof m.year === "number" || m.year === null) &&
    typeof m.rating === "number" &&
    (typeof m.reviewedAt === "string" || typeof m.reviewedAt === "undefined")
  );
}

function reviewTime(movie: MovieReview): number {
  if (!movie.reviewedAt) return 0;
  const time = Date.parse(movie.reviewedAt);
  return Number.isNaN(time) ? 0 : time;
}

function sortMoviesByRecencyAndStars(movies: MovieReview[]): MovieReview[] {
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
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

// ── Status badge ring class ─────────────────────────────────────────────────

function posterRingClass(state: SendState): string {
  if (state === "added") return "ring-2 ring-emerald-500/80 ring-offset-2 ring-offset-zinc-950";
  if (state === "error") return "ring-2 ring-rose-500/70 ring-offset-2 ring-offset-zinc-950";
  if (state === "loading") return "ring-2 ring-amber-500/50 ring-offset-2 ring-offset-zinc-950 animate-pulse";
  return "ring-1 ring-white/5";
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Home() {
  const [config, setConfig] = useState<LocalConfig>(defaultConfig);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [settings, setSettings] = useState<PublicSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState({
    radarrUrl: "",
    radarrApiKey: "",
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  
  // Connection Test States
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [minimumRating, setMinimumRating] = useState(4);
  const [autoDownloadRating, setAutoDownloadRating] = useState(4);
  const [movies, setMovies] = useState<MovieReview[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [hasAutoFetched, setHasAutoFetched] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [sendMessages, setSendMessages] = useState<Record<string, string>>({});
  const [activeMovieKey, setActiveMovieKey] = useState<string | null>(null);

  // ── localStorage hydration ─────────────────────────────────────────────
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<LocalConfig> & { 
          minimumRating?: number;
          autoDownloadRating?: number;
        };
        setConfig({ username: parsed.username ?? "" });
        if (typeof parsed.minimumRating === "number") setMinimumRating(parsed.minimumRating);
        if (typeof parsed.autoDownloadRating === "number") setAutoDownloadRating(parsed.autoDownloadRating);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHasLoadedConfig(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedConfig) return;
    window.localStorage.setItem(
      STORAGE_KEY, 
      JSON.stringify({ ...config, minimumRating, autoDownloadRating })
    );
  }, [config, hasLoadedConfig, minimumRating, autoDownloadRating]);

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!hasLoadedConfig || !settings.reviewer || hasAutoFetched || isFetching) return;

    const username = config.username.trim() || settings.reviewer.trim();
    if (!username) return;

    setHasAutoFetched(true);
    void fetchReviewsForUsername(username, settings);
  }, [config.username, hasAutoFetched, hasLoadedConfig, isFetching, settings]);

  // ── Close modals on ESC ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (activeMovieKey) {
        setActiveMovieKey(null);
        return;
      }
      if (isSettingsOpen) setIsSettingsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeMovieKey, isSettingsOpen]);

  // ── Auto-close movie modal after successful add ────────────────────────
  useEffect(() => {
    if (!activeMovieKey || sendStates[activeMovieKey] !== "added") return;
    const t = setTimeout(() => setActiveMovieKey(null), 2000);
    return () => clearTimeout(t);
  }, [activeMovieKey, sendStates]);

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

  // Synced statistics helper
  const stats = useMemo(() => {
    const total = movies.length;
    const filtered = filteredMovies.length;
    const values = Object.values(sendStates);
    const synced = values.filter((s) => s === "added").length;
    const failed = values.filter((s) => s === "error").length;
    const syncing = values.filter((s) => s === "loading").length;

    // Calculate average rating of cached movies
    const averageRating = total > 0 
      ? (movies.reduce((acc, m) => acc + m.rating, 0) / total).toFixed(1)
      : "0.0";

    return { total, filtered, synced, failed, syncing, averageRating };
  }, [movies, filteredMovies, sendStates]);

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateConfig(field: keyof LocalConfig, value: string) {
    setConfig((c) => ({ ...c, [field]: value }));
  }

  // ── API handlers ───────────────────────────────────────────────────────
  async function loadSettings() {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as PublicSettings | null;
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to load settings."));
      setSettings(body);
      if (body.reviewer) {
        setConfig((current) => (current.username.trim() ? current : { username: body.reviewer }));
      }
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
      });
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to load settings.");
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });
      const body = (await res.json().catch(() => null)) as PublicSettings | null;
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to save settings."));
      setSettings(body);
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
      });
      setSettingsMessage("Settings successfully saved and loaded.");
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
        body: JSON.stringify(settingsDraft),
      });
      const data = (await res.json()) as { success: boolean; message: string };
      setConnectionTestResult({
        success: data.success,
        message: data.message,
      });
    } catch (err) {
      setConnectionTestResult({
        success: false,
        message: err instanceof Error ? err.message : "An unexpected network error occurred.",
      });
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function fetchReviews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = config.username.trim();
    await fetchReviewsForUsername(username);
  }

  async function fetchReviewsForUsername(username: string, currentSettings = settings) {
    if (!username) {
      setFetchError("Enter a Letterboxd username.");
      return;
    }
    setIsFetching(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/letterboxd?username=${encodeURIComponent(username)}`);
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to fetch Letterboxd reviews."));
      if (!Array.isArray(body)) throw new Error("Unexpected API response.");
      const fetchedMovies = sortMoviesByRecencyAndStars(body.filter(isMovieReview));
      setMovies(fetchedMovies);
      setSendStates({});
      setSendMessages({});
      autoDownloadHighRatedMovies(fetchedMovies, currentSettings);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unable to fetch Letterboxd reviews.");
    } finally {
      setIsFetching(false);
    }
  }

  function autoDownloadHighRatedMovies(fetchedMovies: MovieReview[], currentSettings = settings) {
    // If auto-download is disabled (-1) or no Radarr credentials
    if (autoDownloadRating === -1 || !currentSettings.radarrUrl || !currentSettings.hasRadarrApiKey) {
      return;
    }

    const queued = new Set<string>();
    for (const movie of fetchedMovies) {
      const key = movieKey(movie);
      if (movie.rating < autoDownloadRating || queued.has(key)) {
        continue;
      }

      queued.add(key);
      void sendToRadarr(movie, currentSettings);
    }
  }

  async function sendToRadarr(movie: MovieReview, currentSettings = settings) {
    const key = movieKey(movie);
    if (!currentSettings.radarrUrl || !currentSettings.hasRadarrApiKey) {
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({
        ...c,
        [key]: "Set up your Radarr Connection in Settings first.",
      }));
      return;
    }
    setSendStates((c) => ({ ...c, [key]: "loading" }));
    setSendMessages((c) => ({ ...c, [key]: "" }));
    try {
      const res = await fetch("/api/radarr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: movie.title, year: movie.year }),
      });
      const body = (await res.json().catch(() => null)) as Partial<RadarrAddResponse> | null;
      if (!res.ok) throw new Error(apiMessage(body, "Unable to add this movie to Radarr."));
      setSendStates((c) => ({ ...c, [key]: "added" }));
      setSendMessages((c) => ({ ...c, [key]: body?.message ?? "Movie successfully added." }));
    } catch (err) {
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({
        ...c,
        [key]: err instanceof Error ? err.message : "Unable to add this movie to Radarr.",
      }));
    }
  }

  // ── CSS Style presets ──────────────────────────────────────────────────
  const inputCls =
    "h-11 rounded-xl border border-white/10 bg-zinc-900/60 px-4 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500/40 transition-all duration-200";

  const labelCls = "text-xs font-bold uppercase tracking-wider text-zinc-400";

  // Check setup states for stepper
  const isRadarrSetup = settings.radarrUrl && settings.hasRadarrApiKey;
  const isUserSetup = config.username.trim().length > 0;

  return (
    <>
      {/* ── Fixed glassmorphic navigation bar ──────────────────────────────── */}
      <nav className="fixed inset-x-0 top-0 z-40 h-16 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl transition-all duration-200">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">

          {/* Glowing Brand Title */}
          <div className="flex flex-shrink-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-orange-600 to-amber-500 shadow-md shadow-orange-500/20">
              <FilmIcon className="h-5 w-5 text-white" />
            </div>
            <span className="font-extrabold text-base tracking-tight text-white">
              LB<span className="text-orange-500">→</span>Radarr
            </span>
          </div>

          {/* Quick fetch form */}
          <form className="flex min-w-0 max-w-xl flex-1 items-center gap-2" onSubmit={fetchReviews}>
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500">
                <UserIcon className="h-4 w-4" />
              </span>
              <input
                className="h-10 w-full rounded-xl border border-white/10 bg-zinc-900/40 pl-10 pr-4 text-sm text-white placeholder-zinc-500 transition-all duration-200 focus:border-orange-500/40 focus:outline-none focus:ring-1 focus:ring-orange-500"
                placeholder="Letterboxd username"
                value={config.username}
                onChange={(e) => updateConfig("username", e.target.value)}
              />
            </div>

            {/* Minimum rating selector */}
            <div className="relative hidden md:block">
              <select
                className="h-10 rounded-xl border border-white/10 bg-zinc-900/40 px-3 pr-8 text-sm text-white appearance-none focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500/40 transition-all cursor-pointer"
                value={minimumRating}
                onChange={(e) => setMinimumRating(Number(e.target.value))}
              >
                {ratingOptions.map((r) => (
                  <option key={r} className="bg-zinc-950" value={r}>
                    {r.toFixed(1)}★ Minimum Filter
                  </option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 text-xs">▼</span>
            </div>

            <button
              className="h-10 flex-shrink-0 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 text-sm font-bold text-white shadow-md shadow-orange-500/10 transition-all duration-200 hover:from-orange-400 hover:to-amber-400 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isFetching}
              type="submit"
            >
              {isFetching ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Fetching
                </span>
              ) : (
                "Sync Feed"
              )}
            </button>
          </form>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2">
            <button
              aria-label="Open settings"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900/40 text-zinc-400 transition-all duration-200 hover:bg-white/5 hover:text-white focus:outline-none focus:ring-1 focus:ring-white/20"
              onClick={() => {
                setSettingsDraft({
                  radarrUrl: settings.radarrUrl,
                  radarrApiKey: "",
                });
                setSettingsMessage(null);
                setSettingsError(null);
                setConnectionTestResult(null);
                setIsSettingsOpen(true);
              }}
              type="button"
            >
              <GearIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Dashboard Layout ────────────────────────────────────────── */}
      <main className="min-h-screen pt-16 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl py-6">

          {/* ── Onboarding / Welcome & Empty State ─────────────────────────── */}
          {movies.length === 0 && !isFetching && (
            <div className="animate-fade-in grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-10 md:py-16">
              
              {/* Left Cinematic Banner Column */}
              <div className="lg:col-span-7 space-y-6 text-left">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-400 border border-orange-500/10">
                  <SparklesIcon className="h-3.5 w-3.5" />
                  Premium Media Connector
                </span>
                <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight text-white">
                  Seamlessly Sync Your <br />
                  <span className="bg-gradient-to-r from-orange-500 to-amber-400 bg-clip-text text-transparent">
                    Letterboxd Reviews
                  </span> to Radarr
                </h1>
                <p className="text-zinc-400 text-base md:text-lg max-w-xl leading-relaxed">
                  Breathe life into your movie library. Letterboxd-to-Radarr automatically parses your RSS feeds and queues films directly into your home theater setup based on your review stars.
                </p>
                
                {/* Integration Info Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  <div className="glass-card p-4 rounded-xl flex gap-3">
                    <div className="text-orange-400 mt-0.5">
                      <CheckIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Instant API Syncing</h4>
                      <p className="text-xs text-zinc-500 mt-1">Direct integration with your local or cloud Radarr server via REST APIs.</p>
                    </div>
                  </div>
                  <div className="glass-card p-4 rounded-xl flex gap-3">
                    <div className="text-orange-400 mt-0.5">
                      <CheckIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Configurable Automation</h4>
                      <p className="text-xs text-zinc-500 mt-1">Set thresholds to auto-download high-star reviews without manual intervention.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Step-by-Step Stepper Card Column */}
              <div className="lg:col-span-5">
                <div className="glass-card rounded-2xl p-6 md:p-8 space-y-6">
                  <h3 className="text-lg font-extrabold text-white flex items-center gap-2">
                    Quick Connection Guide
                  </h3>
                  
                  <div className="space-y-4">
                    
                    {/* Step 1 */}
                    <div className="flex gap-4 relative">
                      <div className="absolute left-[17px] top-9 bottom-0 w-[1px] bg-zinc-800" />
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                        isRadarrSetup 
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" 
                          : "border-white/10 bg-zinc-900/60 text-zinc-400"
                      }`}>
                        {isRadarrSetup ? <CheckIcon className="h-4 w-4" /> : "1"}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">Configure Radarr Server</h4>
                          {!isRadarrSetup && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/10">Setup Needed</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400">
                          Configure your Radarr base URL and API key in Settings to permit syncs.
                        </p>
                        {!isRadarrSetup && (
                          <button
                            className="mt-2 text-xs font-semibold text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 transition-colors"
                            onClick={() => setIsSettingsOpen(true)}
                          >
                            Configure Connection ↗
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex gap-4 relative">
                      <div className="absolute left-[17px] top-9 bottom-0 w-[1px] bg-zinc-800" />
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                        isUserSetup 
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" 
                          : "border-white/10 bg-zinc-900/60 text-zinc-400"
                      }`}>
                        {isUserSetup ? <CheckIcon className="h-4 w-4" /> : "2"}
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-white">Enter Letterboxd Handle</h4>
                        <p className="text-xs text-zinc-400">
                          Provide your Letterboxd username in the navigation bar to parse reviews.
                        </p>
                        {!isUserSetup && (
                          <div className="mt-2.5 flex max-w-xs gap-1.5">
                            <input
                              className="h-8 rounded-lg border border-white/5 bg-zinc-900/40 px-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500"
                              placeholder="e.g. username"
                              value={config.username}
                              onChange={(e) => updateConfig("username", e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex gap-4">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                        isRadarrSetup && isUserSetup 
                          ? "border-orange-500/20 bg-orange-500/10 text-orange-400" 
                          : "border-white/10 bg-zinc-900/60 text-zinc-400"
                      }`}>
                        <SparklesIcon className="h-4.5 w-4.5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-white">Load Feed & Start Syncing</h4>
                        <p className="text-xs text-zinc-400">
                          Click "Sync Feed" to inspect, filter, and sync your favorite movies.
                        </p>
                        {isRadarrSetup && isUserSetup && (
                          <button
                            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-bold text-white shadow-lg shadow-orange-500/20 hover:bg-orange-400 transition"
                            onClick={(e) => {
                              e.preventDefault();
                              void fetchReviewsForUsername(config.username);
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

          {/* ── Loading Skeleton Grid ──────────────────────────────────────── */}
          {isFetching && movies.length === 0 && (
            <div className="space-y-6 py-6">
              <div className="h-6 w-48 rounded bg-white/5 animate-pulse" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="glass-card aspect-[2/3] rounded-xl overflow-hidden shimmer-wrapper">
                    <div className="h-full w-full bg-zinc-900/40 flex flex-col justify-between p-3.5">
                      <div className="h-6 w-11 rounded bg-white/5 animate-pulse" />
                      <div className="space-y-2">
                        <div className="h-3 w-10 rounded bg-white/5 animate-pulse" />
                        <div className="h-4 w-3/4 rounded bg-white/5 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Dashboard Content ──────────────────────────────────────────── */}
          {movies.length > 0 && (
            <div className="space-y-6">

              {/* ── Beautiful Metrics Grid ─────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Metric 1: User details */}
                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                    <UserIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-500">Letterboxd User</p>
                    <h3 className="text-base font-extrabold text-white truncate max-w-[160px]" title={config.username || settings.reviewer}>
                      {config.username || settings.reviewer}
                    </h3>
                    <p className="text-[11px] text-zinc-400">{stats.total} total films found</p>
                  </div>
                </div>

                {/* Metric 2: Auto Sync Configuration */}
                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
                    <ServerIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-zinc-500">Auto-Download</p>
                    <h3 className="text-base font-extrabold text-white flex items-center gap-1.5">
                      {autoDownloadRating === -1 ? (
                        <span className="text-zinc-500 text-sm">Disabled</span>
                      ) : (
                        <span className="text-emerald-400 text-sm">Active (≥{autoDownloadRating.toFixed(1)}★)</span>
                      )}
                    </h3>
                    <p className="text-[11px] text-zinc-400">Triggered on fetch</p>
                  </div>
                </div>

                {/* Metric 3: Sync Outcomes */}
                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                    <CheckIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-500">Synchronization</p>
                    <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                      <span>{stats.synced} Synced</span>
                    </h3>
                    <p className="text-[11px] text-zinc-400">{stats.failed} failed, {stats.syncing} active</p>
                  </div>
                </div>

                {/* Metric 4: General Average */}
                <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
                    <StarIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-500">Average Rating</p>
                    <h3 className="text-base font-extrabold text-white">{stats.averageRating} ★</h3>
                    <p className="text-[11px] text-zinc-400">{stats.filtered} syncable (≥{minimumRating.toFixed(1)}★)</p>
                  </div>
                </div>

              </div>

              {/* Filter controls sub-bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-white/5 bg-zinc-900/30 px-5 py-4">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span>Displaying</span>
                  <strong className="text-white font-extrabold">{stats.filtered}</strong>
                  <span>of</span>
                  <strong className="text-zinc-300">{stats.total}</strong>
                  <span>cached movies.</span>
                  {fetchError && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/10 px-2 py-0.5 rounded">
                      <ExclamationIcon className="h-3 w-3" /> {fetchError}
                    </span>
                  )}
                </div>

                {/* Inline filter selections */}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Show Rated ≥</label>
                  <div className="flex h-9 rounded-lg border border-white/5 bg-zinc-950/60 p-0.5">
                    {[3.0, 3.5, 4.0, 4.5, 5.0].map((val) => (
                      <button
                        key={val}
                        className={`h-full px-3 text-xs font-bold rounded-md transition-all ${
                          minimumRating === val 
                            ? "bg-orange-500 text-white shadow" 
                            : "text-zinc-400 hover:text-white"
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

              {/* ── Empty Filter State ───────────────────────────────────────── */}
              {filteredMovies.length === 0 ? (
                <div className="glass-card flex flex-col items-center justify-center py-20 text-center rounded-2xl">
                  <div className="h-12 w-12 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-500 mb-3">
                    <FilmIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-white">No reviews found matching filter</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-xs">There are no reviews rated {minimumRating.toFixed(1)}★ or higher. Adjust your filter controls above to view more.</p>
                </div>
              ) : (

                /* ── Premium Poster Wall Grid ───────────────────────────────── */
                <div className="animate-fade-in grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 py-2">
                  {filteredMovies.map((movie) => {
                    const key = movieKey(movie);
                    const sendState = sendStates[key] ?? "idle";

                    return (
                      <button
                        key={key}
                        aria-label={`${movie.title} (${movie.year ?? "unknown"}) — ${movie.rating.toFixed(1)} stars`}
                        className={`poster-card aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900/60 text-left focus:outline-none ${posterRingClass(sendState)}`}
                        onClick={() => setActiveMovieKey(key)}
                        type="button"
                      >
                        {/* Film Poster Image */}
                        {movie.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                            loading="lazy"
                            src={movie.posterUrl}
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-800 to-zinc-900 p-4">
                            <FilmIcon className="h-9 w-9 text-zinc-700" />
                            <span className="line-clamp-3 text-center text-[10px] font-bold leading-tight text-zinc-500">
                              {movie.title}
                            </span>
                          </div>
                        )}

                        {/* Visual dark blend overlay */}
                        <div className="poster-gradient absolute inset-0 pointer-events-none" />

                        {/* Top Overlays */}
                        <div className="absolute inset-x-2 top-2 flex justify-between pointer-events-none">
                          {/* Stars Badge */}
                          <div className="rounded-lg bg-black/60 px-2 py-0.5 backdrop-blur-md border border-white/5">
                            <span className="text-[10px] font-bold text-amber-400 flex items-center gap-0.5">
                              ★ {movie.rating.toFixed(1)}
                            </span>
                          </div>

                          {/* Dynamic Action Icon Badge */}
                          {sendState === "added" && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow-md shadow-emerald-500/30 border border-emerald-400/20">
                              <CheckIcon className="h-3 w-3 text-white" />
                            </div>
                          )}
                          {sendState === "error" && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 shadow-md shadow-rose-500/30 border border-rose-400/20">
                              <XIcon className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                          {sendState === "loading" && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 shadow-md shadow-amber-500/30 border border-amber-400/20 animate-spin">
                              <span className="h-2 w-2 rounded-full border-b border-white" />
                            </div>
                          )}
                        </div>

                        {/* Bottom Metadata */}
                        <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none">
                          <p className="mb-0.5 text-[10px] font-bold text-zinc-400">
                            {movie.year ?? "—"}
                          </p>
                          <h3 className="line-clamp-2 text-xs font-extrabold leading-snug text-white group-hover:text-orange-400 transition-colors">
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

      {/* ── Movie Detail Modal (Theater Style Backdrop Blur) ───────────────── */}
      {activeMovieKey && activeMovie && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveMovieKey(null);
          }}
        >
          <div className="glass-modal animate-fade-in flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-md sm:rounded-2xl transition-all border border-white/10">

            {/* Immersive blurred backdrop cover */}
            <div className="relative h-40 flex-shrink-0 overflow-hidden bg-zinc-950">
              {activeMovie.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-20 scale-110 blur-xl"
                  src={activeMovie.posterUrl}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-950" />
              )}
              
              {/* Bottom linear blend for image wrapper */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent" />
              
              {/* Top Banner Content (Close and Link) */}
              <div className="absolute inset-x-4 top-4 flex justify-between items-center">
                {activeMovie.letterboxdUrl ? (
                  <a
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-900/60 px-3 py-1 text-xs font-bold text-zinc-300 backdrop-blur-md border border-white/5 hover:bg-zinc-900 transition-all hover:text-white"
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
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900/60 text-zinc-400 backdrop-blur-sm border border-white/5 transition hover:text-white hover:bg-zinc-900"
                  onClick={() => setActiveMovieKey(null)}
                  type="button"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>

              {/* Overlay Thumbnail in Banner */}
              <div className="absolute left-6 bottom-[-20px] h-24 w-16 overflow-hidden rounded-lg shadow-md border border-white/10 bg-zinc-950">
                {activeMovie.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="h-full w-full object-cover" src={activeMovie.posterUrl} />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-zinc-900"><FilmIcon className="h-5 w-5 text-zinc-700" /></div>
                )}
              </div>
            </div>

            {/* Modal Body Scroll */}
            <div className="flex-1 overflow-y-auto pt-6">

              {/* Title Metadata Block */}
              <div className="px-6 pb-4 pt-2 border-b border-white/5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl font-extrabold leading-tight text-white tracking-tight">
                      {activeMovie.title}
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-zinc-400">
                      {activeMovie.year ?? "Unknown year"}
                    </p>
                  </div>
                  
                  {/* Rating Block */}
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className="text-xl font-black text-amber-400 flex items-center gap-1">
                      ★ {activeMovie.rating.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-medium">Review Score</span>
                  </div>
                </div>
              </div>

              {/* Quote Review text block */}
              <div className="px-6 py-5 border-b border-white/5 bg-zinc-950/20">
                {activeMovie.reviewText ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      My Written Review
                    </p>
                    <div className="relative pl-4 border-l-2 border-orange-500/50">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300 italic">
                        "{activeMovie.reviewText}"
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs italic text-zinc-500">No review text written for this film.</p>
                )}
              </div>

              {/* Action Buttons with state transition representation */}
              <div className="px-6 py-5 bg-zinc-950/40">
                {activeSendState === "added" ? (
                  <div className="flex items-center gap-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-fade-in">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-md shadow-emerald-500/20">
                      <CheckIcon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-emerald-400">Added to Radarr</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{activeMessage || "Film successfully synchronized."}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-orange-500/20 transition hover:from-orange-400 hover:to-amber-400 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={activeSendState === "loading"}
                      onClick={() => void sendToRadarr(activeMovie)}
                      type="button"
                    >
                      {activeSendState === "loading" ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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

      {/* ── Settings Modal ─────────────────────────────────────────────────── */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-4 transition-all duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSettingsOpen(false);
          }}
        >
          <div className="glass-modal flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-xl sm:rounded-2xl border border-white/10">

            {/* Modal Header */}
            <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/5 px-6 pb-4 pt-5">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Control Panel
                </p>
                <h2 className="text-lg font-extrabold text-white">Application Settings</h2>
              </div>
              <button
                aria-label="Close settings"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-400 border border-white/5 transition hover:bg-white/10 hover:text-white"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Scroll Content */}
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              
              {/* Radarr API Config */}
              <form className="space-y-4" onSubmit={saveSettings}>
                
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                  Radarr Endpoint Configuration
                </h4>

                <div className="grid grid-cols-1 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Radarr Base URL</span>
                    <input
                      className={inputCls}
                      placeholder="e.g. http://192.168.1.100:7878"
                      value={settingsDraft.radarrUrl}
                      onChange={(e) =>
                        setSettingsDraft((c) => ({ ...c, radarrUrl: e.target.value }))
                      }
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
                      onChange={(e) =>
                        setSettingsDraft((c) => ({ ...c, radarrApiKey: e.target.value }))
                      }
                    />
                  </label>
                </div>

                {/* Auto-Download Threshold Section */}
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                  Auto-Sync Preferences
                </h4>

                <div className="flex flex-col gap-1.5">
                  <span className={labelCls}>Trigger Auto-Download Threshold</span>
                  <div className="relative">
                    <select
                      className="h-11 w-full rounded-xl border border-white/10 bg-zinc-900/60 px-4 pr-10 text-sm text-white appearance-none focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                      value={autoDownloadRating}
                      onChange={(e) => setAutoDownloadRating(Number(e.target.value))}
                    >
                      <option value={-1}>Disable Automatic Syncing</option>
                      {ratingOptions.map((r) => (
                        <option key={r} value={r}>
                          Sync Rated ≥ {r.toFixed(1)} ★
                        </option>
                      ))}
                    </select>
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 text-xs">▼</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-normal">
                    When you load reviews for a user, movies rated at or above this threshold will be added to your Radarr library automatically.
                  </p>
                </div>

                {/* Database location metadata */}
                <div className="rounded-xl border border-white/5 bg-zinc-900/20 p-4 space-y-1.5 text-xs text-zinc-500">
                  <p>
                    <span className="font-semibold text-zinc-400">Server Path: </span>
                    {settings.dataDir || "Fetching data path..."}
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    Configurations and cached Letterboxd files are persistent and written directly to your secure server storage. Keys remain encrypted on local server volumes.
                  </p>
                </div>

                {/* Connection Testing Dynamic Feedback Window */}
                {connectionTestResult && (
                  <div className={`rounded-xl border p-3.5 flex items-start gap-2.5 text-xs animate-fade-in ${
                    connectionTestResult.success
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                      : "border-rose-500/20 bg-rose-500/5 text-rose-400"
                  }`}>
                    {connectionTestResult.success ? (
                      <CheckIcon className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                    ) : (
                      <ExclamationIcon className="h-4 w-4 flex-shrink-0 text-rose-400" />
                    )}
                    <div className="space-y-1">
                      <p className="font-extrabold">{connectionTestResult.success ? "Success" : "Connection Failed"}</p>
                      <p className="leading-relaxed text-zinc-400">{connectionTestResult.message}</p>
                    </div>
                  </div>
                )}

                {/* Static messages for savings */}
                {settingsMessage && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs font-semibold text-emerald-400">
                    {settingsMessage}
                  </div>
                )}
                {settingsError && (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-semibold text-rose-400">
                    {settingsError}
                  </div>
                )}

                {/* Dual action row */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    className="h-10 rounded-xl border border-white/10 bg-zinc-900/60 px-5 text-xs font-bold text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
                    disabled={isTestingConnection || !settingsDraft.radarrUrl}
                    onClick={testConnection}
                    type="button"
                  >
                    {isTestingConnection ? "Testing Connection..." : "Test Connection"}
                  </button>

                  <button
                    className="h-10 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 text-xs font-bold text-white shadow-md shadow-orange-500/20 transition hover:from-orange-400 hover:to-amber-400 disabled:opacity-50"
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
