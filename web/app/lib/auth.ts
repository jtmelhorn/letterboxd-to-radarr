import { timingSafeEqual } from "node:crypto";

import { configuredAppPassword, isAuthEnabled } from "@/app/lib/config";
import { sign, verifySignature } from "@/app/lib/crypto";

export const SESSION_COOKIE = "lb_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function buildSessionToken(): string {
  const payload = String(Date.now());
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;

  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!verifySignature(payload, signature)) return false;

  const issuedAt = Number.parseInt(payload, 10);
  if (!Number.isFinite(issuedAt)) return false;

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

export function verifyPassword(input: string): boolean {
  const expected = configuredAppPassword();
  if (!expected) return false;

  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

/**
 * True when the request is allowed. When no APP_PASSWORD is set, the app stays
 * open (zero-config self-host).
 */
export function isRequestAuthorized(request: Request): boolean {
  if (!isAuthEnabled()) return true;
  return verifySessionToken(readCookie(request, SESSION_COOKIE));
}
