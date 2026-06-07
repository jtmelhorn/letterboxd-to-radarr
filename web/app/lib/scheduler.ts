import cron from "node-cron";

import { getConfiguredReviewer } from "@/app/lib/config";
import { listSchedulableReviewerGroups } from "@/app/lib/repos/reviewerGroups";
import { getOrCreateUser } from "@/app/lib/repos/users";
import { runSyncScope } from "@/app/lib/sync";

let started = false;

const intervalSchedules = {
  "30m": "*/30 * * * *",
  "1h": "0 * * * *",
  "12h": "0 */12 * * *",
  "1d": "0 0 * * *",
  "1w": "0 0 * * 0",
} as const;

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
  const groups = listSchedulableReviewerGroups();
  for (const group of groups) {
    try {
      const summary = await runSyncScope(
        { type: "group", groupId: group.id },
        { auto: true, threshold: group.ratingThreshold },
      );
      if (summary.added > 0 || summary.failed > 0 || (summary.pending ?? 0) > 0 || (summary.skipped ?? 0) > 0) {
        console.info(
          `[scheduler] ${group.name}: +${summary.added} added, ${summary.exists} existing, ${summary.failed} failed, ${summary.pending ?? 0} pending, ${summary.skipped ?? 0} skipped`,
        );
      }
    } catch (error) {
      console.error(`[scheduler] sync failed for group "${group.name}"`, error);
    }
  }
}

async function runScheduledInterval(interval: keyof typeof intervalSchedules): Promise<void> {
  seedConfiguredReviewer();
  const groups = listSchedulableReviewerGroups().filter((group) => group.syncInterval === interval);
  for (const group of groups) {
    try {
      const summary = await runSyncScope(
        { type: "group", groupId: group.id },
        { auto: true, threshold: group.ratingThreshold },
      );
      if (summary.added > 0 || summary.failed > 0 || (summary.pending ?? 0) > 0 || (summary.skipped ?? 0) > 0) {
        console.info(
          `[scheduler] ${group.name}: +${summary.added} added, ${summary.exists} existing, ${summary.failed} failed, ${summary.pending ?? 0} pending, ${summary.skipped ?? 0} skipped`,
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

  if ((process.env.SYNC_CRON ?? "").trim()) {
    console.info(`[scheduler] background sync scheduled: "${schedule}"`);
    cron.schedule(schedule, () => {
      void runScheduledSync();
    });
    return;
  }

  for (const [interval, groupSchedule] of Object.entries(intervalSchedules)) {
    if (!cron.validate(groupSchedule)) continue;
    console.info(`[scheduler] interval ${interval} scheduled: "${groupSchedule}"`);
    cron.schedule(groupSchedule, () => {
      void runScheduledInterval(interval as keyof typeof intervalSchedules);
    });
  }
}
