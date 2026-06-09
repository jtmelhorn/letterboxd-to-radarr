"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Calls `handler` when a pointer-down lands outside `ref` while `active` is
 * true. Listens on pointer-down (not click) so drags that start inside the
 * element never count as outside clicks.
 */
export function useClickAway(ref: RefObject<HTMLElement | null>, handler: () => void, active = true) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const container = ref.current;
      if (!container) return;
      const target = event.target;
      if (target instanceof Node && container.contains(target)) return;
      handlerRef.current();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [ref, active]);
}
