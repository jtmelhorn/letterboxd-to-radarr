export async function register() {
  // Only boot the background scheduler in the Node.js server runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/app/lib/scheduler");
    startScheduler();
  }
}
