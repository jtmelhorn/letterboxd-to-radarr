// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalsPanel } from "@/app/components/ApprovalsPanel";
import type { PendingApprovalDto } from "@/app/types/movie";

function approval(
  input: Partial<PendingApprovalDto> & { id: number; title: string },
): PendingApprovalDto {
  return {
    id: input.id,
    groupId: input.groupId ?? 1,
    groupName: input.groupName ?? "Movie club",
    reviewId: input.reviewId ?? input.id,
    filmId: input.filmId ?? `film:${input.id}`,
    title: input.title,
    year: input.year ?? 2026,
    averageRating: input.averageRating ?? 4.5,
    status: input.status ?? "pending",
    message: input.message ?? "Waiting for manual approval.",
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof ApprovalsPanel>> = {}) {
  const props: ComponentProps<typeof ApprovalsPanel> = {
    approvals: [],
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onApprove: vi.fn(async () => null),
    onReject: vi.fn(async () => null),
    onRejectAndBlocklist: vi.fn(async () => null),
    onReset: vi.fn(async () => null),
    ...overrides,
  };
  render(<ApprovalsPanel {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("ApprovalsPanel", () => {
  it("renders pending rows with actions and resolved rows greyed below", () => {
    renderPanel({
      approvals: [
        approval({ id: 1, title: "Pending Movie" }),
        approval({ id: 2, title: "Approved Movie", status: "approved", message: "Movie added to Radarr." }),
        approval({ id: 3, title: "Rejected Movie", status: "rejected", message: "Rejected by user." }),
      ],
    });

    expect(screen.getByText("Pending Movie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject + blocklist" })).toBeInTheDocument();

    expect(screen.getByText("Recently resolved")).toBeInTheDocument();
    expect(screen.getByText("Approved Movie")).toBeInTheDocument();
    expect(screen.getByText("Movie added to Radarr.")).toBeInTheDocument();
    expect(screen.getByText("Rejected Movie")).toBeInTheDocument();
    // Reset is offered for rejected rows only (approved rows have no actions).
    expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(1);
  });

  it("fires approve and reject callbacks for the right approval", async () => {
    const user = userEvent.setup();
    const target = approval({ id: 7, title: "Decide Me" });
    const props = renderPanel({ approvals: [target] });

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(props.onApprove).toHaveBeenCalledTimes(1));
    expect(props.onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(props.onReject).toHaveBeenCalledTimes(1));
    expect(props.onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it("shows a returned error inline on the row", async () => {
    const user = userEvent.setup();
    renderPanel({
      approvals: [approval({ id: 9, title: "Blocked Film" })],
      onApprove: vi.fn(async () => "Movie is blocklisted."),
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Movie is blocklisted.");
    // The row stays actionable for retry or reject.
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("filters rows by search and closes via the close button", async () => {
    const user = userEvent.setup();
    const props = renderPanel({
      approvals: [
        approval({ id: 1, title: "Alpha Adventure" }),
        approval({ id: 2, title: "Beta Drama" }),
      ],
    });

    await user.type(screen.getByLabelText("Search approvals"), "alpha");
    expect(screen.getByText("Alpha Adventure")).toBeInTheDocument();
    expect(screen.queryByText("Beta Drama")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close approval queue" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
