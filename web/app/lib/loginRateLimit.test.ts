import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkLoginRateLimit,
  clearFailedLogins,
  loginRateLimitKey,
  recordFailedLogin,
  resetLoginRateLimiter,
} from "@/app/lib/loginRateLimit";

describe("login rate limit", () => {
  beforeEach(() => {
    resetLoginRateLimiter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLoginRateLimiter();
  });

  it("allows up to ten failed attempts and blocks the eleventh", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(checkLoginRateLimit("1.2.3.4").allowed).toBe(true);
      recordFailedLogin("1.2.3.4");
    }

    const blocked = checkLoginRateLimit("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("expires failed attempts after the fifteen-minute window", () => {
    for (let i = 0; i < 10; i += 1) recordFailedLogin("1.2.3.4");
    expect(checkLoginRateLimit("1.2.3.4").allowed).toBe(false);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);

    expect(checkLoginRateLimit("1.2.3.4").allowed).toBe(true);
  });

  it("tracks clients independently and clears on success", () => {
    for (let i = 0; i < 10; i += 1) recordFailedLogin("1.2.3.4");
    expect(checkLoginRateLimit("1.2.3.4").allowed).toBe(false);
    expect(checkLoginRateLimit("5.6.7.8").allowed).toBe(true);

    clearFailedLogins("1.2.3.4");
    expect(checkLoginRateLimit("1.2.3.4").allowed).toBe(true);
  });

  it("keys on the first x-forwarded-for hop with a global fallback", () => {
    const forwarded = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
    });
    expect(loginRateLimitKey(forwarded)).toBe("9.9.9.9");

    const bare = new Request("http://localhost/api/auth/login");
    expect(loginRateLimitKey(bare)).toBe("global");
  });
});
