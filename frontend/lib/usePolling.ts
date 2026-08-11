"use client";

import { useEffect, useRef } from "react";

/**
 * Тодорхой давтамжтайгаар callback дуудна — төлбөр баталгаажсан эсэхийг
 * хэрэглэгч refresh дарахгүйгээр харуулахад ашиглана.
 *
 * Таб нуугдсан үед дуудахгүй; буцаж идэвхжмэгц шууд нэг удаа дуудна.
 */
export function usePolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
): void {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === "visible") saved.current();
    };

    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, enabled]);
}
