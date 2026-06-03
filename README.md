# Letterboxd to Radarr

A Next.js App Router dashboard that reads a public Letterboxd RSS feed, filters reviews by star
rating, and sends selected movies to Radarr.

## Dependencies

Runtime dependencies:

- `next`
- `react`
- `react-dom`
- `rss-parser`
- `csv-parse`

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

The Letterboxd username and minimum rating are stored in browser `localStorage`. Radarr Base URL, Radarr API key, and cached Letterboxd reviews are stored server-side as JSON. By default this data lives in `.data`; set `LETTERBOXD_RADARR_DATA_DIR` or `APP_DATA_DIR` to point at a persistent directory, such as a future container volume.

Letterboxd RSS only exposes the latest 50 activity items. Fetching reviews now merges those items into the persistent cache. To backfill older reviews, use Settings to upload `reviews.csv` from a Letterboxd account export.

## Verification

```bash
npm run typecheck
npm run build
```
