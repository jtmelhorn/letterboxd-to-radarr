export async function register() {
  // Only boot the background scheduler in the Node.js server runtime.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { startScheduler } = await import("@/app/lib/scheduler");
    startScheduler();
  }
}
