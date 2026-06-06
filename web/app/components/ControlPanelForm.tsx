"use client";

import { FormEvent } from "react";

import type { PublicSettings, RadarrOptionsResponse } from "@/app/types/movie";

export interface SettingsDraft {
  radarrUrl: string;
  radarrApiKey: string;
  autoThreshold: number;
  qualityProfileId: number | "";
  rootFolderPath: string;
}

interface ConnectionDot {
  dotClass: string;
  textClass: string;
  label: string;
}

interface ControlPanelFormProps {
  mode: "modal" | "setup";
  settings: PublicSettings;
  settingsDraft: SettingsDraft;
  onDraftChange: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  letterboxdUsername?: string;
  onLetterboxdUsernameChange?: (value: string) => void;
  radarrOptions: RadarrOptionsResponse | null;
  isLoadingOptions: boolean;
  isTestingConnection: boolean;
  isSaving: boolean;
  connectionDot: ConnectionDot;
  connectionTestResult: { success: boolean; message: string } | null;
  settingsMessage: string | null;
  settingsError: string | null;
  ratingOptions: number[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTestConnection: () => void;
  onAutoTestConnection?: () => void;
  submitLabel: string;
  canSubmit?: boolean;
}

const inputCls =
  "h-11 rounded-xl border border-cornsilk/10 bg-ink/60 px-4 text-sm text-cornsilk placeholder-cornsilk/40 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold/40 transition-all duration-200";

const labelCls = "text-xs font-bold uppercase tracking-wider text-cornsilk/60";

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
      <path d="M5 13l4 4L19 7" />
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
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

export function ControlPanelForm({
  mode,
  settings,
  settingsDraft,
  onDraftChange,
  letterboxdUsername,
  onLetterboxdUsernameChange,
  radarrOptions,
  isLoadingOptions,
  isTestingConnection,
  isSaving,
  connectionDot,
  connectionTestResult,
  settingsMessage,
  settingsError,
  ratingOptions,
  onSubmit,
  onTestConnection,
  onAutoTestConnection,
  submitLabel,
  canSubmit = true,
}: ControlPanelFormProps) {
  const isSetup = mode === "setup";
  const profilePlaceholder = isLoadingOptions
    ? "Loading…"
    : isSetup
      ? "Select a quality profile"
      : "Auto (first available)";
  const folderPlaceholder = isLoadingOptions
    ? "Loading…"
    : isSetup
      ? "Select a root folder"
      : "Auto (first available)";

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {isSetup && onLetterboxdUsernameChange && (
        <>
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-gold flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            Letterboxd Account
          </h4>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Letterboxd Username</span>
            <input
              className={inputCls}
              placeholder="your-letterboxd-handle"
              value={letterboxdUsername ?? ""}
              onChange={(e) => onLetterboxdUsernameChange(e.target.value)}
            />
          </label>
        </>
      )}

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
            onBlur={onAutoTestConnection}
            onChange={(e) => onDraftChange((c) => ({ ...c, radarrUrl: e.target.value }))}
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
            onBlur={onAutoTestConnection}
            onChange={(e) => onDraftChange((c) => ({ ...c, radarrApiKey: e.target.value }))}
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
                onDraftChange((c) => ({
                  ...c,
                  qualityProfileId: e.target.value === "" ? "" : Number(e.target.value),
                }))
              }
            >
              {!isSetup && <option value="">{profilePlaceholder}</option>}
              {isSetup && settingsDraft.qualityProfileId === "" && (
                <option value="">{profilePlaceholder}</option>
              )}
              {radarrOptions?.qualityProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-cornsilk/55 text-xs">
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
              onChange={(e) => onDraftChange((c) => ({ ...c, rootFolderPath: e.target.value }))}
            >
              {!isSetup && <option value="">{folderPlaceholder}</option>}
              {isSetup && !settingsDraft.rootFolderPath && (
                <option value="">{folderPlaceholder}</option>
              )}
              {radarrOptions?.rootFolders.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
            <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-cornsilk/55 text-xs">
              ▼
            </span>
          </div>
        </label>
      </div>
      {!radarrOptions && (
        <p className="text-[11px] text-cornsilk/55 leading-normal">
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
            onChange={(e) => onDraftChange((c) => ({ ...c, autoThreshold: Number(e.target.value) }))}
          >
            <option value={-1}>Disable Automatic Syncing</option>
            {ratingOptions.map((r) => (
              <option key={r} value={r}>
                Sync Rated ≥ {r.toFixed(1)} ★
              </option>
            ))}
          </select>
          <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-cornsilk/55 text-xs">
            ▼
          </span>
        </div>
        <p className="text-[11px] text-cornsilk/55 leading-normal">
          The background scheduler and the Sync Feed button add movies rated at or above this threshold
          to your Radarr library automatically.
        </p>
      </div>

      <div className="rounded-xl border border-cornsilk/5 bg-ink/20 p-4 space-y-1.5 text-xs text-cornsilk/55">
        <p>
          <span className="font-semibold text-cornsilk/60">Server Path: </span>
          {settings.dataDir || "Fetching data path..."}
        </p>
        <p className="text-[11px] leading-relaxed">
          Settings and cached reviews are stored in a SQLite database in this directory. Your Radarr API
          key is encrypted at rest.
        </p>
      </div>

      {connectionTestResult && (
        <div
          className={`rounded-xl border p-3.5 flex items-start gap-2.5 text-xs animate-fade-in ${
            connectionTestResult.success
              ? "border-pine/30 bg-pine/10 text-cornsilk"
              : "border-rose-500/20 bg-rose-500/5 text-rose-400"
          }`}
        >
          {connectionTestResult.success ? (
            <CheckIcon className="h-4 w-4 flex-shrink-0 text-chartreuse" />
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
        <div className="rounded-xl border border-pine/30 bg-pine/10 px-4 py-3 text-xs font-semibold text-cornsilk">
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
          onClick={onTestConnection}
          type="button"
        >
          {isTestingConnection ? "Testing Connection..." : "Test Connection"}
        </button>

        <button
          className="h-10 rounded-xl bg-pine px-6 text-xs font-bold text-cornsilk transition hover:bg-pine/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-pine/40 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving || !canSubmit}
          type="submit"
        >
          {isSaving ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function canCompleteSetup(
  settings: PublicSettings,
  settingsDraft: SettingsDraft,
  letterboxdUsername: string,
): boolean {
  return (
    letterboxdUsername.trim().length > 0 &&
    settingsDraft.radarrUrl.trim().length > 0 &&
    (settingsDraft.radarrApiKey.trim().length > 0 || settings.hasRadarrApiKey) &&
    settingsDraft.qualityProfileId !== "" &&
    settingsDraft.rootFolderPath.trim().length > 0 &&
    Number.isFinite(settingsDraft.autoThreshold)
  );
}
