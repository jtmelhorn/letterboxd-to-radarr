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
const ratingOptions = Array.from({ length: 9 }, (_, index) => 1 + index * 0.5);

const defaultConfig: LocalConfig = {
  username: "",
};

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
  if (!value || typeof value !== "object") {
    return false;
  }

  const movie = value as Record<string, unknown>;

  return (
    typeof movie.title === "string" &&
    (typeof movie.year === "number" || movie.year === null) &&
    typeof movie.rating === "number"
  );
}

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);

  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(empty);
}

function buttonClassForState(state: SendState): string {
  const base =
    "w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

  if (state === "loading") {
    return `${base} bg-[#f5f5f7] text-[#86868b] border border-[#e5e5ea] focus:ring-gray-300`;
  }

  if (state === "added") {
    return `${base} bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] focus:ring-green-300 focus:ring-offset-white`;
  }

  if (state === "error") {
    return `${base} bg-[#fff1f2] text-[#be123c] border border-[#fecdd3] focus:ring-red-300 focus:ring-offset-white`;
  }

  return `${base} bg-[#1d1d1f] text-white hover:bg-[#3a3a3c] focus:ring-[#1d1d1f]/30 focus:ring-offset-white`;
}

function sendButtonLabel(state: SendState): string {
  if (state === "loading") return "Sending…";
  if (state === "added") return "✓ Added to Radarr";
  if (state === "error") return "Error — Tap to Retry";

  return "Send to Radarr";
}

// ── Film icon SVG for poster placeholders ───────────────────────────────────
function FilmIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.25}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect height="18" rx="2" ry="2" width="20" x="2" y="3" />
      <line x1="7" x2="7" y1="3" y2="21" />
      <line x1="17" x2="17" y1="3" y2="21" />
      <line x1="2" x2="22" y1="8" y2="8" />
      <line x1="2" x2="22" y1="16" y2="16" />
    </svg>
  );
}

