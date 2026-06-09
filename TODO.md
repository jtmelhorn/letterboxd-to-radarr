# TODO

## Project Improvement Roadmap

Letterboxdarr reads public Letterboxd RSS feeds, stores reviews in SQLite, and adds qualifying movies to Radarr automatically (scheduler / sync groups) or after manual approval. A full audit of the codebase (June 2026, branch `dev`) found four structural problems that drive most of the issues below:

1. **The documented default "All reviewers" sync group does not exist in code.** Setup, `README.md`, and `AGENTS.md` all describe it, but nothing creates, guards, or populates it. Fresh installs complete setup and then nothing ever auto-syncs.
2. **Film-level state is derived from per-review `sync_results` rows and drifts.** Removal/blocklist writes one row against one review; aggregation takes the max status across reviews, so removed multi-reviewer films stay "synced". Rejected approvals resurrect. "Clear activity" deletes the idempotency ledger and the only stored `radarrMovieId`.
3. **`web/app/page.tsx` is a 3,349-line client monolith** (icons, auth gates, dashboard, four modals, all fetch logic), which makes every fix risky.
4. **CI is red and shallow**: one test fails on `dev`, and the GitHub workflow only builds a container (no `npm test` / `npm run typecheck`).

**Strategy:** stabilize the baseline first (fix the failing test, add CI guardrails, repo hygiene), split refresh from sync, decompose `page.tsx` mechanically, then land a film-level sync-state ledger that fixes removal/blocklist/approval correctness in one schema change. After that, build the visible-state features (scheduler visibility, reconciliation, approvals panel) and finish with UX polish. The detailed safe ordering is in **Suggested Implementation Sequence** at the bottom.

**Conventions that apply to every task** (from `AGENTS.md`):

- Schema changes need paired updates in `web/app/lib/db/schema.ts` **and** the DDL/`ensureColumn` logic in `web/app/lib/db/index.ts`.
- Preserve backward compatibility for existing SQLite data, legacy JSON imports, filter JSON, and deprecated DTO fields such as `autoThreshold`.
- Validate on the backend, not only in React components.
- Tests live next to the code they cover; run with `cd web && npm test`. Typecheck with `cd web && npm run typecheck`. There is no lint script.
- Do not assume the app can be run locally; do not commit secrets or SQLite databases.

---

## P0 - Bugs, broken flows, and confusing behavior

### [x] P0-1: Fix the failing sync test and pin the refresh-add contract

> **Completed:** 2026-06-09 — dev / no PR — No spec deviation; local SQLite-backed Vitest suites were skipped by the existing harness.

**Problem:**
`cd web && npm test` fails on `dev`. `web/app/lib/sync.test.ts` > "runs freshly pulled reviews through sync groups from the reviews refresh endpoint" expects 1 Radarr add after `GET /api/reviews?refresh=1`, but gets 2. The test's "Action fans" group filters only on `year exact 2026` with no genre excludes, and the RSS fixture contains two 2026 films ("Action Future" and "Future Doc"), so two adds is what the current code does. Either the test expectation is stale relative to commit `a5869b3` ("Apply group filters to displayed movies") or a regression doubled adds.

**User impact:**
The most critical path (automatic Radarr adds) has unknown intended behavior, and the red suite means no future regression can be caught.

**Goal:**
A green test suite where the test explicitly asserts which films are added and why.

**Files/components to inspect:**
- `web/app/lib/sync.test.ts` (the failing test, ~line 280, and the sibling test at ~line 107 which uses `exclude: ["Documentary"]`)
- `web/app/lib/sync.ts` (`syncCachedGroup`, `syncRefreshedScope`)
- `git log -p a5869b3` to see what changed

**Implementation instructions:**
1. Run `cd web && npm test` and confirm the single failure.
2. Diff the failing test's group config against the passing sibling test. The sibling excludes `Documentary`; the failing test does not, so both 2026 fixtures qualify.
3. Decide intent: if two adds are correct given the fixture, either change the expectation to 2 adds (and assert both titles), or add `genres: { include: [], exclude: ["Documentary"] }` to the test's group so exactly one film qualifies (preferred — it keeps the "1 add" assertion meaningful).
4. Inspect `a5869b3` to confirm no production regression caused the count change before touching the test.
5. Make the test name and assertions self-documenting (assert added titles, not just counts).

**Edge cases:**
- If investigation reveals a genuine double-add of the *same* film (two POSTs for one filmId), that is a production bug in `syncCachedGroup` candidate dedupe and must be fixed in `sync.ts` instead of the test.

**Acceptance criteria:**
- `cd web && npm test` passes (39/39).
- `cd web && npm run typecheck` passes.
- The test asserts which specific films were added.

**Test plan:**
- The fixed test itself; add one new case covering two qualifying films in one group (expects 2 adds) so the contract is explicit.

**Do not change:**
- Production sync behavior unless a real double-add of a single film is proven.
- Other tests in the file.

---

### [x] P0-2: Repo hygiene and CI guardrails

> **Completed:** 2026-06-09 — dev / no PR — No spec deviation; CI red-check behavior requires a GitHub PR run to observe.

**Problem:**
- `web/.smoke-data2/app.db`, `app.db-shm`, `app.db-wal` are committed SQLite databases (git-tracked). `web/.gitignore` covers `.smoke-data` but not `.smoke-data2`.
- `.github/workflows/publish-container.yml` only builds the Docker image; `npm test` and `npm run typecheck` never run in CI.
- `docker-compose.yml` has an invalid volume `${CHANGE_ME}:/data` (fails `docker compose config` unless an env var is set) and ships `REVIEWER: "moremoviesmike"` — a real third-party Letterboxd account — so default installs silently ingest a stranger's feed.

**User impact:**
Committed databases may contain local state (and normalize committing data files); regressions ship because CI never runs tests; new users sync someone else's reviews out of the box.

**Goal:**
No data files in git, CI runs typecheck + tests on PRs, compose file is valid and uses placeholders only.

**Files/components to inspect:**
- `web/.smoke-data2/` (tracked files)
- `web/.gitignore`
- `.github/workflows/publish-container.yml`
- `docker-compose.yml` (`REVIEWER`, `volumes`)
- `web/app/lib/config.ts` (`isPlaceholderValue` already ignores `CHANGE_ME`)
- `README.md` (named-volume documentation)

**Implementation instructions:**
1. `git rm -r web/.smoke-data2` and add `.smoke-data2` (or a glob like `.smoke-data*`) to `web/.gitignore`.
2. Add a CI job (either a new workflow `ci.yml` or a job in `publish-container.yml`) that runs on PRs and pushes to `dev`/`main`: `cd web && npm ci && npm run typecheck && npm test`. Make the container build depend on it (`needs:`) so broken builds don't publish.
3. In `docker-compose.yml`, change `REVIEWER: "moremoviesmike"` to `REVIEWER: "CHANGE_ME"` (the app's placeholder filter in `config.ts` already ignores `CHANGE_ME`).
4. Replace `- ${CHANGE_ME}:/data` with the named volume documented in `README.md`: `- letterboxd-radarr-data:/data` plus a top-level `volumes: letterboxd-radarr-data:` block.
5. Run `docker compose config` to verify the file parses.

**Edge cases:**
- Do not delete `.data` handling or `DATA_DIR` behavior; only the committed smoke data.
- CI must tolerate `better-sqlite3` native build on the runner (tests already guard with `describeWithSqlite`).

**Acceptance criteria:**
- `git ls-files web/.smoke-data2` returns nothing.
- A PR with a failing test shows a red check.
- `docker compose config` succeeds with no env vars set.
- Fresh compose up does not seed any reviewer until the user edits `REVIEWER` or adds one in the UI.

**Test plan:**
- Manual: `docker compose config`; push a branch with an intentionally broken test and confirm CI fails (then revert).

**Do not change:**
- Image publishing triggers/tags; the Dockerfile; placeholder-filtering logic in `config.ts`.

---

### [x] P0-3: Create, protect, and wire the default "All reviewers" group

> **Completed:** 2026-06-09 — dev / no PR — No spec deviation; local SQLite-backed Vitest suites were skipped by the existing harness.

**Problem:**
No code creates a default reviewer group. The setup wizard's "Initial All reviewers group" section (`ControlPanelForm.tsx`, setup mode) writes only the deprecated `radarr_targets.auto_threshold`, which group sync never reads. `deleteReviewerGroup` (`web/app/lib/repos/reviewerGroups.ts`) has no guard for group id 1. No auto-membership exists. `README.md` and `AGENTS.md` describe all of this as existing behavior.

**User impact:**
Fresh installs complete setup believing auto-sync is configured; the scheduler iterates zero groups and does nothing. The only hint is a "Sync groups: None enabled" stat card.

**Goal:**
A default "All reviewers" group exists on every install, covers all reviewers automatically, receives the setup wizard's threshold, can be disabled but not deleted.

**Files/components to inspect:**
- `web/app/lib/db/index.ts` (`init()` — singleton seeding pattern for `radarr_targets` / `app_state`)
- `web/app/lib/repos/reviewerGroups.ts` (`deleteReviewerGroup`, `toReviewerGroupDto`, `handlesForGroup`)
- `web/app/lib/repos/users.ts` (`getOrCreateUser`, `deleteUser`)
- `web/app/api/reviewer-groups/route.ts` (DELETE handler)
- `web/app/page.tsx` (`completeSetup`)
- `web/app/components/ControlPanelForm.tsx` (setup threshold section copy)
- `web/app/lib/setup.ts`, `web/app/api/setup/complete/route.ts`

**Implementation instructions:**
1. In `db/index.ts` `init()`, seed a default group with an insert-if-missing statement (mirror the `radarr_targets` singleton pattern). Use a reserved name like `All reviewers`. Seed only when the `reviewer_groups` table is empty OR track the default group id in `app_state` (new column `default_group_id`) to avoid colliding with existing user-created groups on upgraded installs. Prefer the `app_state` column: it survives renames and avoids relying on `id = 1`.
2. Auto-membership: in `getOrCreateUser`, after inserting a new user, also insert membership into the default group (`reviewer_group_members`, `onConflictDoNothing`). `deleteUser` already cascades membership. Backfill memberships for existing users when seeding.
3. Guard deletion: in `deleteReviewerGroup` (repo, not just route), throw for the default group id; the route already returns the error message with a 400. Keep disable (`enabled = false`) allowed.
4. Wire setup: in `completeSetup` (`page.tsx`) the wizard already PUTs `autoThreshold` to `/api/settings`. Add a server-side step — in `/api/setup/complete` or in the settings PUT when setup is incomplete — that applies the wizard threshold to the default group (`upsertReviewerGroup` with the default id). Keep writing `radarr_targets.auto_threshold` too for DTO backward compatibility.
5. Update `ControlPanelForm.tsx` copy if wording changes, and update `README.md`/`AGENTS.md` if semantics differ from what they document.

**Edge cases:**
- Upgraded installs that already created their own "All reviewers" group (name is `UNIQUE`): if a group with that name exists, adopt it as the default instead of inserting.
- Env-seeded reviewers (`REVIEWER`/`LETTERBOXD_REVIEWER` via `getConfiguredReviewer`) must also gain default-group membership (they go through `getOrCreateUser`).
- Legacy JSON migration (`migrateLegacy.ts`) creates users directly with raw SQL — backfill memberships after migration too, or run the backfill at the end of `init()` every boot (idempotent insert-if-missing is cheapest).

**Acceptance criteria:**
- Fresh DB → setup wizard → scheduler (or `POST /api/sync` scope `all`) adds qualifying movies with no extra configuration.
- Adding a reviewer makes them a member of the default group automatically.
- `DELETE /api/reviewer-groups?id=<default>` returns 400 with a clear message; disabling works.
- Existing databases upgrade without duplicate groups or lost settings.

**Test plan:**
- Repo test: fresh DB has the default group; `getOrCreateUser("x")` adds membership; delete of default group throws.
- Sync test: fresh DB + settings + one reviewer + threshold from setup → `runSyncScope({type:"all"})` produces adds.
- Upgrade test: DB with a pre-existing group named "All reviewers" → no duplicate created.

**Do not change:**
- The deprecated `autoThreshold` field on DTOs (`ReviewerGroupDto.autoThreshold`, `PublicSettings.autoThreshold`) — keep populated.
- Custom group behavior and membership semantics.

---

### [x] P0-4: Film-level sync-state ledger (fixes stale "synced" status after removal)

> **Completed:** 2026-06-09 — dev / no PR — No spec deviation; local SQLite-backed Vitest suites were skipped by the existing harness.

**Problem:**
Sync state is stored per *review* in `sync_results`. Removal endpoints (`web/app/api/movies/[id]/remove/route.ts`, `web/app/api/radarr/route.ts` DELETE) record `removed`/`blocklisted` against **one** reviewId. `getAggregatedMovies` (`web/app/lib/repos/aggregatedReviews.ts`) computes a film's status as the max `statusRank` across all its reviews, where `added` (rank 3) beats `blocklisted`/`removed` (rank 1). So a multi-reviewer film removed from Radarr still shows as "synced" forever, stays in the Synced panel, and keeps the green poster ring. Related debt: `getLatestSyncResultForFilmId` (`syncResults.ts`) and `getReviewByFilmId` (`reviews.ts`) load entire tables and scan in JS because `sync_results` has no film identity; and two different status pipelines exist (`reviews.ts:latestStatusByReview` "success sticky" vs `aggregatedReviews.ts:syncStatusByReview` + `statusRank` max-rank) implementing different semantics for the same concept.

**User impact:**
"Remove from Radarr" appears broken for any film reviewed by 2+ reviewers; displayed status diverges from actual re-add behavior; queries get slower as data grows.

**Goal:**
One authoritative, film-keyed answer to "what is this film's sync state", used by aggregation, candidate selection, and removal.

**Files/components to inspect:**
- `web/app/lib/db/schema.ts` (`syncResults` table)
- `web/app/lib/db/index.ts` (DDL + `ensureColumn`)
- `web/app/lib/repos/syncResults.ts` (`recordSyncResult`, `getLatestSyncResultForFilmId`, `getRecentSyncResults`)
- `web/app/lib/repos/aggregatedReviews.ts` (`syncStatusByReview`, `statusRank`)
- `web/app/lib/repos/reviews.ts` (`latestStatusByReview`, `getReviewByFilmId`)
- `web/app/api/movies/[id]/remove/route.ts`, `web/app/api/radarr/route.ts`
- `web/app/lib/filmIdentity.ts` (`canonicalFilmGuid`)
- `web/app/lib/sync.ts` (candidate filter `movie.status !== "added" ...`)

**Implementation instructions:**
1. Add a nullable `film_id TEXT` column to `sync_results` via `ensureColumn` in `db/index.ts` and the Drizzle schema; add an index on `(film_id, created_at)`.
2. Backfill on startup (idempotent, one-time guarded by checking for NULL film_ids): join `sync_results` → `reviews`, compute `canonicalFilmGuid(review)`, update rows.
3. Change `recordSyncResult` to require/derive `filmId` (look up the review once) and write it on every insert.
4. Rewrite film status resolution: latest row per `film_id` wins, with `added`/`exists` not overridden by later `error`/`skipped` rows but **overridden** by `removed`/`blocklisted`/`failed_remove`. Put this in one function in `syncResults.ts` (e.g. `latestFilmStatuses(filmIds): Map<string, SyncMovieStatus>`) and use it from both `aggregatedReviews.ts` and `reviews.ts`. Delete the duplicate `statusRank`/max-rank logic.
5. Rewrite `getLatestSyncResultForFilmId` as an indexed query (`WHERE film_id = ? ORDER BY created_at DESC LIMIT 1`).
6. Removal endpoints keep writing one row, but because status is now film-keyed, the stale-added bug disappears. Verify both endpoints record the film's id (`canonicalFilmGuid`).
7. Keep `getReviewByFilmId` but make it index-assisted if practical (reviews.guid is already canonical for new rows; fall back to scan only for legacy rows).

**Edge cases:**
- Legacy `reviews.guid` values that are not canonical (pre-`canonicalFilmGuid` data) — backfill must compute via `canonicalFilmGuid(row)`, not trust `guid`.
- Films whose identity changes (RSS later provides a `/film/<slug>/` URL where title-year fallback was used before): the dedupe logic in `reviews.ts:mergeExistingDuplicates` already migrates sync results to the keeper review; ensure `film_id` rows are migrated too or recomputed.
- A film with rows from multiple reviewers' manual adds: latest-per-film must consider all rows regardless of which review they hang off.
- Removal-without-blocklist (`removed` status) must leave the film eligible for re-add (current intended semantics of the unchecked "Block" checkbox).

**Acceptance criteria:**
- Film reviewed by reviewers A and B, added via A's review, then removed+blocklisted → film no longer appears in `GET /api/radarr/synced`, poster ring is not green, and the next sync skips it.
- Removal without blocklist → film is re-added on the next qualifying sync.
- `npm test` passes; no full-table JS scans remain in `getLatestSyncResultForFilmId`.

**Test plan:**
- New repo tests for `latestFilmStatuses` covering: added→error (stays added), added→blocklisted (becomes blocklisted), multi-review added+none, exists→removed.
- Extend the existing removal test in `sync.test.ts` to a two-reviewer film.
- Backfill test: insert legacy rows without `film_id`, run init, assert populated.

**Do not change:**
- The `sync_results` rows' role as a visible activity log (don't delete rows here — see P0-6).
- `SyncMovieStatus` union values (other code switches on them).
- Existing `sync_results` data (additive migration only).

