// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useFocusTrap } from "@/app/hooks/useFocusTrap";

function Harness({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  return (
    <div>
      <button type="button">opener</button>
      {open && (
        <div ref={ref} role="dialog">
          <button type="button">first</button>
          <button type="button">middle</button>
          <button type="button">last</button>
        </div>
      )}
    </div>
  );
}

describe("useFocusTrap", () => {
  afterEach(cleanup);

  it("focuses the first focusable element when activated", () => {
    const { rerender } = render(<Harness open={false} />);
    screen.getByRole("button", { name: "opener" }).focus();

    rerender(<Harness open />);

    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("wraps Tab from the last element to the first", () => {
    render(<Harness open />);
    const last = screen.getByRole("button", { name: "last" });
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });

    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    render(<Harness open />);
    const first = screen.getByRole("button", { name: "first" });
    first.focus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(screen.getByRole("button", { name: "last" })).toHaveFocus();
  });

  it("restores focus to the previously focused element on deactivation", () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    rerender(<Harness open />);
    expect(opener).not.toHaveFocus();

    rerender(<Harness open={false} />);
    expect(opener).toHaveFocus();
  });
});
