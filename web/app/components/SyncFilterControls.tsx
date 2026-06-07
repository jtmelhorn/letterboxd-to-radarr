"use client";

import { useMemo, useState } from "react";

import {
  MAX_SYNC_YEAR,
  MIN_SYNC_YEAR,
  normalizeGenreKey,
  normalizeGenreLabel,
  normalizeSyncFilters,
  validateSyncFilters,
} from "@/app/lib/syncFilters";
import type { SyncFilters, SyncYearFilterMode } from "@/app/types/movie";

export interface SyncFilterDraft {
  year: {
    mode: SyncYearFilterMode;
    exactYear: string;
    minYear: string;
    maxYear: string;
  };
  genres: {
    include: string[];
    exclude: string[];
  };
}

interface SyncFilterControlsProps {
  draft: SyncFilterDraft;
  genreOptions: string[];
  error?: string | null;
  onChange: (draft: SyncFilterDraft) => void;
}

const inputCls =
  "h-9 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 text-xs text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25";

const selectCls = `${inputCls} appearance-none`;
const labelCls = "text-[10px] font-bold uppercase tracking-wider text-cornsilk/55";
const helperCls = "text-[11px] leading-relaxed text-cornsilk/50";
const currentYear = String(new Date().getFullYear());

const yearModeOptions: Array<{ value: SyncYearFilterMode; label: string }> = [
  { value: "any", label: "Any year" },
  { value: "exact", label: "Exact year" },
  { value: "gte", label: "Year is after or equal to" },
  { value: "lte", label: "Year is before or equal to" },
  { value: "between", label: "Year is between" },
];

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

