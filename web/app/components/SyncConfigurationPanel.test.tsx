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
    autoThreshold: input.autoThreshold ?? 4,
    ratingThreshold: input.ratingThreshold ?? input.autoThreshold ?? 4,
    syncInterval: input.syncInterval ?? "1d",
    requiresManualApproval: input.requiresManualApproval ?? false,
    filters: input.filters ?? emptyFilters,
    reviewerHandles: input.reviewerHandles ?? [],
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof SyncConfigurationPanel>> = {}) {
  const props = {
    genreOptions: ["Action", "Documentary", "Horror", "Thriller"],
    pendingApprovalCount: 0,
    ratingOptions: [3, 4, 5],
    reviewerGroups: [
      group({ id: 1, name: "All reviewers", reviewerHandles: ["alice"] }),
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

  it("can create a group and save configured filters", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.type(screen.getByPlaceholderText("Group name"), "Weekend picks");
    await user.selectOptions(screen.getAllByDisplayValue("Avg >= 4.0 stars")[0], "5");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(props.onCreateGroup).toHaveBeenCalledWith({ name: "Weekend picks", ratingThreshold: 5 });

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
        group({ id: 1, name: "All reviewers" }),
        {
          ...group({ id: 3, name: "Legacy empty" }),
          filters: undefined as unknown as SyncFilters,
        },
      ],
    });

    const legacy = screen.getByLabelText("Legacy empty group name").closest("article");
    expect(within(legacy as HTMLElement).getByLabelText("Release year filter")).toHaveValue("any");
  });

  it("shows the All reviewers defaults as any year, four stars, and no genre filters", () => {
    renderPanel();

    const allReviewers = screen.getByLabelText("All reviewers group name").closest("article");
    const scope = within(allReviewers as HTMLElement);

    expect(scope.getByLabelText("Release year filter")).toHaveValue("any");
    expect(scope.getByDisplayValue("Avg >= 4.0 stars")).toBeInTheDocument();
    expect(scope.getByLabelText("Included genres")).toHaveTextContent("Select included genres");
    expect(scope.getByLabelText("Excluded genres")).toHaveTextContent("Select excluded genres");
  });
});
