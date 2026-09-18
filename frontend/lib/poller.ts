/** Төлбөр хүлээгдэж байхад автомат шалгалтын дээд хугацаа. */
export const POLL_MAX_DURATION_MS = 10 * 60 * 1000;
/** Алдааны үед интервал хэд хүртэл өсөх. */
export const POLL_MAX_INTERVAL_MS = 60_000;

export type PollStopReason = "disabled" | "max_duration";

export interface PollerOptions {
  intervalMs: number;
  maxDurationMs?: number;
  maxIntervalMs?: number;
  run: () => void | Promise<void>;
  now?: () => number;
  isVisible?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  onStopped?: (reason: PollStopReason) => void;
}

/**
 * Интервал + visibility. Давхар tick алгасна, алдаагаар backoff хийнэ,
 * maxDuration-оос хойш зогсоно. Эхлэхэд шууд дуудахгүй — эхний ачааллыг
 * хуудас өөрөө хийнэ.
 */
export function createPoller(options: PollerOptions) {
  const intervalMs = options.intervalMs;
  const maxDurationMs = options.maxDurationMs ?? POLL_MAX_DURATION_MS;
  const maxIntervalMs = options.maxIntervalMs ?? POLL_MAX_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const isVisible = options.isVisible ?? (() => true);
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let startedAt = 0;
  let delay = intervalMs;
  let timer: unknown = null;
  let inFlight = false;
  let stopped: PollStopReason | null = "disabled";

  function clear() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function stop(reason: PollStopReason) {
    if (stopped === reason && timer == null && !inFlight) return;
    stopped = reason;
    clear();
    options.onStopped?.(reason);
  }

  function schedule() {
    if (stopped) return;
    clear();
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, delay);
  }

  async function tick(): Promise<void> {
    clear();
    if (stopped) return;
    if (now() - startedAt >= maxDurationMs) {
      stop("max_duration");
      return;
    }
    if (!isVisible()) {
      schedule();
      return;
    }
    if (inFlight) {
      schedule();
      return;
    }
    inFlight = true;
    try {
      await options.run();
      delay = intervalMs;
    } catch {
      delay = Math.min(Math.max(delay * 2, intervalMs * 2), maxIntervalMs);
    } finally {
      inFlight = false;
    }
    if (!stopped) schedule();
  }

  return {
    start() {
      stopped = null;
      startedAt = now();
      delay = intervalMs;
      inFlight = false;
      schedule();
    },
    stop,
    /** Таб буцаж харагдахад нэг удаа шалгана — нуугдсан үед алгасна. */
    notifyVisibility() {
      if (stopped) return;
      if (!isVisible()) return;
      void tick();
    },
    getDelay() {
      return delay;
    },
    isStopped() {
      return stopped;
    },
  };
}
