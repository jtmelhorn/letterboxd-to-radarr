// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClickAway } from "@/app/hooks/useClickAway";

function Harness({ active, onAway }: { active: boolean; onAway: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, onAway, active);
  return (
    <div>
      <button type="button">outside</button>
      <div ref={ref}>
        <button type="button">inside</button>
      </div>
    </div>
  );
}

describe("useClickAway", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls the handler on pointer-down outside the element", () => {
    const onAway = vi.fn();
    render(<Harness active onAway={onAway} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));

    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it("does not call the handler on pointer-down inside the element", () => {
    const onAway = vi.fn();
    render(<Harness active onAway={onAway} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "inside" }));

    expect(onAway).not.toHaveBeenCalled();
  });

  it("does nothing while inactive", () => {
    const onAway = vi.fn();
    render(<Harness active={false} onAway={onAway} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));

    expect(onAway).not.toHaveBeenCalled();
  });
});
