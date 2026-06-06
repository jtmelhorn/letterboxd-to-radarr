# Letterboxd to Radarr

A Next.js App Router dashboard that reads a public Letterboxd RSS feed, filters reviews by star
rating, and automatically sends highly rated movies to Radarr.

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

Fill in the `CHANGE_ME` placeholders in `docker-compose.yml`, or leave them as-is and enter settings in the UI. Placeholder values are ignored by the app until you replace them.

The placeholders are:

- `REVIEWER`: your Letterboxd username, for example `jtmel`.
- `RADARR`: your Radarr base URL, for example `http://radarr.example.com:7878`.
- `API_KEY`: your Radarr API key from Radarr Settings > General > Security.

Optional environment variables:

- `APP_PASSWORD`: when set, the app and all API routes require this password (a signed, HTTP-only session cookie is issued on login). Leave unset for an open, zero-config LAN deployment.
- `APP_ENCRYPTION_KEY`: 32-byte base64 or hex key used to encrypt the stored Radarr API key. If unset, a random key is generated and persisted as `secret.key` in the data directory.
- `SYNC_CRON`: cron expression for the background sync (default `*/30 * * * *`). Set to `off` to disable background syncing.
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

- Letterboxd username
- Radarr base URL, for example `http://192.168.1.100:7878`
- Radarr API key
- Minimum star rating

The Letterboxd username and the display rating filter are stored in browser `localStorage`. Everything else—Radarr connection, the auto-download threshold, quality profile, root folder, cached reviews, and sync history—is stored server-side in a SQLite database (`app.db`). In local development this data defaults to `web/.data`; Docker Compose stores it in the `letterboxd-radarr-data` volume mounted at `/data`. The Radarr API key is encrypted at rest with AES-256-GCM.

Letterboxd RSS exposes the latest activity items. Fetching reviews merges those items (keyed by RSS guid) into the database, sorts the movie wall by newest review date and then star rating. A background scheduler and the "Sync Feed" action add movies rated at or above the configured threshold to Radarr, recording each outcome in the sync history. Adds are idempotent—a movie that already synced successfully is not re-sent.

### API overview

- `GET /api/reviews?handle=<user>&refresh=1` — read cached reviews (optionally refreshing from RSS); no Radarr side effects.
- `POST /api/sync` `{ handle }` — fetch, upsert, and auto-add qualifying movies to Radarr; returns a run summary.
- `GET /api/sync?handle=<user>` — recent sync history (activity log).
- `POST /api/radarr` `{ reviewId }` — manually add a single stored review to Radarr.
- `GET /api/radarr/options` — available Radarr quality profiles and root folders.
- `GET|PUT /api/settings`, `POST /api/settings/test` — read/update connection + automation settings and test connectivity.
- `POST /api/auth/login`, `POST /api/auth/logout` — session management when `APP_PASSWORD` is set.

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
