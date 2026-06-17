// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SyncConfigurationPanel } from "@/app/components/SyncConfigurationPanel";
import type { ReviewerDto, ReviewerGroupDto, SyncFilters, SyncInterval } from "@/app/types/movie";

const syncIntervalOptions: Array<{ value: SyncInterval; label: string }> = [
  { value: "manual", label: "Manual only" },
  { value: "1d", label: "Daily" },
];

const emptyFilters: SyncFilters = {
  year: { mode: "any" },
  genres: { include: [], exclude: [] },
};

function reviewer(handle: string, id: number): ReviewerDto {
  return { id, handle };
}

function group(input: Partial<ReviewerGroupDto> & { id: number; name: string }): ReviewerGroupDto {
  return {
    id: input.id,
    name: input.name,
    enabled: input.enabled ?? true,
    autoThreshold: input.autoThreshold ?? 4,
    ratingThreshold: input.ratingThreshold ?? input.autoThreshold ?? 4,
    syncInterval: input.syncInterval ?? "1d",
    requiresManualApproval: input.requiresManualApproval ?? false,
    filters: input.filters ?? emptyFilters,
    reviewerHandles: input.reviewerHandles ?? [],
    lastSyncedAt: input.lastSyncedAt ?? null,
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof SyncConfigurationPanel>> = {}) {
  const props = {
    genreOptions: ["Action", "Documentary", "Horror", "Thriller"],
    pendingApprovalCount: 0,
    ratingOptions: [3, 4, 5],
    reviewerGroups: [
      group({ id: 2, name: "Favorites", reviewerHandles: [] }),
    ],
    reviewers: [reviewer("alice", 1)],
    syncIntervalOptions,
    onAddReviewer: vi.fn(async () => true),
    onCreateGroup: vi.fn(async () => true),
    onDeleteGroup: vi.fn(async () => undefined),
    onRemoveReviewer: vi.fn(async () => undefined),
    onSaveGroup: vi.fn(async () => true),
    ...overrides,
  };

  render(<SyncConfigurationPanel {...props} />);
  return props;
}

describe("SyncConfigurationPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("can add a reviewer and assign a reviewer to a group from the same screen", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.type(screen.getByPlaceholderText("letterboxd-handle"), "bob");
    await user.click(screen.getByRole("button", { name: "Add reviewer" }));

    expect(props.onAddReviewer).toHaveBeenCalledWith("bob");

    await user.selectOptions(screen.getByLabelText("Add reviewer to Favorites"), "alice");

    expect(props.onSaveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, name: "Favorites" }),
      expect.objectContaining({ reviewerHandles: ["alice"] }),
    );
  });

  it("can create a group with full settings and save configured filters on existing groups", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: "+ New group" }));
    await user.type(screen.getByPlaceholderText("Group name"), "Weekend picks");
    await user.selectOptions(screen.getAllByDisplayValue("Avg >= 4.0 stars")[0], "5");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(props.onCreateGroup).toHaveBeenCalledWith({
      name: "Weekend picks",
      enabled: true,
      ratingThreshold: 5,
      syncInterval: "1d",
      requiresManualApproval: false,
      filters: { year: { mode: "any" }, genres: { include: [], exclude: [] } },
      reviewerHandles: [],
    });

    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    expect(favorites).toBeTruthy();
    const scope = within(favorites as HTMLElement);

    await user.selectOptions(scope.getByLabelText("Release year filter"), "between");
    await user.type(scope.getByLabelText("Minimum year"), "1990");
    await user.type(scope.getByLabelText("Maximum year"), "2010");
    await user.click(scope.getByLabelText("Included genres"));
    await user.click(scope.getByLabelText("Horror"));
    await user.click(scope.getByRole("button", { name: "Done" }));
    await user.click(scope.getByLabelText("Excluded genres"));
    await user.click(scope.getByLabelText("Documentary"));
    await user.click(scope.getByRole("button", { name: "Done" }));
    await user.click(scope.getByRole("button", { name: "Save group" }));

    expect(props.onSaveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, name: "Favorites" }),
      expect.objectContaining({
        filters: {
          year: { mode: "between", minYear: 1990, maxYear: 2010 },
          genres: { include: ["Horror"], exclude: ["Documentary"] },
        },
      }),
    );
  });

  it("opens the new-group draft with documented defaults", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "+ New group" }));

    const draft = screen.getByLabelText("New group name").closest("article");
    expect(draft).toBeTruthy();
    const scope = within(draft as HTMLElement);

    expect(scope.getByLabelText("New group name")).toHaveValue("");
    expect(scope.getByLabelText("Enabled")).toBeChecked();
    expect(scope.getByDisplayValue("Avg >= 4.0 stars")).toBeInTheDocument();
    expect(scope.getByDisplayValue("Daily")).toBeInTheDocument();
    expect(scope.getByLabelText("Require approval")).not.toBeChecked();
    expect(scope.getByLabelText("Release year filter")).toHaveValue("any");
    expect(scope.getByLabelText("Included genres")).toHaveTextContent("Select included genres");
    expect(scope.getByLabelText("Excluded genres")).toHaveTextContent("Select excluded genres");
  });

  it("can create a group with a reviewer pre-assigned", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: "+ New group" }));
    await user.selectOptions(screen.getByLabelText("Add reviewer to new group"), "alice");
    await user.type(screen.getByPlaceholderText("Group name"), "Cinephiles");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(props.onCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Cinephiles", reviewerHandles: ["alice"] }),
    );
  });

  it("canceling the new-group draft discards it without calling onCreateGroup", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: "+ New group" }));
    await user.type(screen.getByPlaceholderText("Group name"), "Throwaway");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onCreateGroup).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New group name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New group" })).toBeInTheDocument();
  });

  it("shows reviewer pool without group badges", () => {
    renderPanel();

    expect(screen.queryByText("In All reviewers")).not.toBeInTheDocument();
    expect(screen.queryByText("Not syncing")).not.toBeInTheDocument();
  });

  it("saves the enabled toggle with group settings", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    await user.click(scope.getByLabelText("Enabled"));
    await user.click(scope.getByRole("button", { name: "Save group" }));

    expect(props.onSaveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, name: "Favorites" }),
      expect.objectContaining({ enabled: false }),
    );
  });

  it("changes visible year fields as the year mode changes", async () => {
    const user = userEvent.setup();
    renderPanel();

    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    expect(scope.queryByLabelText("Exact year")).not.toBeInTheDocument();

    await user.selectOptions(scope.getByLabelText("Release year filter"), "exact");
    expect(scope.getByLabelText("Exact year")).toBeInTheDocument();
    expect(scope.getByLabelText("Exact year")).toHaveValue(String(new Date().getFullYear()));

    await user.selectOptions(scope.getByLabelText("Release year filter"), "between");
    expect(scope.getByLabelText("Minimum year")).toBeInTheDocument();
    expect(scope.getByLabelText("Maximum year")).toBeInTheDocument();
  });

  it("shows validation errors for invalid year filters and does not save", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    await user.selectOptions(scope.getByLabelText("Release year filter"), "between");
    await user.type(scope.getByLabelText("Minimum year"), "2026");
    await user.type(scope.getByLabelText("Maximum year"), "2020");
    await user.click(scope.getByRole("button", { name: "Save group" }));

    expect(scope.getByText("Minimum year cannot be greater than maximum year.")).toBeInTheDocument();
    expect(props.onSaveGroup).not.toHaveBeenCalled();
  });

  it("can select and remove included and excluded genres from multi-select dropdowns", async () => {
    const user = userEvent.setup();
    renderPanel();
    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    await user.click(scope.getByLabelText("Included genres"));
    await user.click(scope.getByLabelText("Horror"));
    await user.click(scope.getByLabelText("Thriller"));
    await user.click(scope.getByRole("button", { name: "Done" }));
    expect(scope.getByText("Horror")).toBeInTheDocument();
    expect(scope.getByText("Thriller")).toBeInTheDocument();
    await user.click(scope.getByRole("button", { name: "Remove Horror from included genres" }));
    expect(scope.queryByText("Horror")).not.toBeInTheDocument();

    await user.click(scope.getByLabelText("Excluded genres"));
    await user.click(scope.getByLabelText("Documentary"));
    await user.click(scope.getByRole("button", { name: "Done" }));
    expect(scope.getByText("Documentary")).toBeInTheDocument();
    await user.click(scope.getByRole("button", { name: "Remove Documentary from excluded genres" }));
    expect(scope.queryByText("Documentary")).not.toBeInTheDocument();
  });

  it("loads groups without filters using default filter controls", () => {
    renderPanel({
      reviewerGroups: [
        group({ id: 2, name: "Favorites" }),
        {
          ...group({ id: 3, name: "Legacy empty" }),
          filters: undefined as unknown as SyncFilters,
        },
      ],
    });

    const legacy = screen.getByLabelText("Legacy empty group name").closest("article");
    expect(within(legacy as HTMLElement).getByLabelText("Release year filter")).toHaveValue("any");
  });

  it("disables Save when clean and indicates unsaved changes until reset", async () => {
    const user = userEvent.setup();
    renderPanel();
    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    const save = scope.getByRole("button", { name: "Save group" });
    expect(save).toBeDisabled();
    expect(scope.queryByText("Unsaved changes")).not.toBeInTheDocument();

    await user.type(scope.getByLabelText("Favorites group name"), " updated");
    expect(save).toBeEnabled();
    expect(scope.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(scope.getByRole("button", { name: "Reset" }));
    expect(save).toBeDisabled();
    expect(scope.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("offers a Disabled (no auto-sync) threshold option mapping to -1", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ ratingOptions: [-1, 1, 2.5, 3, 4, 5] });
    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    const thresholdSelect = scope.getByDisplayValue("Avg >= 4.0 stars");
    await user.selectOptions(thresholdSelect, "-1");
    expect(scope.getByDisplayValue("Disabled (no auto-sync)")).toBeInTheDocument();

    await user.click(scope.getByRole("button", { name: "Save group" }));
    expect(props.onSaveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, name: "Favorites" }),
      expect.objectContaining({ ratingThreshold: -1 }),
    );
  });

  it("renders thresholds below 3.0 from existing groups", () => {
    renderPanel({
      ratingOptions: [-1, 1, 1.5, 2, 2.5, 3, 4, 5],
      reviewerGroups: [group({ id: 2, name: "Favorites", ratingThreshold: 1.5 })],
    });

    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    expect(within(favorites as HTMLElement).getByDisplayValue("Avg >= 1.5 stars")).toBeInTheDocument();
  });

  it("explains that membership changes save immediately", () => {
    renderPanel();
    expect(screen.getByText("Membership changes save immediately.")).toBeInTheDocument();
  });

  it("shows group defaults as any year, four stars, and no genre filters", () => {
    renderPanel();

    const favorites = screen.getByLabelText("Favorites group name").closest("article");
    const scope = within(favorites as HTMLElement);

    expect(scope.getByLabelText("Release year filter")).toHaveValue("any");
    expect(scope.getByLabelText("Enabled")).toBeChecked();
    expect(scope.getByText("Genre filters require a movie metadata lookup during sync.")).toBeInTheDocument();
    expect(scope.getByDisplayValue("Avg >= 4.0 stars")).toBeInTheDocument();
    expect(scope.getByLabelText("Included genres")).toHaveTextContent("Select included genres");
    expect(scope.getByLabelText("Excluded genres")).toHaveTextContent("Select excluded genres");
  });
});
