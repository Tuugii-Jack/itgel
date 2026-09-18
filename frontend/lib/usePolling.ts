"use client";

import { useEffect, useRef } from "react";
import {
  POLL_MAX_DURATION_MS,
  createPoller,
  type PollStopReason,
} from "./poller";

/**
 * Төлбөр баталгаажсан эсэхийг refreshгүйгээр харуулна.
 * Таб нуугдсан үед дуудахгүй; буцаж идэвхжмэгц нэг удаа дуудна.
 * Идэвхтэй шалгалт maxDuration-оос хэтэрвэл зогсоно — гараар дахин оролдож болно.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean,
  options?: {
    restartKey?: string | number;
    maxDurationMs?: number;
    onStopped?: (reason: PollStopReason) => void;
  },
): void {
  const saved = useRef(callback);
  const onStopped = useRef(options?.onStopped);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    onStopped.current = options?.onStopped;
  }, [options?.onStopped]);

  const restartKey = options?.restartKey ?? "";
  const maxDurationMs = options?.maxDurationMs ?? POLL_MAX_DURATION_MS;

  useEffect(() => {
    if (!enabled) return;

    const poller = createPoller({
      intervalMs,
      maxDurationMs,
      run: () => saved.current(),
      isVisible: () => document.visibilityState === "visible",
      onStopped: (reason) => {
        if (reason === "disabled") return;
        onStopped.current?.(reason);
      },
    });
    poller.start();

    const onVis = () => poller.notifyVisibility();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      poller.stop("disabled");
    };
  }, [intervalMs, enabled, restartKey, maxDurationMs]);
}
