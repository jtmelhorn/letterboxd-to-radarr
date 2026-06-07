import { eq } from "drizzle-orm";

import {
  configuredRadarrApiKey,
  configuredRadarrUrl,
  getConfiguredReviewer,
  getDataDir,
  isAuthEnabled,
} from "@/app/lib/config";
import { decryptSecret, encryptSecret } from "@/app/lib/crypto";
import { getDb } from "@/app/lib/db";
import { radarrTargets } from "@/app/lib/db/schema";
import { isSetupComplete } from "@/app/lib/repos/appState";
import { getReviewerGroup } from "@/app/lib/repos/reviewerGroups";
import type {
  PublicSettings,
  ResolvedRadarrTarget,
  SettingsUpdate,
} from "@/app/types/movie";

const SETTINGS_ID = 1;

function readRow() {
  const db = getDb();
  return db.select().from(radarrTargets).where(eq(radarrTargets.id, SETTINGS_ID)).get();
}

/**
 * Resolve the effective Radarr target. Environment variables (RADARR/API_KEY)
 * take precedence over stored values so container config still wins.
 */
export function getRadarrTarget(): ResolvedRadarrTarget {
  const row = readRow();

  const storedKey = row?.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : "";

  return {
    baseUrl: configuredRadarrUrl() || row?.baseUrl || "",
    apiKey: configuredRadarrApiKey() || storedKey,
    qualityProfileId: row?.qualityProfileId ?? null,
    qualityProfileName: row?.qualityProfileName ?? null,
    rootFolderPath: row?.rootFolderPath ?? null,
    minAvailability: row?.minAvailability ?? "announced",
    autoThreshold: row?.autoThreshold ?? 4,
    monitored: row?.monitored ?? true,
  };
}

export function saveSettings(update: SettingsUpdate): void {
  const db = getDb();
  const values: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (typeof update.radarrUrl === "string") {
    values.baseUrl = update.radarrUrl;
  }
  if (typeof update.radarrApiKey === "string" && update.radarrApiKey.trim()) {
    values.apiKeyEncrypted = encryptSecret(update.radarrApiKey.trim());
  }
  if (update.qualityProfileId !== undefined) {
    values.qualityProfileId = update.qualityProfileId;
  }
  if (update.qualityProfileName !== undefined) {
    values.qualityProfileName = update.qualityProfileName;
  }
  if (update.rootFolderPath !== undefined) {
    values.rootFolderPath = update.rootFolderPath;
  }
  if (typeof update.minAvailability === "string") {
    values.minAvailability = update.minAvailability;
  }
  if (typeof update.autoThreshold === "number") {
    values.autoThreshold = update.autoThreshold;
  }
  if (typeof update.monitored === "boolean") {
    values.monitored = update.monitored;
  }
  db.update(radarrTargets).set(values).where(eq(radarrTargets.id, SETTINGS_ID)).run();
}

export function toPublicSettings(target: ResolvedRadarrTarget): PublicSettings {
  return {
    reviewer: getConfiguredReviewer(),
    radarrUrl: target.baseUrl,
    hasRadarrApiKey: target.apiKey.length > 0,
    qualityProfileId: target.qualityProfileId,
    qualityProfileName: target.qualityProfileName,
    rootFolderPath: target.rootFolderPath,
    minAvailability: target.minAvailability,
    autoThreshold: target.autoThreshold,
    monitored: target.monitored,
    dataDir: getDataDir(),
    authEnabled: isAuthEnabled(),
    setupComplete: isSetupComplete(),
  };
}
