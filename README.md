# Letterboxd to Radarr

A Next.js App Router dashboard that reads one or more public Letterboxd RSS feeds, combines
reviews by film, averages reviewer ratings, and automatically sends highly rated movies to Radarr.

Reviews, settings, and sync history are stored in a SQLite database. A background scheduler keeps
Radarr in sync on an interval even when no browser is open, the Radarr API key is encrypted at
rest, and the whole app can optionally sit behind a password.

## Docker Compose

For normal use, the root of this repo only needs:

- `docker-compose.yml`
- `README.md`

Start the app:

```bash
docker compose up -d
```

Open http://localhost:3080 by default. If `3080` conflicts with another service, change the left side of `3080:3000` in `docker-compose.yml`.

Settings and the Letterboxd review cache are stored in the `letterboxd-radarr-data` Docker volume. This avoids bind-mount permission issues with the non-root container user.

Fill in the `CHANGE_ME` placeholders in `docker-compose.yml`, or leave them as-is and enter settings in the UI during first-launch setup. Placeholder values are ignored by the app until you replace them.

On first launch, the app walks you through:

1. **Admin password** — required if `APP_PASSWORD` is not set in the environment (stored hashed in `/data`).
2. **Sign in** — when `APP_PASSWORD` is set, or after you create a password in step 1.
3. **Setup wizard** — full-screen control panel to add the first Letterboxd reviewer, confirm Radarr connection, choose quality profile/root folder, and set the default auto-sync threshold. This runs once per data volume even when env vars pre-fill the fields.

The placeholders are:

- `REVIEWER`: optional initial Letterboxd reviewer handle, for example `jtmel`.
- `RADARR`: your Radarr base URL, for example `http://radarr.example.com:7878`.
- `API_KEY`: your Radarr API key from Radarr Settings > General > Security.

Optional environment variables:

- `APP_PASSWORD`: optional admin password. When set, users sign in with this password. When omitted, the first visitor must set a password in the UI (stored hashed in the data volume). The app is not open without authentication.
- `APP_ENCRYPTION_KEY`: 32-byte base64 or hex key used to encrypt the stored Radarr API key. If unset, a random key is generated and persisted as `secret.key` in the data directory.
- `SYNC_CRON`: cron expression for the background sync (default `0 0 * * *`, once daily at midnight). Set to `off` to disable background syncing.
- `DATA_DIR`: override the data directory (defaults to `/data` in production, `web/.data` in development).

To build the image locally instead of pulling from GitHub Container Registry, uncomment `build: ./web` in `docker-compose.yml`.

## Repository Layout

- Root: Docker Compose deployment files and user-facing docs.
- `web/`: Next.js application source, package metadata, Dockerfile, and TypeScript config.

## Dependencies

Runtime dependencies:

- `next`
- `react`
- `react-dom`
- `rss-parser`
- `better-sqlite3` (SQLite storage)
- `drizzle-orm` (typed queries)
- `node-cron` (background scheduler)
- `p-limit` (Radarr request concurrency limiting)
- `lru-cache` (RSS feed caching)

Development dependencies:

- `typescript`
- `tailwindcss`
- `@tailwindcss/postcss`
- `@types/node`
- `@types/react`
- `@types/react-dom`

Install everything with:

```bash
cd web
npm install
```

## Development

```bash
cd web
npm run dev
```

Open http://localhost:3000 and enter:

- One or more Letterboxd reviewer handles
- Radarr base URL, for example `http://192.168.1.100:7878`
- Radarr API key
- Minimum star rating

The display rating filter is stored in browser `localStorage`. Everything else—Letterboxd reviewer sources, reviewer groups, group auto-sync thresholds, Radarr connection, quality profile, root folder, cached reviews, and sync history—is stored server-side in a SQLite database (`app.db`). In local development this data defaults to `web/.data`; Docker Compose stores it in the `letterboxd-radarr-data` volume mounted at `/data`. The Radarr API key is encrypted at rest with AES-256-GCM.

Letterboxd RSS exposes the latest activity items. Fetching reviews merges those items (keyed by RSS guid) into the database. The dashboard groups reviews by film identity, shows an average rating when multiple reviewers reviewed the same movie, and keeps each review visible in the movie detail view. A background scheduler evaluates enabled reviewer groups and adds movies whose group-average rating meets that group's threshold. Adds are idempotent—a movie that already synced successfully is not re-sent.

### API overview

- `GET /api/reviewers`, `POST /api/reviewers`, `DELETE /api/reviewers?handle=<user>` — manage Letterboxd reviewer sources.
- `GET|POST|PUT /api/reviewer-groups`, `DELETE /api/reviewer-groups?id=<id>` — manage named reviewer groups and group auto-sync thresholds.
- `GET /api/reviews?scope=all|group&groupId=<id>&reviewer=<handle>&refresh=1` — read aggregated film reviews (optionally refreshing RSS); no Radarr side effects.
- `POST /api/sync` `{ scope, reviewer, groupId }` — fetch, upsert, and auto-add qualifying aggregated movies to Radarr; returns a run summary.
- `GET /api/sync?...` — recent sync history (activity log).
- `POST /api/radarr` `{ reviewId }` — manually add a stored film representative to Radarr.
- `GET /api/radarr/synced?...` — aggregated movies successfully sent to Radarr, including all reviewer details.
- `GET /api/radarr/options` — available Radarr quality profiles and root folders.
- `GET|PUT /api/settings`, `POST /api/settings/test` — read/update connection + automation settings and test connectivity.
- `GET /api/auth/status` — bootstrap state (`needsPasswordSetup`, `needsLogin`, `setupComplete`).
- `POST /api/auth/setup-password` — set the admin password on first launch (when no env password).
- `POST /api/auth/login`, `POST /api/auth/logout` — session management.
- `POST /api/setup/complete` — mark first-launch setup wizard as finished.

## Container

Build the production image:

```bash
docker build -t letterboxd-to-radarr:latest ./web
```

Run it locally:

```bash
docker run --rm -p 3000:3000 \
  -v letterboxd-radarr-data:/data \
  -e REVIEWER=your-letterboxd-username \
  -e RADARR=http://192.168.1.100:7878 \
  -e API_KEY=your-api-key \
  letterboxd-to-radarr:latest
```

Tag and push to a public registry:

```bash
docker tag letterboxd-to-radarr:latest registry.example.com/your-name/letterboxd-to-radarr:latest
docker push registry.example.com/your-name/letterboxd-to-radarr:latest
```

Pass secrets like `API_KEY` at runtime instead of baking them into the image.

If you previously used a host bind mount such as `./data:/data` and saw `Unable to save settings.`, the host directory was likely not writable by the container's non-root user. Switch back to the named volume above, or fix the host directory ownership before using a bind mount.

## Verification

```bash
cd web
npm run typecheck
npm run build
```
