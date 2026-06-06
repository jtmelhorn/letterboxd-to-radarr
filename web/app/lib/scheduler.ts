import cron from "node-cron";

import { getConfiguredReviewer } from "@/app/lib/config";
import { listUsers } from "@/app/lib/repos/users";
import { runSync } from "@/app/lib/sync";

let started = false;

function resolveSchedule(): string | null {
  const raw = (process.env.SYNC_CRON ?? "").trim();
  if (raw.toLowerCase() === "off" || process.env.AUTO_SYNC?.toLowerCase() === "false") {
    return null;
  }
  return raw || "0 0 * * *";
}

/** Collect handles to sync: every known DB user, plus the env-configured one. */
function handlesToSync(): string[] {
  const handles = new Set<string>();
  try {
    for (const user of listUsers()) {
      handles.add(user.handle);
    }
  } catch {
    // DB may not be ready yet; ignore.
  }
  const reviewer = getConfiguredReviewer();
  if (reviewer) handles.add(reviewer.toLowerCase());
  return [...handles];
}

async function runScheduledSync(): Promise<void> {
  const handles = handlesToSync();
  for (const handle of handles) {
    try {
      const summary = await runSync(handle, { auto: true });
      if (summary.added > 0 || summary.failed > 0) {
        console.info(
          `[scheduler] ${handle}: +${summary.added} added, ${summary.exists} existing, ${summary.failed} failed`,
        );
      }
    } catch (error) {
      console.error(`[scheduler] sync failed for ${handle}`, error);
    }
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;

  const schedule = resolveSchedule();
  if (!schedule) {
    console.info("[scheduler] background sync disabled (SYNC_CRON=off).");
    return;
  }
  if (!cron.validate(schedule)) {
    console.warn(`[scheduler] invalid SYNC_CRON "${schedule}"; background sync disabled.`);
    return;
  }

  console.info(`[scheduler] background sync scheduled: "${schedule}"`);
  cron.schedule(schedule, () => {
    void runScheduledSync();
  });
}
