# Letterboxd to Radarr

A Next.js App Router dashboard that reads a public Letterboxd RSS feed, filters reviews by star
rating, and automatically sends movies rated 4 stars or higher to Radarr.

## Dependencies

Runtime dependencies:

- `next`
- `react`
- `react-dom`
- `rss-parser`

Development dependencies:

- `typescript`
- `tailwindcss`
- `@tailwindcss/postcss`
- `@types/node`
- `@types/react`
- `@types/react-dom`

Install everything with:

```bash
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:3000 and enter:

- Letterboxd username
- Radarr base URL, for example `http://192.168.1.100:7878`
- Radarr API key
- Minimum star rating

The Letterboxd username and minimum rating are stored in browser `localStorage`. Radarr Base URL, Radarr API key, and cached Letterboxd reviews are stored server-side as JSON. By default this data lives in `.data`; set `LETTERBOXD_RADARR_DATA_DIR` or `APP_DATA_DIR` to point at a persistent directory, such as a future container volume. The Radarr API key is stored plaintext in that data directory and should be protected like a secret.

Letterboxd RSS exposes the latest activity items. Fetching reviews merges those items into the persistent cache, sorts the movie wall by newest review date and then star rating, and automatically adds movies rated 4.0 stars or higher to Radarr when Radarr settings are configured.

## Container

Build the production image:

```bash
docker build -t letterboxd-to-radarr:latest .
```

Run it locally:

```bash
docker run --rm -p 3000:3000 \
  -v letterboxd-radarr-data:/data \
  -e REVIEWER=your-letterboxd-username \
  -e SONARR=http://192.168.1.100:7878 \
  -e API_KEY=your-api-key \
  letterboxd-to-radarr:latest
```

The app is movie-focused and talks to Radarr. `SONARR` is accepted as a media-server URL alias for container compatibility with the requested variable names.

Supported runtime variables:

| Variable | Purpose |
| --- | --- |
| `REVIEWER` or `LETTERBOXD_REVIEWER` | Prefills the Letterboxd username. |
| `SONARR`, `SONARR_URL`, or `RADARR_URL` | Media server base URL. |
| `API_KEY`, `SONARR_API_KEY`, or `RADARR_API_KEY` | Media server API key. |
| `LETTERBOXD_RADARR_DATA_DIR` or `APP_DATA_DIR` | Persistent settings/cache directory. Defaults to `/data` in the container. |
| `PORT` | HTTP port inside the container. Defaults to `3000`. |

Tag and push to a public registry:

```bash
docker tag letterboxd-to-radarr:latest registry.example.com/your-name/letterboxd-to-radarr:latest
docker push registry.example.com/your-name/letterboxd-to-radarr:latest
```

Pass secrets like `API_KEY` at runtime instead of baking them into the image.

### Docker Compose

Copy `.env.example` to `.env`, set your values, then start the app:

```bash
cp .env.example .env
docker compose up -d
```

Open http://localhost:3080 by default, or whatever you set for `HOST_PORT`. The default host port `3080` is chosen to avoid common *arr suite ports such as Radarr (`7878`), Sonarr (`8989`), and Prowlarr (`9696`).

To build the image locally instead of pulling from GitHub Container Registry, uncomment `build: .` in `docker-compose.yml`.

## Verification

```bash
npm run typecheck
npm run build
```