---

### [x] P0-5: Make "Reject" on pending approvals permanent

> **Completed:** 2026-06-09 — dev / no PR — No spec deviation; local SQLite-backed Vitest suites were skipped by the existing harness.

**Problem:**
`createPendingApproval` (`web/app/lib/repos/pendingApprovals.ts`) dedupes only against rows with `status = 'pending'`. After a reject (`/api/pending-approvals/[id]/reject` sets `status = 'rejected'`), the very next sync of that group re-creates a fresh pending approval for the same film. Reject silently means "ask me again on every sync interval".

**User impact:**
The approval queue fills with zombie items the user already rejected; users stop trusting the queue.

**Goal:**
Rejected films stay rejected for that group until the user explicitly resets them; optionally the user can "Reject and blocklist" to block across all groups.

**Files/components to inspect:**
- `web/app/lib/repos/pendingApprovals.ts` (`createPendingApproval`, `listPendingApprovals`, `resolvePendingApproval`)
- `web/app/lib/sync.ts` (approval-creation loop in `syncCachedGroup`)
- `web/app/api/pending-approvals/[id]/reject/route.ts`
- Approvals UI inside the Settings modal in `web/app/page.tsx` (search for "Pending approvals")

**Implementation instructions:**
1. In `createPendingApproval`, also check for an existing row with `groupId + filmId + status = 'rejected'`; if found, return `null` (no new pending row).
2. Add a re-open trigger so a rejection isn't eternally sticky when circumstances change: `averageRating` is already stored on the row — when the film's current average rating is **higher** than the rating recorded on the rejected row, allow a new pending approval (pass the current average into the check). This keeps "the rating improved" cases alive without re-prompting on every sync. *(Keep this rule simple and documented in a code comment.)*
3. UI: in the approvals list, add a second reject option "Reject + blocklist" that calls the existing `POST /api/blocklist` with the film's identifiers after rejecting, for users who never want the film.
4. Provide an undo path: rejected items should be visible (greyed out) with a "Reset" action that deletes/re-opens the rejected row — either a new `DELETE /api/pending-approvals/[id]` or reuse `resolvePendingApproval`. (Visibility work overlaps with P1-3; at minimum implement the backend reset endpoint here.)

**Edge cases:**
- Multiple groups can hold approvals for the same film; rejection is per-group. Blocklisting is global — make the UI copy say so.
- A film rejected, then manually added via `POST /api/radarr` — leave the rejected row alone; status resolution from P0-4 governs displayed state.
- Average rating equality (float compare): re-open only on a strictly higher rounded-to-0.1 value.

**Acceptance criteria:**
- Sync → reject → sync again → `pending === 0` for that film/group.
- A new higher-rated review arrives → film re-appears as pending.
- "Reject + blocklist" causes future syncs to record a `skipped: blocklisted` result.

**Test plan:**
- Repo test: create → resolve rejected → create again returns `null`; create with higher rating returns a row.
- Sync integration test: full reject/resync cycle asserting `summary.pending`.

**Do not change:**
- Approve flow (`/approve` route) and its blocklist pre-check.
- The `pending_approvals` table shape beyond what's needed (status column already supports this).

---

### [x] P0-6: Stop "Clear activity" from destroying sync state

> **Completed:** 2026-06-09 — dev / no PR — Preserved the latest durable state row per film instead of the raw latest row so P0-4 success-over-transient-error semantics and Radarr ids survive clears; local SQLite-backed Vitest suites were skipped by the existing harness.

**Problem:**
The activity panel's trash button calls `DELETE /api/sync`, which runs `clearAllSyncResults()` / `clearSyncResultsForUser()` (`web/app/lib/repos/syncResults.ts`). But `sync_results` is also (a) the idempotency ledger — candidate selection in `sync.ts` skips films whose status is `added`/`exists`/`failed_remove` — and (b) the only place `radarrMovieId` is stored, which removal requires (`getLatestSyncResultForFilmId`). Clearing the "log" makes every previously-added movie a re-add candidate on the next sync and breaks "Remove from Radarr" ("Cannot safely remove… Re-sync the movie first").

**User impact:**
A cosmetic-looking trash icon triggers mass re-add attempts on the next scheduled sync and disables removals, with no warning.

**Goal:**
Clearing the activity display never changes which movies get re-added and never breaks removal.

**Files/components to inspect:**
- `web/app/lib/repos/syncResults.ts` (`clearAllSyncResults`, `clearSyncResultsForUser`, `getRecentSyncResults`)
- `web/app/api/sync/route.ts` (DELETE)
- `web/app/page.tsx` (`clearActivity`, activity panel header)
- Depends on P0-4's `film_id` column.

**Implementation instructions:**
1. After P0-4 lands, change the clear functions to preserve state-bearing rows: delete only rows that are **not** the latest row per `film_id`, or delete only rows with display-only statuses (`skipped`, `error` that have a later success) — simplest correct version: for each `film_id`, keep the single latest row; delete the rest.
2. Alternative (preferred if you implement it fully): introduce a `film_sync_state` table (filmId PK, status, radarrMovieId, radarrTmdbId, updatedAt) maintained by `recordSyncResult`; then `sync_results` becomes purely a log and clear-all is safe. Pick ONE approach and update P0-4's status resolution accordingly.
3. Add a confirmation dialog in the UI before clearing ("This clears the visible history. Movies already sent to Radarr will not be re-added.") using the same dialog pattern as the remove-movie modal.
4. Expose the existing-but-hidden `force` re-sync explicitly instead: the `POST /api/sync` body already supports `force: true`; if users were clearing activity to force re-adds, give them a real "Force re-sync" affordance (can be a small button in the activity panel footer or settings; keep minimal).

**Edge cases:**
- Clearing scoped to one reviewer (`?handle=`) — same preservation rule per film.
- Films whose only row is `skipped` — keeping the latest row preserves nothing important; fine either way.
- Concurrent sync while clearing — SQLite `busy_timeout` is set; wrap delete in a transaction.

**Acceptance criteria:**
- Add a movie → clear activity → run sync → no Radarr `POST /api/v3/movie` for that film.
- Add a movie → clear activity → "Remove from Radarr" still resolves the `radarrMovieId` and succeeds.
- The activity panel visually empties (or reduces to one entry per film, depending on the chosen approach — pick "empties" by keeping state in `film_sync_state` or excluding kept rows from `getRecentSyncResults` display via a flag).

**Test plan:**
- Repo test: record added → clear → `latestFilmStatuses` still returns added; `getLatestSyncResultForFilmId` still returns the radarrMovieId.
- Sync integration test: add → clear → sync → zero add calls.

**Do not change:**
- `recordSyncResult` call sites' semantics; the activity panel's read API shape (`SyncResultItem`).

---

### [ ] P0-7: Split "refresh reviews" (GET) from "run sync" (POST)

**Problem:**
`GET /api/reviews?refresh=1` calls `syncRefreshedScope(scope, { auto: true }, fetched)` (`web/app/api/reviews/route.ts`), which adds movies to Radarr. The dashboard calls `loadReviews(true)` on first ready render and after every scope-dropdown change (`page.tsx` auto-fetch effect + `setHasAutoFetched(false)` in the scope `onChange`). So merely opening the app or flipping the scope can trigger Radarr adds. `README.md` explicitly documents this endpoint as having "no Radarr add side effects".

**User impact:**
Surprise downloads; users cannot preview their feed without triggering automation; GETs with side effects get retried by proxies/prefetchers.

**Goal:**
`GET /api/reviews?refresh=1` fetches RSS + metadata only. Radarr adds happen exclusively via `POST /api/sync` (the nav Sync button already uses it) and the background scheduler.

**Files/components to inspect:**
- `web/app/api/reviews/route.ts`
- `web/app/lib/sync.ts` (`refreshScopeReviews`, `syncRefreshedScope`, `cachedSyncRunsForRefreshedScope`)
- `web/app/page.tsx` (`loadReviews`, auto-fetch effect, scope `onChange`, `syncFeed`)
- `web/app/lib/sync.test.ts` (the P0-1 test asserts the current side-effectful behavior — coordinate)
- `README.md` API overview

**Implementation instructions:**
1. In `reviews/route.ts`, replace the `refreshScopeReviews` + `syncRefreshedScope` pair with `refreshScopeReviews(scope)` only. Keep the stale-cache fallback behavior on upstream failure exactly as-is (per AGENTS.md).
2. Remove `syncRefreshedScope` and `cachedSyncRunsForRefreshedScope` from `sync.ts` if no other callers remain (grep first).
3. Update the P0-1 test: after refresh, expect **zero** Radarr add calls; add/keep a separate test that `POST /api/sync` performs the adds.
4. Verify the dashboard still has an obvious sync path: the nav refresh button calls `syncFeed()` → `POST /api/sync` (it does). The "Sync Now" button in the empty state does too.
5. Update `README.md` if its wording needs adjusting (it already claims no side effects — code now matches).

**Edge cases:**
- Metadata enrichment during refresh must still respect `scopeNeedsGenreMetadata` so genre filters keep working at sync time.
- The single-flight `inFlight` map in `sync.ts` keys sync scopes; refresh-only calls shouldn't collide with sync keys.

**Acceptance criteria:**
- Opening the dashboard (cold load) performs RSS fetches but zero `POST /api/v3/movie` calls to Radarr.
- Changing the scope dropdown performs zero Radarr adds.
- Nav Sync button and scheduler still add qualifying movies.

**Test plan:**
- Route test with mocked fetch: `GET /api/reviews?refresh=1` → assert no Radarr POST; `POST /api/sync` → assert adds.
- Manual: open dashboard with a qualifying movie and confirm nothing is added until Sync is clicked.

**Do not change:**
- Stale-cache fallback in `/api/reviews` (`{ reviews, stale: true }` on upstream failure).
- `POST /api/sync` behavior, scheduler behavior.

---

### [ ] P0-8: Stop group scope from overwriting saved display filters

**Problem:**
A `useEffect` in `web/app/page.tsx` (the "Mirror display filters from active sync group" block) overwrites `minimumRating` and `selectedGenres` whenever a group scope is selected, and resets them to `0` / `[]` when leaving group scope. The persistence effect then writes these clobbered values into localStorage (`letterboxdarr-local-config`). One visit to a group scope permanently destroys the user's saved display preferences. The mirroring is also redundant: `filteredMovies` already applies `activeReviewerGroup` threshold+filters directly, and the rating pills / genre control are hidden in group scope anyway.

**User impact:**
Filters mysteriously reset to "All ratings"/no genres after browsing a group scope.

**Goal:**
Group scope filters the grid via the group's rules (as today) without ever mutating or persisting the user's own display-filter state.

**Files/components to inspect:**
- `web/app/page.tsx`: the mirror effect (searches: `Mirror display filters`), the localStorage persistence effect, `filteredMovies` memo, the stat-card caption that reads `(group filters)`.

**Implementation instructions:**
1. Delete the mirror effect entirely.
2. Verify `filteredMovies` behaves identically in group scope (it checks `activeReviewerGroup` first and ignores `minimumRating`/`selectedGenres` in that branch — it does).
3. Verify the "Average rating" stat-card caption still shows "(group filters)" in group scope (it keys off `activeReviewerGroup`, not the mirrored state).
4. Check nothing else reads `minimumRating`/`selectedGenres` expecting mirrored values (grep within `page.tsx`).

**Edge cases:**
- A user with pre-clobbered localStorage: nothing to repair, but ensure loading a saved `minimumRating: 0` still works (it does — `0` means "All").

**Acceptance criteria:**
- Set min rating 4.5 and a genre filter → switch to a group scope → switch back to "All enabled groups" → 4.5 and the genre selection are still active and still in localStorage.
- Group scope still filters the grid by the group's threshold and filters.

**Test plan:**
- After P1-8 extracts a `useLocalDisplayFilters` hook, add a unit test for persistence across scope changes. Until then: manual verification per acceptance criteria.

**Do not change:**
- `filteredMovies` group-filtering logic; localStorage key names; the behavior of hiding rating/genre controls in group scope.

---

## P1 - High-impact UX and functionality improvements

### [ ] P1-1: Radarr reconciliation job ("the truth job")

**Problem:**
`added`/`exists` statuses are sticky forever (success-sticky logic in `reviews.ts`, rank/latest logic in `aggregatedReviews.ts`). If a user deletes a movie inside Radarr, this app still shows it as synced indefinitely. Nothing ever re-verifies against Radarr's actual library.

**User impact:**
The Synced panel, poster rings, and stat counts go stale; users can't trust the green checkmarks.

**Goal:**
A reconcile action (manual button + optional scheduled tail) that compares recorded synced films against Radarr's library and records reality.

**Files/components to inspect:**
- `web/app/lib/radarr.ts` (add a `listRadarrMovies(target)` wrapper for `GET /api/v3/movie` — one bulk call)
- New `web/app/lib/reconcile.ts`
- `web/app/lib/repos/syncResults.ts` / film-state from P0-4
- `web/app/lib/scheduler.ts` (optional post-sync reconcile)
- `web/app/api/radarr/synced/route.ts` + Synced slide-over in `page.tsx` (refresh/reconcile button)

**Implementation instructions:**
1. Add `listRadarrMovies` to `radarr.ts` returning `{id, tmdbId, imdbId}` tuples; single GET, 10s timeout, no pagination needed (Radarr returns the full library).
2. Create `reconcileSyncedMovies()`: load films currently considered synced (status `added`/`exists`/`failed_remove`), match each against the library by `radarrMovieId` first, then `tmdbId`; for misses, record a sync result with a new status `missing_in_radarr` (add to `SyncMovieStatus` union and `isSyncMovieStatus`) — do **not** blocklist.
3. Decide candidate semantics: films with `missing_in_radarr` should be re-addable (treat like `removed` in the candidate filter in `sync.ts`). Document in a comment.
4. Add `POST /api/radarr/reconcile` route (auth-guarded like the others) returning a summary `{checked, missing}`.
5. UI: add a "Verify against Radarr" button in the Synced slide-over header; show a result toast/banner. Status text for missing films: "Removed in Radarr".
6. Optional: call reconcile at the end of scheduled syncs behind a simple env flag (`RECONCILE_ON_SYNC=true`) or just leave it manual for now (manual is acceptable for this ticket).

**Edge cases:**
- Radarr unreachable → return 502 with message; do not record anything.
- Movies added outside this app that match cached reviews — reconcile must not mark anything for films we never recorded as synced (scope strictly to our synced set).
- Huge libraries: one GET is fine; avoid per-movie requests.

**Acceptance criteria:**
- Delete a synced movie in Radarr → click Verify → film leaves the Synced list and becomes re-addable by the next sync.
- Reconcile is idempotent (running twice records nothing new the second time).

**Test plan:**
- Unit test for `reconcileSyncedMovies` with mocked library responses (present, missing, unreachable).
- Status-union test: `missing_in_radarr` handled by candidate filter and aggregation.

**Do not change:**
- Blocklist behavior (reconcile never blocklists).
- The add path in `radarr.ts:addMovie`.

---

### [ ] P1-2: Close the blocklist identifier-matching hole

**Problem:**
`isMovieBlocklisted` (`web/app/lib/repos/movieBlocklist.ts`) checks `filmId` and normalized title+year **only when the candidate has no tmdbId and no imdbId** (`if (!input.tmdbId && !imdbId && ...)`). A candidate that *has* a tmdbId is never matched against a blocklist row stored *without* one. The `/api/radarr` DELETE path stores only `review.tmdbMovieId` (often null) and ignores the known `latestSync.radarrTmdbId`, so such rows exist. Result: blocked movies can be silently re-added.

**User impact:**
"Block this movie from future auto-sync" intermittently doesn't block.

**Goal:**
A blocklist row blocks the film regardless of which identifiers each side happens to have.

**Files/components to inspect:**
- `web/app/lib/repos/movieBlocklist.ts` (`isMovieBlocklisted`, `addToBlocklist`)
- `web/app/api/radarr/route.ts` (DELETE handler — blocklist insert)
- `web/app/api/movies/[id]/remove/route.ts` (already uses `movie.tmdbMovieId ?? latestSync?.radarrTmdbId` — use as reference)

**Implementation instructions:**
1. In `isMovieBlocklisted`, remove the `!input.tmdbId && !imdbId` gates: always check, in priority order, tmdbId → imdbId → filmId → normalized title+year. Return true on the first hit.
2. In `/api/radarr` DELETE, store the best-known tmdbId at block time: `review.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null` (mirror the movies/[id]/remove path).
3. Keep title+year as the lowest-priority check (remake false-positive risk); it already requires both fields.

