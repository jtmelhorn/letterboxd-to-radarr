# AGENTS.md

## Project overview

Letterboxdarr is a Next.js App Router dashboard that reads public Letterboxd RSS feeds, stores reviews in SQLite, groups reviews by film/reviewer group, enriches metadata through Radarr lookup, and sends qualifying movies to Radarr automatically or after manual approval.

## Tech stack

- Frontend: Next.js App Router, React 19, TypeScript, Tailwind CSS classes in `web/app`.
- Backend: Next.js route handlers under `web/app/api`, forced to `runtime = "nodejs"` for SQLite/native modules.
- Runtime/package manager: Node 22 in Docker, npm with `web/package-lock.json`.
- Storage/config: SQLite via `better-sqlite3` + Drizzle schema in `web/app/lib/db`; app data defaults to `/data` in production and `web/.data` in development. Radarr API keys are encrypted with AES-256-GCM.
- Deployment: root `docker-compose.yml` pulls `ghcr.io/jtmelhorn/letterboxd-to-radarr:latest`; `web/Dockerfile` builds a standalone Next image.

## Repo map

- `README.md` - user-facing Docker/deployment docs and API overview.
- `docker-compose.yml` - deployment compose file and environment placeholders.
- `web/package.json` - npm scripts and dependencies.
- `web/Dockerfile` - multi-stage production image for Next standalone output.
- `web/app/page.tsx` - main dashboard and client-side orchestration.
- `web/app/components/ControlPanelForm.tsx` - Radarr/setup settings form.
- `web/app/components/SyncConfigurationPanel.tsx` - reviewer/group management UI.
- `web/app/components/SyncFilterControls.tsx` - group filter controls and frontend validation.
- `web/app/api/**/route.ts` - App Router API endpoints.
- `web/app/lib/sync.ts` - RSS refresh, filter evaluation, manual approval creation, and Radarr auto-add orchestration.
- `web/app/lib/letterboxd.ts` - RSS fetch/parse/cache logic.
- `web/app/lib/radarr.ts` - Radarr connection test, options, metadata lookup, and add logic.
- `web/app/lib/syncFilters.ts` - backend filter normalization, validation, legacy compatibility, and evaluation.
- `web/app/lib/repos/*` - persistence accessors for users, groups, reviews, settings, metadata, sync results, approvals.
- `web/app/lib/db/index.ts` - SQLite initialization, DDL, compatibility column additions, singleton rows, legacy import.
- `web/app/lib/db/schema.ts` - Drizzle table definitions.
- `web/app/lib/db/migrateLegacy.ts` - one-time migration from old JSON files.
- `web/app/types/movie.ts` - shared DTOs and API-facing types.

## Core workflows

- Reviewer management: `/api/reviewers` validates Letterboxd handles, seeds env `REVIEWER`/`LETTERBOXD_REVIEWER` when present, and stores handles in the `users` table.
- Sync group configuration: `/api/reviewer-groups` creates/updates groups with `ratingThreshold`, `syncInterval`, `requiresManualApproval`, filters, and reviewer membership. Group id `1` is the default "All reviewers" group and cannot be deleted; custom groups store membership in `reviewer_group_members`.
- RSS ingestion: `/api/reviews?refresh=1` refreshes the requested reviewer/group/all scope with `fetchLetterboxdReviews`, upserts reviews by user+guid, and enriches metadata. Plain `GET /api/reviews` reads cached aggregated data and has no Radarr add side effects.
- Movie metadata lookup: metadata uses Radarr `/api/v3/movie/lookup`, preferring RSS `tmdb:movieId` where available; TV-style entries may use the TVmaze fallback path in metadata repos. Lookup failures should not break RSS sync.
- Radarr add flow: `/api/sync` runs scoped sync and `/api/radarr` manually adds a stored review. `sync.ts` filters candidates by group threshold/status, applies group filters, retries retryable Radarr errors up to three times, limits Radarr concurrency to 3, and records `sync_results`.
- Manual approval flow: groups with `requiresManualApproval` create `pending_approvals` instead of adding immediately. Approving `/api/pending-approvals/[id]/approve` calls Radarr and resolves the approval as `approved` or `error`; rejecting resolves without Radarr.
- Filtering logic: filters live on reviewer groups as JSON. `syncFilters.ts` supports year modes (`any`, `exact`, `gte`, `lte`, `between`) plus genre include/exclude, normalizes labels, validates backend input, and reads legacy `rules` format.

