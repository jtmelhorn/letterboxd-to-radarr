"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Traps keyboard focus inside `ref` while `active` is true: focuses the first
 * focusable element on activation, wraps Tab/Shift+Tab at the edges, and
 * restores focus to the previously focused element on deactivation.
 *
 * The keydown listener is attached to the container itself, so when a second
 * overlay opens above this one (a sibling in the DOM), only the topmost
 * layer's trap sees key events.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = focusableElements(container)[0] ?? container;
    initial.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !container) return;
      const items = focusableElements(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const insideTrap = current instanceof HTMLElement && container.contains(current);
      if (event.shiftKey) {
        if (!insideTrap || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!insideTrap || current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [ref, active]);
}
