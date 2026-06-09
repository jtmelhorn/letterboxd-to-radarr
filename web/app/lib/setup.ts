import { getConfiguredReviewer } from "@/app/lib/config";
import { isValidHandle } from "@/app/lib/letterboxd";
import { getRadarrTarget } from "@/app/lib/repos/settings";
import { getOrCreateUser, listUsers } from "@/app/lib/repos/users";

export function validateSetupReady(): { ok: true } | { ok: false; message: string } {
  const configuredReviewer = getConfiguredReviewer();
  if (configuredReviewer && isValidHandle(configuredReviewer)) {
    getOrCreateUser(configuredReviewer);
  }
  if (listUsers().length === 0) {
    return { ok: false, message: "Add at least one Letterboxd reviewer before completing setup." };
  }

  const target = getRadarrTarget();
  const hasUrl = Boolean(target.baseUrl.trim());
  const hasApiKey = Boolean(target.apiKey.trim());

  // Radarr is optional at setup time — it can be configured later from
  // Settings. A half-filled connection is rejected rather than saved silently.
  if (!hasUrl && !hasApiKey) {
    return { ok: true };
  }
  if (!hasUrl) {
    return { ok: false, message: "Radarr Base URL is required when an API key is provided." };
  }

  try {
    const url = new URL(target.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "Radarr Base URL must be a valid http or https URL." };
    }
  } catch {
    return { ok: false, message: "Radarr Base URL must be a valid http or https URL." };
  }

  if (!hasApiKey) {
    return { ok: false, message: "Radarr API key is required when a base URL is provided." };
  }

  if (target.qualityProfileId == null) {
    return { ok: false, message: "Select a quality profile before completing setup." };
  }

  if (!target.rootFolderPath?.trim()) {
    return { ok: false, message: "Select a root folder before completing setup." };
  }

  if (typeof target.autoThreshold !== "number" || !Number.isFinite(target.autoThreshold)) {
    return { ok: false, message: "Auto-download threshold must be a valid number." };
  }

  return { ok: true };
}