## Commands

- Install: `cd web && npm ci`
- Test: `cd web && npm test`
- Typecheck: `cd web && npm run typecheck`
- Lint: not found; there is no lint script in `web/package.json`.
- Build: `cd web && npm run build`
- Docker build: `docker build -t letterboxdarr:latest ./web`
- Docker Compose config check: `docker compose config`
- Docker Compose deployment: `docker compose up -d`

Do not add or rely on local dev server instructions unless a future task verifies a reliable workflow. The repo contains `npm run dev`, but this file intentionally does not bless it as a confirmed local app workflow.

## Development rules

- Make minimal focused changes and avoid unrelated refactors.
- Preserve backward compatibility for existing SQLite data, legacy JSON imports, filter JSON, and deprecated DTO fields such as `autoThreshold`.
- Do not introduce forced defaults without clear UI; Radarr quality profile/root folder may be auto-selected only where existing code already does so.
- Keep group-specific sync behavior inside reviewer group configuration.
- Validate on the backend, not only in React components.
- Add or update tests for behavior changes where possible, especially around sync, filters, and group persistence.
- Do not commit secrets, real Radarr API keys, app passwords, encryption keys, SQLite databases, or `.data` contents.
- Do not assume the app can be run locally.

## UI rules

- Keep reviewer and group management in one cohesive sync configuration screen.
- Make sync behavior explicit: threshold, interval, filters, and manual approval should be visible where groups are managed.
- Avoid vague labels like "Unassigned" unless the UI clearly explains what it means.
- Avoid global settings that duplicate group settings; the default group is the bridge for "all reviewers" behavior.
- Keep filters understandable and flexible; pair frontend validation with `syncFilters.ts` backend validation.
- Reuse existing Tailwind class patterns, CSS variables such as `--radius-card`/`--radius-control`, and compact section-card form patterns.

## Testing notes

Tests live next to the code they cover:

- `web/app/lib/sync.test.ts`
- `web/app/lib/syncFilters.test.ts`
- `web/app/lib/repos/reviewerGroups.test.ts`
- `web/app/components/SyncConfigurationPanel.test.tsx`

Vitest is configured in `web/vitest.config.ts` with the `@` alias pointing at `web/` and default `environment: "node"`. Use `cd web && npm test` for the available test workflow. There is no lint script.

## Known pitfalls

- No confirmed reliable local run workflow. Do not add "run locally" instructions or depend on `npm run dev` without verifying it for the task.
- `docker-compose.yml` currently contains placeholders, including `${CHANGE_ME}:/data`; validate compose before assuming it is runnable as-is.
- Do not edit generated or local state directly: `web/.next`, `web/node_modules`, `web/.data`, SQLite files, and Docker volume contents are not source.
- SQLite schema changes need compatibility handling in both `web/app/lib/db/schema.ts` and `web/app/lib/db/index.ts` DDL/`ensureColumn` logic.
- `migrateLegacyJson` is one-time and guarded by `.migrated-sqlite`; changes can affect old users upgrading from JSON storage.
- Environment variables can override stored settings: `RADARR`/`RADARR_URL`, `API_KEY`/`RADARR_API_KEY`, `REVIEWER`/`LETTERBOXD_REVIEWER`, `APP_PASSWORD`, `APP_ENCRYPTION_KEY`, `SYNC_CRON`, `DATA_DIR`.
- Radarr credentials are resolved server-side; do not accept client-supplied API keys for add/sync paths.
- RSS fetches are cached and conditional. Preserve stale-cache behavior in `/api/reviews` when upstream refresh fails.
- Sync idempotence depends on recorded `sync_results` statuses (`added`/`exists`) and representative review IDs.
- Filter behavior can be fragile when genre metadata is unavailable; excluded-genre filtering currently skips movies with no genre metadata.
- Group id `1` has special semantics as the default group and membership is auto-populated from all users.
