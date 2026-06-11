"use client";

import { CheckIcon, SparklesIcon } from "@/app/components/icons";

export function WelcomeHero({
  isRadarrSetup,
  isUserSetup,
  username,
  onUsernameChange,
  onOpenSettings,
  onSyncNow,
}: {
  isRadarrSetup: boolean;
  isUserSetup: boolean;
  username: string;
  onUsernameChange: (value: string) => void;
  onOpenSettings: () => void;
  onSyncNow: () => void;
}) {
  return (
    <div className="animate-fade-in flex flex-1 flex-col justify-center gap-8 overflow-y-auto py-4 lg:grid lg:grid-cols-12 lg:items-center">
      <div className="lg:col-span-7 space-y-6 text-left">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/15 bg-gold/10 px-3 py-1 text-xs font-bold text-gold">
          <SparklesIcon className="h-3.5 w-3.5" />
          Private media automation
        </span>
        <h1 className="text-4xl font-black leading-tight tracking-tight text-cornsilk md:text-5xl">
          <span className="brand-wordmark">letterboxdarr</span> turns high-rated reviews into Radarr adds.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-cornsilk/68 md:text-lg">
          Configure Radarr once, enter your public Letterboxd handle, then sync. Movies that meet
          enabled group rules can be queued automatically while the dashboard stays readable and manual.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
          <div className="glass-card flex gap-3 rounded-[var(--radius-card)] p-4">
            <div className="text-gold mt-0.5">
              <CheckIcon className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-cornsilk">Background Syncing</h4>
              <p className="mt-1 text-xs leading-relaxed text-cornsilk/65">
                A server scheduler keeps Radarr in sync even when this tab is closed.
              </p>
            </div>
          </div>
          <div className="glass-card flex gap-3 rounded-[var(--radius-card)] p-4">
            <div className="text-gold mt-0.5">
              <CheckIcon className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-cornsilk">Sync Groups</h4>
              <p className="mt-1 text-xs leading-relaxed text-cornsilk/65">
                Set thresholds, timing, approvals, and filters for hands-off downloads.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-5">
        <div className="glass-card rounded-[var(--radius-card)] p-6 md:p-8 space-y-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">Get started</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-cornsilk">Connection checklist</h3>
          </div>

          <div className="space-y-4">
            <div className="flex gap-4 relative">
              <div className="absolute left-[17px] top-9 bottom-0 w-[1px] bg-pine" />
              <div
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border font-bold transition-all duration-300 ${
                  isRadarrSetup
                    ? "border-pine/30 bg-pine/15 text-cornsilk"
                    : "border-cornsilk/10 bg-ink/60 text-cornsilk/60"
                }`}
              >
                {isRadarrSetup ? <CheckIcon className="h-4 w-4" /> : "1"}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-cornsilk">Configure Radarr Server</h4>
                  {!isRadarrSetup && (
                    <span className="rounded bg-gold/10 px-1.5 py-0.5 text-[11px] font-bold text-gold border border-gold/10">
                      Setup Needed
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-cornsilk/65">
                  Configure your Radarr base URL and API key in Settings to permit syncs.
                </p>
                {!isRadarrSetup && (
                  <button
                    className="mt-2 text-xs font-semibold text-gold hover:text-cornsilk inline-flex items-center gap-1 transition-colors"
                    onClick={onOpenSettings}
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
                    ? "border-pine/30 bg-pine/15 text-cornsilk"
                    : "border-cornsilk/10 bg-ink/60 text-cornsilk/60"
                }`}
              >
                {isUserSetup ? <CheckIcon className="h-4 w-4" /> : "2"}
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-cornsilk">Enter Letterboxd Handle</h4>
                <p className="text-xs leading-relaxed text-cornsilk/65">
                  Enter your Letterboxd username, then use Sync Feed to fetch reviews.
                </p>
                {!isUserSetup && (
                  <div className="mt-2.5 flex max-w-xs gap-1.5">
                    <input
                      aria-label="Letterboxd username"
                      className="h-9 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 focus:outline-none focus:ring-2 focus:ring-gold/30"
                      placeholder="e.g. username"
                      value={username}
                      onChange={(e) => onUsernameChange(e.target.value)}
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
                <p className="text-xs leading-relaxed text-cornsilk/65">
                  Click Sync Feed to inspect, filter, and send movies into Radarr.
                </p>
                {isRadarrSetup && isUserSetup && (
                  <button
                    className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-pine px-4 py-2 text-xs font-extrabold text-ink transition hover:bg-pine/90"
                    onClick={(e) => {
                      e.preventDefault();
                      onSyncNow();
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
  );
}

export function LoadingSkeletonGrid({ isSyncing }: { isSyncing: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden">
      <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-cornsilk/25 border-t-pine" />
          <div>
            <p className="text-sm font-extrabold text-cornsilk">
              {isSyncing ? "Syncing Letterboxd and Radarr…" : "Loading Letterboxd reviews…"}
            </p>
            <p className="mt-0.5 text-xs text-cornsilk/60">
              Posters and review details will appear as soon as the feed is ready.
            </p>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="poster-grid">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="glass-card aspect-[2/3] overflow-hidden rounded-2xl shimmer-wrapper">
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
    </div>
  );
}
