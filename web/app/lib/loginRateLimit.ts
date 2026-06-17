const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;

// In-process sliding window keyed by client IP. This app runs single-node, so
// a Map is sufficient; state resets on restart, which is acceptable here.
const failedAttemptsByKey = new Map<string, number[]>();

export function loginRateLimitKey(request: Request): string {
  // Trust only the first x-forwarded-for hop (set by the user's own reverse
  // proxy). Without it, fall back to one global bucket.
  const forwarded = request.headers.get("x-forwarded-for");
  const firstHop = forwarded?.split(",")[0]?.trim();
  return firstHop || "global";
}

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const recent = (failedAttemptsByKey.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  failedAttemptsByKey.set(key, recent);
  if (recent.length >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedLogin(key: string): void {
  const now = Date.now();
  const recent = (failedAttemptsByKey.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  failedAttemptsByKey.set(key, recent);
}

export function clearFailedLogins(key: string): void {
  failedAttemptsByKey.delete(key);
}

export function resetLoginRateLimiter(): void {
  failedAttemptsByKey.clear();
}
