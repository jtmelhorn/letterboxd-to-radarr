"use client";

import type { FormEvent, ReactNode } from "react";
import { CheckIcon, ExclamationIcon } from "@/app/components/icons";

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
  onSkipRadarr?: () => void;
  submitLabel: string;
  canSubmit?: boolean;
}

const labelCls = "text-sm font-semibold text-cornsilk";
const helperCls = "ui-helper";

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="ui-section p-4 sm:p-5">
      <div className="mb-4 space-y-1">
        <h3 className="text-base font-extrabold tracking-tight text-cornsilk">{title}</h3>
        {description && <p className={helperCls}>{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className={labelCls} htmlFor={htmlFor}>
      {children}
      {required && (
        <span className="ml-1 text-gold" aria-label="required">
          *
        </span>
      )}
    </label>
  );
}

function Alert({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
}) {
  const styles = {
    success: "border-pine/30 bg-pine/10 text-cornsilk",
    error: "border-rose-500/25 bg-rose-500/10 text-rose-200",
    info: "border-azure/20 bg-azure/10 text-cornsilk/80",
  }[tone];

  return (
    <div className={`rounded-[var(--radius-control)] border px-4 py-3 text-sm ${styles}`} role="status">
      {children}
    </div>
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
  onSkipRadarr,
  submitLabel,
  canSubmit = true,
}: ControlPanelFormProps) {
  const isSetup = mode === "setup";
  const idPrefix = isSetup ? "setup" : "settings";
  const profilePlaceholder = isLoadingOptions
    ? "Loading profiles…"
    : isSetup
      ? "Select a quality profile"
      : "Auto-select first available";
  const folderPlaceholder = isLoadingOptions
    ? "Loading folders…"
    : isSetup
      ? "Select a root folder"
      : "Auto-select first available";
  const missingSetupItems =
    isSetup && !canSubmit
      ? [
          !letterboxdUsername?.trim() && "Letterboxd username",
          !settingsDraft.radarrUrl.trim() && !settings.radarrUrlFromEnv && "Radarr base URL",
          !settingsDraft.radarrApiKey.trim() &&
            !settings.hasRadarrApiKey &&
            !settings.radarrApiKeyFromEnv &&
            "Radarr API key",
          settingsDraft.qualityProfileId === "" && "Quality profile",
          !settingsDraft.rootFolderPath.trim() && "Root folder",
        ].filter(Boolean)
      : [];

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {isSetup && onLetterboxdUsernameChange && (
        <SectionCard
          description="This is the public Letterboxd account whose reviews will be read from RSS."
          title="Letterboxd account"
        >
          <div className="space-y-2">
            <FieldLabel htmlFor={`${idPrefix}-letterboxd-username`} required>
              Letterboxd username
            </FieldLabel>
            <input
              autoComplete="username"
              className="ui-input"
              id={`${idPrefix}-letterboxd-username`}
              placeholder="your-letterboxd-handle"
              value={letterboxdUsername ?? ""}
              onChange={(e) => onLetterboxdUsernameChange(e.target.value)}
            />
          </div>
        </SectionCard>
      )}

      <SectionCard
        description="Connect to Radarr first, then load the available library targets."
        title="Radarr connection"
      >
        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel htmlFor={`${idPrefix}-radarr-url`} required>
                Radarr base URL
              </FieldLabel>
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${connectionDot.textClass}`}>
                <span className={`h-2 w-2 rounded-full ${connectionDot.dotClass}`} />
                {connectionDot.label}
              </span>
            </div>
            <input
              autoComplete="url"
              className="ui-input"
              disabled={settings.radarrUrlFromEnv}
              id={`${idPrefix}-radarr-url`}
              inputMode="url"
              placeholder="http://192.168.1.100:7878"
              value={settings.radarrUrlFromEnv ? settings.radarrUrl : settingsDraft.radarrUrl}
              onBlur={onAutoTestConnection}
              onChange={(e) => onDraftChange((current) => ({ ...current, radarrUrl: e.target.value }))}
            />
            {settings.radarrUrlFromEnv && (
              <p className={helperCls}>
                Set by the RADARR environment variable — remove it from your container
                configuration to edit it here.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor={`${idPrefix}-radarr-api-key`} required>
              Radarr API key
            </FieldLabel>
            <input
              autoComplete="off"
              className="ui-input"
              disabled={settings.radarrApiKeyFromEnv}
              id={`${idPrefix}-radarr-api-key`}
              placeholder={
                settings.radarrApiKeyFromEnv
                  ? "Set by environment"
                  : settings.hasRadarrApiKey
                    ? "Saved — leave blank to keep unchanged"
                    : "Paste API key"
              }
              type="password"
              value={settings.radarrApiKeyFromEnv ? "" : settingsDraft.radarrApiKey}
              onBlur={onAutoTestConnection}
              onChange={(e) => onDraftChange((current) => ({ ...current, radarrApiKey: e.target.value }))}
            />
            {settings.radarrApiKeyFromEnv && (
              <p className={helperCls}>
                Set by the API_KEY environment variable — remove it from your container
                configuration to edit it here.
              </p>
            )}
            {onAutoTestConnection && (
              <p className={helperCls}>
                Use “Test connection” to load profiles and folders. The form also checks once after you leave
                these fields.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="ui-btn ui-btn-secondary"
            disabled={isTestingConnection || (!settingsDraft.radarrUrl && !settings.radarrUrlFromEnv)}
            onClick={onTestConnection}
            type="button"
          >
            {isTestingConnection ? "Testing…" : "Test connection"}
          </button>
          {!radarrOptions && (
            <p className="text-xs text-cornsilk/60">Profiles and folders appear after a successful test.</p>
          )}
        </div>

        {connectionTestResult && (
          <Alert tone={connectionTestResult.success ? "success" : "error"}>
            <div className="flex items-start gap-3">
              {connectionTestResult.success ? (
                <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-pine" />
              ) : (
                <ExclamationIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-300" />
              )}
              <div>
                <p className="font-extrabold">
                  {connectionTestResult.success ? "Connection verified" : "Connection failed"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-cornsilk/70">
                  {connectionTestResult.message}
                </p>
              </div>
            </div>
          </Alert>
        )}
      </SectionCard>

      <SectionCard
        description="Choose where Radarr should place movies added from your reviews."
        title="Library target"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <FieldLabel htmlFor={`${idPrefix}-quality-profile`} required={isSetup}>
              Quality profile
            </FieldLabel>
            <select
              className="ui-select"
              disabled={!radarrOptions}
              id={`${idPrefix}-quality-profile`}
              value={settingsDraft.qualityProfileId === "" ? "" : String(settingsDraft.qualityProfileId)}
              onChange={(e) =>
                onDraftChange((current) => ({
                  ...current,
                  qualityProfileId: e.target.value === "" ? "" : Number(e.target.value),
                }))
              }
            >
              {!isSetup && <option value="">{profilePlaceholder}</option>}
              {isSetup && settingsDraft.qualityProfileId === "" && (
                <option value="">{profilePlaceholder}</option>
              )}
              {radarrOptions?.qualityProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor={`${idPrefix}-root-folder`} required={isSetup}>
              Root folder
            </FieldLabel>
            <select
              className="ui-select"
              disabled={!radarrOptions}
              id={`${idPrefix}-root-folder`}
              value={settingsDraft.rootFolderPath}
              onChange={(e) => onDraftChange((current) => ({ ...current, rootFolderPath: e.target.value }))}
            >
              {!isSetup && <option value="">{folderPlaceholder}</option>}
              {isSetup && !settingsDraft.rootFolderPath && <option value="">{folderPlaceholder}</option>}
              {radarrOptions?.rootFolders.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.path}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SectionCard>

      {isSetup && (
        <SectionCard
          description="Sets the starting threshold for the default All reviewers group. You can change or disable that group later in Sync Configuration."
          title="Initial All reviewers group"
        >
          <div className="space-y-2">
            <FieldLabel htmlFor={`${idPrefix}-auto-threshold`}>Auto-sync threshold</FieldLabel>
            <select
              className="ui-select"
              id={`${idPrefix}-auto-threshold`}
              value={settingsDraft.autoThreshold}
              onChange={(e) =>
                onDraftChange((current) => ({ ...current, autoThreshold: Number(e.target.value) }))
              }
            >
              {ratingOptions.map((rating) => (
                <option key={rating} value={rating}>
                  Sync rated ≥ {rating.toFixed(1)} ★
                </option>
              ))}
            </select>
          </div>
        </SectionCard>
      )}

      <Alert tone="info">
        <p className="font-semibold text-cornsilk">Storage and security</p>
        <p className="mt-1 text-xs leading-relaxed text-cornsilk/65">
          Settings and cached reviews are stored in SQLite at{" "}
          <span className="font-mono text-cornsilk/80">{settings.dataDir || "the configured data path"}</span>.
          Your Radarr API key is encrypted at rest.
        </p>
      </Alert>

      {settingsMessage && <Alert tone="success">{settingsMessage}</Alert>}
      {settingsError && <Alert tone="error">{settingsError}</Alert>}
      {missingSetupItems.length > 0 && (
        <Alert tone="error">
          <p className="font-extrabold">Complete the required setup fields.</p>
          <p className="mt-1 text-xs text-cornsilk/70">Missing: {missingSetupItems.join(", ")}.</p>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-end">
        {isSetup && onSkipRadarr && !canSubmit && Boolean(letterboxdUsername?.trim()) && (
          <div className="flex flex-col gap-1 sm:mr-auto">
            <button
              className="ui-btn ui-btn-secondary"
              disabled={isSaving}
              type="button"
              onClick={onSkipRadarr}
            >
              Skip Radarr for now
            </button>
            <p className={helperCls}>Saves only the reviewer. Connect Radarr later from Settings.</p>
          </div>
        )}
        <button
          className="ui-btn ui-btn-primary"
          disabled={isSaving || !canSubmit}
          type="submit"
        >
          {isSaving ? "Saving…" : submitLabel}
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
    (settingsDraft.radarrUrl.trim().length > 0 || settings.radarrUrlFromEnv) &&
    (settingsDraft.radarrApiKey.trim().length > 0 ||
      settings.hasRadarrApiKey ||
      settings.radarrApiKeyFromEnv) &&
    settingsDraft.qualityProfileId !== "" &&
    settingsDraft.rootFolderPath.trim().length > 0 &&
    Number.isFinite(settingsDraft.autoThreshold)
  );
}
