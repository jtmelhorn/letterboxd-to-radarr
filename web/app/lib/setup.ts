import { getRadarrTarget } from "@/app/lib/repos/settings";

export function validateSetupReady(): { ok: true } | { ok: false; message: string } {
  const target = getRadarrTarget();

  if (!target.baseUrl.trim()) {
    return { ok: false, message: "Radarr Base URL is required." };
  }

  try {
    const url = new URL(target.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "Radarr Base URL must be a valid http or https URL." };
    }
  } catch {
    return { ok: false, message: "Radarr Base URL must be a valid http or https URL." };
  }

  if (!target.apiKey.trim()) {
    return { ok: false, message: "Radarr API key is required." };
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
