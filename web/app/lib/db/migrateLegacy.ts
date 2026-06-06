import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

import { getDataDir } from "@/app/lib/config";
import { encryptSecret } from "@/app/lib/crypto";
import { canonicalFilmGuid } from "@/app/lib/filmIdentity";

interface LegacySettings {
  radarrUrl?: string;
  radarrApiKey?: string;
}

interface LegacyMovie {
  title?: string;
  year?: number | null;
  rating?: number;
  reviewedAt?: string;
  posterUrl?: string;
  reviewText?: string;
  letterboxdUrl?: string;
}

interface LegacyCache {
  usernames?: Record<string, { updatedAt?: string; movies?: LegacyMovie[] }>;
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * One-time import of the pre-SQLite JSON files (settings.json,
 * letterboxd-cache.json) into the database. Guarded by a flag file so it only
 * runs once per data volume.
 */
export function migrateLegacyJson(sqlite: Database.Database): void {
  const dataDir = getDataDir();
  const flagPath = path.join(dataDir, ".migrated-sqlite");
  if (existsSync(flagPath)) return;

  try {
    const settings = readJson<LegacySettings>(path.join(dataDir, "settings.json"));
    if (settings && (settings.radarrUrl || settings.radarrApiKey)) {
      sqlite
        .prepare(
          `UPDATE radarr_targets SET base_url = ?, api_key_encrypted = ? WHERE id = 1`,
        )
        .run(
          settings.radarrUrl ?? "",
          settings.radarrApiKey ? encryptSecret(settings.radarrApiKey) : "",
        );
    }

    const cache = readJson<LegacyCache>(path.join(dataDir, "letterboxd-cache.json"));
    if (cache?.usernames) {
      const insertUser = sqlite.prepare(
        `INSERT OR IGNORE INTO users (handle) VALUES (?)`,
      );
      const getUser = sqlite.prepare(`SELECT id FROM users WHERE handle = ?`);
      const insertReview = sqlite.prepare(
        `INSERT OR IGNORE INTO reviews
          (user_id, guid, title, year, rating, reviewed_at, poster_url, review_text, letterboxd_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const tx = sqlite.transaction(() => {
        for (const [rawHandle, entry] of Object.entries(cache.usernames ?? {})) {
          const handle = rawHandle.trim().toLowerCase();
          if (!handle) continue;
          insertUser.run(handle);
          const user = getUser.get(handle) as { id: number } | undefined;
          if (!user) continue;

          for (const movie of entry.movies ?? []) {
            const title = movie.title?.trim();
            if (!title || typeof movie.rating !== "number") continue;
            const year =
              typeof movie.year === "number" && Number.isFinite(movie.year) ? movie.year : null;
            const guid = canonicalFilmGuid({
              title,
              year,
              letterboxdUrl: movie.letterboxdUrl,
            });
            insertReview.run(
              user.id,
              guid,
              title,
              year,
              movie.rating,
              movie.reviewedAt ?? null,
              movie.posterUrl ?? null,
              movie.reviewText ?? null,
              movie.letterboxdUrl ?? null,
            );
          }
        }
      });
      tx();
    }

    writeFileSync(flagPath, new Date().toISOString(), "utf8");
  } catch (error) {
    console.error("[migrate] legacy JSON import failed", error);
  }
}
