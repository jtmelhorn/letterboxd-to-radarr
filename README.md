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
- `jszip`

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

The Letterboxd username and minimum rating are stored in browser `localStorage`. Radarr Base URL, Radarr API key, Letterboxd export URL, Letterboxd session cookie, and cached Letterboxd reviews are stored server-side as JSON. By default this data lives in `.data`; set `LETTERBOXD_RADARR_DATA_DIR` or `APP_DATA_DIR` to point at a persistent directory, such as a future container volume. The Letterboxd cookie is stored plaintext in that data directory and should be protected like a secret.

Letterboxd RSS only exposes the latest 50 activity items. Fetching reviews now merges those items into the persistent cache. To backfill older reviews, save a Letterboxd session Cookie header in Settings and use **Fetch Export ZIP**. The app downloads the official Letterboxd account export from `https://letterboxd.com/user/exportdata`, then reads `reviews.csv`, `ratings.csv`, and `diary.csv` from the archive. Manual `.zip` or CSV upload is still supported as a fallback.

## Verification

```bash
npm run typecheck
npm run build
```