**Edge cases:**
- Title+year collisions between different films (remakes same year are rare; acceptable for lowest-priority check — note it in a comment).
- Blocklist rows with `tmdb_id` unique index: `addToBlocklist` uses `onConflictDoNothing` — unchanged.
- Candidate with tmdbId A vs blocklist row with tmdbId B for the same film (bad metadata): filmId check now also runs and catches it.

**Acceptance criteria:**
- Block a movie whose stored review lacked a tmdbId → a future sync candidate carrying a tmdbId (from refreshed RSS) is still skipped with "movie is blocklisted".
- All four identifier combinations (tmdb-only row, imdb-only row, filmId-only row, title/year-only row) block candidates carrying any superset of identifiers.

**Test plan:**
- New `movieBlocklist.test.ts` matrix test: row identifier type × candidate identifier type → expected blocked.
- Sync integration test: blocklisted film with mismatched identifier sets is skipped.

**Do not change:**
- Blocklist table schema; unblock endpoints; the priority that explicit IDs beat title/year.

---

### [ ] P1-3: Promote approvals to a first-class queue

**Problem:**
Pending approvals render inside the Settings modal (`page.tsx`, "Pending approvals" section), behind a gear icon whose badge doubles as the "Radarr setup needed" dot. Approval errors are routed into `settingsError`, rendered far away near the form. The defining feature of `requiresManualApproval` groups is effectively hidden.

**User impact:**
Users don't notice movies waiting for approval; approve/reject errors are easy to miss; the gear badge is ambiguous.

**Goal:**
A dedicated approvals slide-over (same pattern as the Activity/Synced panels) with its own nav icon + count badge, row-level states, and visible resolved/errored history.

**Files/components to inspect:**
- `web/app/page.tsx` (nav icon row, `pendingApprovalCount`, `resolvePendingApproval`, the existing approvals JSX inside the Settings modal)
- `web/app/lib/repos/pendingApprovals.ts` (`listPendingApprovals(includeResolved)` already exists)
- `web/app/api/pending-approvals/route.ts`
- New `web/app/components/ApprovalsPanel.tsx`
- P0-5's reject/reset semantics (build on them)

**Implementation instructions:**
1. Build `ApprovalsPanel.tsx` modeled on the Synced slide-over: header with refresh/close, search input, list rows showing title, year, group name, average rating, createdAt relative time.
2. Add a nav icon (e.g. an inbox/check icon) with a count badge for `pendingApprovalCount`; remove the pending-count badge from the gear (keep the setup-needed pulse dot on the gear).
3. Row actions: Approve, Reject, Reject + blocklist (from P0-5). Each row manages its own busy/error state — do not reuse `settingsError`.
4. Show recently resolved items (approved/rejected/error) greyed out below pending ones — pass `includeResolved=true` via a query param on `GET /api/pending-approvals` (add `?includeResolved=1` support to the route; repo already supports it).
5. Optionally enrich rows with posters by joining film data: either include `posterUrl` in `listPendingApprovals` (join `pending_approvals.review_id` → `reviews`) or look up client-side from loaded movies. Server-side join preferred.
6. Keep a slim "Pending approvals (N) → open queue" link in the Settings modal where the old section was, so existing muscle memory still works.

**Edge cases:**
- Approval whose group was deleted (`groupName` falls back to "Deleted group") — still actionable.
- Approving a film that's now blocklisted → route returns 409; surface inline on the row.
- Approving a film already in Radarr → resolves as approved with "Already exists" message; render as success.

**Acceptance criteria:**
- Pending count visible in the nav at all times; clicking opens the queue without opening Settings.
- Approve/reject works per-row with inline busy/error states.
- Resolved items visible (greyed) with their outcome message.

**Test plan:**
- Component test (`ApprovalsPanel.test.tsx`, follow `SyncConfigurationPanel.test.tsx` patterns): renders rows, fires approve/reject callbacks, shows error state.
- Route test for `?includeResolved=1`.

**Do not change:**
- The approve/reject API contracts; `pending_approvals` schema.

---

### [ ] P1-4: Harden partial reviewer-group updates

**Problem:**
`parseGroupBody` (`web/app/api/reviewer-groups/route.ts`) substitutes defaults for omitted fields (`syncInterval: "1d"`, `requiresManualApproval: false`, threshold `4`, `reviewerHandles: []`), and `upsertReviewerGroup` writes them all. Any partial `PUT` silently resets group config. The drag-and-drop UI only survives because the React layer happens to send full payloads; a two-step drag between groups does two sequential saves and can leave a reviewer in both groups if the second fails. `reviewerIdsFromHandles` silently drops unknown handles.

**User impact:**
Scripts/integrations corrupt group settings; membership moves can half-apply.

**Goal:**
`PUT` with an `id` merges with the existing row (only provided keys change); unknown reviewer handles are rejected with a clear message.

**Files/components to inspect:**
- `web/app/api/reviewer-groups/route.ts` (`parseGroupBody`, PUT/POST)
- `web/app/lib/repos/reviewerGroups.ts` (`upsertReviewerGroup`, `reviewerIdsFromHandles`)
- `web/app/components/SyncConfigurationPanel.tsx` (`dropReviewerOnGroup` two-step save)
- `web/app/lib/repos/reviewerGroups.test.ts`

**Implementation instructions:**
1. In `parseGroupBody`, distinguish "absent" from "provided": return `undefined` for omitted `ratingThreshold`, `syncInterval`, `requiresManualApproval`, `reviewerHandles` instead of defaults.
2. In `upsertReviewerGroup`, when updating an existing group, fall back to the existing row's values for each `undefined` field (the pattern already exists for `enabled` and `filtersJson` — extend it to threshold, interval, approval, and membership: skip the member delete/insert entirely when `reviewerHandles === undefined`).
3. For creates (no `id`), keep current defaults (threshold 4, `1d`, no approval, empty members).
4. In `reviewerIdsFromHandles`, collect handles that resolve to no user and throw `Error("Unknown reviewer handle(s): …")`; route maps it to 400.
5. For the drag-between-groups flow in `SyncConfigurationPanel.tsx`, if the remove-from-source save fails after the add-to-target succeeded, surface the error (existing `settingsError` path) — acceptable to leave membership in both with a visible error rather than attempt rollback.

**Edge cases:**
- Legacy clients sending `autoThreshold` instead of `ratingThreshold` must keep working (deprecated-field compatibility).
- `filters` omitted vs explicitly `null`: omitted keeps existing JSON (current behavior); keep it.
- Group name omitted on update: currently required — keep requiring it for creates, allow omitted on update (fall back to existing name).

**Acceptance criteria:**
- `PUT {id, reviewerHandles: [...]}` changes only membership; threshold/interval/approval/filters untouched.
- `PUT {id, requiresManualApproval: true}` changes only that flag.
- `PUT` with an unknown handle returns 400 naming the handle.
- Existing UI flows (save group, drag/drop, chip remove) still work.

**Test plan:**
- Extend `reviewerGroups.test.ts`: partial-update preservation for each field; unknown-handle rejection; legacy `autoThreshold` body.
- Component test: drag handlers still send full payloads (no regression).

**Do not change:**
- POST create defaults; `SyncFilterValidationError` handling; DTO shapes.

---

### [ ] P1-5: Coherent, visible scheduling (last sync time per group)

**Problem:**
Two scheduling models coexist in `web/app/lib/scheduler.ts`: if `SYNC_CRON` is set, **all** schedulable groups run on that single cron and per-group intervals are ignored (`runScheduledSync`); if unset, five hardcoded interval crons run (`runScheduledInterval`). The two functions are near-duplicates. Nothing records or displays when a group last synced, so users can't tell whether background sync works at all. `README.md` documents only the `SYNC_CRON` model.

**User impact:**
"Sync timing: Every 30 minutes" can be a lie depending on an env var; the app gives zero feedback that the scheduler is alive.

**Goal:**
One scheduler code path; `SYNC_CRON` documented as a global override; each group shows "Last synced X ago" in the UI.

**Files/components to inspect:**
- `web/app/lib/scheduler.ts` (`runScheduledSync`, `runScheduledInterval`, `resolveSchedule`, `startScheduler`)
- `web/app/lib/db/schema.ts` + `web/app/lib/db/index.ts` (new `last_synced_at` column on `reviewer_groups` via `ensureColumn`)
- `web/app/lib/repos/reviewerGroups.ts` (`toReviewerGroupDto` — expose `lastSyncedAt`)
- `web/app/lib/sync.ts` (`executeGroupSync` — stamp the column after a run)
- `web/app/components/SyncConfigurationPanel.tsx` (display)
- `web/app/types/movie.ts` (`ReviewerGroupDto`)
- `README.md`

**Implementation instructions:**
1. Merge `runScheduledSync` and `runScheduledInterval` into one function taking an optional interval filter; keep log output format.
2. Add `last_synced_at TEXT` to `reviewer_groups` (schema + `ensureColumn`). Stamp it in `executeGroupSync` after a successful run (including runs with 0 adds; skip when the group was skipped for `manual` interval).
3. Expose `lastSyncedAt: string | null` on `ReviewerGroupDto`; render "Last synced 2h ago" (reuse the relative-time helper — extract `formatRelativeTime` from `page.tsx` into a shared util as part of this or P1-8) next to each group's header in `SyncConfigurationPanel.tsx`, and "Never synced" when null.
4. When `SYNC_CRON` is set, log clearly that per-group intervals are overridden, and render a small note in the sync-config panel ("Background schedule overridden by SYNC_CRON") — pass a flag through `PublicSettings` or a new field on the groups response.
5. Update `README.md`: document both modes (per-group intervals by default; `SYNC_CRON` as global override; `off` disables).

**Edge cases:**
- Manual-interval groups: never stamped by the scheduler but stamped by manual `POST /api/sync` runs — stamp on any successful group run regardless of trigger.
- Existing DBs: column is nullable; UI shows "Never synced" until the first run.

**Acceptance criteria:**
- Each group card shows last-synced relative time, updating after manual sync.
- With `SYNC_CRON` set, the UI indicates the override.
- Scheduler file has one run function; behavior for both env modes unchanged otherwise.

**Test plan:**
- Repo test: `executeGroupSync` stamps `last_synced_at`.
- Scheduler unit test: interval filtering selects correct groups; `SYNC_CRON` mode runs all schedulable groups.

**Do not change:**
- Cron expressions for the interval map; `off`/`AUTO_SYNC=false` disable behavior; single-flight sync semantics.

---

### [ ] P1-6: Make environment overrides visible (settings + reviewers)

**Problem:**
`getRadarrTarget` (`web/app/lib/repos/settings.ts`) prefers `RADARR`/`API_KEY` env over stored values, but the settings form happily lets users edit stored values that are then silently ignored. `publicReviewers()` (`web/app/api/reviewers/route.ts`) re-creates the env `REVIEWER` on every GET, so the env-seeded reviewer is undeletable with no explanation.

**User impact:**
"I changed the URL and nothing happened"; "this reviewer keeps coming back after I delete it".

**Goal:**
The UI shows which values come from the environment, renders them read-only, and marks the env reviewer as locked.

**Files/components to inspect:**
- `web/app/lib/repos/settings.ts` (`getRadarrTarget`, `toPublicSettings`)
- `web/app/types/movie.ts` (`PublicSettings`, `ReviewerDto`)
- `web/app/components/ControlPanelForm.tsx` (URL/API-key fields)
- `web/app/api/reviewers/route.ts` (`publicReviewers`, DELETE)
- `web/app/components/SyncConfigurationPanel.tsx` (reviewer chips)
- `web/app/lib/config.ts` (`configuredRadarrUrl`, `configuredRadarrApiKey`, `getConfiguredReviewer`)

