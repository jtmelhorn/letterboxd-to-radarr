"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import type { MovieReview, RadarrAddResponse } from "@/app/types/movie";

interface AppConfig {
  username: string;
  radarrUrl: string;
  radarrApiKey: string;
}

type SendState = "idle" | "loading" | "added" | "error";

const STORAGE_KEY = "letterboxd-to-radarr-config";
const ratingOptions = Array.from({ length: 9 }, (_, index) => 1 + index * 0.5);

const defaultConfig: AppConfig = {
  username: "",
  radarrUrl: "",
  radarrApiKey: "",
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
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [minimumRating, setMinimumRating] = useState(4);
  const [movies, setMovies] = useState<MovieReview[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [sendMessages, setSendMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    const savedConfig = window.localStorage.getItem(STORAGE_KEY);

    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig) as Partial<AppConfig>;

        setConfig({
          username: parsed.username ?? "",
          radarrUrl: parsed.radarrUrl ?? "",
          radarrApiKey: parsed.radarrApiKey ?? "",
        });
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

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, hasLoadedConfig]);

  const filteredMovies = useMemo(
    () => movies.filter((movie) => movie.rating >= minimumRating),
    [minimumRating, movies],
  );

  function updateConfig(field: keyof AppConfig, value: string) {
    setConfig((current) => ({
      ...current,
      [field]: value,
    }));
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

  async function sendToRadarr(movie: MovieReview) {
    const key = movieKey(movie);

    if (!config.radarrUrl.trim() || !config.radarrApiKey.trim()) {
      setSendStates((current) => ({ ...current, [key]: "error" }));
      setSendMessages((current) => ({
        ...current,
        [key]: "Enter your Radarr Base URL and API key first.",
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
          radarrUrl: config.radarrUrl.trim(),
          radarrApiKey: config.radarrApiKey.trim(),
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
                Fetch your public Letterboxd RSS feed, filter by star rating, and add the movies
                directly to Radarr with automatic quality profile and root folder discovery.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
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
                Configuration is stored in this browser&apos;s localStorage, including the Radarr API
                key.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-xl shadow-black/20 sm:p-8">
          <form className="grid gap-5 lg:grid-cols-12" onSubmit={fetchReviews}>
            <label className="flex flex-col gap-2 lg:col-span-3">
              <span className="text-sm font-semibold text-slate-200">Letterboxd Username</span>
              <input
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                placeholder="karsten"
                value={config.username}
                onChange={(event) => updateConfig("username", event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2 lg:col-span-3">
              <span className="text-sm font-semibold text-slate-200">Radarr Base URL</span>
              <input
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                placeholder="http://192.168.1.100:7878"
                value={config.radarrUrl}
                onChange={(event) => updateConfig("radarrUrl", event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2 lg:col-span-3">
              <span className="text-sm font-semibold text-slate-200">Radarr API Key</span>
              <input
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/30"
                placeholder="Paste API key"
                type="password"
                value={config.radarrApiKey}
                onChange={(event) => updateConfig("radarrApiKey", event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2 lg:col-span-2">
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

            <div className="flex items-end lg:col-span-1">
              <button
                className="w-full rounded-2xl bg-white px-4 py-3 font-bold text-slate-950 transition hover:bg-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isFetching}
                type="submit"
              >
                {isFetching ? "Fetching..." : "Fetch Reviews"}
              </button>
            </div>
          </form>

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
                Enter your configuration, choose a minimum rating, and fetch reviews to begin.
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
    </main>
  );
}
