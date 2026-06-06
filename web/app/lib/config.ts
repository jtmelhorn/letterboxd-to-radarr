import path from "node:path";

function isPlaceholderValue(value: string): boolean {
  return ["CHANGE_ME", "CHANGEME", "CHANGME"].includes(value.trim().toUpperCase());
}

function envValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !isPlaceholderValue(value)) {
      return value;
    }
  }

  return "";
}

export function configuredRadarrUrl(): string {
  return envValue(["RADARR", "RADARR_URL"]);
}

export function configuredRadarrApiKey(): string {
  return envValue(["RADARR_API_KEY", "API_KEY"]);
}

export function getConfiguredReviewer(): string {
  return envValue(["LETTERBOXD_REVIEWER", "REVIEWER"]);
}

/**
 * Resolve the writable data directory. Configurable via DATA_DIR so the
 * persistent volume location is no longer hardcoded.
 */
export function getDataDir(): string {
  const fromEnv = process.env.DATA_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === "production") {
    return "/data";
  }

  return path.join(process.cwd(), ".data");
}

/**
 * Optional single-password gate. When unset, the app stays open (zero-config
 * self-host) but logs a warning; when set, every API route and page requires a
 * signed session cookie.
 */
export function configuredAppPassword(): string {
  return process.env.APP_PASSWORD?.trim() ?? "";
}

export function isAuthEnabled(): boolean {
  return configuredAppPassword().length > 0;
}
