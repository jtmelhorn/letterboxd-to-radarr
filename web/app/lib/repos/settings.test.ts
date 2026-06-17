import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sqliteAvailable = (() => {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
})();
const describeWithSqlite = sqliteAvailable ? describe : describe.skip;

let dataDir = "";
const ENV_KEYS = ["RADARR", "RADARR_URL", "API_KEY", "RADARR_API_KEY", "REVIEWER", "LETTERBOXD_REVIEWER", "APP_PASSWORD"];

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-settings-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  for (const key of ENV_KEYS) delete process.env[key];
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("environment override visibility", () => {
  it("flags env-provided Radarr URL and API key in PublicSettings", async () => {
    process.env.RADARR = "http://radarr.env:7878";
    process.env.API_KEY = "env-secret";
    const { getRadarrTarget, toPublicSettings } = await import("@/app/lib/repos/settings");

    const settings = toPublicSettings(getRadarrTarget());
    expect(settings.radarrUrlFromEnv).toBe(true);
    expect(settings.radarrApiKeyFromEnv).toBe(true);
    expect(settings.radarrUrl).toBe("http://radarr.env:7878");
    expect(settings.hasRadarrApiKey).toBe(true);
  });

  it("does not flag stored values or CHANGE_ME placeholders as env-provided", async () => {
    process.env.RADARR = "CHANGE_ME";
    process.env.API_KEY = "CHANGE_ME";
    const { getRadarrTarget, saveSettings, toPublicSettings } = await import(
      "@/app/lib/repos/settings"
    );

    saveSettings({ radarrUrl: "http://radarr.local", radarrApiKey: "stored-secret" });
    const settings = toPublicSettings(getRadarrTarget());
    expect(settings.radarrUrlFromEnv).toBe(false);
    expect(settings.radarrApiKeyFromEnv).toBe(false);
    expect(settings.radarrUrl).toBe("http://radarr.local");
  });

  it("locks the env reviewer: fromEnv flag, DELETE refused with 400, others deletable", async () => {
    process.env.APP_PASSWORD = "test-password";
    process.env.REVIEWER = "EnvUser";
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { buildSessionToken, SESSION_COOKIE } = await import("@/app/lib/auth");
    const { DELETE, GET } = await import("@/app/api/reviewers/route");

    getOrCreateUser("normaluser");
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(buildSessionToken())}`;

    const listRes = await GET(new Request("http://localhost/api/reviewers", { headers: { cookie } }));
    const listBody = (await listRes.json()) as {
      reviewers: Array<{ handle: string; fromEnv: boolean }>;
    };
    expect(listBody.reviewers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handle: "envuser", fromEnv: true }),
        expect.objectContaining({ handle: "normaluser", fromEnv: false }),
      ]),
    );

    const envDelete = await DELETE(
      new Request("http://localhost/api/reviewers?handle=envuser", {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(envDelete.status).toBe(400);
    const envDeleteBody = (await envDelete.json()) as { message: string };
    expect(envDeleteBody.message).toContain("environment variable");

    const normalDelete = await DELETE(
      new Request("http://localhost/api/reviewers?handle=normaluser", {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(normalDelete.status).toBe(200);
    const normalDeleteBody = (await normalDelete.json()) as {
      reviewers: Array<{ handle: string }>;
    };
    expect(normalDeleteBody.reviewers.map((reviewer) => reviewer.handle)).toEqual(["envuser"]);
  });
});