**Implementation instructions:**
1. Extend `PublicSettings` with `radarrUrlFromEnv: boolean` and `radarrApiKeyFromEnv: boolean` (computed in `toPublicSettings` from `configuredRadarrUrl()` / `configuredRadarrApiKey()`).
2. In `ControlPanelForm.tsx`, when a field is env-controlled: disable the input, show the value (URL) or "Set by environment" placeholder (API key), and a helper line "Set by RADARR/API_KEY environment variable — remove it from your container config to edit here."
3. Extend the reviewers response with `fromEnv: boolean` per reviewer (`handle === getConfiguredReviewer().toLowerCase()`). In `SyncConfigurationPanel.tsx`, render a small lock on that chip and hide its remove button (or show a tooltip explaining why removal won't stick).
4. In `DELETE /api/reviewers`, return 400 with an explanatory message when the handle equals the env-configured reviewer (otherwise it reappears on the next GET — confusing).
5. Settings `PUT` may continue accepting URL/key values even when env-overridden (harmless), but the test-connection endpoint already prefers submitted values — leave as-is.

**Edge cases:**
- Env var removed after a reviewer was seeded: the lock disappears and normal deletion works (the flag is computed live).
- `CHANGE_ME` placeholders are filtered by `isPlaceholderValue` and must not count as env-configured.

**Acceptance criteria:**
- With `RADARR` set, the URL field is read-only with an explanation; without it, editable.
- The env reviewer chip shows a lock; deleting it via API returns a clear 400.
- `PublicSettings` consumers (setup wizard `canCompleteSetup`) still work — treat env-provided URL/key as satisfying requirements.

**Test plan:**
- Settings DTO test with env vars stubbed.
- Route test: DELETE env reviewer → 400; DELETE normal reviewer → 200.

**Do not change:**
- Env-over-stored precedence itself (container config must keep winning); placeholder filtering.

---

### [ ] P1-7: Honest fetch/error states in the dashboard

**Problem:**
Three related issues in `web/app/page.tsx`:
1. `/api/reviews` returns `{ stale: true }` when Letterboxd is unreachable but cache exists; the UI ignores the flag — users see old data with no warning.
2. Remove-movie failures call `alert(...)` (`removeSyncedMovie`) — jarring and inconsistent with the `AlertBanner` pattern.
3. `loadReviews` rebuilds `sendStates` wholesale from server statuses, wiping any in-flight `"loading"` entries — a movie being manually added loses its spinner if a background reload lands mid-flight. Several loaders also swallow errors with bare `catch {}`.

**User impact:**
Silent stale data; ugly native alerts; flickering/incorrect button states during adds.

**Goal:**
Stale data is labelled; errors surface in-app; in-flight UI state survives background reloads.

**Files/components to inspect:**
- `web/app/page.tsx`: `loadReviews` (body parsing — `stale` is already in the parsed type), `removeSyncedMovie`, `sendToRadarr`, `sendStates` setter logic, the `AlertBanner` component.

**Implementation instructions:**
1. Add `const [isStaleData, setIsStaleData] = useState(false)`; set from `body.stale === true` in `loadReviews`; clear on a successful fresh load. Render an info `AlertBanner` above the grid: "Letterboxd is unreachable — showing cached reviews." Optionally have the API include a `fetchedAt` timestamp for the message.
2. Replace both `alert(...)` calls in `removeSyncedMovie` with an error state rendered inside the remove-confirmation dialog (keep the dialog open on failure so the user can retry or cancel).
3. In `loadReviews`, merge statuses instead of replacing: build the new map from server data, then re-apply any keys currently in `"loading"` state (`setSendStates(prev => { const next = …serverStates; for (const [k,v] of Object.entries(prev)) if (v === "loading") next[k] = v; return next; })`).
4. For the silent loaders (`loadReviewers`, `loadReviewerGroups`, `loadPendingApprovals`, `loadBlocklist`, `loadActivity`, `loadSyncedMovies`): keep them non-fatal but set a single shared `degraded` flag (or console.warn at minimum) so failures aren't completely invisible. A small reusable banner "Some data failed to load — retry" is sufficient.

**Edge cases:**
- Stale flag with empty cache → route already returns 502; the existing `fetchError` banner covers it.
- A loading movie whose server status flips to added mid-flight: the manual request's own completion handler will overwrite `loading` — acceptable.

**Acceptance criteria:**
- Simulate Letterboxd failure (after at least one successful sync) → banner appears, cached movies still render.
- Failed removal shows an inline dialog error; no `alert()` calls remain in the repo.
- A movie's spinner survives a concurrent `loadReviews`.

**Test plan:**
- After P1-8, hook-level tests for the merge behavior and stale flag. Until then manual: dev-tools network blocking.

**Do not change:**
- The API's stale-cache contract; the AlertBanner component API.

---

### [ ] P1-8: Decompose `page.tsx` into components and hooks

**Problem:**
`web/app/page.tsx` is 3,349 lines: ~15 inline SVG icon components, three auth/boot screens, the dashboard, the movie detail modal, activity + synced slide-overs, the remove dialog, the settings modal, and ~30 `useState` hooks with hand-rolled fetch chains (e.g. `resolvePendingApproval` triggers four sequential reloads). Every other task touches this file; merge conflicts and regressions are guaranteed. It also ships one giant client bundle to every visitor including the login screen.

**User impact:**
Indirect but large: slows every fix, increases bug rate.

**Goal:**
`page.tsx` becomes a composition root under ~400 lines; behavior and visuals unchanged.

**Files/components to inspect:**
- `web/app/page.tsx` (everything)
- `web/app/components/` (existing patterns: `SyncConfigurationPanel`, `ControlPanelForm`, `SyncFilterControls`)

**Implementation instructions:**
Mechanical moves only — zero behavior change. Suggested extraction order (each step must typecheck + pass tests before the next):
1. `web/app/components/icons.tsx` — all SVG icon components (FilmIcon, GearIcon, CheckIcon, XIcon, RadarrIcon, ArrowPathIcon, SparklesIcon, ServerIcon, UserIcon, ExclamationIcon, StarIcon, ClockIcon, InfoIcon, TrashIcon, LockIcon). Deduplicate the copies already living in `SyncConfigurationPanel.tsx` / `ControlPanelForm.tsx`.
2. `web/app/lib/format.ts` — `formatRelativeTime`, `movieGenres`, search-matcher helpers (`movieMatchesSearch`, `activityMatchesSearch`, `pendingApprovalMatchesSearch`, `blocklistMatchesSearch`), `sortMoviesByRating`, `statusToSendState`, `syncResultToActivity`.
3. `web/app/components/AuthGate.tsx` — the `needsPasswordSetup`, `needsLogin` screens and shared form chrome (take callbacks as props).
4. `web/app/components/MovieGrid.tsx` + `PosterCard.tsx` (includes `PosterRadarrAction`, `posterRingClass`).
5. `web/app/components/MovieDetailModal.tsx`, `ActivityPanel.tsx`, `SyncedPanel.tsx`, `RemoveMovieDialog.tsx`, `SettingsModal.tsx` (the modal shells; `ModalHeader`, `AlertBanner`, `StatCard` go to `components/ui.tsx`).
6. Hooks: `web/app/hooks/useAuthBoot.ts` (bootPhase/login/setup-password), `useDashboardData.ts` (reviews/groups/approvals/blocklist/activity/synced loaders + scope handling), `useLocalDisplayFilters.ts` (localStorage persistence).
7. While moving, replace the duplicated inline search predicate in `filteredMovies` with the shared `movieMatchesSearch`, and delete the unused `useMediaQuery`/`isDesktop` (verify with grep first).

**Edge cases:**
- Preserve exact ESC-key close ordering across modals (the global keydown handler).
- Preserve focus/auto-test behavior in settings (`maybeAutoTestConnection`, `lastAutoTestRef`).
- Keep `"use client"` directives on every extracted component file.

**Acceptance criteria:**
- `page.tsx` < ~400 lines; no behavior or visual change; typecheck, tests, and `npm run build` pass.
- No duplicate icon definitions remain across components.

**Test plan:**
- Add render smoke tests for extracted panels (jsdom, following `SyncConfigurationPanel.test.tsx` setup) before/while extracting.
- Full manual pass: login → setup → dashboard → each modal → each action.

**Do not change:**
- Any behavior, styling, or API calls in this task. Pure moves. Land before behavioral UI tasks (P1-3, P1-7, P2 items).

---

### [ ] P1-9: Align reviewer-scope sync with group-average semantics

**Problem:**
`syncRunsForScope` (`web/app/lib/sync.ts`) for `{type:"reviewer"}` builds runs with `aggregationScope: {type:"reviewer", reviewer}`, so threshold checks use that single reviewer's ratings. Group/scheduler runs use the group-average. The same film can qualify in one path and not the other. (`cachedSyncRunsForRefreshedScope` already aggregates per group — use it as the reference.)

**User impact:**
Syncing a single reviewer can add a movie the group's average should have blocked, and vice versa.

**Goal:**
Reviewer-triggered syncs refresh only that reviewer's RSS but evaluate candidates against each covering group's group-scope aggregation.

**Files/components to inspect:**
- `web/app/lib/sync.ts` (`syncRunsForScope`, `cachedSyncRunsForRefreshedScope`, `executeGroupSync`, `refreshHandles`)
- `web/app/lib/sync.test.ts`

**Implementation instructions:**
1. In `syncRunsForScope` reviewer branch, change each run to `{ group, handles: [handle], aggregationScope: { type: "group", groupId: group.id } }` — refresh only the one handle, aggregate the whole group (mirroring `cachedSyncRunsForRefreshedScope`).
2. Note in a comment why handles and aggregationScope differ.
3. If P0-7 removed `cachedSyncRunsForRefreshedScope`, just apply the same pattern here.

**Edge cases:**
- Reviewer not in any enabled group → zero runs (unchanged).
- Reviewer in multiple groups → one run per group; idempotency via film status prevents double adds.

**Acceptance criteria:**
- Group with reviewers A (5.0★) and B (2.0★) on a film, threshold 4.0: syncing reviewer A does **not** add the film (group average 3.5).

**Test plan:**
- New sync test exactly matching the acceptance scenario, plus the inverse (both rated high → add succeeds from reviewer scope).

**Do not change:**
- Group-scope and all-scope behavior; the single-flight keying.

---

### [ ] P1-10: Tighten Radarr lookup matching (no more `valid[0]` guesses)

**Problem:**
`pickBestMatch` (`web/app/lib/radarr.ts`) falls back to `valid[0]` — the first lookup result — when nothing matches by tmdbId, title, or year. For ambiguous titles without a tmdbId, the app can add the **wrong movie** to Radarr.

**User impact:**
Wrong movies appear in Radarr libraries; hard to notice until downloaded.

**Goal:**
When no confident match exists, return `not_found` with an "ambiguous match" message instead of guessing.

**Files/components to inspect:**
- `web/app/lib/radarr.ts` (`pickBestMatch`, `addMovie`, `lookupMovieMetadata`)
- `web/app/lib/sync.test.ts` fixtures (lookup mocks)

**Implementation instructions:**
1. Remove the terminal `?? valid[0]` fallback in `pickBestMatch`. Keep, in order: tmdbId exact → exact title+year → normalized title+year → normalized title ±1 year → year-only (keep this one ONLY if title similarity also passes; otherwise drop it) → exact/normalized title without year.
2. Return `null` when none match; `addMovie`/`lookupMovieMetadata` already handle `null` by returning `not_found` — improve the message to "No confident match in Radarr lookup for '<title> (<year>)'. Add it manually from the movie detail view if this is the right film."
3. The year-only fallback (`valid.find(r => r.year === input.year)`) is risky for common years — require it to also pass a loose normalized-title containment check.

**Edge cases:**
- RSS provides tmdbId → unchanged exact path (most adds).
- Titles with diacritics/articles — `normalizeLookupTitle` already handles; keep.
- Single-result lookups that don't match title at all (Radarr fuzzy search) → now `not_found` instead of added. This is the intended behavior change.

**Acceptance criteria:**
- A lookup returning only unrelated titles results in a `skipped`/`error` sync result with the ambiguous-match message, not an add.
- All existing matching tests pass; tmdbId-based adds unaffected.

**Test plan:**
- Unit tests for `pickBestMatch`: each priority tier, and the no-confident-match → null case.

**Do not change:**
- The lookup term construction (`tmdb:` prefix preferred); add payload shape; retry logic in `sync.ts`.

---

## P2 - UI polish, responsive behavior, and quality-of-life improvements

### [ ] P2-1: Fix activity retry button state (wrong key space)

**Problem:**
In the activity panel (`web/app/page.tsx`), the retry button's busy check reads `sendStates[String(entry.reviewId)]`, but `sendStates` is keyed by film id (`movieKey(movie)` → `movie.id`, e.g. `"film:slug"`), never by review id. The disabled/"Sending…" state can never trigger. Also `retryFromActivity` searches only `movies` (current scope) and fails silently when the entry's film isn't in the loaded scope.

**User impact:**
Retry gives no feedback and sometimes does nothing with no explanation.

**Goal:**
Retry shows busy state and reports when the film can't be resolved in the current scope.

**Files/components to inspect:**
- `web/app/page.tsx` (`retryFromActivity`, activity list JSX — after P1-8 this lives in `ActivityPanel.tsx`)

**Implementation instructions:**
1. Resolve the film id for an activity entry: `SyncResultItem` already includes `filmId` — thread it through `syncResultToActivity` into `ActivityEntry` and key the busy check on it.
2. In `retryFromActivity`, if the movie isn't found in `movies` or `syncedMovies`, show an inline message on the entry ("Movie not in the current scope — switch scope to retry") instead of returning silently.

**Edge cases:**
- Client-generated activity entries (from `logActivity`) have no server `filmId` — derive from `movieKey(movie)` at creation.

**Acceptance criteria:**
- Clicking retry disables the button and shows "Sending…" until completion.
- Retrying an out-of-scope film shows an explanatory message.

**Test plan:**
- Component test on the extracted ActivityPanel: busy state renders; out-of-scope message renders.

**Do not change:**
- Retry's underlying call (`sendToRadarr`).

---

### [ ] P2-2: Truthful search placeholders and copy

**Problem:**
The placeholder "Search movies, year, reviewer, or genre…" is copy-pasted onto four search inputs in `page.tsx`, but: activity search matches title/year/message/status (not reviewer/genre); blocklist search matches title/year/source/tmdb/imdb; approvals search matches title/year/group name.

**User impact:**
Users type a reviewer name into activity search and wrongly conclude the data is missing.

**Goal:**
Each search input's placeholder describes what it actually matches.

**Files/components to inspect:**
- `web/app/page.tsx` (or post-P1-8 panel components): the four `<input placeholder=…>` occurrences; matcher functions `activityMatchesSearch`, `blocklistMatchesSearch`, `pendingApprovalMatchesSearch`.

**Implementation instructions:**
1. Activity: "Search by title, year, status, or message…"
2. Blocklist: "Search by title, year, source, or TMDB/IMDb id…"
3. Approvals: "Search by title, year, or group…"
4. Synced/main grid keep the current placeholder (it is accurate there).

**Edge cases:** none.

**Acceptance criteria:** Placeholders match the matcher implementations.

**Test plan:** Visual check; optional snapshot in panel tests.

**Do not change:** Matcher logic.

---

### [ ] P2-3: Form/control improvements in sync configuration

**Problem:**
- The "Hide in Radarr" checkbox label is ambiguous.
- Group threshold selects only offer 3.0–5.0 (`groupRatingOptions` in `page.tsx`), while the backend accepts 1.0–5.0 plus `-1` ("disabled", validated by `isValidAutoThreshold`). The automation-off mode is unreachable from the UI.
- `SyncConfigurationPanel` mixes two persistence models: name/threshold/interval/approval/filters need "Save group", but membership changes (drag, dropdown, chip remove) save instantly. There is no dirty-state indicator, so users don't know a Save is pending.

**User impact:**
Confusing controls; silent unsaved changes; no way to disable a group's threshold without disabling the whole group.

**Goal:**
Clear labels, full threshold range incl. "Disabled", and a visible dirty indicator on unsaved group edits.

**Files/components to inspect:**
- `web/app/page.tsx` (`groupRatingOptions`, "Hide in Radarr" label)
- `web/app/components/SyncConfigurationPanel.tsx` (`GroupDraft`, save/reset buttons, threshold select)
- `web/app/lib/repos/reviewerGroups.ts` (`isValidAutoThreshold` — reference only)

**Implementation instructions:**
1. Rename the checkbox label to "Hide movies already in Radarr".
2. Replace `groupRatingOptions` with the full 1.0–5.0 half-star range plus a "Disabled (no auto-sync)" option mapping to `-1`. Render `-1` distinctly in the select.
3. Compute dirtiness per group by comparing `groupDrafts[group.id]` to `draftFromGroup(group)` (JSON compare is fine) and: show a dot/asterisk on the "Save group" button, and disable Save when clean.
4. Add a one-line helper under the assigned-reviewers box: "Membership changes save immediately."

**Edge cases:**
- Threshold `-1` + enabled group: sync code treats `threshold === -1` as automation disabled (`syncCachedGroup`) — verify the summary/empty path still records nothing.
- Existing groups with thresholds below 3.0 (created via API) must render correctly in the expanded select.

**Acceptance criteria:**
- "Disabled" threshold selectable and persists as `-1`; such groups never auto-add.
- Save button indicates dirty state; clean groups have Save disabled.

**Test plan:**
- Extend `SyncConfigurationPanel.test.tsx`: dirty indicator appears on edit, clears on save/reset; `-1` option present.

**Do not change:**
- Backend threshold validation; instant-save membership behavior (just label it).

---

### [ ] P2-4: Modal/dropdown interaction and focus management

**Problem:**
- All four overlays (movie detail, activity, synced, settings) set `aria-modal` but never trap focus or move it on open; background stays tabbable; focus is not returned to the trigger on close.
- The dashboard genre dropdown and the `MultiGenreDropdown` in filters don't close on outside click (only via their toggle/Done buttons or the global ESC handler).
- The min-rating tooltip is a hover/focus-only `<span tabIndex={0}>` without `role`/`aria-describedby`.

**User impact:**
Keyboard users tab into a hidden background; mouse users get stuck-open dropdowns; tooltip invisible to assistive tech and touch.

**Goal:**
Standard focus-trapped dialogs, click-away dropdowns, accessible tooltip.

**Files/components to inspect:**
- `web/app/page.tsx` / post-P1-8 modal components; ESC handler effect
- `web/app/components/SyncFilterControls.tsx` (`MultiGenreDropdown`)

**Implementation instructions:**
1. Create a small `useFocusTrap(ref, active)` hook (focus first focusable on open, wrap Tab/Shift+Tab, restore focus to the previously-focused element on close). Apply to all four overlays and the remove dialog. No new dependency needed; ~40 lines.
2. Create a `useClickAway(ref, handler)` hook; apply to the dashboard genre dropdown and `MultiGenreDropdown`.
3. Tooltip: give the trigger `aria-describedby` pointing at the tooltip span's id, add `role="tooltip"`; consider replacing hover-reveal with a click-toggleable popover (also fixes touch — coordinate with P2-6).
4. Keep the existing global ESC ordering working alongside the traps.

**Edge cases:**
- Nested overlay (remove dialog opens above movie modal at `z-[60]`) — trap must apply to the topmost layer only.
- Drag-and-drop in settings must not be broken by click-away handlers.

**Acceptance criteria:**
- Tab cycling stays inside an open modal; closing returns focus to the opener.
- Clicking outside any open dropdown closes it.
- Tooltip is reachable and announced by screen readers.

**Test plan:**
- jsdom tests for the two hooks; manual keyboard pass over every overlay.

**Do not change:**
- Visual styling; ESC close ordering semantics.

---

### [ ] P2-5: Accessibility pass (contrast, labels, semantics)

**Problem:**
- Helper/label text at `text-cornsilk/55` and sizes like `text-[10px]`/`text-[9px]` will fail WCAG AA contrast/size in stat labels, section labels, and badges.
- Poster buttons' `aria-label` omits sync status (a screen-reader user can't tell a film is already in Radarr).
- The dashboard genre filter's "All genres" checkbox is checked when nothing is selected but unchecking does nothing (its onChange always clears) — semantically a "Clear" action rendered as a checkbox.

**User impact:**
Low-vision and screen-reader users get a degraded experience.

**Goal:**
AA-compliant text contrast for functional text, informative poster labels, honest control semantics.

**Files/components to inspect:**
- `web/app/page.tsx` / extracted components (search `cornsilk/55`, `cornsilk/45`, `text-[10px]`, `text-[9px]`)
- `web/app/globals.css` (color variables)
- Poster card button `aria-label`; genre dropdown "All genres" row

