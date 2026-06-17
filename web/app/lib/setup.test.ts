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

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-setup-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("validateSetupReady", () => {
  it("requires at least one reviewer", async () => {
    const { validateSetupReady } = await import("@/app/lib/setup");

    expect(validateSetupReady()).toMatchObject({
      ok: false,
      message: expect.stringContaining("reviewer"),
    });
  });

  it("allows completing setup with a reviewer and no Radarr configuration", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { validateSetupReady } = await import("@/app/lib/setup");

    getOrCreateUser("alice");

    expect(validateSetupReady()).toEqual({ ok: true });
  });

  it("rejects a half-filled Radarr configuration", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { validateSetupReady } = await import("@/app/lib/setup");

    getOrCreateUser("alice");
    saveSettings({ radarrUrl: "http://radarr.local:7878" });

    expect(validateSetupReady()).toMatchObject({
      ok: false,
      message: expect.stringContaining("API key"),
    });
  });

  it("keeps full validation when both Radarr URL and key are provided", async () => {
    const { getOrCreateUser } = await import("@/app/lib/repos/users");
    const { saveSettings } = await import("@/app/lib/repos/settings");
    const { validateSetupReady } = await import("@/app/lib/setup");

    getOrCreateUser("alice");
    saveSettings({ radarrUrl: "http://radarr.local:7878", radarrApiKey: "secret-key" });

    expect(validateSetupReady()).toMatchObject({
      ok: false,
      message: expect.stringContaining("quality profile"),
    });
  });
});
