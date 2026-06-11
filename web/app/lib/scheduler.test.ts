import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSyncScope: vi.fn(),
  listSchedulableReviewerGroups: vi.fn(),
  getOrCreateUser: vi.fn(),
  getConfiguredReviewer: vi.fn(() => ""),
}));

vi.mock("@/app/lib/sync", () => ({ runSyncScope: mocks.runSyncScope }));
vi.mock("@/app/lib/repos/reviewerGroups", () => ({
  listSchedulableReviewerGroups: mocks.listSchedulableReviewerGroups,
}));
vi.mock("@/app/lib/repos/users", () => ({ getOrCreateUser: mocks.getOrCreateUser }));
vi.mock("@/app/lib/config", () => ({ getConfiguredReviewer: mocks.getConfiguredReviewer }));

const emptySummary = {
  fetched: 0,
  added: 0,
  exists: 0,
  failed: 0,
  pending: 0,
  skipped: 0,
  threshold: 4,
  results: [],
};

function group(id: number, name: string, syncInterval: string, ratingThreshold = 4) {
  return { id, name, syncInterval, ratingThreshold };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSyncScope.mockResolvedValue(emptySummary);
  mocks.listSchedulableReviewerGroups.mockReturnValue([
    group(1, "Half hourly", "30m"),
    group(2, "Daily", "1d", 4.5),
    group(3, "Weekly", "1w"),
  ]);
});

describe("runScheduledGroups", () => {
  it("runs only groups matching the firing interval", async () => {
    const { runScheduledGroups } = await import("@/app/lib/scheduler");

    await runScheduledGroups("1d");

    expect(mocks.runSyncScope).toHaveBeenCalledTimes(1);
    expect(mocks.runSyncScope).toHaveBeenCalledWith(
      { type: "group", groupId: 2 },
      { auto: true, threshold: 4.5 },
    );
  });

  it("runs every schedulable group when no interval filter is given (SYNC_CRON mode)", async () => {
    const { runScheduledGroups } = await import("@/app/lib/scheduler");

    await runScheduledGroups();

    expect(mocks.runSyncScope).toHaveBeenCalledTimes(3);
    expect(mocks.runSyncScope.mock.calls.map(([scope]) => scope)).toEqual([
      { type: "group", groupId: 1 },
      { type: "group", groupId: 2 },
      { type: "group", groupId: 3 },
    ]);
  });

  it("keeps running remaining groups when one group's sync throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runSyncScope.mockRejectedValueOnce(new Error("boom"));
    const { runScheduledGroups } = await import("@/app/lib/scheduler");

    await runScheduledGroups();

    expect(mocks.runSyncScope).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalled();
  });
});
