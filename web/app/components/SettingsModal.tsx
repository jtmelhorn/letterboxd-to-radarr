"use client";

import { useState, type FormEvent, type RefObject } from "react";

import { ControlPanelForm } from "@/app/components/ControlPanelForm";
import type { SettingsDraft } from "@/app/components/ControlPanelForm";
import { SyncConfigurationPanel } from "@/app/components/SyncConfigurationPanel";
import { ModalHeader } from "@/app/components/ui";
import type {
  BlocklistedMovieDto,
  PublicSettings,
  RadarrOptionsResponse,
  ReviewerDto,
  ReviewerGroupDto,
  SyncFilters,
  SyncInterval,
} from "@/app/types/movie";

type GroupUpdate = Partial<
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
>;

type CreateGroupInput = {
  name: string;
  enabled: boolean;
  ratingThreshold: number;
  syncInterval: SyncInterval;
  requiresManualApproval: boolean;
  filters: SyncFilters;
  reviewerHandles: string[];
};

type Tab = "groups" | "radarr" | "blocklist";

export function SettingsModal({
  modalRef,
  onClose,
  // Sync groups
  groupGenreOptions,
  groupRatingOptions,
  pendingApprovalCount,
  reviewerGroups,
  reviewers,
  syncIntervalOptions,
  onAddReviewer,
  onCreateGroup,
  onDeleteGroup,
  onRemoveReviewer,
  onSaveGroup,
  // Approvals summary
  hasManualApprovalGroups,
  erroredApprovalCount,
  onOpenApprovals,
  // Blocklist
  blocklistedMovies,
  filteredBlocklistedMovies,
  blocklistSearch,
  onBlocklistSearchChange,
  onUnblockMovie,
  // Radarr settings form
  connectionDot,
  connectionTestResult,
  isLoadingOptions,
  isSavingSettings,
  isTestingConnection,
  radarrOptions,
  ratingOptions,
  settings,
  settingsDraft,
  settingsError,
  settingsMessage,
  onAutoTestConnection,
  onDraftChange,
  onSubmitSettings,
  onTestConnection,
}: {
  modalRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  groupGenreOptions: string[];
  groupRatingOptions: number[];
  pendingApprovalCount: number;
  reviewerGroups: ReviewerGroupDto[];
  reviewers: ReviewerDto[];
  syncIntervalOptions: Array<{ value: SyncInterval; label: string }>;
  onAddReviewer: (handle: string) => Promise<boolean>;
  onCreateGroup: (input: CreateGroupInput) => Promise<boolean>;
  onDeleteGroup: (group: ReviewerGroupDto) => Promise<void>;
  onRemoveReviewer: (handle: string) => Promise<void>;
  onSaveGroup: (group: ReviewerGroupDto, update: GroupUpdate) => Promise<boolean>;
  hasManualApprovalGroups: boolean;
  erroredApprovalCount: number;
  onOpenApprovals: () => void;
  blocklistedMovies: BlocklistedMovieDto[];
  filteredBlocklistedMovies: BlocklistedMovieDto[];
  blocklistSearch: string;
  onBlocklistSearchChange: (value: string) => void;
  onUnblockMovie: (id: number) => void;
  connectionDot: { dotClass: string; textClass: string; label: string };
  connectionTestResult: { success: boolean; message: string } | null;
  isLoadingOptions: boolean;
  isSavingSettings: boolean;
  isTestingConnection: boolean;
  radarrOptions: RadarrOptionsResponse | null;
  ratingOptions: number[];
  settings: PublicSettings;
  settingsDraft: SettingsDraft;
  settingsError: string | null;
  settingsMessage: string | null;
  onAutoTestConnection: () => void;
  onDraftChange: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onSubmitSettings: (event: FormEvent<HTMLFormElement>) => void;
  onTestConnection: () => void;
}) {
  const [tab, setTab] = useState<Tab>("groups");

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "groups", label: "Sync groups" },
    { value: "radarr", label: "Radarr connection" },
    { value: "blocklist", label: "Blocklist", count: blocklistedMovies.length },
  ];

  return (
    <div
      className="modal-overlay items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        aria-labelledby="settings-title"
        aria-modal="true"
        className="modal-shell flex max-h-[92vh] w-full flex-col sm:max-w-5xl"
        role="dialog"
      >
        <ModalHeader
          closeLabel="Close settings"
          eyebrow="Control panel"
          onClose={onClose}
          title="Settings"
          titleId="settings-title"
        />

        <div className="flex flex-col gap-4 overflow-hidden sm:flex-row">
          {/* Sidebar tabs */}
          <nav className="flex flex-shrink-0 gap-1 border-b border-white/10 px-4 py-3 sm:w-56 sm:flex-col sm:border-b-0 sm:border-r sm:px-3 sm:py-5">
            {tabs.map((t) => (
              <button
                key={t.value}
                className={`flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-xs font-bold transition ${
                  tab === t.value
                    ? "bg-pine/15 text-cornsilk"
                    : "text-cornsilk/65 hover:bg-white/[0.04] hover:text-cornsilk"
                }`}
                onClick={() => setTab(t.value)}
                type="button"
              >
                <span>{t.label}</span>
                {typeof t.count === "number" && t.count > 0 && (
                  <span className="rounded-full bg-cornsilk/10 px-1.5 py-0.5 text-[10px] text-cornsilk/80">
                    {t.count}
                  </span>
                )}
              </button>
            ))}

            {(hasManualApprovalGroups || pendingApprovalCount > 0 || erroredApprovalCount > 0) && (
              <div className="mt-4 rounded-[var(--radius-control)] border border-gold/15 bg-gold/10 p-3 sm:mt-auto">
                <p className="text-xs font-extrabold text-cornsilk">
                  Pending approvals ({pendingApprovalCount})
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-cornsilk/65">
                  Open the approval queue from the inbox icon in the navigation bar.
                </p>
                <button
                  className="ui-btn ui-btn-secondary ui-btn-sm mt-2 w-full"
                  onClick={onOpenApprovals}
                  type="button"
                >
                  Open queue
                </button>
              </div>
            )}
          </nav>

          {/* Tab panels */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-2 sm:px-6 sm:pt-5">
            {tab === "groups" && (
              <SyncConfigurationPanel
                genreOptions={groupGenreOptions}
                pendingApprovalCount={pendingApprovalCount}
                ratingOptions={groupRatingOptions}
                reviewerGroups={reviewerGroups}
                reviewers={reviewers}
                syncCronOverride={settings.syncCronOverride}
                syncIntervalOptions={syncIntervalOptions}
                onAddReviewer={onAddReviewer}
                onCreateGroup={onCreateGroup}
                onDeleteGroup={onDeleteGroup}
                onRemoveReviewer={onRemoveReviewer}
                onSaveGroup={onSaveGroup}
              />
            )}

            {tab === "radarr" && (
              <ControlPanelForm
                connectionDot={connectionDot}
                connectionTestResult={connectionTestResult}
                isLoadingOptions={isLoadingOptions}
                isSaving={isSavingSettings}
                isTestingConnection={isTestingConnection}
                mode="modal"
                onAutoTestConnection={onAutoTestConnection}
                onDraftChange={onDraftChange}
                onSubmit={onSubmitSettings}
                onTestConnection={onTestConnection}
                radarrOptions={radarrOptions}
                ratingOptions={ratingOptions}
                settings={settings}
                settingsDraft={settingsDraft}
                settingsError={settingsError}
                settingsMessage={settingsMessage}
                submitLabel="Save Settings"
              />
            )}

            {tab === "blocklist" && (
              <section className="space-y-4">
                <div>
                  <h3 className="text-base font-extrabold tracking-tight text-cornsilk">Blocklisted movies</h3>
                  <p className="ui-helper mt-1">
                    Movies listed here are skipped before approvals or Radarr adds.
                  </p>
                </div>
                <input
                  aria-label="Search blocklisted movies"
                  className="ui-input ui-input-sm"
                  placeholder="Search by title, year, source, or TMDB/IMDb id…"
                  value={blocklistSearch}
                  onChange={(e) => onBlocklistSearchChange(e.target.value)}
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
                            <span className="ml-1 font-medium text-cornsilk/70">{movie.year}</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-cornsilk/60">
                          {movie.source === "removed_from_radarr" ? "Removed from Radarr" : "Manually blocked"}
                          {movie.tmdbId != null && <span> · TMDB {movie.tmdbId}</span>}
                        </p>
                      </div>
                      <button
                        className="ui-btn ui-btn-secondary ui-btn-sm"
                        onClick={() => onUnblockMovie(movie.id)}
                        type="button"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                  {blocklistedMovies.length === 0 && (
                    <p className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 px-3 py-3 text-xs text-cornsilk/70">
                      No movies are blocklisted.
                    </p>
                  )}
                  {blocklistedMovies.length > 0 && filteredBlocklistedMovies.length === 0 && (
                    <p className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/15 px-3 py-3 text-xs text-cornsilk/70">
                      No blocklisted movies match your search.
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
