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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "letterboxdarr-auth-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describeWithSqlite("session tokens", () => {
  it("round-trips a freshly issued token", async () => {
    const { buildSessionToken, verifySessionToken } = await import("@/app/lib/auth");

    expect(verifySessionToken(buildSessionToken())).toBe(true);
  });

  it("rejects tampered tokens", async () => {
    const { buildSessionToken, verifySessionToken } = await import("@/app/lib/auth");

    const token = buildSessionToken();
    expect(verifySessionToken(`${token}x`)).toBe(false);
    expect(verifySessionToken(token.replace(/^\d/, "9"))).toBe(false);
  });

  it("treats legacy timestamp-only tokens as epoch zero", async () => {
    const { verifySessionToken } = await import("@/app/lib/auth");
    const { sign } = await import("@/app/lib/crypto");

    const legacyPayload = String(Date.now());
    expect(verifySessionToken(`${legacyPayload}.${sign(legacyPayload)}`)).toBe(true);
  });

  it("invalidates previously issued tokens when the password changes", async () => {
    const { buildSessionToken, verifySessionToken } = await import("@/app/lib/auth");
    const { setAdminPassword } = await import("@/app/lib/repos/appState");
    const { hashPassword } = await import("@/app/lib/crypto");

    const token = buildSessionToken();
    expect(verifySessionToken(token)).toBe(true);

    setAdminPassword(hashPassword("new-password-123"));

    expect(verifySessionToken(token)).toBe(false);
    expect(verifySessionToken(buildSessionToken())).toBe(true);
  });
});
