"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ApprovalsPanel } from "@/app/components/ApprovalsPanel";
import { ActivityPanel } from "@/app/components/ActivityPanel";
import { LoadingSkeletonGrid, WelcomeHero } from "@/app/components/DashboardEmptyState";
import { DashboardNav } from "@/app/components/DashboardNav";
import { LoadingScreen, LoginScreen, PasswordSetupScreen } from "@/app/components/AuthGate";
import { MovieGrid } from "@/app/components/MovieGrid";
import { MovieDetailModal } from "@/app/components/MovieDetailModal";
import { RemoveMovieDialog } from "@/app/components/RemoveMovieDialog";
import { SettingsModal } from "@/app/components/SettingsModal";
import { SyncedPanel } from "@/app/components/SyncedPanel";
import { PosterRadarrAction, posterRingClass } from "@/app/components/PosterCard";
import { AlertBanner, Button, EmptyState, Input, Select, StatCard } from "@/app/components/ui";
import {
  ArrowPathIcon,
  CheckIcon,
  ClockIcon,
  ExclamationIcon,
  FilmIcon,
  GearIcon,
  InboxIcon,
  LockIcon,
  RadarrIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@/app/components/icons";
import { canCompleteSetup, ControlPanelForm } from "@/app/components/ControlPanelForm";
import { useClickAway } from "@/app/hooks/useClickAway";
import { useFocusTrap } from "@/app/hooks/useFocusTrap";
import {
  activityMatchesSearch,
  blocklistMatchesSearch,
  formatRelativeTime,
  movieGenres,
  movieMatchesSearch,
  sortMoviesByRating,
  statusToSendState,
  syncResultToActivity,
  UNKNOWN_GENRE,
} from "@/app/lib/format";
import type { ActivityEntry, ActivityStatus, SendState } from "@/app/lib/format";
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
  SyncFilters,
  SyncInterval,
  SyncResultItem,
  SyncRunSummary,
} from "@/app/types/movie";

interface LocalConfig {
  username: string;
  searchQuery?: string;
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
const ratingOptions = Array.from({ length: 9 }, (_, i) => 1 + i * 0.5);
// -1 is the backend's "automation disabled" threshold (isValidAutoThreshold).
const groupRatingOptions = [-1, ...ratingOptions];
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
  syncCronOverride: false,
  radarrUrlFromEnv: false,
  radarrApiKeyFromEnv: false,
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

function isAddedToRadarr(movie: AggregatedMovieDto, sendStates: Record<string, SendState>): boolean {
  const state = sendStates[movieKey(movie)] ?? statusToSendState(movie.status);
  return state === "added";
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
  const [bootMessage, setBootMessage] = useState<string>("Starting up…");
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
  const [hasLoadedGroups, setHasLoadedGroups] = useState(false);
  const [allSyncedCount, setAllSyncedCount] = useState<number | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalDto[]>([]);
  const [scopeSelection, setScopeSelection] = useState<ScopeSelection>("all");
  const [isFetching, setIsFetching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncedOpen, setIsSyncedOpen] = useState(false);
  const [isApprovalsOpen, setIsApprovalsOpen] = useState(false);
  const [hasAutoFetched, setHasAutoFetched] = useState(false);
  const [removingMovie, setRemovingMovie] = useState<AggregatedMovieDto | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [blockFutureSync, setBlockFutureSync] = useState(true);
  const [syncedSearch, setSyncedSearch] = useState("");
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<{ message: string; error: boolean } | null>(
    null,
  );
  const [activitySearch, setActivitySearch] = useState("");
  const [blocklistSearch, setBlocklistSearch] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isStaleData, setIsStaleData] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [hasDegradedLoads, setHasDegradedLoads] = useState(false);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [sendMessages, setSendMessages] = useState<Record<string, string>>({});
  const [metadataMessages, setMetadataMessages] = useState<Record<string, string>>({});
  const [activeMovieKey, setActiveMovieKey] = useState<string | null>(null);
  const [refreshingMetadataKey, setRefreshingMetadataKey] = useState<string | null>(null);

