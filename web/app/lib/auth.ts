import { timingSafeEqual } from "node:crypto";

import { configuredAppPassword } from "@/app/lib/config";
import { sign, verifyPasswordHash, verifySignature } from "@/app/lib/crypto";
import { getAppState, getSessionEpoch, hasStoredAdminPassword, isSetupComplete } from "@/app/lib/repos/appState";

export const SESSION_COOKIE = "lb_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface AuthStatus {
  needsPasswordSetup: boolean;
  needsLogin: boolean;
  setupComplete: boolean;
  authEnabled: boolean;
}

export function buildSessionToken(): string {
  const payload = `${getSessionEpoch()}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;

  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!verifySignature(payload, signature)) return false;

  // Payload is "<epoch>.<issuedAt>"; tokens issued before the epoch field
  // existed carry only "<issuedAt>" and count as epoch 0, so they stay valid
  // until the first password change bumps the stored epoch.
  const dotIdx = payload.indexOf(".");
  const epoch = dotIdx > 0 ? Number.parseInt(payload.slice(0, dotIdx), 10) : 0;
  const issuedAt = Number.parseInt(dotIdx > 0 ? payload.slice(dotIdx + 1) : payload, 10);
  if (!Number.isFinite(epoch) || !Number.isFinite(issuedAt)) return false;
  if (epoch < getSessionEpoch()) return false;

  const ageSeconds = (Date.now() - issuedAt) / 1000;
  return ageSeconds >= 0 && ageSeconds <= SESSION_MAX_AGE;
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function isPasswordConfigured(): boolean {
  return configuredAppPassword().length > 0 || hasStoredAdminPassword();
}

export function verifyPassword(input: string): boolean {
  const fromEnv = configuredAppPassword();
  if (fromEnv) {
    const a = Buffer.from(input);
    const b = Buffer.from(fromEnv);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  const storedHash = getAppState().adminPasswordHash;
  if (!storedHash) return false;
  return verifyPasswordHash(input, storedHash);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function hasValidSession(request: Request): boolean {
  return verifySessionToken(readCookie(request, SESSION_COOKIE));
}

export function getAuthStatus(request: Request): AuthStatus {
  const envPassword = configuredAppPassword().length > 0;
  const storedPassword = hasStoredAdminPassword();
  const passwordConfigured = envPassword || storedPassword;
  const sessionValid = hasValidSession(request);
  const setupComplete = isSetupComplete();

  const needsPasswordSetup = !passwordConfigured;
  const authEnabled = passwordConfigured;
  const needsLogin = passwordConfigured && !sessionValid;

  return {
    needsPasswordSetup,
    needsLogin,
    setupComplete,
    authEnabled,
  };
}

/**
 * True when the request is allowed. Requires a configured password and valid
 * session cookie once bootstrap is complete.
 */
export function isRequestAuthorized(request: Request): boolean {
  if (!isPasswordConfigured()) return false;
  return hasValidSession(request);
}