// ── Chevron icon ─────────────────────────────────────────────────────────────
function ChevronIcon({ className }: { className?: string }) {
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

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
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());

  useEffect(() => {
    const savedConfig = window.localStorage.getItem(STORAGE_KEY);

    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig) as Partial<LocalConfig> & { minimumRating?: number };

        setConfig({
          username: parsed.username ?? "",
        });

        if (typeof parsed.minimumRating === "number") {
          setMinimumRating(parsed.minimumRating);
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    setHasLoadedConfig(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedConfig) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, minimumRating }));
  }, [config, hasLoadedConfig, minimumRating]);

  useEffect(() => {
    void loadSettings();
  }, []);

  const filteredMovies = useMemo(
    () => movies.filter((movie) => movie.rating >= minimumRating),
    [minimumRating, movies],
  );

  function updateConfig(field: keyof LocalConfig, value: string) {
    setConfig((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function toggleReview(key: string) {
    setExpandedReviews((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  async function loadSettings() {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as PublicSettings | null;

      if (!response.ok || !body) {
        throw new Error(apiMessage(body, "Unable to load settings."));
      }

      setSettings(body);
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
        letterboxdExportUrl: body.letterboxdExportUrl,
        letterboxdCookie: "",
      });
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Unable to load settings.");
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settingsDraft),
      });
      const body = (await response.json().catch(() => null)) as PublicSettings | null;

      if (!response.ok || !body) {
        throw new Error(apiMessage(body, "Unable to save settings."));
      }

      setSettings(body);
      setSettingsDraft({
        radarrUrl: body.radarrUrl,
        radarrApiKey: "",
        letterboxdExportUrl: body.letterboxdExportUrl,
        letterboxdCookie: "",
      });
      setSettingsMessage("Settings saved to persistent server storage.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Unable to save settings.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function fetchReviews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const username = config.username.trim();

    if (!username) {
      setFetchError("Enter a Letterboxd username before fetching reviews.");
      return;
    }

    setIsFetching(true);
    setFetchError(null);

    try {
      const response = await fetch(`/api/letterboxd?username=${encodeURIComponent(username)}`);
      const body = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(apiMessage(body, "Unable to fetch Letterboxd reviews."));
      }

      if (!Array.isArray(body)) {
        throw new Error("Letterboxd API returned an unexpected response.");
      }

      setMovies(body.filter(isMovieReview));
      setSendStates({});
      setSendMessages({});
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Unable to fetch Letterboxd reviews.");
    } finally {
      setIsFetching(false);
    }
  }

  async function importLetterboxdCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!config.username.trim()) {
      setImportError("Enter a Letterboxd username before importing reviews.");
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
      const response = await fetch("/api/letterboxd/import", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as LetterboxdImportResponse | null;

      if (!response.ok || !body) {
        throw new Error(apiMessage(body, "Unable to import Letterboxd export."));
      }

      setMovies(body.movies.filter(isMovieReview));
      const fileSummary = body.importedFiles?.length
        ? ` Files: ${body.importedFiles
            .map((file) => `${file.fileName} (${file.importedCount})`)
            .join(", ")}.`
        : "";

      setImportMessage(
        `Imported ${body.importedCount} rated movies. Cache now contains ${body.totalCached} movies.${fileSummary}`,
      );
      setSendStates({});
      setSendMessages({});
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to import Letterboxd export.");
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
      const response = await fetch("/api/letterboxd/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: config.username.trim() }),
      });
      const body = (await response.json().catch(() => null)) as LetterboxdImportResponse | null;

      if (!response.ok || !body) {
        throw new Error(apiMessage(body, "Unable to fetch Letterboxd export."));
      }

      const fileSummary = body.importedFiles?.length
        ? ` Files: ${body.importedFiles
            .map((file) => `${file.fileName} (${file.importedCount})`)
            .join(", ")}.`
        : "";

      setMovies(body.movies.filter(isMovieReview));
      setImportMessage(
        `Fetched and imported ${body.importedCount} rated movies. Cache now contains ${body.totalCached} movies.${fileSummary}`,
      );
      setSendStates({});
      setSendMessages({});
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to fetch Letterboxd export.");
    } finally {
      setIsFetchingExport(false);
    }
  }

  async function sendToRadarr(movie: MovieReview) {
    const key = movieKey(movie);

    if (!settings.radarrUrl || !settings.hasRadarrApiKey) {
      setSendStates((current) => ({ ...current, [key]: "error" }));
      setSendMessages((current) => ({
        ...current,
        [key]: "Open Settings and save your Radarr Base URL and API key first.",
      }));
      return;
    }

    setSendStates((current) => ({ ...current, [key]: "loading" }));
    setSendMessages((current) => ({ ...current, [key]: "" }));

    try {
      const response = await fetch("/api/radarr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: movie.title,
          year: movie.year,
        }),
      });
      const body = (await response.json().catch(() => null)) as Partial<RadarrAddResponse> | null;

      if (!response.ok) {
        throw new Error(apiMessage(body, "Unable to add this movie to Radarr."));
      }

      setSendStates((current) => ({ ...current, [key]: "added" }));
      setSendMessages((current) => ({
        ...current,
        [key]: body?.message ?? "Movie added to Radarr.",
      }));
    } catch (error) {
      setSendStates((current) => ({ ...current, [key]: "error" }));
      setSendMessages((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Unable to add this movie to Radarr.",
      }));
    }
  }

  // ── Input / label shared classes ──────────────────────────────────────────
  const inputClass =
    "rounded-xl border border-[#d2d2d7] bg-white px-4 py-3 text-[#1d1d1f] outline-none transition placeholder:text-[#c7c7cc] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20";

  const labelClass = "text-sm font-semibold text-[#1d1d1f]";

  return (
    <main className="min-h-screen px-5 py-10 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">

        {/* ── Hero / header ─────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl border border-[#e5e5ea] bg-white shadow-card">
          <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-12 lg:p-12">

            {/* Left: headline */}
            <div className="flex flex-col justify-center gap-6">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-700">
                  Letterboxd → Radarr
                </span>
                <h1 className="mt-4 max-w-xl text-4xl font-black leading-tight tracking-tight text-[#1d1d1f] sm:text-5xl">
                  Turn your highest&#8209;rated reviews into a Radarr watchlist.
                </h1>
              </div>
              <p className="max-w-lg text-lg leading-relaxed text-[#6e6e73]">
                Fetch your latest Letterboxd RSS items, persist them server-side, import your full
                export history, and add selected movies directly to Radarr.
              </p>
            </div>

            {/* Right: status card */}
            <div className="flex flex-col gap-5 rounded-2xl border border-[#e5e5ea] bg-[#f9f9fb] p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#86868b]">
                    Radarr
                  </p>
                  <p className="mt-1 font-semibold text-[#1d1d1f]">
                    {settings.radarrUrl ? "Configured" : "Not configured"}
                    {settings.hasRadarrApiKey ? " · API key set" : ""}
                  </p>
                </div>
                <button
                  className="rounded-xl border border-[#d2d2d7] bg-white px-4 py-2 text-sm font-semibold text-[#1d1d1f] shadow-sm transition hover:bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
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
                  Settings
                </button>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#e5e5ea] bg-white p-4 shadow-sm">
                  <dt className="text-xs font-medium text-[#86868b]">Reviews loaded</dt>
                  <dd className="mt-2 text-3xl font-bold tracking-tight text-[#1d1d1f]">
                    {movies.length}
                  </dd>
                </div>
                <div className="rounded-xl border border-[#e5e5ea] bg-white p-4 shadow-sm">
                  <dt className="text-xs font-medium text-[#86868b]">After filter</dt>
                  <dd className="mt-2 text-3xl font-bold tracking-tight text-[#1d1d1f]">
                    {filteredMovies.length}
                  </dd>
                </div>
              </dl>

              <p className="text-xs leading-5 text-[#86868b]">
                Settings and cached reviews are stored on the server so they can live on a mounted
                container volume.
              </p>
            </div>
          </div>
        </section>

        {/* ── Fetch form ────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[#e5e5ea] bg-white p-8 shadow-card">
          <form className="grid gap-4 sm:grid-cols-[1fr_15rem_auto]" onSubmit={fetchReviews}>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Letterboxd Username</span>
              <input
                className={inputClass}
                placeholder="karsten"
                value={config.username}
                onChange={(event) => updateConfig("username", event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className={labelClass}>Minimum Star Rating</span>
              <select
                className={inputClass}
                value={minimumRating}
                onChange={(event) => setMinimumRating(Number(event.target.value))}
              >
                {ratingOptions.map((rating) => (
                  <option key={rating} value={rating}>
                    {rating.toFixed(1)} stars
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                className="w-full rounded-xl bg-[#1d1d1f] px-5 py-3 font-semibold text-white transition hover:bg-[#3a3a3c] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]/30 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                disabled={isFetching}
                type="submit"
              >
                {isFetching ? "Fetching…" : "Fetch Reviews"}
              </button>
            </div>
          </form>

          <p className="mt-4 text-sm leading-6 text-[#86868b]">
            RSS only exposes the latest 50 items. Reviews are merged into persistent storage on each
            fetch — use Settings to import the official Letterboxd export ZIP for full history.
          </p>

          {fetchError ? (
            <div className="mt-4 rounded-xl border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
              {fetchError}
            </div>
          ) : null}
        </section>

        {/* ── Movie grid ────────────────────────────────────────────────── */}
        <section>
          {movies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d2d2d7] bg-white p-14 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f5f5f7]">
                <FilmIcon className="h-8 w-8 text-[#c7c7cc]" />
              </div>
              <h2 className="text-xl font-bold text-[#1d1d1f]">No reviews loaded yet</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#6e6e73]">
                Enter a Letterboxd username above and fetch reviews, or import your Letterboxd export
                in Settings to backfill full history.
              </p>
            </div>
          ) : filteredMovies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d2d2d7] bg-white p-14 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f5f5f7]">
                <FilmIcon className="h-8 w-8 text-[#c7c7cc]" />
              </div>
              <h2 className="text-xl font-bold text-[#1d1d1f]">No movies match this filter</h2>
              <p className="mt-2 text-sm leading-6 text-[#6e6e73]">
                Lower the minimum star rating above to see more reviewed films.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-5 text-sm font-medium text-[#86868b]">
                {filteredMovies.length} {filteredMovies.length === 1 ? "film" : "films"} · rated{" "}
                {minimumRating.toFixed(1)}★ and above
              </p>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {filteredMovies.map((movie) => {
                  const key = movieKey(movie);
                  const sendState = sendStates[key] ?? "idle";
                  const message = sendMessages[key];
                  const isReviewExpanded = expandedReviews.has(key);

                  return (
                    <article
                      className="movie-card flex flex-col overflow-hidden rounded-2xl border border-[#e5e5ea] bg-white shadow-card"
                      key={key}
                    >
                      {/* Poster area */}
                      <div className="relative aspect-[2/3] w-full overflow-hidden poster-placeholder">
                        {movie.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`${movie.title} poster`}
                            className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                            loading="lazy"
                            src={movie.posterUrl}
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                            <FilmIcon className="h-12 w-12 text-[#aeaeb2]" />
                            <p className="text-xs font-medium text-[#aeaeb2]">No poster available</p>
                          </div>
                        )}

                        {/* Rating badge — overlaid on poster */}
                        <div className="absolute left-3 top-3">
                          <span
                            className="star-rating inline-flex items-center rounded-lg border border-amber-200/60 bg-white/90 px-2.5 py-1 text-sm font-semibold shadow-sm backdrop-blur-sm"
                            title={`${movie.rating.toFixed(1)} out of 5 stars`}
                          >
                            {renderStars(movie.rating)}
                          </span>
                        </div>
                      </div>

                      {/* Card body */}
                      <div className="flex flex-1 flex-col gap-4 p-5">
                        {/* Title + year */}
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-[#86868b]">
                              {movie.year ?? "Unknown year"}
                            </span>
                            {movie.letterboxdUrl ? (
                              <a
                                className="text-xs font-medium text-[#0071e3] transition hover:underline"
                                href={movie.letterboxdUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Letterboxd ↗
                              </a>
                            ) : null}
                          </div>
                          <h2 className="text-lg font-bold leading-snug tracking-tight text-[#1d1d1f]">
                            {movie.title}
                          </h2>
                        </div>

                        {/* Review accordion */}
                        {movie.reviewText ? (
                          <div className="rounded-xl border border-[#e5e5ea] overflow-hidden">
                            <button
                              aria-expanded={isReviewExpanded}
                              className="flex w-full items-center justify-between gap-3 bg-[#f9f9fb] px-4 py-3 text-left text-sm font-medium text-[#6e6e73] transition hover:bg-[#f0f0f5] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0071e3]/30"
                              onClick={() => toggleReview(key)}
                              type="button"
                            >
                              <span>{isReviewExpanded ? "Hide review" : "Read review"}</span>
                              <ChevronIcon
                                className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 ${isReviewExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                            {isReviewExpanded ? (
                              <div className="accordion-enter border-t border-[#e5e5ea] bg-white px-4 py-4">
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#3a3a3c]">
                                  {movie.reviewText}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Radarr action */}
                        <div className="mt-auto">
                          <button
                            className={buttonClassForState(sendState)}
                            disabled={sendState === "loading"}
                            onClick={() => void sendToRadarr(movie)}
                            type="button"
                          >
                            {sendButtonLabel(sendState)}
                          </button>
                          {message ? (
                            <p
                              className={`mt-2 text-xs leading-5 ${
                                sendState === "error" ? "text-[#be123c]" : "text-[#15803d]"
                              }`}
                            >
                              {message}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ── Settings modal ──────────────────────────────────────────────── */}
      {isSettingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSettingsOpen(false);
          }}
        >
          <div className="glass modal-scroll max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e5e5ea] shadow-modal">
            <div className="p-8">
              {/* Modal header */}
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#86868b]">
                    Configuration
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-[#1d1d1f]">
                    Persistent app settings
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#6e6e73]">
                    Settings are saved to JSON on the server. Set{" "}
                    <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs font-mono text-[#1d1d1f]">
                      LETTERBOXD_RADARR_DATA_DIR
                    </code>{" "}
                    or{" "}
                    <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs font-mono text-[#1d1d1f]">
                      APP_DATA_DIR
                    </code>{" "}
                    to point this at a container volume.
                  </p>
                </div>
                <button
                  className="flex-shrink-0 rounded-full border border-[#e5e5ea] bg-[#f5f5f7] p-2 text-[#6e6e73] transition hover:bg-[#ebebed] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                  onClick={() => setIsSettingsOpen(false)}
                  type="button"
                  aria-label="Close settings"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Settings form */}
              <form className="space-y-5" onSubmit={saveSettings}>
                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Radarr Base URL</span>
                  <input
                    className={inputClass}
                    placeholder="http://192.168.1.100:7878"
                    value={settingsDraft.radarrUrl}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, radarrUrl: event.target.value }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Radarr API Key</span>
                  <input
                    className={inputClass}
                    placeholder={
                      settings.hasRadarrApiKey
                        ? "Saved — leave blank to keep it"
                        : "Paste API key"
                    }
                    type="password"
                    value={settingsDraft.radarrApiKey}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        radarrApiKey: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Letterboxd Export URL</span>
                  <input
                    className={inputClass}
                    placeholder="https://letterboxd.com/user/exportdata"
                    value={settingsDraft.letterboxdExportUrl}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        letterboxdExportUrl: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Letterboxd Session Cookie</span>
                  <textarea
                    className={`${inputClass} min-h-24 resize-y`}
                    placeholder={
                      settings.hasLetterboxdCookie
                        ? "Saved — leave blank to keep it"
                        : "Paste the Cookie header from an authenticated Letterboxd browser request"
                    }
                    value={settingsDraft.letterboxdCookie}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        letterboxdCookie: event.target.value,
                      }))
                    }
                  />
                </label>

                <div className="rounded-xl border border-[#e5e5ea] bg-[#f9f9fb] p-4 text-sm">
                  <div className="space-y-1.5 text-[#6e6e73]">
                    <p>
                      <span className="font-semibold text-[#1d1d1f]">Storage directory: </span>
                      {settings.dataDir || "Loading…"}
                    </p>
                    <p>
                      <span className="font-semibold text-[#1d1d1f]">Letterboxd cookie: </span>
                      {settings.hasLetterboxdCookie ? "Configured" : "Not configured"}
                    </p>
                    <p className="text-xs leading-5 text-[#86868b]">
                      API keys and cookies are stored in plaintext. Restrict access to the container
                      volume.
                    </p>
                  </div>
                </div>

                {settingsMessage ? (
                  <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#15803d]">
                    {settingsMessage}
                  </div>
                ) : null}
                {settingsError ? (
                  <div className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
                    {settingsError}
                  </div>
                ) : null}

                <button
                  className="rounded-xl bg-[#1d1d1f] px-6 py-3 font-semibold text-white transition hover:bg-[#3a3a3c] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]/30 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingSettings}
                  type="submit"
                >
                  {isSavingSettings ? "Saving…" : "Save Settings"}
                </button>
              </form>

              <div className="my-8 h-px bg-[#e5e5ea]" />

              {/* Import form */}
              <form className="space-y-5" onSubmit={importLetterboxdCsv}>
                <div>
                  <h3 className="text-xl font-bold text-[#1d1d1f]">Backfill Letterboxd history</h3>
                  <p className="mt-2 text-sm leading-6 text-[#6e6e73]">
                    Letterboxd RSS is limited to 50 items. Export your account data from Letterboxd
                    and upload the full{" "}
                    <span className="font-semibold text-[#1d1d1f]">.zip</span> file. The app reads
                    reviews.csv, ratings.csv, and diary.csv to backfill older rated movies.
                  </p>
                </div>

                {/* Automated fetch */}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-amber-900">Automated export fetch</p>
                      <p className="mt-1 text-sm leading-5 text-amber-700">
                        Uses the saved Letterboxd session cookie to download and import the export
                        ZIP automatically.
                      </p>
                    </div>
                    <button
                      className="flex-shrink-0 rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isFetchingExport}
                      onClick={() => void fetchLetterboxdExport()}
                      type="button"
                    >
                      {isFetchingExport ? "Fetching…" : "Fetch Export ZIP"}
                    </button>
                  </div>
                </div>

                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Manual fallback: export .zip or CSV</span>
                  <input
                    accept=".zip,.csv,application/zip,text/csv"
                    className="rounded-xl border border-[#d2d2d7] bg-white px-4 py-3 text-sm text-[#6e6e73] file:mr-4 file:rounded-lg file:border-0 file:bg-[#1d1d1f] file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-white transition file:hover:bg-[#3a3a3c] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                    onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>

                {importMessage ? (
                  <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#15803d]">
                    {importMessage}
                  </div>
                ) : null}
                {importError ? (
                  <div className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
                    {importError}
                  </div>
                ) : null}

                <button
                  className="rounded-xl border border-[#d2d2d7] bg-white px-6 py-3 font-semibold text-[#1d1d1f] shadow-sm transition hover:bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isImporting}
                  type="submit"
                >
                  {isImporting ? "Importing…" : "Import Export File"}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