**Implementation instructions:**
1. Bump functional text (labels, helper text, badge text) from `/45`–`/55` opacities to `/70`+ and minimum 11px; leave purely decorative text alone. Do a targeted sweep, not a blind find/replace — check each against its background.
2. Append sync status to the poster `aria-label`: `"<title> (<year>) — 4.5 average stars — already in Radarr"` when sendState is added.
3. Replace the "All genres" checkbox with a "Clear selection" button-styled row (or make it a radio-like control that's disabled when already empty).

**Edge cases:**
- The gold-on-dark and chartreuse-on-dark accent combos — verify with a contrast checker, adjust only failing ones.

**Acceptance criteria:**
- Functional text passes AA (4.5:1 normal, 3:1 large) spot-checked on the main dashboard, settings, and modals.
- VoiceOver/NVDA reads poster status.

**Test plan:**
- Manual contrast audit (browser devtools); screen-reader spot check.

**Do not change:**
- Brand colors for decorative elements; layout.

---

### [ ] P2-6: Mobile and touch usability

**Problem:**
- The dashboard locks to `h-[100dvh]` with `overflow-hidden` (`<main>` in `page.tsx`) and the whole header stack (banners + 4 stat cards + filter bar) is `shrink-0`; on a 667px-tall phone the poster grid gets a sliver of scrollable space.
- The filter bar crams scope select, tooltip, six rating pills, genre dropdown, hide-checkbox, and search into one wrapping row — three ragged lines at tablet widths.
- Poster hover affordances ("Click for review" reveal, hover-revealed retry/remove buttons via `sm:group-hover`) have no touch equivalent beyond the idle state; the rating tooltip is hover-only.

**User impact:**
The app is hard to use on phones — tiny scroll area, cramped controls, hidden actions.

**Goal:**
Comfortable phone layout: natural page scroll on small screens, compact filters, touch-reachable actions.

**Files/components to inspect:**
- `web/app/page.tsx` / extracted `MovieGrid`/`PosterCard` + dashboard shell; `web/app/globals.css` (`.poster-grid`, `.content-shell`)

**Implementation instructions:**
1. Below `sm`, drop the fixed-viewport layout: let `<main>` scroll normally (`h-auto overflow-visible`), keep the locked layout from `sm:` up. The poster grid then participates in page scroll on phones.
2. Collapse the four stat cards into a 2×2 compact grid (already `grid-cols-1` — change to `grid-cols-2` with smaller padding) or a horizontal scroller below `sm`.
3. Move rating pills + genre + hide-added into a single "Filters" disclosure/popover button on `< lg`, leaving scope + search visible.
4. On touch (no hover media query): keep poster action buttons always visible at reduced opacity, and rely on the detail modal for retry/remove (it already has full-width buttons). Use `@media (hover: hover)` to scope the hover-reveal behavior.
5. Replace the hover tooltip with the popover from P2-4.

**Edge cases:**
- iOS dynamic viewport (`100dvh` already used — keep for the locked desktop mode).
- Very narrow screens (320px): posters min size `10.5rem` — confirm two columns still fit or allow one.

**Acceptance criteria:**
- On a 375×667 viewport: stats + filters take < 40% of viewport height; the grid scrolls naturally; every poster action is reachable by tap.
- Desktop layout unchanged.

**Test plan:**
- Manual responsive pass at 320/375/768/1024/1440 widths; verify no horizontal scroll.

**Do not change:**
- Desktop (≥1024px) layout and grid sizing.

---

### [ ] P2-7: Empty/guidance states and stat-card affordances

**Problem:**
- With zero enabled groups (P0-3 reduces but doesn't eliminate this — groups can be disabled), the dashboard shows movies normally while auto-sync is silently dead; the only signal is a stat card.
- Only the "Radarr status" stat card is clickable, with no visual affordance distinguishing it; "Sync groups: None enabled" doesn't link anywhere.
- The "Average rating" card shows the average of *currently filtered* movies but reads like a global stat.
- The Synced panel empty state doesn't distinguish "never synced anything" from "nothing synced in this scope".
- Approval rows with `status: "error"` are invisible (only pending rows listed).

**User impact:**
Users miss that automation is off; dead-end stats; misleading numbers.

**Goal:**
The dashboard tells users when automation is off and stats are navigable and honest.

**Files/components to inspect:**
- `web/app/page.tsx` / extracted dashboard + `StatCard`, Synced panel, approvals list
- `web/app/lib/repos/pendingApprovals.ts` (`includeResolved`)

**Implementation instructions:**
1. Add an info `AlertBanner` when `enabledSyncGroupCount === 0` and movies exist: "No enabled sync groups — movies will not be added to Radarr automatically." with an "Open sync settings" action button.
2. Make the "Sync groups" stat card clickable → opens the settings modal (sync section); add a subtle chevron/hover ring to both clickable cards.
3. Caption the average card "avg of shown movies".
4. Synced panel: when scope ≠ all and the all-scope synced list is non-empty, say "No synced movies in this scope — switch to All to see N synced movies." (needs the unscoped count: either fetch once or pass through existing data).
5. Surface errored approvals (overlaps P1-3 — if P1-3 is done, just verify; otherwise list `error` rows with a red badge in the existing settings section).

**Edge cases:**
- Don't show the zero-groups banner during initial load before groups have been fetched.

**Acceptance criteria:**
- Disabling all groups produces the banner; enabling one removes it.
- Both clickable stat cards have hover affordances and work.

**Test plan:**
- Component tests for banner conditions; manual click-through.

**Do not change:**
- Stat computation logic beyond captions.

---

### [ ] P2-8: Setup wizard — allow completing setup without a reachable Radarr

**Problem:**
`canCompleteSetup` (`web/app/components/ControlPanelForm.tsx`) requires a selected quality profile and root folder, which are only loadable after a successful Radarr connection test. If Radarr is down/unreachable during first-run, the user is hard-blocked from finishing setup and exploring the app.

**User impact:**
First-run dead end for users setting up the dashboard before (or away from) their Radarr box.

**Goal:**
Setup can be completed with reviewer-only configuration; Radarr details can be filled in later via the persistent "setup needed" nudge.

**Files/components to inspect:**
- `web/app/components/ControlPanelForm.tsx` (`canCompleteSetup`, `missingSetupItems`)
- `web/app/page.tsx` (`completeSetup`, gear pulse-dot logic `isRadarrSetup`)
- `web/app/lib/setup.ts` (`validateSetupReady` — server-side mirror), `web/app/api/setup/complete/route.ts`

**Implementation instructions:**
1. Add a "Skip Radarr for now" secondary action in setup mode, visible when the Letterboxd username is valid but Radarr fields are incomplete. It completes setup with only the reviewer saved.
2. Relax `validateSetupReady` server-side accordingly (reviewer required; Radarr optional) — keep full validation when Radarr fields *are* partially provided (don't allow URL without key).
3. After a skipped setup, the existing gear pulse-dot + checklist empty-state already guide users to configure Radarr — verify both render correctly in this state.
4. Sync paths already no-op safely without Radarr (`radarrConfigured` check in `syncCachedGroup`) — verify no error spam in activity.

**Edge cases:**
- Half-filled Radarr config (URL, no key) at skip time: don't persist partial values silently; warn or discard.

**Acceptance criteria:**
- Setup completes with only a Letterboxd handle; dashboard loads reviews; no Radarr errors logged until configured.
- Full setup path unchanged.

**Test plan:**
- Route test for relaxed `validateSetupReady`; manual first-run walkthrough both paths.

**Do not change:**
- The full setup path's required-field validation; auth flow.

---

### [ ] P2-9: Auth hardening (login rate limit, session invalidation)

**Problem:**
- `POST /api/auth/login` has no rate limiting or lockout — unlimited password guesses.
- Session tokens are `timestamp.HMAC` valid for 30 days (`web/app/lib/auth.ts`); changing the admin password does not invalidate existing sessions (the HMAC key — `secret.key` / `APP_ENCRYPTION_KEY` — doesn't change).

**User impact:**
Self-hosted instances exposed to the internet are brute-forceable; a stolen session outlives a password change.

**Goal:**
Throttled logins; password change invalidates sessions.

**Files/components to inspect:**
- `web/app/api/auth/login/route.ts`
- `web/app/lib/auth.ts` (`buildSessionToken`, `verifySessionToken`)
- `web/app/lib/repos/appState.ts` (password storage; add a `sessionEpoch`/`passwordChangedAt` field)
- `web/app/lib/db/schema.ts` + `db/index.ts` (new column on `app_state`)

**Implementation instructions:**
1. In-memory rate limit on login: per-IP (from `x-forwarded-for` first hop) sliding window, e.g. 10 attempts / 15 min, returning 429 with a Retry-After. In-process Map is fine (single-node app).
2. Add `session_epoch INTEGER NOT NULL DEFAULT 0` to `app_state` (schema + `ensureColumn`). Include the epoch in the session payload (`${epoch}.${timestamp}` signed); `verifySessionToken` rejects tokens whose epoch < current.
3. Bump the epoch whenever the admin password is set/changed (`setAdminPassword`). Note: env `APP_PASSWORD` changes can't be detected — document that limitation in a comment.
4. Keep cookie flags as-is (httpOnly, lax, secure-on-https).

**Edge cases:**
- Existing sessions issued before the epoch field exists: treat missing-epoch tokens as epoch 0 — valid until the first password change.
- Reverse proxies: trust only the first `x-forwarded-for` hop; fall back to a global limiter if absent.

**Acceptance criteria:**
- 11th rapid failed login returns 429.
- Setting a new password invalidates previously-issued cookies (next request → needsLogin).

**Test plan:**
- Route tests for rate limit and epoch invalidation; token round-trip unit tests.

**Do not change:**
- The env `APP_PASSWORD` flow; cookie names; 30-day max age.

---

### [ ] P2-10: Engineering hygiene — timeouts, error bodies, logging, dead code

**Problem:**
Assorted small debts from the audit:
- `web/app/lib/tvmaze.ts` fetches without the 10s `AbortSignal.timeout` used by Radarr calls.
- Route error bodies are ad-hoc `{ message }` strings with inconsistent logging (`console.error` with varying prefixes); scheduler logs are the only structured-ish output.
- Dead/duplicated code: unused `useMediaQuery`/`isDesktop` in `page.tsx`; the inline search predicate in `filteredMovies` duplicates `movieMatchesSearch` (both may already be resolved by P1-8 — verify).

**User impact:**
Indirect: hangs on slow TVmaze responses; harder debugging.

**Goal:**
Consistent timeouts, predictable error payloads, subsystem-prefixed logs, no dead code.

**Files/components to inspect:**
- `web/app/lib/tvmaze.ts`
- All `web/app/api/**/route.ts` (error responses)
- `web/app/lib/scheduler.ts`, `web/app/lib/sync.ts`, `web/app/lib/repos/movieMetadata.ts` (log call sites)
- `web/app/page.tsx`

**Implementation instructions:**
1. Add `signal: AbortSignal.timeout(10_000)` to TVmaze fetches.
2. Standardize error bodies as `{ message: string, code?: string }` — sweep routes for plain-string or inconsistent shapes (most already comply; this is verification + small fixes).
3. Adopt consistent log prefixes: `[sync]`, `[radarr]`, `[scheduler]`, `[metadata]`, `[auth]` on existing console calls. No logging library needed.
4. Delete confirmed-dead code (grep `isDesktop`, `useMediaQuery`; verify zero usages).

**Edge cases:** none significant.

**Acceptance criteria:**
- No fetch in `lib/` without a timeout; typecheck/tests/build pass; grep finds no unused media-query hook.

**Test plan:**
- Existing suite; spot-check a TVmaze timeout path with a stalled mock.

**Do not change:**
- API success payload shapes; log levels semantics.

---

### [ ] P2-11: Expand automated test coverage

**Problem:**
Current suite covers sync filtering, filter normalization, group persistence, one component, and DB init. Untested: aggregation status resolution, blocklist matching, approval lifecycle, activity-clear semantics, `pickBestMatch`, Letterboxd RSS parsing/dedupe, scheduler interval selection, auth/session expiry, `canonicalFilmGuid` edge cases.

**User impact:**
Indirect: regressions in exactly the state-accuracy areas this backlog fixes.

**Goal:**
Each fixed behavior in P0/P1 is locked in by a test; the riskiest pure functions have direct unit tests.

**Files/components to inspect:**
- Existing: `web/app/lib/sync.test.ts`, `syncFilters.test.ts`, `repos/reviewerGroups.test.ts`, `components/SyncConfigurationPanel.test.tsx`, `lib/db/index.test.ts`
- `web/vitest.config.ts`

**Implementation instructions:**
Add, colocated next to the code (many of these are also listed in their parent tasks — this task is the sweep for whatever wasn't added there):
1. `repos/aggregatedReviews.test.ts` — multi-reviewer status resolution, averaging, identity grouping.
2. `repos/movieBlocklist.test.ts` — identifier matrix (per P1-2).
3. `repos/pendingApprovals.test.ts` — create/dedupe/reject/re-open (per P0-5).
4. `repos/syncResults.test.ts` — latest-status logic, clear-preservation (per P0-4/P0-6).
5. `lib/radarr.test.ts` — `pickBestMatch` tiers, `normalizeRadarrUrl`, `errorMessageFromBody`.
6. `lib/letterboxd.test.ts` — `mapItems` from fixture XML, entity decoding, dedupe, TV detection inputs.
7. `lib/filmIdentity.test.ts` — slug extraction vs title-year fallback.
8. `lib/scheduler.test.ts` — interval selection, `SYNC_CRON` override, `off`.
9. `lib/auth.test.ts` — token round-trip, expiry, tamper rejection.

**Edge cases:**
- Keep the `describeWithSqlite` guard pattern for anything touching better-sqlite3.

**Acceptance criteria:**
- All listed files exist and pass; suite still completes in reasonable time (< ~30s).

**Test plan:** the tests are the deliverable.

**Do not change:**
- Vitest config beyond what's needed (jsdom env per-file via directive where required).

---

### [ ] P2-12: Documentation reconciliation sweep

**Problem:**
`README.md` and `AGENTS.md` describe behavior that diverges from code (default group id 1 semantics, "no Radarr side effects" on `/api/reviews`, `SYNC_CRON` model). Individual tasks above update docs locally; drift will remain.

**User impact:**
Future agents and users act on wrong assumptions — the root cause of several P0s.

**Goal:**
After the P0/P1 waves land, both docs accurately describe: default group behavior, refresh vs sync contract, scheduler modes, blocklist/removal semantics, and the approvals lifecycle.

**Files/components to inspect:**
- `README.md` (API overview, env vars, behavior descriptions)
- `AGENTS.md` (Core workflows, Known pitfalls)

**Implementation instructions:**
1. Do this as the **last** task of each wave: re-read both files against the actual routes/behavior, fix every stale claim.
2. Specifically verify: `/api/reviews` side-effect wording, group id 1 / default-group description, `SYNC_CRON` + per-interval scheduling, reject semantics, reconcile endpoint (if P1-1 landed), `last_synced_at`.

**Edge cases:** none.

**Acceptance criteria:**
- A new agent reading only `AGENTS.md` + `README.md` would make correct assumptions about all the flows changed in this backlog.

**Test plan:** review-only.

**Do not change:**
- The factual sections that are already correct (Docker/deploy instructions verified to work).

---

## P3 - Optional future enhancements

### [ ] P3-1: Letterboxd watchlist as a per-group source type

**Problem:**
Only review feeds (`/rss/`) are ingested; many users want their Letterboxd **watchlist** auto-added regardless of ratings.

**User impact:**
Covers the most-requested *arr companion workflow (watchlist → Radarr).

**Goal:**
A group (or reviewer) can be configured to ingest `letterboxd.com/<user>/watchlist/` entries as rating-less candidates that bypass the rating threshold but still honor filters, blocklist, and approval.

**Files/components to inspect:**
- `web/app/lib/letterboxd.ts` (fetch/parse — watchlist pages are HTML, not RSS; investigate `https://letterboxd.com/<user>/rss/` variants and scraping constraints first)
- `web/app/lib/db/schema.ts` (source-type flag on users or groups), `web/app/lib/sync.ts`, `SyncConfigurationPanel.tsx`

**Implementation instructions:**
1. Spike first: confirm a stable public data source for watchlists (RSS availability has changed over time); if only HTML, implement a paginated scraper with conservative caching and a clear user-agent, mirroring the RSS cache pattern.
2. Model: add `sourceType: "reviews" | "watchlist"` per group membership or per reviewer entry; watchlist candidates get `rating: null` and skip threshold checks.
3. Reuse blocklist/filters/approval/idempotency unchanged.

**Edge cases:**
- Rating-less candidates must not poison average-rating displays (exclude from averages).
- Letterboxd rate limiting / markup changes — degrade gracefully like RSS stale-cache.

**Acceptance criteria:**
- A watchlist-enabled group adds watchlisted films (subject to filters/blocklist/approval) and records normal sync results.

**Test plan:**
- Parser unit tests from saved HTML/RSS fixtures; sync integration test with rating-less candidates.

**Do not change:**
- Review-feed ingestion behavior.

---

### [ ] P3-2: Per-group Radarr targets (quality profile, root folder, tag)

**Problem:**
Quality profile / root folder / monitored are global (`radarr_targets` singleton). Households want e.g. kids' group → different root folder, and a `letterboxdarr` tag on adds for traceability.

**User impact:**
Multi-user households can route content; tags make app-added movies auditable in Radarr.

**Goal:**
Optional per-group overrides for qualityProfileId, rootFolderPath, and a Radarr tag applied on add; global settings remain the default.

**Files/components to inspect:**
- `web/app/lib/db/schema.ts` (`reviewer_groups` new nullable columns), `db/index.ts`
- `web/app/lib/sync.ts` (pass group overrides into `addMovie`), `web/app/lib/radarr.ts` (`addMovie` payload: `tags`, tag creation via `/api/v3/tag`)
- `SyncConfigurationPanel.tsx` (collapsible "Radarr overrides" section per group, reusing options from `/api/radarr/options`)

**Implementation instructions:**
1. Add nullable `quality_profile_id`, `root_folder_path`, `radarr_tag` columns to `reviewer_groups` (+ `ensureColumn`).
2. In `syncCachedGroup`, build the effective target: group override ?? global. Manual adds (`/api/radarr`) keep using global.
3. Tag support: resolve-or-create the tag id once per run via Radarr's tag API; include `tags: [id]` in the add payload.
4. UI: per-group collapsible section, default collapsed showing "Using global settings".

**Edge cases:**
- Overridden profile/folder deleted in Radarr later → add fails with Radarr's error; surface in activity (existing error path).
- A film qualifying in two groups with different targets: first add wins (idempotency); document.

**Acceptance criteria:**
- A group with overrides adds movies to the overridden folder/profile with the tag; groups without overrides behave exactly as today.

**Test plan:**
- Sync test asserting payload contents per group; tag resolve-or-create unit test.

**Do not change:**
- Global settings semantics; manual add path defaults.

---

### [ ] P3-3: Notifications webhook (failures + pending approvals digest)

**Problem:**
Failures and pending approvals are only visible in-app; the scheduler runs headless.

**User impact:**
Users learn about failed adds or waiting approvals days later.

**Goal:**
An optional webhook URL (generic JSON + Discord-compatible) that fires on sync failures and when new pending approvals are created.

**Files/components to inspect:**
- New `web/app/lib/notify.ts`; call sites in `web/app/lib/sync.ts` (after run summary) and `pendingApprovals.ts` (on create)
- Settings storage: new nullable column on `radarr_targets` or a new `app_settings` key; `ControlPanelForm.tsx` field
- `README.md`

**Implementation instructions:**
1. Store `webhook_url` (nullable) in settings; expose in the settings form with a "Send test" button (new route).
2. `notify(event)` with a 5s timeout, fire-and-forget (never block or fail a sync), simple payload `{event, title, body, items[]}`; detect `discord.com/api/webhooks` and wrap in `{content}` format.
3. Emit: per scheduled run with `failed > 0` or `pending > 0` (one digest message, not per-movie).

**Edge cases:**
- Webhook endpoint down — log once per run, never retry-loop.
- Don't notify for manual (`auto: false`) runs by default.

**Acceptance criteria:**
- With a webhook configured, a scheduled run producing failures/pendings posts one message; sync outcome unaffected by webhook failures.

**Test plan:**
- Unit test for payload formatting + non-blocking failure; mocked end-to-end scheduler test.

**Do not change:**
- Sync result recording; scheduler timing.

---

### [ ] P3-4: "In Radarr" detection for movies not added by this app

**Problem:**
The grid only knows about movies this app added. A movie already in the user's Radarr library shows as addable; "adding" it returns `exists` only at click time.

**User impact:**
Misleading grid state for users with existing libraries; needless clicks.

**Goal:**
During reconcile (P1-1) or on demand, cross-check all *cached* films against the Radarr library and badge matches as "In Radarr" (status `exists`) without adding.

**Files/components to inspect:**
- `web/app/lib/reconcile.ts` (extend), `web/app/lib/radarr.ts` (`listRadarrMovies`)
- Status recording (`syncResults.ts` / film-state) — record `exists` for matched films with message "Found in Radarr library (not added by this app)"

**Implementation instructions:**
1. Extend reconcile: index the Radarr library by tmdbId; for every cached film with a tmdbId and no current synced status, record `exists`.
2. Candidate selection already skips `exists` — net effect: no add attempts for library movies.
3. Show the normal green/added ring; consider a distinct tooltip ("already in your Radarr library").

**Edge cases:**
- Films without tmdbId: skip (title-matching against the whole library is too false-positive-prone).
- Library movie later deleted in Radarr → P1-1's missing detection flips it back.

**Acceptance criteria:**
- After reconcile, films already in Radarr show as synced/exists and are skipped by syncs.

**Test plan:**
- Reconcile unit test extension with library fixtures.

**Do not change:**
- Add flow; blocklist.

---

### [ ] P3-5: Activity log pagination and per-film history

**Problem:**
Activity is capped at the latest 100 rows (`getRecentSyncResults(undefined, 100)`) with no way to page back; the movie detail modal shows no sync history for that film.

**User impact:**
History disappears on busy instances; debugging "why wasn't this added" requires DB access.

**Goal:**
Cursor-paginated activity (`before` id param + "Load more" button) and a compact per-film history section in the movie detail modal.

**Files/components to inspect:**
- `web/app/lib/repos/syncResults.ts` (`getRecentSyncResults` — add cursor param; add `getSyncResultsForFilmId` using the P0-4 `film_id` index)
- `web/app/api/sync/route.ts` (GET — accept `before`/`limit`)
- Activity panel + movie detail modal components

**Implementation instructions:**
1. Add `before?: number` (sync result id) and `limit` to the GET endpoint and repo query (`WHERE id < ? ORDER BY id DESC LIMIT ?`).
2. Activity panel: "Load more" appends older entries.
3. Movie detail modal: fetch + render the film's last ~10 events (status badge, message, relative time) under the reviews section.

**Edge cases:**
- Mixed client-generated entries (from `logActivity`) and paged server entries — dedupe by id where possible.

**Acceptance criteria:**
- Activity can page back beyond 100 entries; the detail modal shows that film's sync events.

**Test plan:**
- Repo pagination test; component test for Load more.

**Do not change:**
- Default page size; existing entry rendering.

---

## Suggested Implementation Sequence

1. **P0-1 Fix the failing sync test** — nothing is safe to change while the suite is red. *No dependencies.*
2. **P0-2 Repo hygiene and CI guardrails** — get tests running in CI before behavioral changes start landing; fixes compose placeholders so no new install ingests a stranger's feed. *Depends on P0-1 (CI must be green).*
3. **P0-7 Split refresh (GET) from sync (POST)** — small, isolated contract fix; do it before touching sync internals so later tests assert the right contract. Coordinate with the test fixed in P0-1. *Depends on P0-1.*
4. **P1-8 Decompose `page.tsx` (move-only)** — do the mechanical split while behavior is frozen so every later UI task is a small diff. *Depends on P0-1/P0-2 for safety nets; must precede P1-3, P1-7, and all P2 UI tasks.*
5. **P0-4 Film-level sync-state ledger** — the keystone schema change (`film_id` on `sync_results`, unified status resolution, indexed lookups). *No UI dependencies; coordinate status semantics with P0-7's contract.*
6. **P0-6 Safe "Clear activity"** — directly builds on the ledger's latest-row-per-film semantics. *Depends on P0-4.*
7. **P0-5 Permanent rejects** — approval lifecycle correctness; backend portion only (UI lands with P1-3). *Depends on P0-4 (status resolution).*
8. **P1-2 Blocklist matcher fix** — small, isolated; consumes identifiers recorded by removal paths touched in P0-4. *Depends on P0-4 landing to avoid merge conflicts in the same files.*
9. **P0-3 Default "All reviewers" group + setup wiring** — now that sync state is trustworthy, make fresh installs actually sync. *Depends on P0-4 (so first-run adds record correct state); pairs with P1-9 and P1-4 below since all touch `reviewerGroups`/`sync.ts`.*
10. **P1-9 Reviewer-scope group-average semantics** — small `sync.ts` change in the same area. *Depends on P0-3 wave.*
11. **P1-4 Harden partial group updates** — same files (`reviewer-groups` route/repo). *Depends on P0-3 wave.*
12. **P1-5 Scheduler visibility (`last_synced_at`, merged scheduler)** — needs final group semantics from steps 9–11. *Depends on P0-3, P1-9.*
13. **P0-8 Stop group scope clobbering display filters** + **P1-7 Honest fetch/error states** + **P2-1 Activity retry key fix** — the client-state correctness batch; cheap after the decomposition. *Depend on P1-8.*
14. **P1-3 First-class approvals panel** — builds on P0-5 semantics and P1-8 components. *Depends on P0-5, P1-8.*
15. **P1-6 Env-override visibility** — settings/reviewers UI + small API changes. *Depends on P1-8 (form components).*
16. **P1-10 Tighten Radarr lookup matching** — isolated `radarr.ts` change; safe anytime after CI exists, scheduled here to benefit from P2-11 test patterns. *No hard dependencies.*
17. **P1-1 Radarr reconciliation** — last of the majors; uses the ledger (P0-4) and the Synced panel component (P1-8). *Depends on P0-4, P1-8.*
18. **P2 polish wave** — P2-2 placeholders, P2-3 form controls, P2-4 focus management, P2-5 accessibility, P2-6 mobile, P2-7 empty states, P2-8 setup skip, P2-9 auth hardening, P2-10 hygiene. Batch into 2–3 small PRs. *Depend on P1-8; P2-7 partially depends on P1-3.*
19. **P2-11 Test coverage sweep** then **P2-12 docs reconciliation** — lock everything in and make the docs true. *After the waves they describe.*
20. **P3 enhancements** (P3-1 watchlist, P3-2 per-group targets, P3-3 notifications, P3-4 library detection, P3-5 pagination/history) — optional; each depends on the stable ledger (P0-4) and, for P3-4, on P1-1.

---

## Agent Prompt Queue

Ready-to-copy prompts for future coding agents. Work top-to-bottom unless the sequence above says otherwise.

```text
Task: P0-1 Fix the failing sync test and pin the refresh-add contract

Read and follow AGENTS.md.

Context:
`cd web && npm test` fails on dev: sync.test.ts "runs freshly pulled reviews through sync groups from the reviews refresh endpoint" expects 1 Radarr add but gets 2. The test's group filters only year=2026 and the RSS fixture has two 2026 films, so two adds match current behavior. Determine whether the expectation is stale (likely, after commit a5869b3) or a real double-add regression exists.

Files to inspect:
web/app/lib/sync.test.ts (failing test ~line 280; passing sibling ~line 107 which excludes Documentary), web/app/lib/sync.ts (syncCachedGroup, syncRefreshedScope), git log -p a5869b3

Implement:
1) Reproduce the failure. 2) Inspect a5869b3 to rule out a production regression. 3) If behavior is correct, make the test deterministic: add genres.exclude=["Documentary"] to the test group so exactly one film qualifies, and assert the added film's title; or assert 2 adds with both titles. 4) Add one new test covering two qualifying films in one group. If you find a genuine duplicate POST for a single filmId, fix sync.ts instead and keep the test.

Acceptance criteria:
cd web && npm test passes 39+/39; cd web && npm run typecheck passes; the test asserts which films were added.

Test plan:
The fixed test plus the new two-qualifying-films case.

Do not change:
Production sync behavior unless a real single-film double-add is proven; other tests.
```

```text
Task: P0-2 Repo hygiene and CI guardrails

Read and follow AGENTS.md.

Context:
web/.smoke-data2/ contains git-tracked SQLite databases; CI (.github/workflows/publish-container.yml) only builds a container with no tests; docker-compose.yml has an invalid volume `${CHANGE_ME}:/data` and ships REVIEWER: "moremoviesmike" (a real third-party Letterboxd account) so default installs ingest a stranger's feed.

Files to inspect:
web/.smoke-data2/, web/.gitignore, .github/workflows/publish-container.yml, docker-compose.yml, web/app/lib/config.ts (isPlaceholderValue), README.md

Implement:
1) git rm -r web/.smoke-data2 and add `.smoke-data*` to web/.gitignore. 2) Add a CI job running on PRs and pushes to dev/main: cd web && npm ci && npm run typecheck && npm test; make the container build depend on it via needs:. 3) Change REVIEWER to "CHANGE_ME" (the placeholder filter already ignores it). 4) Replace the volume with the named volume documented in README (letterboxd-radarr-data:/data plus a top-level volumes: block). 5) Verify with docker compose config.

Acceptance criteria:
No tracked files under web/.smoke-data2; docker compose config succeeds with no env set; CI fails when a test fails.

Test plan:
docker compose config; CI run on the PR itself.

Do not change:
Image publish triggers/tags, the Dockerfile, placeholder filtering in config.ts.
```

```text
Task: P0-3 Create, protect, and wire the default "All reviewers" group

Read and follow AGENTS.md.

Context:
README/AGENTS/setup UI describe a default "All reviewers" group, but no code creates it, guards its deletion, or auto-populates membership. The setup wizard threshold only writes the deprecated radarr_targets.auto_threshold, which group sync never reads. Fresh installs therefore never auto-sync. Prereq: P0-4 ledger should already be merged (see TODO.md sequence).

Files to inspect:
web/app/lib/db/index.ts (init(), singleton seeding pattern), web/app/lib/repos/reviewerGroups.ts (deleteReviewerGroup), web/app/lib/repos/users.ts (getOrCreateUser), web/app/api/reviewer-groups/route.ts (DELETE), web/app/page.tsx (completeSetup), web/app/components/ControlPanelForm.tsx, web/app/lib/setup.ts, web/app/api/setup/complete/route.ts, web/app/lib/db/migrateLegacy.ts

Implement:
1) Track default_group_id in app_state (new column via ensureColumn + schema). 2) Seed an "All reviewers" group on init when none is tracked; if a group with that exact name exists, adopt it instead of inserting. 3) Auto-membership: insert into reviewer_group_members in getOrCreateUser (onConflictDoNothing); run an idempotent backfill for existing users at the end of init(). 4) Throw from deleteReviewerGroup for the default group (route surfaces 400); keep disabling allowed. 5) Apply the setup wizard threshold to the default group in /api/setup/complete (keep writing radarr_targets.auto_threshold for DTO compatibility). 6) Update README/AGENTS wording if semantics shift.

Acceptance criteria:
Fresh DB -> setup -> sync scope "all" adds qualifying movies with no manual group config; new reviewers auto-join the default group; deleting the default group returns 400; upgraded DBs with an existing "All reviewers" group get no duplicate.

Test plan:
Repo tests: seeding, auto-membership, delete guard, adopt-existing-group; sync integration test from a fresh DB; legacy-migration backfill test.

Do not change:
Deprecated autoThreshold DTO fields (keep populated); custom group behavior.
```

```text
Task: P0-4 Film-level sync-state ledger

Read and follow AGENTS.md.

Context:
Sync state is per-review in sync_results; removal records against one review, and aggregation takes the max statusRank across reviews, so removed multi-reviewer films stay "synced" forever. Also: getLatestSyncResultForFilmId and getReviewByFilmId do full-table JS scans, and two different status pipelines exist (reviews.ts latestStatusByReview vs aggregatedReviews.ts syncStatusByReview+statusRank).

Files to inspect:
web/app/lib/db/schema.ts (syncResults), web/app/lib/db/index.ts (DDL/ensureColumn), web/app/lib/repos/syncResults.ts, web/app/lib/repos/aggregatedReviews.ts, web/app/lib/repos/reviews.ts, web/app/api/movies/[id]/remove/route.ts, web/app/api/radarr/route.ts, web/app/lib/filmIdentity.ts, web/app/lib/sync.ts (candidate filter)

Implement:
1) Add nullable film_id TEXT to sync_results (schema + ensureColumn) with an index on (film_id, created_at). 2) Idempotent startup backfill: join reviews, compute canonicalFilmGuid(review), update NULL rows. 3) recordSyncResult derives and writes film_id on every insert. 4) Single status resolver in syncResults.ts: latestFilmStatuses(filmIds) — latest row per film wins; added/exists not overridden by later error/skipped, but overridden by removed/blocklisted/failed_remove. Use it from aggregatedReviews.ts and reviews.ts; delete statusRank/max-rank and the duplicate pipeline. 5) Rewrite getLatestSyncResultForFilmId as an indexed query. 6) Ensure mergeExistingDuplicates keeps film_id consistent when reviews merge.

Acceptance criteria:
Two-reviewer film added then removed+blocklisted disappears from /api/radarr/synced and is skipped by the next sync; removal without blocklist leaves it re-addable; no full-table JS scans in getLatestSyncResultForFilmId; npm test passes.

Test plan:
New syncResults tests (status transitions incl. multi-review), two-reviewer removal integration test in sync.test.ts, backfill test with legacy rows.

Do not change:
SyncMovieStatus union values; existing sync_results rows (additive migration only); the activity-log read API shape.
```

```text
Task: P0-5 Make pending-approval rejection permanent

Read and follow AGENTS.md.

Context:
createPendingApproval dedupes only against status='pending' rows, so a rejected film is re-queued by the very next sync. Reject should stick per group, with a rating-increase re-open rule and an optional blocklist escalation.

Files to inspect:
web/app/lib/repos/pendingApprovals.ts, web/app/lib/sync.ts (approval-creation loop), web/app/api/pending-approvals/[id]/reject/route.ts, web/app/api/blocklist/route.ts, approvals UI in web/app/page.tsx

Implement:
1) In createPendingApproval, return null when a rejected row exists for groupId+filmId UNLESS the new averageRating (rounded to 0.1) is strictly higher than the rejected row's recorded rating. 2) Add a reset path (DELETE /api/pending-approvals/[id] or equivalent) to clear a rejection. 3) Add a "Reject + blocklist" UI action calling POST /api/blocklist after rejecting. 4) Comment the re-open rule clearly.

Acceptance criteria:
Sync -> reject -> sync produces pending=0 for that film/group; a higher average rating re-opens it; reject+blocklist causes future syncs to record skipped:blocklisted.

Test plan:
Repo tests for dedupe/re-open; sync integration test for the full cycle.

Do not change:
The approve route and its blocklist pre-check; pending_approvals schema beyond what exists.
```

```text
Task: P0-6 Make "Clear activity" safe

Read and follow AGENTS.md.

Context:
DELETE /api/sync wipes sync_results, which is also the idempotency ledger and the only store of radarrMovieId. Clearing the visible log currently causes mass re-add candidates and breaks "Remove from Radarr". Prereq: P0-4 (film_id column) is merged.

Files to inspect:
web/app/lib/repos/syncResults.ts (clearAllSyncResults, clearSyncResultsForUser, getRecentSyncResults, getLatestSyncResultForFilmId), web/app/api/sync/route.ts (DELETE), web/app/page.tsx (clearActivity)

Implement:
1) Change clear functions to preserve the latest row per film_id (delete everything else) inside a transaction. 2) Add a confirmation dialog before clearing, styled like the remove-movie dialog, stating that already-synced movies will not be re-added. 3) Optionally expose the existing force flag of POST /api/sync as an explicit "Force re-sync" control for users who cleared history to force re-adds.

Acceptance criteria:
Add movie -> clear -> sync: zero Radarr POSTs for that film; add -> clear -> remove-from-Radarr still resolves radarrMovieId and succeeds; activity display clears (except preserved state rows or via display filtering — choose one and document).

Test plan:
Repo test: clear preserves latest-per-film and getLatestSyncResultForFilmId still works; integration test: add -> clear -> sync -> no add calls.

Do not change:
recordSyncResult call sites; SyncResultItem shape.
```

```text
Task: P0-7 Split refresh (GET /api/reviews) from sync (POST /api/sync)

Read and follow AGENTS.md.

Context:
GET /api/reviews?refresh=1 currently calls syncRefreshedScope(..., {auto:true}) which adds movies to Radarr; the dashboard triggers it on first load and on every scope change, so opening the app can cause Radarr adds. README documents this endpoint as having no Radarr side effects.

Files to inspect:
web/app/api/reviews/route.ts, web/app/lib/sync.ts (refreshScopeReviews, syncRefreshedScope, cachedSyncRunsForRefreshedScope), web/app/page.tsx (loadReviews, auto-fetch effect, scope onChange, syncFeed), web/app/lib/sync.test.ts, README.md

Implement:
1) In reviews/route.ts, call only refreshScopeReviews(scope); keep the stale-cache fallback exactly as-is. 2) Remove syncRefreshedScope/cachedSyncRunsForRefreshedScope if unreferenced (grep first). 3) Update the affected test to assert zero Radarr POSTs on refresh and keep/add a test that POST /api/sync performs adds. 4) Verify the dashboard still routes manual syncs through POST /api/sync (nav button + "Sync Now").

Acceptance criteria:
Cold dashboard load and scope changes perform RSS fetches but zero POST /api/v3/movie calls; POST /api/sync and the scheduler still add; metadata enrichment for genre-filter groups still happens on refresh.

Test plan:
Route test with mocked fetch for both endpoints; manual check that the Sync button adds a qualifying movie.

Do not change:
Stale-cache fallback ({reviews, stale:true}); POST /api/sync; scheduler behavior.
```

```text
Task: P0-8 Stop group scope from overwriting saved display filters

Read and follow AGENTS.md.

Context:
A useEffect in web/app/page.tsx ("Mirror display filters from active sync group") overwrites minimumRating/selectedGenres when a group scope is active and resets them to 0/[] when leaving; the localStorage persistence effect then saves the clobbered values, permanently destroying user preferences. filteredMovies already applies group rules directly, so the mirror is redundant.

Files to inspect:
web/app/page.tsx: the mirror effect, the localStorage persistence effect, filteredMovies memo, the stat-card caption using activeReviewerGroup

Implement:
1) Delete the mirror effect. 2) Verify filteredMovies behaves identically in group scope (it branches on activeReviewerGroup). 3) Verify the "(group filters)" caption still keys off activeReviewerGroup. 4) Grep page.tsx for any other reader expecting mirrored values.

Acceptance criteria:
Set min rating 4.5 + a genre filter -> enter a group scope -> return to "All enabled groups": both filters intact and still persisted in localStorage; group scope still filters by group rules.

Test plan:
Manual per acceptance criteria (or a hook unit test if useLocalDisplayFilters exists already from P1-8).

Do not change:
filteredMovies group logic; localStorage key names; hiding of rating/genre controls in group scope.
```

```text
Task: P1-1 Radarr reconciliation job

Read and follow AGENTS.md.

Context:
added/exists statuses are sticky forever; movies deleted inside Radarr still show as synced. Add a reconcile action comparing recorded synced films to Radarr's actual library. Prereqs: P0-4 ledger; P1-8 decomposition (Synced panel component).

Files to inspect:
web/app/lib/radarr.ts (add listRadarrMovies for GET /api/v3/movie), new web/app/lib/reconcile.ts, web/app/lib/repos/syncResults.ts, web/app/types/movie.ts (SyncMovieStatus), web/app/lib/sync.ts (candidate filter), web/app/api/radarr/synced/route.ts, the Synced panel component

Implement:
1) listRadarrMovies(target): one bulk GET, 10s timeout, returns {id,tmdbId,imdbId}. 2) reconcileSyncedMovies(): for films currently synced (added/exists/failed_remove), match by radarrMovieId then tmdbId; for misses record new status "missing_in_radarr" (extend SyncMovieStatus + isSyncMovieStatus); never blocklist. 3) Treat missing_in_radarr like removed in the sync candidate filter (re-addable). 4) Add POST /api/radarr/reconcile (auth-guarded) returning {checked, missing}. 5) Add a "Verify against Radarr" button in the Synced panel with a result banner.

Acceptance criteria:
Delete a synced movie in Radarr -> Verify -> it leaves the Synced list and is re-addable; running reconcile twice records nothing the second time; Radarr unreachable returns 502 and records nothing.

Test plan:
Unit tests for reconcile (present/missing/unreachable); status-union handling tests.

Do not change:
Blocklist behavior; addMovie.
```

```text
Task: P1-2 Close the blocklist identifier-matching hole

Read and follow AGENTS.md.

Context:
isMovieBlocklisted only checks filmId/title+year when the candidate has NO tmdbId/imdbId, so a candidate with a tmdbId never matches a blocklist row stored without one. The /api/radarr DELETE path also stores only review.tmdbMovieId (often null) instead of falling back to latestSync.radarrTmdbId.

Files to inspect:
web/app/lib/repos/movieBlocklist.ts (isMovieBlocklisted, addToBlocklist), web/app/api/radarr/route.ts (DELETE), web/app/api/movies/[id]/remove/route.ts (reference implementation)

Implement:
1) Remove the !input.tmdbId && !imdbId gates: always check tmdbId, then imdbId, then filmId, then normalized title+year; return true on first hit. 2) In /api/radarr DELETE, store tmdbId as review.tmdbMovieId ?? latestSync?.radarrTmdbId ?? null. 3) Comment that title+year is lowest priority due to remake risk.

Acceptance criteria:
A film blocklisted without a tmdbId is skipped when a later sync candidate carries a tmdbId; all identifier-combination permutations block correctly.

Test plan:
New movieBlocklist.test.ts matrix (row identifier type x candidate identifier type); sync integration test with mismatched identifier sets.

Do not change:
Blocklist schema; unblock endpoints; ID-over-title priority.
```

```text
Task: P1-3 First-class approvals queue panel

Read and follow AGENTS.md.

Context:
Pending approvals are buried inside the Settings modal behind a gear icon whose badge doubles as the setup-needed indicator; errors route to a distant settingsError. Build a dedicated slide-over like the Activity/Synced panels. Prereqs: P0-5 reject semantics; P1-8 decomposition.

Files to inspect:
web/app/page.tsx (nav icons, pendingApprovalCount, resolvePendingApproval, existing approvals JSX), web/app/lib/repos/pendingApprovals.ts (listPendingApprovals(includeResolved)), web/app/api/pending-approvals/route.ts, web/app/components/ (panel patterns)

Implement:
1) New ApprovalsPanel.tsx modeled on the Synced slide-over: header, search, rows (title, year, group, avg rating, relative time). 2) New nav icon with the pending-count badge; remove the count badge from the gear (keep its setup pulse-dot). 3) Row actions Approve / Reject / Reject+blocklist with per-row busy and inline error states. 4) Support ?includeResolved=1 on GET /api/pending-approvals and render resolved items greyed below pending. 5) Optionally join posterUrl server-side via reviews. 6) Leave a "Pending approvals (N) -> open queue" link where the settings section was.

Acceptance criteria:
Pending count always visible in nav; approve/reject works without opening Settings; resolved items visible with outcome messages; approving a blocklisted film shows the 409 inline.

Test plan:
ApprovalsPanel component test (render, approve/reject callbacks, error state); route test for includeResolved.

Do not change:
Approve/reject API contracts; pending_approvals schema.
```

```text
Task: P1-4 Harden partial reviewer-group updates

Read and follow AGENTS.md.

Context:
parseGroupBody substitutes defaults (interval "1d", approval false, threshold 4, members []) for omitted fields, so any partial PUT silently resets group config; unknown reviewer handles are silently dropped by reviewerIdsFromHandles.

Files to inspect:
web/app/api/reviewer-groups/route.ts (parseGroupBody), web/app/lib/repos/reviewerGroups.ts (upsertReviewerGroup, reviewerIdsFromHandles), web/app/components/SyncConfigurationPanel.tsx (dropReviewerOnGroup), web/app/lib/repos/reviewerGroups.test.ts

Implement:
1) parseGroupBody returns undefined for omitted ratingThreshold/syncInterval/requiresManualApproval/reviewerHandles (and name on updates). 2) upsertReviewerGroup falls back to the existing row for undefined fields on update; skip membership delete/insert entirely when reviewerHandles is undefined; keep current defaults for creates. 3) reviewerIdsFromHandles throws "Unknown reviewer handle(s): ..." for unresolvable handles; route maps to 400. 4) Keep legacy autoThreshold body field working.

Acceptance criteria:
PUT {id, reviewerHandles} changes only membership; PUT {id, requiresManualApproval:true} changes only that flag; unknown handle -> 400 naming it; existing UI save/drag/chip flows unchanged.

Test plan:
Extend reviewerGroups.test.ts with per-field preservation, unknown-handle rejection, and legacy autoThreshold cases.

Do not change:
POST create defaults; SyncFilterValidationError handling; DTO shapes.
```

```text
Task: P1-5 Coherent visible scheduling with last-synced timestamps

Read and follow AGENTS.md.

Context:
scheduler.ts has two near-duplicate run functions; when SYNC_CRON is set, per-group intervals are silently ignored; nothing records or shows when a group last synced.

Files to inspect:
web/app/lib/scheduler.ts, web/app/lib/db/schema.ts + web/app/lib/db/index.ts (ensureColumn), web/app/lib/repos/reviewerGroups.ts (toReviewerGroupDto), web/app/lib/sync.ts (executeGroupSync), web/app/components/SyncConfigurationPanel.tsx, web/app/types/movie.ts, README.md

Implement:
1) Merge runScheduledSync/runScheduledInterval into one function with an optional interval filter. 2) Add last_synced_at TEXT to reviewer_groups (schema + ensureColumn); stamp in executeGroupSync after any successful run (manual or scheduled). 3) Expose lastSyncedAt on ReviewerGroupDto; render "Last synced Xh ago" / "Never synced" per group card (extract/reuse a shared relative-time helper). 4) When SYNC_CRON is set, log the override and surface a small note in the sync-config UI. 5) Document both scheduling modes in README.

Acceptance criteria:
Group cards show last-synced time updating after manual sync; SYNC_CRON override is indicated; one scheduler run function; both env modes behave as before otherwise.

Test plan:
Repo test for the timestamp stamp; scheduler unit tests for interval filtering and override mode.

Do not change:
Interval cron expressions; off/AUTO_SYNC disable handling; single-flight sync.
```

```text
Task: P1-6 Make environment overrides visible in settings and reviewers

Read and follow AGENTS.md.

Context:
RADARR/API_KEY env vars silently override stored settings while the form remains editable; the env REVIEWER is re-created on every GET /api/reviewers so deleting it appears broken.

Files to inspect:
web/app/lib/repos/settings.ts (getRadarrTarget, toPublicSettings), web/app/types/movie.ts (PublicSettings, ReviewerDto), web/app/components/ControlPanelForm.tsx, web/app/api/reviewers/route.ts, web/app/components/SyncConfigurationPanel.tsx, web/app/lib/config.ts

Implement:
1) Add radarrUrlFromEnv/radarrApiKeyFromEnv booleans to PublicSettings. 2) Render env-controlled fields disabled with a "Set by RADARR/API_KEY environment variable" helper. 3) Add fromEnv to reviewer DTOs (handle equals getConfiguredReviewer() lowercased); show a lock on that chip and hide/explain its remove control. 4) DELETE /api/reviewers for the env handle returns 400 with an explanatory message. 5) Ensure canCompleteSetup treats env-provided URL/key as satisfying requirements.

Acceptance criteria:
With RADARR set: URL field read-only with explanation; env reviewer chip locked; deleting it returns a clear 400; with env removed, everything behaves normally; CHANGE_ME placeholders never count as env-configured.

Test plan:
Settings DTO test with stubbed env; reviewers route DELETE tests (env vs normal handle).

Do not change:
Env-over-stored precedence; placeholder filtering.
```

```text
Task: P1-7 Honest fetch/error states in the dashboard

Read and follow AGENTS.md.

Context:
The UI ignores the stale:true flag from /api/reviews (silent stale data); removeSyncedMovie uses native alert(); loadReviews rebuilds sendStates wholesale, wiping in-flight "loading" states; several loaders swallow errors with bare catch{}. Prereq: P1-8 decomposition recommended.

Files to inspect:
web/app/page.tsx (or extracted hooks/components): loadReviews, removeSyncedMovie, sendToRadarr, sendStates handling, AlertBanner

Implement:
1) Track isStaleData from body.stale; render an info AlertBanner "Letterboxd is unreachable — showing cached reviews." cleared on the next successful fresh load. 2) Replace alert() calls with an inline error rendered inside the remove-confirmation dialog (keep dialog open on failure). 3) In loadReviews, merge statuses: apply server states, then re-apply any keys currently "loading". 4) For silent loaders, set a shared degraded flag with a small retry banner (or at minimum console.warn).

Acceptance criteria:
Blocking Letterboxd network after a prior sync shows the stale banner with cached movies; no alert() calls remain in the repo; a movie's spinner survives a concurrent reviews reload.

Test plan:
Hook-level tests for merge + stale flag if hooks exist; otherwise manual via devtools network blocking.

Do not change:
The API stale-cache contract; AlertBanner API.
```

```text
Task: P1-8 Decompose page.tsx into components and hooks (move-only)

Read and follow AGENTS.md.

Context:
web/app/page.tsx is 3,349 lines containing icons, auth screens, dashboard, four modals, and all fetch logic. Split it mechanically with ZERO behavior change. This unblocks most UI tasks in TODO.md.

Files to inspect:
web/app/page.tsx, web/app/components/* (existing patterns)

Implement:
Extract in order, typechecking and testing after each step: 1) components/icons.tsx (all inline SVG components; dedupe copies in SyncConfigurationPanel.tsx/ControlPanelForm.tsx). 2) lib/format.ts (formatRelativeTime, sortMoviesByRating, movieGenres, search matchers, statusToSendState, syncResultToActivity). 3) components/AuthGate.tsx (password-setup + login screens). 4) components/MovieGrid.tsx + PosterCard.tsx (incl. PosterRadarrAction, posterRingClass). 5) components/MovieDetailModal.tsx, ActivityPanel.tsx, SyncedPanel.tsx, RemoveMovieDialog.tsx, SettingsModal.tsx; shared ModalHeader/AlertBanner/StatCard into components/ui.tsx. 6) hooks/useAuthBoot.ts, hooks/useDashboardData.ts, hooks/useLocalDisplayFilters.ts. 7) Replace the duplicated inline search predicate in filteredMovies with the shared movieMatchesSearch; delete unused useMediaQuery/isDesktop after grep confirms zero usages. Keep "use client" on every extracted file; preserve ESC-close ordering and the settings auto-test behavior exactly.

Acceptance criteria:
page.tsx under ~400 lines; npm run typecheck, npm test, and npm run build pass; no behavior or visual change; no duplicate icon definitions remain.

Test plan:
Add render smoke tests for extracted panels (jsdom, following SyncConfigurationPanel.test.tsx); full manual pass: login -> setup -> dashboard -> every modal -> every action.

Do not change:
Any behavior, styling, copy, or API calls. Pure moves only.
```

```text
Task: P1-9 Align reviewer-scope sync with group-average semantics

Read and follow AGENTS.md.

Context:
syncRunsForScope for {type:"reviewer"} aggregates with reviewer scope, so threshold checks use one reviewer's ratings while group/scheduler runs use group averages — the same film can qualify in one path and not the other.

Files to inspect:
web/app/lib/sync.ts (syncRunsForScope reviewer branch; compare cachedSyncRunsForRefreshedScope if still present), web/app/lib/sync.test.ts

Implement:
1) In the reviewer branch, keep handles=[handle] (refresh only that feed) but set aggregationScope={type:"group", groupId: group.id} for each covering enabled group. 2) Comment why handles and aggregationScope intentionally differ.

Acceptance criteria:
Group with reviewers A(5.0) and B(2.0) on one film, threshold 4.0: syncing reviewer A does NOT add (group average 3.5); when both rate >=4, reviewer-scope sync adds it.

Test plan:
Two new sync tests exactly matching the acceptance scenarios.

Do not change:
Group-scope and all-scope behavior; single-flight keying.
```

```text
Task: P1-10 Tighten Radarr lookup matching

Read and follow AGENTS.md.

Context:
pickBestMatch in web/app/lib/radarr.ts falls back to valid[0] when nothing matches by tmdbId/title/year, so ambiguous lookups can add the WRONG movie to Radarr.

Files to inspect:
web/app/lib/radarr.ts (pickBestMatch, addMovie, lookupMovieMetadata), web/app/lib/sync.test.ts (lookup mocks)

Implement:
1) Remove the terminal `?? valid[0]` fallback; return null when no tier matches. 2) Keep tiers: tmdbId exact -> exact title+year -> normalized title+year -> normalized title +/-1 year -> title-only (exact/normalized). 3) Make the year-only tier require a loose normalized-title containment check, or drop it. 4) Improve the not_found message: "No confident match in Radarr lookup for '<title> (<year>)'."

Acceptance criteria:
A lookup returning only unrelated titles yields not_found (recorded as error/skipped) instead of an add; tmdbId-based adds unaffected; existing tests pass.

Test plan:
New unit tests for each pickBestMatch tier and the null case.

Do not change:
Lookup term construction (tmdb: prefix); add payload; retry logic in sync.ts.
```

```text
Task: P2 batch A — small dashboard fixes (P2-1 retry key, P2-2 placeholders, P2-3 form controls)

Read and follow AGENTS.md.

Context:
Three small quality fixes detailed in TODO.md: (P2-1) the activity retry button checks sendStates[String(entry.reviewId)] but sendStates is keyed by film id, so busy state never shows, and retryFromActivity fails silently for out-of-scope films; (P2-2) four search inputs share one inaccurate placeholder; (P2-3) "Hide in Radarr" label is ambiguous, group threshold selects omit 1.0-2.5 and the -1 "Disabled" mode, and group drafts have no dirty indicator.

Files to inspect:
web/app/page.tsx and/or extracted ActivityPanel/SyncedPanel/SettingsModal components, web/app/components/SyncConfigurationPanel.tsx, web/app/lib/repos/reviewerGroups.ts (isValidAutoThreshold, reference)

Implement:
1) Thread filmId from SyncResultItem into ActivityEntry; key retry busy state on it; show an inline "Movie not in the current scope" message when retry can't resolve the film. 2) Set accurate placeholders: activity "Search by title, year, status, or message…", blocklist "Search by title, year, source, or TMDB/IMDb id…", approvals "Search by title, year, or group…". 3) Rename checkbox to "Hide movies already in Radarr"; expand threshold options to 1.0-5.0 half-steps plus "Disabled (no auto-sync)" mapping to -1; add a dirty-state indicator on "Save group" (disabled when clean) and a "Membership changes save immediately" helper line.

Acceptance criteria:
Retry shows Sending… and disables while in flight; placeholders match the matcher functions; -1 threshold selectable, persists, and prevents auto-adds; Save button reflects dirty state.

Test plan:
Extend SyncConfigurationPanel.test.tsx (dirty indicator, -1 option); ActivityPanel component test for busy/out-of-scope states.

Do not change:
Matcher logic; backend threshold validation; instant-save membership behavior.
```

```text
Task: P2 batch B — focus management, accessibility, mobile (P2-4, P2-5, P2-6)

Read and follow AGENTS.md.

Context:
Modals set aria-modal without trapping or restoring focus; dropdowns lack click-away; the rating tooltip is hover-only with no ARIA wiring; functional text at cornsilk/55 and 9-10px fails contrast; poster aria-labels omit sync status; the "All genres" checkbox is semantically a clear-action; on phones the h-[100dvh] overflow-hidden layout leaves a sliver for the grid and hover-only poster actions are unreachable by touch.

Files to inspect:
web/app/page.tsx / extracted modal+grid components, web/app/components/SyncFilterControls.tsx (MultiGenreDropdown), web/app/globals.css (.poster-grid, .content-shell)

Implement:
1) useFocusTrap(ref, active) hook (focus-first, Tab wrap, restore-on-close) applied to all overlays incl. the remove dialog (topmost layer only). 2) useClickAway hook for the dashboard genre dropdown and MultiGenreDropdown. 3) Tooltip -> click-toggleable popover with role and aria-describedby. 4) Contrast sweep: functional text to /70+ opacity and >=11px (decorative text exempt); verify gold/chartreuse accents. 5) Append "— already in Radarr" to poster aria-labels when added. 6) Replace the "All genres" checkbox with a clear-selection control. 7) Below sm: let main scroll naturally (drop fixed-viewport mode), stat cards to a compact 2x2 grid, move rating/genre/hide controls into a Filters disclosure on <lg, and scope hover-reveal behavior with @media (hover: hover) so touch users get always-visible (dimmed) poster actions.

Acceptance criteria:
Tab stays inside open modals and focus returns on close; outside-click closes dropdowns; at 375x667 the header takes <40% height and the grid scrolls naturally; every poster action reachable by tap; desktop (>=1024px) unchanged; spot-checked text passes AA.

Test plan:
jsdom tests for both hooks; manual keyboard pass over every overlay; responsive pass at 320/375/768/1024/1440.

Do not change:
Desktop layout/grid sizing; ESC ordering semantics; brand colors on decorative elements.
```

```text
Task: P2 batch C — guidance states, setup skip, auth hardening, hygiene (P2-7, P2-8, P2-9, P2-10)

Read and follow AGENTS.md.

Context:
Four independent items detailed in TODO.md: zero-enabled-groups is silent while automation is dead and stat cards lack affordances (P2-7); setup hard-requires a reachable Radarr (P2-8); login has no rate limit and password changes don't invalidate sessions (P2-9); TVmaze fetches lack timeouts, log prefixes are inconsistent, and dead code may remain (P2-10).

Files to inspect:
Dashboard/StatCard/Synced panel components, web/app/components/ControlPanelForm.tsx (canCompleteSetup), web/app/lib/setup.ts, web/app/api/auth/login/route.ts, web/app/lib/auth.ts, web/app/lib/repos/appState.ts, web/app/lib/db/schema.ts + db/index.ts, web/app/lib/tvmaze.ts, api routes (error bodies), web/app/page.tsx (dead code)

Implement:
1) P2-7: info banner when enabledSyncGroupCount===0 and movies exist (with "Open sync settings" action, suppressed during initial load); make the Sync-groups stat card clickable with hover affordance on both clickable cards; caption average card "avg of shown movies"; scope-aware Synced empty state; show errored approvals if P1-3 hasn't already. 2) P2-8: "Skip Radarr for now" setup path (reviewer required, Radarr optional; reject half-filled Radarr config); relax validateSetupReady to match; verify post-skip nudges render. 3) P2-9: per-IP sliding-window login rate limit (10/15min -> 429); add session_epoch to app_state (ensureColumn), embed in tokens, bump on password set/change, reject older epochs (missing epoch = 0). 4) P2-10: AbortSignal.timeout(10_000) on TVmaze fetches; standardize {message, code?} error bodies; [subsystem] log prefixes; delete confirmed-dead code.

Acceptance criteria:
Disabling all groups shows the banner; setup completes with reviewer only and no Radarr error spam; 11th rapid bad login -> 429; password change invalidates old cookies; no lib/ fetch without a timeout; build/tests pass.

Test plan:
Component tests for banner conditions; route tests for relaxed setup, rate limit, and epoch invalidation; stalled-mock TVmaze timeout test.

Do not change:
Full-setup validation when Radarr fields are provided; cookie names/flags/max-age; env APP_PASSWORD flow.
```

```text
Task: P2-11 Expand automated test coverage

Read and follow AGENTS.md.

Context:
The suite covers sync filtering, filter normalization, group persistence, one component, and DB init. State-accuracy areas fixed by this backlog need locking in; several risky pure functions are untested. Add whatever the parent tasks didn't already add.

Files to inspect:
web/app/lib/sync.test.ts and siblings (patterns: describeWithSqlite guard, temp DATA_DIR per test, vi.stubGlobal fetch), web/vitest.config.ts

Implement:
Colocated tests: repos/aggregatedReviews.test.ts (multi-reviewer status, averaging, identity grouping); repos/movieBlocklist.test.ts (identifier matrix); repos/pendingApprovals.test.ts (create/dedupe/reject/re-open); repos/syncResults.test.ts (latest-status logic, clear preservation); lib/radarr.test.ts (pickBestMatch tiers, normalizeRadarrUrl, errorMessageFromBody); lib/letterboxd.test.ts (mapItems from fixture XML, entity decoding, dedupe); lib/filmIdentity.test.ts (slug vs title-year fallback); lib/scheduler.test.ts (interval selection, SYNC_CRON override, off); lib/auth.test.ts (token round-trip, expiry, tamper rejection).

Acceptance criteria:
All listed files exist and pass; full suite completes in under ~30s.

Test plan:
The tests are the deliverable; run cd web && npm test.

Do not change:
Vitest config beyond per-file environment needs; production code (test-only task — file bugs found as new TODO items instead).
```

```text
Task: P2-12 Documentation reconciliation sweep

Read and follow AGENTS.md.

Context:
README.md and AGENTS.md described behavior that diverged from code (default group semantics, /api/reviews side effects, SYNC_CRON model) — the root cause of several P0s. After the P0/P1 waves land, sweep both docs against actual behavior.

Files to inspect:
README.md (API overview, env vars, behavior text), AGENTS.md (Core workflows, Known pitfalls), the routes and libs they describe

Implement:
Verify and correct, at minimum: /api/reviews refresh contract (no Radarr side effects after P0-7), default-group creation/protection/auto-membership (P0-3), scheduler modes incl. SYNC_CRON override and last_synced_at (P1-5), reject semantics (P0-5), clear-activity semantics (P0-6), blocklist matching (P1-2), reconcile endpoint if present (P1-1), env-override visibility (P1-6).

Acceptance criteria:
A new agent reading only AGENTS.md + README.md makes correct assumptions about every flow changed by this backlog; no claim in either file contradicts the code.

Test plan:
Review-only; cross-check each documented endpoint against its route handler.

Do not change:
Docker/deploy instructions that are already correct; document reality rather than aspirations.
```

```text
Task: P3-1 Letterboxd watchlist as a per-group source type

Read and follow AGENTS.md.

Context:
Only review feeds are ingested. Add optional watchlist ingestion: rating-less candidates that bypass the rating threshold but honor filters, blocklist, approval, and idempotency. SPIKE FIRST: confirm a stable public watchlist data source (RSS availability has changed; may require paginated HTML scraping with conservative caching).

Files to inspect:
web/app/lib/letterboxd.ts (fetch/cache patterns), web/app/lib/db/schema.ts, web/app/lib/sync.ts, web/app/components/SyncConfigurationPanel.tsx, web/app/lib/repos/aggregatedReviews.ts (exclude rating-less from averages)

Implement:
1) Spike the data source and document findings. 2) Add sourceType ("reviews" | "watchlist") modeling per group or reviewer entry. 3) Watchlist candidates carry rating null, skip threshold checks, and are excluded from average-rating displays. 4) Reuse filters/blocklist/approval/idempotency unchanged. 5) Degrade gracefully (stale-cache pattern) on upstream failure.

Acceptance criteria:
A watchlist-enabled group adds watchlisted films subject to filters/blocklist/approval; averages exclude rating-less entries; review ingestion unchanged.

Test plan:
Parser tests from saved fixtures; sync integration test with rating-less candidates.

Do not change:
Review-feed ingestion behavior.
```

```text
Task: P3-2 Per-group Radarr targets (quality profile, root folder, tag)

Read and follow AGENTS.md.

Context:
Quality profile/root folder are global. Add optional per-group overrides plus a Radarr tag on adds, defaulting to global settings.

Files to inspect:
web/app/lib/db/schema.ts + db/index.ts (nullable columns on reviewer_groups), web/app/lib/sync.ts (effective target per group), web/app/lib/radarr.ts (addMovie payload tags; tag resolve-or-create via /api/v3/tag), web/app/components/SyncConfigurationPanel.tsx, web/app/api/radarr/options/route.ts

Implement:
1) Add nullable quality_profile_id, root_folder_path, radarr_tag to reviewer_groups (+ ensureColumn). 2) syncCachedGroup builds effective target: group override ?? global; manual adds keep global. 3) Resolve-or-create the tag id once per run; include tags:[id] in add payloads when set. 4) Per-group collapsible "Radarr overrides" UI section, collapsed by default showing "Using global settings".

Acceptance criteria:
Overridden groups add to the overridden folder/profile with the tag; non-overridden groups identical to today; deleted-in-Radarr overrides surface Radarr's error in activity.

Test plan:
Sync test asserting per-group add payloads; tag resolve-or-create unit test.

Do not change:
Global settings semantics; manual add defaults.
```

```text
Task: P3-3 Notifications webhook for failures and pending approvals

Read and follow AGENTS.md.

Context:
Failures and pending approvals are only visible in-app. Add an optional webhook (generic JSON, Discord-compatible) fired as one digest per scheduled run with failures or new pendings.

Files to inspect:
new web/app/lib/notify.ts, web/app/lib/sync.ts (post-run), web/app/lib/repos/pendingApprovals.ts, settings storage (radarr_targets column or new key) + web/app/components/ControlPanelForm.tsx, README.md

Implement:
1) Store nullable webhook_url in settings; settings-form field with a "Send test" route. 2) notify(event): 5s timeout, fire-and-forget, payload {event,title,body,items[]}; wrap as {content} for discord.com/api/webhooks URLs. 3) Emit one digest per scheduled (auto) run when failed>0 or pending>0; skip manual runs by default; never let webhook failure affect sync outcome.

Acceptance criteria:
Configured webhook receives one message for a failing/pending scheduled run; sync results unchanged when the webhook endpoint is down.

Test plan:
Payload formatting + non-blocking failure unit tests; mocked scheduler end-to-end test.

Do not change:
Sync result recording; scheduler timing.
```

```text
Task: P3-4 Detect movies already in Radarr (not added by this app)

Read and follow AGENTS.md.

Context:
The grid only knows app-added movies; films already in the user's Radarr library show as addable. Extend the P1-1 reconcile to badge cached films found in the library. Prereq: P1-1.

Files to inspect:
web/app/lib/reconcile.ts, web/app/lib/radarr.ts (listRadarrMovies), web/app/lib/repos/syncResults.ts (record exists)

Implement:
1) During reconcile, index the library by tmdbId; for every cached film with a tmdbId and no current synced status, record exists with message "Found in Radarr library (not added by this app)". 2) Skip films without tmdbId (title matching too false-positive-prone). 3) Verify candidate selection now skips them and the green ring renders.

Acceptance criteria:
After reconcile, library films show as synced/exists and are skipped by syncs; films without tmdbId untouched; P1-1 missing-detection still flips them back if later deleted.

Test plan:
Reconcile unit test extension with library fixtures covering matched, unmatched, and no-tmdbId films.

Do not change:
Add flow; blocklist.
```

```text
Task: P3-5 Activity log pagination and per-film history

Read and follow AGENTS.md.

Context:
Activity is capped at the latest 100 rows with no paging; the movie detail modal shows no per-film sync history. Prereq: P0-4 (film_id index).

Files to inspect:
web/app/lib/repos/syncResults.ts (getRecentSyncResults; add getSyncResultsForFilmId), web/app/api/sync/route.ts (GET), ActivityPanel and MovieDetailModal components

Implement:
1) Add before (sync result id) and limit params to the GET endpoint and repo query (WHERE id < ? ORDER BY id DESC LIMIT ?). 2) "Load more" in the activity panel appending older entries (dedupe by id against client-generated entries). 3) Movie detail modal: render the film's last ~10 events (status badge, message, relative time) via getSyncResultsForFilmId.

Acceptance criteria:
Activity pages back beyond 100 entries; the detail modal shows that film's sync events; default view unchanged.

Test plan:
Repo pagination test; Load-more component test.

Do not change:
Default page size; existing entry rendering.
```
