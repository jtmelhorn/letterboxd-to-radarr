# Letterboxd to Radarr

A Next.js App Router dashboard that reads a public Letterboxd RSS feed, filters reviews by star
rating, and automatically sends movies rated 4 stars or higher to Radarr.

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

The Letterboxd username and minimum rating are stored in browser `localStorage`. Radarr Base URL, Radarr API key, and cached Letterboxd reviews are stored server-side as JSON. In local development this data defaults to `web/.data`; Docker Compose stores it in the `letterboxd-radarr-data` volume mounted at `/data`. The Radarr API key is stored plaintext in that data directory and should be protected like a secret.

Letterboxd RSS exposes the latest activity items. Fetching reviews merges those items into the persistent cache, sorts the movie wall by newest review date and then star rating, and automatically adds movies rated 4.0 stars or higher to Radarr when Radarr settings are configured.

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