  const [autoSyncSummary, setAutoSyncSummary] = useState<AutoSyncSummary | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityRetryNotices, setActivityRetryNotices] = useState<Record<string, string>>({});
  const [activitySeenAt, setActivitySeenAt] = useState(() => Date.now());
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isClearActivityConfirmOpen, setIsClearActivityConfirmOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  const movieModalRef = useRef<HTMLDivElement>(null);
  const activityPanelRef = useRef<HTMLElement>(null);
  const syncedPanelRef = useRef<HTMLElement>(null);
  const approvalsPanelRef = useRef<HTMLElement>(null);
  const settingsModalRef = useRef<HTMLDivElement>(null);
  const removeDialogRef = useRef<HTMLDivElement>(null);
  const clearActivityDialogRef = useRef<HTMLDivElement>(null);
  const genreDropdownRef = useRef<HTMLDivElement>(null);

  // Nested overlays (remove/clear dialogs above a modal) stay correct because
  // each trap listens on its own container — only the topmost layer sees Tab.
  useFocusTrap(movieModalRef, Boolean(activeMovieKey));
  useFocusTrap(activityPanelRef, isActivityOpen);
  useFocusTrap(syncedPanelRef, isSyncedOpen);
  useFocusTrap(approvalsPanelRef, isApprovalsOpen);
  useFocusTrap(settingsModalRef, isSettingsOpen);
  useFocusTrap(removeDialogRef, removingMovie != null);
  useFocusTrap(clearActivityDialogRef, isClearActivityConfirmOpen);

  useClickAway(genreDropdownRef, () => setIsGenreFilterOpen(false), isGenreFilterOpen);


  const activityUnreadCount = useMemo(
    () => activityLog.filter((entry) => isActivityBadgeWorthy(entry) && entry.at > activitySeenAt).length,
    [activityLog, activitySeenAt],
  );
  const pendingApprovalCount = pendingApprovals.filter((approval) => approval.status === "pending").length;
  const erroredApprovalCount = pendingApprovals.filter((approval) => approval.status === "error").length;
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

  // Secondary loaders stay non-fatal, but failures flip a shared degraded
  // flag so they are not completely invisible (P1-7).
  const loadReviewers = useCallback(async () => {
    try {
      const res = await fetch("/api/reviewers", { cache: "no-store" });
      if (!res.ok) {
        setHasDegradedLoads(true);
        return;
      }
      const body = (await res.json()) as { reviewers?: ReviewerDto[] };
      setReviewers(body.reviewers ?? []);
    } catch {
      setHasDegradedLoads(true);
    }
  }, []);

  const loadReviewerGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/reviewer-groups", { cache: "no-store" });
      if (!res.ok) {
        setHasDegradedLoads(true);
        return;
      }
      const body = (await res.json()) as { groups?: ReviewerGroupDto[] };
      setReviewerGroups(body.groups ?? []);
      setHasLoadedGroups(true);
    } catch {
      setHasDegradedLoads(true);
    }
  }, []);

  const loadPendingApprovals = useCallback(async () => {
    try {
      // includeResolved so errored approvals stay visible; counts filter on status.
      const res = await fetch("/api/pending-approvals?includeResolved=1", { cache: "no-store" });
      if (!res.ok) {
        setHasDegradedLoads(true);
        return;
      }
      const body = (await res.json()) as { pendingApprovals?: PendingApprovalDto[] };
      setPendingApprovals(body.pendingApprovals ?? []);
    } catch {
      setHasDegradedLoads(true);
    }
  }, []);

  const loadBlocklist = useCallback(async () => {
    try {
      const res = await fetch("/api/blocklist", { cache: "no-store" });
      if (!res.ok) {
        setHasDegradedLoads(true);
        return;
      }
      const body = (await res.json()) as { blocklist?: BlocklistedMovieDto[] };
      setBlocklistedMovies(body.blocklist ?? []);
    } catch {
      setHasDegradedLoads(true);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/sync?${scopeQuery()}`, { cache: "no-store" });
      if (!res.ok) {
        setHasDegradedLoads(true);
        return;
      }
      const body = (await res.json()) as { results: SyncResultItem[] };
      setActivityLog(body.results.map(syncResultToActivity));
    } catch {
      setHasDegradedLoads(true);
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
        // stale:true means Letterboxd was unreachable and the API served its
        // cache; label it instead of silently showing old data (P1-7).
        setIsStaleData(body.stale === true);
        const sorted = sortMoviesByRating(body.reviews);
        setMovies(sorted);
        const states: Record<string, SendState> = {};
        for (const review of sorted) {
          states[movieKey(review)] = statusToSendState(review.status);
        }
        // Merge instead of replace: keep in-flight "loading" entries so a
        // background reload doesn't wipe a manual add's spinner.
        setSendStates((previous) => {
          for (const [key, value] of Object.entries(previous)) {
            if (value === "loading") states[key] = value;
          }
          return states;
        });
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
      if (!res.ok) {
        setHasDegradedLoads(true);
        return;
      }
      const body = (await res.json()) as { movies?: AggregatedMovieDto[] };
      const scoped = body.movies ?? [];
      setSyncedMovies(scoped);
      if (currentScope.type === "all") {
        setAllSyncedCount(scoped.length);
      } else {
        // The scoped panel's empty state points users at the unscoped list.
        const allRes = await fetch("/api/radarr/synced", { cache: "no-store" });
        if (allRes.ok) {
          const allBody = (await allRes.json()) as { movies?: AggregatedMovieDto[] };
          setAllSyncedCount((allBody.movies ?? []).length);
        }
      }
    } catch {
      // non-fatal
    }
  }, [currentScope.type, scopeQuery]);

  const reconcileSyncedMovies = useCallback(async () => {
    setIsReconciling(true);
    setReconcileResult(null);
    try {
      const res = await fetch("/api/radarr/reconcile", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { checked?: number; missing?: number; message?: string }
        | null;
      if (res.status === 401) {
        setBootPhase("needsLogin");
        return;
      }
      if (!res.ok) {
        throw new Error(apiMessage(body, "Unable to verify the library against Radarr."));
      }
      const checked = body?.checked ?? 0;
      const missing = body?.missing ?? 0;
      setReconcileResult({
        message:
          missing > 0
            ? `Verified ${checked} synced ${checked === 1 ? "movie" : "movies"}: ${missing} removed in Radarr.`
            : `Verified ${checked} synced ${checked === 1 ? "movie" : "movies"}: all present in Radarr.`,
        error: false,
      });
      if (missing > 0) {
        await Promise.all([loadSyncedMovies(), loadActivity(), loadReviews(false)]);
      }
    } catch (err) {
      setReconcileResult({
        message: err instanceof Error ? err.message : "Unable to verify the library against Radarr.",
        error: true,
      });
    } finally {
      setIsReconciling(false);
    }
  }, [loadActivity, loadReviews, loadSyncedMovies]);

  const removeSyncedMovie = useCallback(async () => {
    if (!removingMovie) return;
    const representative = removingMovie.reviews[0];
    if (!representative) {
      setRemovingMovie(null);
      return;
    }
    setIsRemoving(true);
    setRemoveError(null);
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
        setRemovingMovie(null);
        setDeleteFiles(false);
        setBlockFutureSync(true);
      } else {
        // Keep the dialog open so the user can retry or cancel (P1-7).
        setRemoveError(body?.message ?? "Failed to remove movie from Radarr.");
      }
    } catch {
      setRemoveError("Failed to remove movie from Radarr.");
    } finally {
      setIsRemoving(false);
    }
  }, [removingMovie, deleteFiles, blockFutureSync, loadActivity, loadBlocklist, loadReviews]);

  const loadSettings = useCallback(async () => {
    try {
      setBootMessage("Loading settings…");
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
      setBootMessage("Loading reviewers and groups…");
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
      setBootMessage("Checking authentication…");
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      const status = (await res.json()) as AuthStatusResponse;
      const phase = resolveBootPhase(status);
      if (phase === "needsSetup" || phase === "ready") {
        await loadSettings();
      }
      setBootPhase(phase);
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
      if (isMobileFiltersOpen) {
        setIsMobileFiltersOpen(false);
        return;
      }
      if (isSyncedOpen) {
        setIsSyncedOpen(false);
        return;
      }
      if (isApprovalsOpen) {
        setIsApprovalsOpen(false);
        return;
      }
      if (bootPhase === "ready" && isSettingsOpen) setIsSettingsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeMovieKey, bootPhase, isActivityOpen, isApprovalsOpen, isGenreFilterOpen, isMobileFiltersOpen, isSettingsOpen, isSyncedOpen]);

  useEffect(() => {
    if (!autoSyncSummary) return;
    const t = setTimeout(() => setAutoSyncSummary(null), 6000);
    return () => clearTimeout(t);
  }, [autoSyncSummary]);

  // Reset any stale removal error whenever the remove dialog opens or closes.
  useEffect(() => {
    setRemoveError(null);
  }, [removingMovie]);

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

  // Drives the mobile "Filters (N)" badge. Group scope replaces Row 2 with a
  // "Using group filters" badge, so the count is only meaningful outside it.
  const activeFilterCount = activeReviewerGroup
    ? 0
    : (minimumRating > 0 ? 1 : 0) + (selectedGenres.length > 0 ? 1 : 0) + (hideAdded ? 1 : 0);

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

  async function createReviewerGroup(input: {
    name: string;
    enabled: boolean;
    ratingThreshold: number;
    syncInterval: SyncInterval;
    requiresManualApproval: boolean;
    filters: SyncFilters;
    reviewerHandles: string[];
  }): Promise<boolean> {
    const name = input.name.trim();
    if (!name) return false;
    setSettingsError(null);
    try {
      const res = await fetch("/api/reviewer-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enabled: input.enabled,
          ratingThreshold: input.ratingThreshold,
          syncInterval: input.syncInterval,
          requiresManualApproval: input.requiresManualApproval,
          filters: input.filters,
          reviewerHandles: input.reviewerHandles,
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

  // Approval-queue actions return an error message (or null) so the panel can
  // render failures inline on the row instead of routing through settingsError.
  async function resolvePendingApproval(
    approval: PendingApprovalDto,
    action: "approve" | "reject",
  ): Promise<string | null> {
    try {
      const res = await fetch(`/api/pending-approvals/${approval.id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) return apiMessage(body, `Unable to ${action} pending movie.`);
      await Promise.all([loadPendingApprovals(), loadActivity(), loadSyncedMovies(), loadReviews(false)]);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : `Unable to ${action} pending movie.`;
    }
  }

  async function rejectAndBlocklistPendingApproval(approval: PendingApprovalDto): Promise<string | null> {
    try {
      const rejectRes = await fetch(`/api/pending-approvals/${approval.id}/reject`, { method: "POST" });
      const rejectBody = (await rejectRes.json().catch(() => null)) as { message?: string } | null;
      if (!rejectRes.ok) return apiMessage(rejectBody, "Unable to reject pending movie.");

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
      if (!blockRes.ok) return apiMessage(blockBody, "Unable to blocklist movie.");

      await Promise.all([loadPendingApprovals(), loadBlocklist(), loadActivity(), loadSyncedMovies(), loadReviews(false)]);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Unable to reject and blocklist pending movie.";
    }
  }

  async function resetResolvedApproval(approval: PendingApprovalDto): Promise<string | null> {
    try {
      const res = await fetch(`/api/pending-approvals/${approval.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) return apiMessage(body, "Unable to reset approval.");
      await loadPendingApprovals();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Unable to reset approval.";
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

  // Completes setup with only the reviewer saved; any half-filled Radarr
  // fields in the form are intentionally discarded, not persisted.
  async function skipRadarrSetup() {
    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      const reviewerHandle = config.username.trim() || settings.reviewer.trim();
      if (!reviewerHandle) {
        throw new Error("Add a Letterboxd username first.");
      }
      const reviewerRes = await fetch("/api/reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: reviewerHandle }),
      });
      const reviewerBody = (await reviewerRes.json().catch(() => null)) as { message?: string } | null;
      if (!reviewerRes.ok) throw new Error(apiMessage(reviewerBody, "Unable to save reviewer."));

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
      filmId: movieKey(movie),
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

  async function retryFromActivity(entry: ActivityEntry) {
    const movie =
      (entry.filmId != null
        ? (movies.find((m) => movieKey(m) === entry.filmId) ??
          syncedMovies.find((m) => movieKey(m) === entry.filmId))
        : undefined) ??
      (entry.reviewId != null
        ? (movies.find((m) => m.reviews.some((review) => review.id === entry.reviewId)) ??
          syncedMovies.find((m) => m.reviews.some((review) => review.id === entry.reviewId)))
        : undefined);
    if (!movie) {
      setActivityRetryNotices((current) => ({
        ...current,
        [entry.id]: "Movie not in the current scope — switch scope to retry.",
      }));
      return;
    }
    setActivityRetryNotices((current) => {
      if (!(entry.id in current)) return current;
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
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
        : { dotClass: "bg-pine/50", textClass: "text-cornsilk/70", label: "Not tested" };

  const setupReady = canCompleteSetup(settings, settingsDraft, config.username || reviewers[0]?.handle || "");

  // ── Boot gates ─────────────────────────────────────────────────────────
  if (bootPhase === "loading") {
    return <LoadingScreen message={bootMessage} />;
  }

  if (bootPhase === "needsPasswordSetup") {
    return (
      <PasswordSetupScreen
        confirmPasswordInput={confirmPasswordInput}
        isSettingPassword={isSettingPassword}
        loginError={loginError}
        passwordInput={passwordInput}
        onConfirmPasswordChange={setConfirmPasswordInput}
        onPasswordChange={setPasswordInput}
        onSubmit={submitSetupPassword}
      />
    );
  }

  if (bootPhase === "needsLogin") {
    return (
      <LoginScreen
        isLoggingIn={isLoggingIn}
        loginError={loginError}
        passwordInput={passwordInput}
        onPasswordChange={setPasswordInput}
        onSubmit={submitLogin}
      />
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
              onSkipRadarr={() => void skipRadarrSetup()}
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
      <DashboardNav
        activityUnreadCount={activityUnreadCount}
        busy={busy}
        isRadarrSetup={Boolean(isRadarrSetup)}
        pendingApprovalCount={pendingApprovalCount}
        onOpenActivity={openActivity}
        onOpenApprovals={() => {
          void loadPendingApprovals();
          setIsApprovalsOpen(true);
        }}
        onOpenSettings={() => {
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
        onSyncFeed={() => void syncFeed()}
      />

      {/* ── Main Dashboard Layout ────────────────────────────────────────── */}
      <main className="flex min-h-[100dvh] flex-col overflow-y-auto pt-16">
        {movies.length > 0 ? (
          <div className="content-shell flex flex-col gap-4 py-4">
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

              {isStaleData && !fetchError && (
                <AlertBanner title="Showing cached reviews" tone="info">
                  Letterboxd is unreachable — showing cached reviews until it responds again.
                </AlertBanner>
              )}

              {hasDegradedLoads && (
                <AlertBanner
                  action={
                    <button
                      className="rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-cornsilk/80 transition hover:bg-white/[0.08] hover:text-cornsilk"
                      onClick={() => {
                        setHasDegradedLoads(false);
                        void loadReviewers();
                        void loadReviewerGroups();
                        void loadPendingApprovals();
                        void loadBlocklist();
                        void loadActivity();
                        void loadSyncedMovies();
                      }}
                      type="button"
                    >
                      Retry
                    </button>
                  }
                  title="Some data failed to load"
                  tone="info"
                >
                  Parts of the dashboard (reviewers, groups, approvals, blocklist, or activity) may
                  be out of date.
                </AlertBanner>
              )}

              {hasLoadedGroups && enabledSyncGroupCount === 0 && (
                <AlertBanner
                  action={
                    <button
                      className="rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-cornsilk/80 transition hover:bg-white/[0.08] hover:text-cornsilk"
                      onClick={() => setIsSettingsOpen(true)}
                      type="button"
                    >
                      Open sync settings
                    </button>
                  }
                  title="No enabled sync groups"
                  tone="info"
                >
                  Movies will not be added to Radarr automatically until a sync group is enabled.
                </AlertBanner>
              )}

              <div className="grid shrink-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
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
                  onClick={() => setIsSettingsOpen(true)}
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
                    setReconcileResult(null);
                    setIsSyncedOpen(true);
                  }}
                  value={`${stats.synced} synced`}
                />
                <StatCard
                  detail={`Avg of ${stats.filtered} shown ${
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

              <div className="ui-section sticky top-0 z-10 px-3 py-2">
                {/* Compact toolbar — one row on desktop, stacks on small screens */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Left cluster — always visible */}
                  <select
                    aria-label="Reviewer scope"
                    className="ui-select ui-select-sm w-auto min-w-[8rem] font-bold sm:min-w-[10rem]"
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

                  <span className="ui-badge ui-badge-slate shrink-0 opacity-80">
                    {stats.filtered} of {stats.total}
                  </span>

                  <Button
                    aria-controls="filter-row-2"
                    aria-expanded={isMobileFiltersOpen}
                    className="relative lg:hidden"
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsMobileFiltersOpen((open) => !open)}
                  >
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-ink">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>

                  {/* Inline filters — inline on desktop, toggled by Filters on mobile */}
                  <div
                    className={`${
                      isMobileFiltersOpen ? "flex" : "hidden"
                    } order-20 w-full items-center gap-2 lg:order-none lg:flex lg:w-auto`}
                    id="filter-row-2"
                  >
                    {currentScope.type === "group" ? (
                      <span className="ui-badge ui-badge-green">Using group filters</span>
                    ) : (
                      <>
                        <select
                          aria-label="Minimum rating"
                          className="ui-select ui-select-sm w-auto min-w-[7.5rem] font-bold"
                          value={minimumRating}
                          onChange={(event) => setMinimumRating(Number(event.target.value))}
                        >
                          <option value={0}>All ratings</option>
                          {[3.0, 3.5, 4.0, 4.5, 5.0].map((val) => (
                            <option key={val} value={val}>
                              {val.toFixed(1)}★ &amp; up
                            </option>
                          ))}
                        </select>

                        <div ref={genreDropdownRef} className="relative">
                          <button
                            aria-expanded={isGenreFilterOpen}
                            aria-haspopup="listbox"
                            aria-label="Filter by genre"
                            className={`flex h-8 min-w-[8rem] items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-pine/25 ${
                              isGenreFilterOpen || selectedGenres.length > 0
                                ? "border-pine/50 bg-pine/10 text-chartreuse"
                                : "border-white/10 bg-black/20 text-cornsilk/80 hover:border-white/20 hover:bg-white/[0.05] hover:text-cornsilk"
                            }`}
                            onClick={() => setIsGenreFilterOpen((open) => !open)}
                            type="button"
                          >
                            <span className="truncate">{genreFilterLabel}</span>
                            <span className="pointer-events-none text-[10px] text-cornsilk/45">▼</span>
                          </button>
                          {isGenreFilterOpen && (
                            <div className="absolute left-0 top-full z-30 mt-2 w-60 rounded-[var(--radius-control)] border border-cornsilk/10 bg-ink p-2 shadow-2xl">
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
                              <div className="max-h-56 overflow-y-auto py-1">
                                {genreOptions.length === 0 ? (
                                  <p className="px-2 py-3 text-xs leading-relaxed text-cornsilk/70">
                                    Cached genres will appear after metadata refresh.
                                  </p>
                                ) : (
                                  genreOptions.map((genre) => (
                                    <label
                                      key={genre}
                                      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-xs font-semibold text-cornsilk/75 transition hover:bg-white/[0.06]"
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

                        <label
                          className={`flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border px-3 text-xs font-bold transition focus-within:ring-2 focus-within:ring-pine/25 ${
                            hideAdded
                              ? "border-pine/50 bg-pine/10 text-chartreuse"
                              : "border-white/10 bg-black/20 text-cornsilk/80 hover:border-white/20 hover:bg-white/[0.05] hover:text-cornsilk"
                          }`}
                        >
                          <input
                            aria-label="Hide added movies"
                            checked={hideAdded}
                            className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                            onChange={(e) => setHideAdded(e.target.checked)}
                            type="checkbox"
                          />
                          <span className="whitespace-nowrap">Hide added</span>
                        </label>
                      </>
                    )}
                  </div>

                  {/* Search — right on desktop, full width on mobile */}
                  <div className="relative order-10 flex basis-full items-center lg:order-none lg:ml-auto lg:basis-auto lg:flex-1 lg:max-w-[480px]">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cornsilk/45" />
                    <Input
                      aria-label="Search movies"
                      className="ui-input-sm h-8 w-full pl-9 pr-8"
                      placeholder="Search movies, year, reviewer, or genre…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-cornsilk/45 transition hover:bg-white/10 hover:text-cornsilk"
                        onClick={() => setSearchQuery("")}
                        type="button"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {filteredMovies.length === 0 ? (
              <div className="py-8">
                <EmptyState
                  icon={<FilmIcon className="h-6 w-6" />}
                  title="No movies match this filter"
                  description={
                    hideAdded
                      ? "All visible movies are already in Radarr, or none meet the current filter. Adjust the filters above."
                      : searchQuery.trim()
                        ? "No movies match your search. Try a different query."
                        : activeReviewerGroup
                          ? "No movies match this group's threshold and filters. Adjust them in Sync groups."
                          : selectedGenres.length > 0
                            ? "No movies match the selected genre filter. Clear genres or choose a different selection above."
                            : minimumRating > 0
                              ? `No movies rated ${minimumRating.toFixed(1)}★ or higher. Choose All or lower the minimum rating above.`
                              : "No movies cached yet. Sync your Letterboxd feed to get started."
                  }
                />
              </div>
            ) : (
              <MovieGrid
                movies={filteredMovies}
                sendStates={sendStates}
                onOpenMovie={(key) => setActiveMovieKey(key)}
                onRemove={(m) => setRemovingMovie(m)}
                onSend={(m) => void sendToRadarr(m)}
              />
            )}
          </div>
        ) : (
        <div className="content-shell flex flex-col py-3 sm:h-full sm:min-h-0">
          {fetchError && (
            <AlertBanner title="Unable to sync feed" tone="error">
              {fetchError}
            </AlertBanner>
          )}
          {movies.length === 0 && !busy && (
            <WelcomeHero
              isRadarrSetup={Boolean(isRadarrSetup)}
              isUserSetup={isUserSetup}
              username={config.username}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onSyncNow={() => void syncFeed()}
              onUsernameChange={(value) => updateConfig("username", value)}
            />
          )}

          {busy && movies.length === 0 && <LoadingSkeletonGrid isSyncing={isSyncing} />}
        </div>
        )}
      </main>

      {/* ── Movie Detail Modal ─────────────────────────────────────────────── */}
      {activeMovieKey && activeMovie && (
        <MovieDetailModal
          message={activeMessage ?? null}
          metadataMessage={activeMetadataMessage ?? null}
          metadataRefreshing={activeMetadataRefreshing}
          modalRef={movieModalRef}
          movie={activeMovie}
          sendState={activeSendState}
          onClose={() => setActiveMovieKey(null)}
          onRefreshMetadata={(movie) => void refreshMetadata(movie)}
          onRemove={(movie) => setRemovingMovie(movie)}
          onSend={(movie) => void sendToRadarr(movie)}
        />
      )}

      {/* ── Sync Activity Slide-over ───────────────────────────────────────── */}
      {isActivityOpen && (
        <ActivityPanel
          activityLog={activityLog}
          activityRetryNotices={activityRetryNotices}
          activitySearch={activitySearch}
          filteredActivityLog={filteredActivityLog}
          panelRef={activityPanelRef}
          sendStates={sendStates}
          onClearRequest={() => setIsClearActivityConfirmOpen(true)}
          onClose={() => setIsActivityOpen(false)}
          onRefresh={() => void loadActivity()}
          onRetry={(entry) => void retryFromActivity(entry)}
          onSearchChange={setActivitySearch}
        />
      )}

      {/* ── Approval Queue Slide-over ────────────────────────────────────── */}
      {isApprovalsOpen && (
        <ApprovalsPanel
          approvals={pendingApprovals}
          panelRef={approvalsPanelRef}
          onApprove={(approval) => resolvePendingApproval(approval, "approve")}
          onClose={() => setIsApprovalsOpen(false)}
          onRefresh={() => void loadPendingApprovals()}
          onReject={(approval) => resolvePendingApproval(approval, "reject")}
          onRejectAndBlocklist={rejectAndBlocklistPendingApproval}
          onReset={resetResolvedApproval}
        />
      )}

      {/* ── Synced Movies Slide-over ─────────────────────────────────────── */}
      {isSyncedOpen && (
        <SyncedPanel
          allSyncedCount={allSyncedCount}
          filteredSyncedMovies={filteredSyncedMovies}
          isAllScope={currentScope.type === "all"}
          isReconciling={isReconciling}
          panelRef={syncedPanelRef}
          reconcileResult={reconcileResult}
          syncedMovies={syncedMovies}
          syncedSearch={syncedSearch}
          onClose={() => {
            setIsSyncedOpen(false);
            setSyncedSearch("");
          }}
          onOpenMovie={(movie) => {
            setIsSyncedOpen(false);
            setActiveMovieKey(movie.id);
          }}
          onReconcile={() => void reconcileSyncedMovies()}
          onRefresh={() => void loadSyncedMovies()}
          onRemoveMovie={(movie) => setRemovingMovie(movie)}
          onSearchChange={setSyncedSearch}
        />
      )}

      {/* ── Clear activity confirmation dialog ────────────────────────────── */}
      {isClearActivityConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            ref={clearActivityDialogRef}
            aria-modal="true"
            className="glass-modal w-full max-w-sm rounded-[var(--radius-card)] border border-cornsilk/10 p-5 shadow-2xl"
            role="dialog"
          >
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
        <RemoveMovieDialog
          blockFutureSync={blockFutureSync}
          deleteFiles={deleteFiles}
          dialogRef={removeDialogRef}
          isRemoving={isRemoving}
          movie={removingMovie}
          removeError={removeError}
          onBlockFutureSyncChange={setBlockFutureSync}
          onCancel={() => {
            setRemovingMovie(null);
            setDeleteFiles(false);
            setBlockFutureSync(true);
          }}
          onConfirm={() => void removeSyncedMovie()}
          onDeleteFilesChange={setDeleteFiles}
        />
      )}

      {/* ── Settings Modal ─────────────────────────────────────────────────── */}
      {isSettingsOpen && (
        <SettingsModal
          blocklistSearch={blocklistSearch}
          blocklistedMovies={blocklistedMovies}
          connectionDot={connectionDot}
          connectionTestResult={connectionTestResult}
          erroredApprovalCount={erroredApprovalCount}
          filteredBlocklistedMovies={filteredBlocklistedMovies}
          groupGenreOptions={groupGenreOptions}
          groupRatingOptions={groupRatingOptions}
          hasManualApprovalGroups={hasManualApprovalGroups}
          isLoadingOptions={isLoadingOptions}
          isSavingSettings={isSavingSettings}
          isTestingConnection={isTestingConnection}
          modalRef={settingsModalRef}
          pendingApprovalCount={pendingApprovalCount}
          radarrOptions={radarrOptions}
          ratingOptions={ratingOptions}
          reviewerGroups={reviewerGroups}
          reviewers={reviewers}
          settings={settings}
          settingsDraft={settingsDraft}
          settingsError={settingsError}
          settingsMessage={settingsMessage}
          syncIntervalOptions={syncIntervalOptions}
          onAddReviewer={addReviewer}
          onAutoTestConnection={maybeAutoTestConnection}
          onBlocklistSearchChange={setBlocklistSearch}
          onClose={() => setIsSettingsOpen(false)}
          onCreateGroup={createReviewerGroup}
          onDeleteGroup={deleteGroup}
          onDraftChange={(updater) => setSettingsDraft(updater)}
          onOpenApprovals={() => {
            setIsSettingsOpen(false);
            void loadPendingApprovals();
            setIsApprovalsOpen(true);
          }}
          onRemoveReviewer={removeReviewer}
          onSaveGroup={saveReviewerGroup}
          onSubmitSettings={saveSettings}
          onTestConnection={testConnection}
          onUnblockMovie={(id) => void unblockMovie(id)}
        />
      )}
    </>
  );
}