function yearString(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

export function filtersToDraft(value: unknown): SyncFilterDraft {
  const filters = normalizeSyncFilters(value);
  return {
    year: {
      mode: filters.year.mode,
      exactYear: yearString(filters.year.exactYear),
      minYear: yearString(filters.year.minYear),
      maxYear: yearString(filters.year.maxYear),
    },
    genres: {
      include: [...filters.genres.include],
      exclude: [...filters.genres.exclude],
    },
  };
}

function compactDraft(draft: SyncFilterDraft): unknown {
  const year = { mode: draft.year.mode } as Record<string, unknown>;
  if (draft.year.exactYear.trim()) year.exactYear = draft.year.exactYear.trim();
  if (draft.year.minYear.trim()) year.minYear = draft.year.minYear.trim();
  if (draft.year.maxYear.trim()) year.maxYear = draft.year.maxYear.trim();

  return {
    year,
    genres: {
      include: draft.genres.include,
      exclude: draft.genres.exclude,
    },
  };
}

export function draftToSyncFilters(draft: SyncFilterDraft): SyncFilters {
  return validateSyncFilters(compactDraft(draft));
}

export function validateSyncFilterDraft(draft: SyncFilterDraft): string | null {
  try {
    draftToSyncFilters(draft);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Filter settings are invalid.";
  }
}

function addGenre(values: string[], raw: string): string[] {
  const label = normalizeGenreLabel(raw);
  const key = normalizeGenreKey(label);
  if (!key) return values;
  const next = new Map(values.map((value) => [normalizeGenreKey(value), normalizeGenreLabel(value)]));
  next.set(key, label);
  return Array.from(next.values()).sort((a, b) => a.localeCompare(b));
}

function removeGenre(values: string[], raw: string): string[] {
  const key = normalizeGenreKey(raw);
  return values.filter((value) => normalizeGenreKey(value) !== key);
}

function toggleGenre(values: string[], raw: string): string[] {
  const key = normalizeGenreKey(raw);
  if (!key) return values;
  if (values.some((value) => normalizeGenreKey(value) === key)) {
    return removeGenre(values, raw);
  }
  return addGenre(values, raw);
}

function MultiGenreDropdown({
  label,
  helper,
  values,
  options,
  tone,
  onChange,
}: {
  label: string;
  helper: string;
  values: string[];
  options: string[];
  tone: "include" | "exclude";
  onChange: (values: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const availableOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const option of [...options, ...values]) {
      const label = normalizeGenreLabel(option);
      const key = normalizeGenreKey(label);
      if (key) labels.set(key, label);
    }
    return Array.from(labels.values()).sort((a, b) => a.localeCompare(b));
  }, [options, values]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeGenreKey(query);
    if (!normalizedQuery) return availableOptions;
    return availableOptions.filter((option) => normalizeGenreKey(option).includes(normalizedQuery));
  }, [availableOptions, query]);
  const selectedKeys = useMemo(() => new Set(values.map(normalizeGenreKey)), [values]);
  const chipTone =
    tone === "include"
      ? "border-pine/20 bg-pine/10 text-chartreuse"
      : "border-gold/20 bg-gold/10 text-gold";
  const dropdownTone = tone === "include" ? "focus:ring-pine/25" : "focus:ring-gold/25";
  const summary =
    values.length === 0
      ? `Select ${tone === "include" ? "included" : "excluded"} genres`
      : `${values.length} selected`;

  return (
    <div className="relative space-y-2">
      <div className="space-y-1">
        <span className={labelCls}>{label}</span>
        <button
          aria-expanded={isOpen}
          aria-label={label}
          className={`min-h-10 w-full rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 py-2 text-left text-xs font-bold leading-snug text-cornsilk/75 transition hover:border-white/20 hover:bg-white/[0.05] focus:border-pine/60 focus:outline-none focus:ring-2 ${dropdownTone}`}
          type="button"
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="block whitespace-normal">{summary}</span>
        </button>
      </div>
      <p className={helperCls}>{helper}</p>

      {isOpen && (
        <div className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-ink p-2 shadow-2xl">
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            className={inputCls}
            placeholder="Search genres"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-2 max-h-48 overflow-y-auto pr-1">
            {filteredOptions.map((option) => {
              const key = normalizeGenreKey(option);
              const checked = selectedKeys.has(key);
              return (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-xs font-semibold text-cornsilk/75 transition hover:bg-white/[0.06]"
                >
                  <input
                    checked={checked}
                    className="h-3.5 w-3.5 rounded border-cornsilk/20 bg-ink text-pine focus:ring-pine/40"
                    type="checkbox"
                    onChange={() => onChange(toggleGenre(values, option))}
                  />
                  <span className="min-w-0 flex-1 whitespace-normal leading-snug">{option}</span>
                </label>
              );
            })}
            {filteredOptions.length === 0 && (
              <p className="px-2 py-3 text-xs font-semibold text-cornsilk/45">No matching genres.</p>
            )}
          </div>
          <button
            className="mt-2 h-8 w-full rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 px-3 text-xs font-bold text-cornsilk/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-cornsilk"
            type="button"
            onClick={() => setIsOpen(false)}
          >
            Done
          </button>
        </div>
      )}

      <div className="flex min-h-8 flex-wrap gap-2">
        {values.map((genre) => (
          <span
            key={genre}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-bold ${chipTone}`}
          >
            <span className="truncate">{genre}</span>
            <button
              aria-label={`Remove ${genre} from ${label.toLowerCase()}`}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition hover:bg-white/10"
              type="button"
              onClick={() => onChange(removeGenre(values, genre))}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-[11px] font-semibold text-cornsilk/45">None selected</span>}
      </div>
    </div>
  );
}

export function SyncFilterControls({ draft, error, genreOptions, onChange }: SyncFilterControlsProps) {
  const updateYear = (update: Partial<SyncFilterDraft["year"]>) => {
    onChange({ ...draft, year: { ...draft.year, ...update } });
  };
  const updateYearMode = (mode: SyncYearFilterMode) => {
    updateYear({
      mode,
      exactYear: mode === "exact" && !draft.year.exactYear.trim() ? currentYear : draft.year.exactYear,
    });
  };

  return (
    <div className="rounded-[var(--radius-control)] border border-cornsilk/10 bg-black/20 p-3">
      <div className="mb-3 space-y-1">
        <p className={labelCls}>Movie filters</p>
        <p className={helperCls}>Filters apply before approvals or Radarr adds for this group.</p>
        <p className={helperCls}>Genre filters require a movie metadata lookup during sync.</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="space-y-1">
            <span className={labelCls}>Release year filter</span>
            <select
              className={selectCls}
              value={draft.year.mode}
              onChange={(event) => updateYearMode(event.target.value as SyncYearFilterMode)}
            >
              {yearModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {draft.year.mode === "exact" && (
            <label className="space-y-1">
              <span className={labelCls}>Exact year</span>
              <input
                className={inputCls}
                inputMode="numeric"
                max={MAX_SYNC_YEAR}
                min={MIN_SYNC_YEAR}
                placeholder={currentYear}
                type="text"
                value={draft.year.exactYear}
                onChange={(event) => updateYear({ exactYear: event.target.value })}
              />
            </label>
          )}

          {draft.year.mode === "gte" && (
            <label className="space-y-1">
              <span className={labelCls}>Minimum year</span>
              <input
                className={inputCls}
                inputMode="numeric"
                max={MAX_SYNC_YEAR}
                min={MIN_SYNC_YEAR}
                placeholder="2020"
                type="text"
                value={draft.year.minYear}
                onChange={(event) => updateYear({ minYear: event.target.value })}
              />
            </label>
          )}

          {draft.year.mode === "lte" && (
            <label className="space-y-1">
              <span className={labelCls}>Maximum year</span>
              <input
                className={inputCls}
                inputMode="numeric"
                max={MAX_SYNC_YEAR}
                min={MIN_SYNC_YEAR}
                placeholder="1999"
                type="text"
                value={draft.year.maxYear}
                onChange={(event) => updateYear({ maxYear: event.target.value })}
              />
            </label>
          )}

          {draft.year.mode === "between" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelCls}>Minimum year</span>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  max={MAX_SYNC_YEAR}
                  min={MIN_SYNC_YEAR}
                  placeholder="1990"
                  type="text"
                  value={draft.year.minYear}
                  onChange={(event) => updateYear({ minYear: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className={labelCls}>Maximum year</span>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  max={MAX_SYNC_YEAR}
                  min={MIN_SYNC_YEAR}
                  placeholder="2010"
                  type="text"
                  value={draft.year.maxYear}
                  onChange={(event) => updateYear({ maxYear: event.target.value })}
                />
              </label>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MultiGenreDropdown
            helper="Included genres limit syncing to movies matching at least one selected genre."
            label="Included genres"
            options={genreOptions}
            tone="include"
            values={draft.genres.include}
            onChange={(include) => onChange({ ...draft, genres: { ...draft.genres, include } })}
          />
          <MultiGenreDropdown
            helper="Excluded genres prevent matching movies from syncing."
            label="Excluded genres"
            options={genreOptions}
            tone="exclude"
            values={draft.genres.exclude}
            onChange={(exclude) => onChange({ ...draft, genres: { ...draft.genres, exclude } })}
          />
        </div>

        {error && (
          <p className="rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
