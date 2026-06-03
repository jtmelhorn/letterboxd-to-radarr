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

function buttonClassForState(state: SendState): string {
  const base =
    "rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-70";

  if (state === "loading") {
    return `${base} bg-slate-700 text-slate-200 focus:ring-slate-500`;
  }

  if (state === "added") {
    return `${base} bg-emerald-500 text-emerald-950 focus:ring-emerald-300`;
  }

  if (state === "error") {
    return `${base} bg-red-500 text-white focus:ring-red-300`;
  }

  return `${base} bg-orange-400 text-slate-950 hover:bg-orange-300 focus:ring-orange-300`;
}

function sendButtonLabel(state: SendState): string {
  if (state === "loading") {
    return "Sending...";
  }

  if (state === "added") {
    return "Added";
  }

  if (state === "error") {
    return "Error";
  }

  return "Send to Radarr";
}

export default function Home() {
  const [config, setConfig] = useState<LocalConfig>(defaultConfig);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [settings, setSettings] = useState<PublicSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState({ radarrUrl: "", radarrApiKey: "" });
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

  async function loadSettings() {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as PublicSettings | null;

      if (!response.ok || !body) {
        throw new Error(apiMessage(body, "Unable to load settings."));
      }

      setSettings(body);
      setSettingsDraft({ radarrUrl: body.radarrUrl, radarrApiKey: "" });
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
      setSettingsDraft({ radarrUrl: body.radarrUrl, radarrApiKey: "" });
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

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/30 backdrop-blur">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:p-10">
            <div className="flex flex-col justify-center gap-6">
              <div>
                <p className="mb-3 inline-flex rounded-full border border-orange-300/30 bg-orange-300/10 px-3 py-1 text-sm font-medium text-orange-200">
                  Letterboxd to Radarr
                </p>
                <h1 className="max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                  Turn your highest-rated reviews into a Radarr watchlist.
                </h1>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-slate-300">
                Fetch your latest Letterboxd RSS items, persist them server-side, import your
                Letterboxd export for full history, and add selected movies directly to Radarr.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-400">Radarr settings</p>
                  <p className="mt-1 font-semibold text-white">
                    {settings.radarrUrl ? "Configured" : "Not configured"}
                    {settings.hasRadarrApiKey ? " with API key" : ""}
                  </p>
                </div>
                <button
                  className="rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2 focus:ring-offset-slate-950"
                  onClick={() => {
                    setSettingsDraft({ radarrUrl: settings.radarrUrl, radarrApiKey: "" });
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
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div className="rounded-2xl bg-white/[0.06] p-4">
                  <dt className="text-slate-400">Reviews loaded</dt>
                  <dd className="mt-2 text-3xl font-bold text-white">{movies.length}</dd>
                </div>
                <div className="rounded-2xl bg-white/[0.06] p-4">
                  <dt className="text-slate-400">Visible after filter</dt>
                  <dd className="mt-2 text-3xl font-bold text-white">{filteredMovies.length}</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Radarr URL, API key, and cached Letterboxd reviews are stored on the server so they
                can later live on a mounted container volume.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-xl shadow-black/20 sm:p-8">
          <form className="grid gap-5 md:grid-cols-[1fr_16rem_auto]" onSubmit={fetchReviews}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-slate-200">Letterboxd Username</span>
              <input
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                placeholder="karsten"
                value={config.username}
                onChange={(event) => updateConfig("username", event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-slate-200">Minimum Star Rating</span>
              <select
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                value={minimumRating}
                onChange={(event) => setMinimumRating(Number(event.target.value))}
              >
                {ratingOptions.map((rating) => (
                  <option key={rating} className="bg-slate-950" value={rating}>
                    {rating.toFixed(1)} stars
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                className="w-full rounded-2xl bg-white px-4 py-3 font-bold text-slate-950 transition hover:bg-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-70 md:w-auto"
                disabled={isFetching}
                type="submit"
              >
                {isFetching ? "Fetching..." : "Fetch Reviews"}
              </button>
            </div>
          </form>

          <p className="mt-4 text-sm leading-6 text-slate-400">
            RSS only exposes the latest 50 items. This app now merges every fetch into persistent
            storage; use Settings to import the official Letterboxd export ZIP for older ratings.
          </p>

          {fetchError ? (
            <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {fetchError}
            </div>
          ) : null}
        </section>

        <section>
          {movies.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.04] p-10 text-center">
              <h2 className="text-2xl font-bold text-white">No reviews loaded yet</h2>
              <p className="mt-3 text-slate-400">
                Enter a Letterboxd username and fetch reviews, or import your Letterboxd export in
                Settings to backfill more than the RSS limit.
              </p>
            </div>
          ) : filteredMovies.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.04] p-10 text-center">
              <h2 className="text-2xl font-bold text-white">No movies match this filter</h2>
              <p className="mt-3 text-slate-400">
                Lower the minimum star rating to show more reviewed films.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredMovies.map((movie) => {
                const key = movieKey(movie);
                const sendState = sendStates[key] ?? "idle";
                const message = sendMessages[key];

                return (
                  <article
                    className="flex min-h-56 flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-lg shadow-black/20"
                    key={key}
                  >
                    <div>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <span className="rounded-full bg-orange-300/10 px-3 py-1 text-sm font-semibold text-orange-200">
                          {movie.rating.toFixed(1)} stars
                        </span>
                        <span className="text-sm text-slate-400">{movie.year ?? "Unknown year"}</span>
                      </div>
                      <h2 className="text-2xl font-bold tracking-tight text-white">{movie.title}</h2>
                    </div>

                    <div className="mt-8">
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
                          className={`mt-3 text-sm ${
                            sendState === "error" ? "text-red-200" : "text-emerald-200"
                          }`}
                        >
                          {message}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl shadow-black sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-orange-200">Settings</p>
                <h2 className="mt-2 text-3xl font-black text-white">Persistent app settings</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Settings are saved to JSON on the server. Set LETTERBOXD_RADARR_DATA_DIR or
                  APP_DATA_DIR later to point this at a container volume.
                </p>
              </div>
              <button
                className="rounded-full border border-white/10 px-3 py-1 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="space-y-4" onSubmit={saveSettings}>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-slate-200">Radarr Base URL</span>
                <input
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                  placeholder="http://192.168.1.100:7878"
                  value={settingsDraft.radarrUrl}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, radarrUrl: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-slate-200">Radarr API Key</span>
                <input
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                  placeholder={
                    settings.hasRadarrApiKey
                      ? "Saved API key configured; leave blank to keep it"
                      : "Paste API key"
                  }
                  type="password"
                  value={settingsDraft.radarrApiKey}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, radarrApiKey: event.target.value }))
                  }
                />
              </label>

              <div className="rounded-2xl bg-white/[0.05] p-4 text-sm text-slate-400">
                <p>
                  <span className="font-semibold text-slate-300">Storage directory:</span>{" "}
                  {settings.dataDir || "Loading..."}
                </p>
                <p className="mt-2">
                  The API key is stored in plaintext in this directory. Restrict access to the
                  eventual container volume.
                </p>
              </div>

              {settingsMessage ? (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {settingsMessage}
                </div>
              ) : null}
              {settingsError ? (
                <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {settingsError}
                </div>
              ) : null}

              <button
                className="rounded-2xl bg-orange-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isSavingSettings}
                type="submit"
              >
                {isSavingSettings ? "Saving..." : "Save Settings"}
              </button>
            </form>

            <div className="my-8 h-px bg-white/10" />

            <form className="space-y-4" onSubmit={importLetterboxdCsv}>
              <div>
                <h3 className="text-xl font-bold text-white">Backfill Letterboxd history</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Letterboxd RSS is limited to 50 items. Export your account data from Letterboxd
                  and upload the full <span className="font-semibold text-slate-200">.zip</span> file.
                  The app reads reviews.csv, ratings.csv, and diary.csv from the archive to backfill
                  older rated movies into the persistent cache.
                </p>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-slate-200">Letterboxd export .zip or CSV</span>
                <input
                  accept=".zip,.csv,application/zip,text/csv"
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2 file:font-semibold file:text-slate-950"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>

              {importMessage ? (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {importMessage}
                </div>
              ) : null}
              {importError ? (
                <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {importError}
                </div>
              ) : null}

              <button
                className="rounded-2xl border border-white/10 bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isImporting}
                type="submit"
              >
                {isImporting ? "Importing..." : "Import Reviews CSV"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
