import cron from "node-cron";

import { getConfiguredReviewer } from "@/app/lib/config";
import { listEnabledReviewerGroups } from "@/app/lib/repos/reviewerGroups";
import { getOrCreateUser } from "@/app/lib/repos/users";
import { runSyncScope } from "@/app/lib/sync";

let started = false;

function resolveSchedule(): string | null {
  const raw = (process.env.SYNC_CRON ?? "").trim();
  if (raw.toLowerCase() === "off" || process.env.AUTO_SYNC?.toLowerCase() === "false") {
    return null;
  }
  return raw || "0 0 * * *";
}

function seedConfiguredReviewer(): void {
  const reviewer = getConfiguredReviewer();
  if (!reviewer) return;
  try {
    getOrCreateUser(reviewer);
  } catch {
    // DB may not be ready yet; ignore.
  }
}

async function runScheduledSync(): Promise<void> {
  seedConfiguredReviewer();
  const groups = listEnabledReviewerGroups();
  for (const group of groups) {
    try {
      const summary = await runSyncScope(
        { type: "group", groupId: group.id },
        { auto: true, threshold: group.autoThreshold },
      );
      if (summary.added > 0 || summary.failed > 0) {
        console.info(
          `[scheduler] ${group.name}: +${summary.added} added, ${summary.exists} existing, ${summary.failed} failed`,
        );
      }
    } catch (error) {
      console.error(`[scheduler] sync failed for group "${group.name}"`, error);
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
