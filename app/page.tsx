"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import type {
  LetterboxdImportResponse,
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
  radarrUrl: "",
  hasRadarrApiKey: false,
  letterboxdExportUrl: "https://letterboxd.com/user/exportdata",
  hasLetterboxdCookie: false,
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
    typeof m.rating === "number"
  );
}

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(5 - full - (half ? 1 : 0));
}

// ── SVG icons ───────────────────────────────────────────────────────────────

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
      strokeWidth={2}
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

// ── Status badge ring class ─────────────────────────────────────────────────

function posterRingClass(state: SendState): string {
  if (state === "added") return "ring-2 ring-green-500/80 ring-inset";
  if (state === "error") return "ring-2 ring-red-500/70 ring-inset";
  return "";
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Home() {
  const [config, setConfig] = useState<LocalConfig>(defaultConfig);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [settings, setSettings] = useState<PublicSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState({
    radarrUrl: "",
    radarrApiKey: "",
    letterboxdExportUrl: "https://letterboxd.com/user/exportdata",
    letterboxdCookie: "",
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [minimumRating, setMinimumRating] = useState(4);
  const [movies, setMovies] = useState<MovieReview[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [sendMessages, setSendMessages] = useState<Record<string, string>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isFetchingExport, setIsFetchingExport] = useState(false);
  const [activeMovieKey, setActiveMovieKey] = useState<string | null>(null);

  // ── localStorage hydration ─────────────────────────────────────────────
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

  useEffect(() => {
    void loadSettings();
  }, []);

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
    const t = setTimeout(() => setActiveMovieKey(null), 1800);
    return () => clearTimeout(t);
  }, [activeMovieKey, sendStates]);

  // ── Derived state ──────────────────────────────────────────────────────
  const filteredMovies = useMemo(
    () => movies.filter((m) => m.rating >= minimumRating),
    [movies, minimumRating],
  );

  const activeMovie = useMemo(
    () => (activeMovieKey ? (filteredMovies.find((m) => movieKey(m) === activeMovieKey) ?? null) : null),
    [activeMovieKey, filteredMovies],
  );

  const activeSendState: SendState = activeMovieKey ? (sendStates[activeMovieKey] ?? "idle") : "idle";
  const activeMessage = activeMovieKey ? sendMessages[activeMovieKey] : undefined;

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
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
        letterboxdExportUrl: body.letterboxdExportUrl,
        letterboxdCookie: "",
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
        letterboxdExportUrl: body.letterboxdExportUrl,
        letterboxdCookie: "",
      });
      setSettingsMessage("Settings saved to persistent server storage.");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to save settings.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function fetchReviews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = config.username.trim();
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
      setMovies(body.filter(isMovieReview));
      setSendStates({});
      setSendMessages({});
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unable to fetch Letterboxd reviews.");
    } finally {
      setIsFetching(false);
    }
  }

  async function importLetterboxdCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config.username.trim()) {
      setImportError("Enter a Letterboxd username before importing.");
      return;
    }
    if (!importFile) {
      setImportError("Choose the Letterboxd export .zip, or a reviews.csv, ratings.csv, or diary.csv file.");
      return;
    }
    const formData = new FormData();
    formData.append("username", config.username.trim());
    formData.append("file", importFile);
    setIsImporting(true);
    setImportMessage(null);
    setImportError(null);
    try {
      const res = await fetch("/api/letterboxd/import", { method: "POST", body: formData });
      const body = (await res.json().catch(() => null)) as LetterboxdImportResponse | null;
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to import Letterboxd export."));
      setMovies(body.movies.filter(isMovieReview));
      const fileSummary = body.importedFiles?.length
        ? ` Files: ${body.importedFiles.map((f) => `${f.fileName} (${f.importedCount})`).join(", ")}.`
        : "";
      setImportMessage(
        `Imported ${body.importedCount} rated movies. Cache now contains ${body.totalCached} movies.${fileSummary}`,
      );
      setSendStates({});
      setSendMessages({});
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Unable to import Letterboxd export.");
    } finally {
      setIsImporting(false);
    }
  }

  async function fetchLetterboxdExport() {
    if (!config.username.trim()) {
      setImportError("Enter a Letterboxd username before fetching the export.");
      return;
    }
    if (!settings.hasLetterboxdCookie) {
      setImportError("Save your Letterboxd session cookie in Settings before fetching the export.");
      return;
    }
    setIsFetchingExport(true);
    setImportMessage(null);
    setImportError(null);
    try {
      const res = await fetch("/api/letterboxd/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: config.username.trim() }),
      });
      const body = (await res.json().catch(() => null)) as LetterboxdImportResponse | null;
      if (!res.ok || !body) throw new Error(apiMessage(body, "Unable to fetch Letterboxd export."));
      const fileSummary = body.importedFiles?.length
        ? ` Files: ${body.importedFiles.map((f) => `${f.fileName} (${f.importedCount})`).join(", ")}.`
        : "";
      setMovies(body.movies.filter(isMovieReview));
      setImportMessage(
        `Fetched and imported ${body.importedCount} rated movies. Cache now contains ${body.totalCached} movies.${fileSummary}`,
      );
      setSendStates({});
      setSendMessages({});
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Unable to fetch Letterboxd export.");
    } finally {
      setIsFetchingExport(false);
    }
  }

  async function sendToRadarr(movie: MovieReview) {
    const key = movieKey(movie);
    if (!settings.radarrUrl || !settings.hasRadarrApiKey) {
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({
        ...c,
        [key]: "Open Settings and save your Radarr Base URL and API key first.",
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
      setSendMessages((c) => ({ ...c, [key]: body?.message ?? "Movie added to Radarr." }));
    } catch (err) {
      setSendStates((c) => ({ ...c, [key]: "error" }));
      setSendMessages((c) => ({
        ...c,
        [key]: err instanceof Error ? err.message : "Unable to add this movie to Radarr.",
      }));
    }
  }

  // ── Shared input class ─────────────────────────────────────────────────
  const inputCls =
    "h-10 rounded-xl border border-white/[0.09] bg-white/[0.05] px-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500/40 transition";

  const labelCls = "text-sm font-semibold text-zinc-300";

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Fixed navigation bar ──────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 top-0 z-40 h-14 border-b border-white/[0.07] bg-zinc-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-screen-2xl items-center gap-3 px-4 sm:px-5">

          {/* Wordmark */}
          <div className="mr-1 flex flex-shrink-0 items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500 shadow-lg shadow-orange-500/30">
              <FilmIcon className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="hidden font-black tracking-tight text-white sm:block">
              LB<span className="mx-0.5 font-light text-zinc-600">→</span>Radarr
            </span>
          </div>

          {/* Fetch form — fills remaining space */}
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={fetchReviews}>
            <input
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-white/[0.06] px-3 text-sm text-white placeholder-zinc-600 transition focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500 max-w-[190px]"
              placeholder="Letterboxd username"
              value={config.username}
              onChange={(e) => updateConfig("username", e.target.value)}
            />

            {/* Rating selector — hidden on mobile (shown separately) */}
            <select
              className="hidden h-9 rounded-lg border border-white/[0.09] bg-white/[0.06] px-3 text-sm text-white transition focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500 sm:block"
              value={minimumRating}
              onChange={(e) => setMinimumRating(Number(e.target.value))}
            >
              {ratingOptions.map((r) => (
                <option key={r} className="bg-zinc-950" value={r}>
                  {r.toFixed(1)}★ min
                </option>
              ))}
            </select>

            <button
              className="h-9 flex-shrink-0 rounded-lg bg-orange-500 px-4 text-sm font-bold text-white shadow-sm shadow-orange-500/20 transition hover:bg-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isFetching}
              type="submit"
            >
              {isFetching ? "…" : "Fetch"}
            </button>
          </form>

          {/* Rating selector — mobile only */}
          <select
            className="h-9 w-[72px] flex-shrink-0 rounded-lg border border-white/[0.09] bg-white/[0.06] px-2 text-xs text-white transition focus:outline-none focus:ring-1 focus:ring-orange-500 sm:hidden"
            value={minimumRating}
            onChange={(e) => setMinimumRating(Number(e.target.value))}
          >
            {ratingOptions.map((r) => (
              <option key={r} className="bg-zinc-950" value={r}>
                {r.toFixed(1)}★
              </option>
            ))}
          </select>

          {/* Settings button */}
          <button
            aria-label="Open settings"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.06] text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-white/20"
            onClick={() => {
              setSettingsDraft({
                radarrUrl: settings.radarrUrl,
                radarrApiKey: "",
                letterboxdExportUrl: settings.letterboxdExportUrl,
                letterboxdCookie: "",
              });
              setSettingsMessage(null);
              setSettingsError(null);
              setImportMessage(null);
              setImportError(null);
              setIsSettingsOpen(true);
            }}
            type="button"
          >
            <GearIcon className="h-4 w-4" />
          </button>
        </div>
      </nav>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="min-h-screen pt-14">

        {/* Stats bar — only visible when movies are loaded */}
        {movies.length > 0 && (
          <div className="sticky top-14 z-30 border-b border-white/[0.05] bg-zinc-950/85 px-5 py-2.5 backdrop-blur sm:px-6">
            <div className="mx-auto flex max-w-screen-2xl items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-200">{filteredMovies.length}</span>
              <span className="text-zinc-600">of</span>
              <span className="font-semibold text-zinc-200">{movies.length}</span>
              <span className="text-zinc-600">films</span>
              <span className="mx-1 text-zinc-700">·</span>
              <span className="text-zinc-600">rated ≥</span>
              <span className="font-bold text-amber-500">{minimumRating.toFixed(1)}★</span>
              {settings.radarrUrl ? null : (
                <>
                  <span className="mx-1 text-zinc-700">·</span>
                  <span className="text-zinc-600">
                    Radarr not configured —{" "}
                    <button
                      className="text-orange-400 underline-offset-2 hover:underline"
                      onClick={() => setIsSettingsOpen(true)}
                      type="button"
                    >
                      open Settings
                    </button>
                  </span>
                </>
              )}
              {fetchError ? (
                <span className="ml-auto font-medium text-red-400">{fetchError}</span>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {movies.length === 0 ? (
          <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-5 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/[0.07] bg-zinc-900">
              <FilmIcon className="h-9 w-9 text-zinc-700" />
            </div>
            <h2 className="mb-3 text-2xl font-black text-white">Your watchlist starts here</h2>
            <p className="max-w-xs leading-relaxed text-zinc-500">
              Enter your Letterboxd username in the bar above and click{" "}
              <strong className="font-semibold text-zinc-300">Fetch</strong> to import your rated
              films.
            </p>
            {fetchError ? (
              <div className="mt-6 max-w-sm rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-left text-sm text-red-400">
                {fetchError}
              </div>
            ) : null}
          </div>

        ) : filteredMovies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-36 text-center">
            <h2 className="mb-2 text-xl font-black text-white">Nothing at this rating</h2>
            <p className="text-zinc-500">Lower the minimum rating filter to see more films.</p>
          </div>

        ) : (
          /* ── Poster wall ─────────────────────────────────────────────── */
          <div className="p-4 sm:p-5">
            <div className="mx-auto grid max-w-screen-2xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {filteredMovies.map((movie) => {
                const key = movieKey(movie);
                const sendState = sendStates[key] ?? "idle";

                return (
                  <button
                    aria-label={`${movie.title} (${movie.year ?? "unknown"}) — ${movie.rating.toFixed(1)} stars`}
                    className={`poster-card aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900 focus:outline-none ${posterRingClass(sendState)}`}
                    key={key}
                    onClick={() => setActiveMovieKey(key)}
                    type="button"
                  >
                    {/* Poster image or placeholder */}
                    {movie.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                        src={movie.posterUrl}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-800 to-zinc-900 p-3">
                        <FilmIcon className="h-8 w-8 flex-shrink-0 text-zinc-700" />
                        <span className="line-clamp-3 text-center text-[10px] font-medium leading-tight text-zinc-600">
                          {movie.title}
                        </span>
                      </div>
                    )}

                    {/* Bottom gradient overlay */}
                    <div className="poster-gradient absolute inset-x-0 bottom-0 h-3/4 pointer-events-none" />

                    {/* Rating badge — top left */}
                    <div className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 backdrop-blur-sm pointer-events-none">
                      <span className="text-[11px] font-bold text-amber-400">
                        ★ {movie.rating.toFixed(1)}
                      </span>
                    </div>

                    {/* Status indicator — top right */}
                    {sendState === "added" && (
                      <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/50">
                        <CheckIcon className="h-3 w-3 text-white" />
                      </div>
                    )}
                    {sendState === "error" && (
                      <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/50">
                        <XIcon className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                    {sendState === "loading" && (
                      <div className="absolute right-2 top-2 flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-orange-500/80">
                        <span className="h-2 w-2 rounded-full bg-white" />
                      </div>
                    )}

                    {/* Title — bottom */}
                    <div className="absolute inset-x-0 bottom-0 p-3 pointer-events-none">
                      <p className="mb-0.5 text-[10px] font-medium text-zinc-500">
                        {movie.year ?? "—"}
                      </p>
                      <h3 className="line-clamp-2 text-xs font-bold leading-snug text-white">
                        {movie.title}
                      </h3>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* ── Movie detail modal ─────────────────────────────────────────────── */}
      {activeMovieKey && activeMovie ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-lg sm:items-center sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveMovieKey(null);
          }}
        >
          <div className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/[0.08] bg-zinc-900 shadow-2xl sm:max-w-md sm:rounded-2xl">

            {/* Blurred banner */}
            <div className="relative h-32 flex-shrink-0 overflow-hidden bg-zinc-800">
              {activeMovie.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  src={activeMovie.posterUrl}
                  style={{ filter: "blur(14px)", transform: "scale(1.2)" }}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-800" />
              )}
              {/* Dark scrim */}
              <div className="absolute inset-0 bg-zinc-950/55" />
              {/* Close button */}
              <button
                aria-label="Close"
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-zinc-400 backdrop-blur-sm transition hover:text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                onClick={() => setActiveMovieKey(null)}
                type="button"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">

              {/* Title + year + rating */}
              <div className="border-b border-white/[0.07] px-6 pb-5 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium text-zinc-600">
                      {activeMovie.year ?? "Unknown year"}
                      {activeMovie.letterboxdUrl ? (
                        <>
                          {" · "}
                          <a
                            className="text-zinc-500 transition hover:text-orange-400"
                            href={activeMovie.letterboxdUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Letterboxd ↗
                          </a>
                        </>
                      ) : null}
                    </p>
                    <h2 className="text-xl font-black leading-tight text-white">
                      {activeMovie.title}
                    </h2>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xl font-black text-amber-400">
                      {activeMovie.rating.toFixed(1)}
                    </p>
                    <p className="text-xs text-amber-500/60">{renderStars(activeMovie.rating)}</p>
                  </div>
                </div>
              </div>

              {/* Review text */}
              <div className="border-b border-white/[0.07] px-6 py-5">
                {activeMovie.reviewText ? (
                  <>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                      My Review
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                      {activeMovie.reviewText}
                    </p>
                  </>
                ) : (
                  <p className="text-sm italic text-zinc-600">No written review for this film.</p>
                )}
              </div>

              {/* Radarr action */}
              <div className="px-6 py-5">
                {activeSendState === "added" ? (
                  <div className="flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3.5">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-500">
                      <CheckIcon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-green-400">Added to Radarr</p>
                      {activeMessage ? (
                        <p className="mt-0.5 text-xs text-green-600">{activeMessage}</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400 active:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={activeSendState === "loading"}
                      onClick={() => void sendToRadarr(activeMovie)}
                      type="button"
                    >
                      {activeSendState === "loading" ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Adding…
                        </>
                      ) : activeSendState === "error" ? (
                        <>
                          <XIcon className="h-3.5 w-3.5" />
                          Retry
                        </>
                      ) : (
                        <>
                          <RadarrIcon className="h-3.5 w-3.5" />
                          Add to Radarr
                        </>
                      )}
                    </button>
                    {activeSendState === "error" && activeMessage ? (
                      <p className="mt-2.5 text-center text-xs text-red-400">{activeMessage}</p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Settings modal ─────────────────────────────────────────────────── */}
      {isSettingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-md sm:items-center sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSettingsOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/[0.08] bg-zinc-950 shadow-2xl sm:max-w-2xl sm:rounded-2xl">

            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] px-7 pb-5 pt-6">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                  App Configuration
                </p>
                <h2 className="text-xl font-black text-white">Settings</h2>
              </div>
              <button
                aria-label="Close settings"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-zinc-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 space-y-8 overflow-y-auto px-7 py-6">

              {/* Radarr + Letterboxd settings */}
              <form className="space-y-4" onSubmit={saveSettings}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                  Radarr
                </p>

                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Base URL</span>
                  <input
                    className={inputCls}
                    placeholder="http://192.168.1.100:7878"
                    value={settingsDraft.radarrUrl}
                    onChange={(e) =>
                      setSettingsDraft((c) => ({ ...c, radarrUrl: e.target.value }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>API Key</span>
                  <input
                    className={inputCls}
                    placeholder={
                      settings.hasRadarrApiKey ? "Saved — leave blank to keep" : "Paste API key"
                    }
                    type="password"
                    value={settingsDraft.radarrApiKey}
                    onChange={(e) =>
                      setSettingsDraft((c) => ({ ...c, radarrApiKey: e.target.value }))
                    }
                  />
                </label>

                <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                  Letterboxd
                </p>

                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Export URL</span>
                  <input
                    className={inputCls}
                    placeholder="https://letterboxd.com/user/exportdata"
                    value={settingsDraft.letterboxdExportUrl}
                    onChange={(e) =>
                      setSettingsDraft((c) => ({
                        ...c,
                        letterboxdExportUrl: e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Session Cookie</span>
                  <textarea
                    className="min-h-[4.5rem] resize-y rounded-xl border border-white/[0.09] bg-white/[0.05] px-4 py-3 text-sm text-white placeholder-zinc-600 transition focus:border-orange-500/40 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    placeholder={
                      settings.hasLetterboxdCookie
                        ? "Saved — leave blank to keep"
                        : "Paste the Cookie header from an authenticated Letterboxd browser request"
                    }
                    value={settingsDraft.letterboxdCookie}
                    onChange={(e) =>
                      setSettingsDraft((c) => ({ ...c, letterboxdCookie: e.target.value }))
                    }
                  />
                </label>

                <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs text-zinc-600">
                  <p>
                    <span className="font-medium text-zinc-400">Storage: </span>
                    {settings.dataDir || "Loading…"}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-400">Cookie: </span>
                    {settings.hasLetterboxdCookie ? "Configured" : "Not configured"}
                  </p>
                  <p className="text-zinc-700">
                    API keys and cookies are stored in plaintext. Restrict access to the container
                    volume.
                  </p>
                </div>

                {settingsMessage ? (
                  <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                    {settingsMessage}
                  </div>
                ) : null}
                {settingsError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {settingsError}
                  </div>
                ) : null}

                <button
                  className="h-10 rounded-xl bg-orange-500 px-6 text-sm font-bold text-white transition hover:bg-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSavingSettings}
                  type="submit"
                >
                  {isSavingSettings ? "Saving…" : "Save Settings"}
                </button>
              </form>

              <div className="h-px bg-white/[0.07]" />

              {/* Backfill history */}
              <form className="space-y-4" onSubmit={importLetterboxdCsv}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                  Backfill history
                </p>
                <p className="text-sm leading-relaxed text-zinc-500">
                  RSS is limited to 50 items. Export your Letterboxd data and upload the{" "}
                  <span className="font-semibold text-zinc-300">.zip</span> to backfill your full
                  review history.
                </p>

                {/* Automated fetch card */}
                <div className="flex flex-col gap-4 rounded-xl border border-orange-500/20 bg-orange-500/[0.07] p-4 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-orange-200">Automated fetch</p>
                    <p className="mt-0.5 text-xs text-orange-300/70">
                      Uses the saved session cookie to download and import automatically.
                    </p>
                  </div>
                  <button
                    className="h-9 flex-shrink-0 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white transition hover:bg-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isFetchingExport}
                    onClick={() => void fetchLetterboxdExport()}
                    type="button"
                  >
                    {isFetchingExport ? "Fetching…" : "Fetch ZIP"}
                  </button>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Manual upload</span>
                  <input
                    accept=".zip,.csv,application/zip,text/csv"
                    className="rounded-xl border border-white/[0.09] bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-400 transition file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-200 hover:file:bg-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>

                {importMessage ? (
                  <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                    {importMessage}
                  </div>
                ) : null}
                {importError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {importError}
                  </div>
                ) : null}

                <button
                  className="h-10 rounded-xl border border-white/[0.09] bg-white/[0.05] px-6 text-sm font-bold text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isImporting}
                  type="submit"
                >
                  {isImporting ? "Importing…" : "Import File"}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
