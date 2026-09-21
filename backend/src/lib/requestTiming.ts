import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

type TimingStore = {
  qpayMs: number;
  qpayCalls: number;
  /** liveAdmin wall. Доторх query нь db нийлбэрт давхар орно. */
  authMs: number;
  /** Prisma query event-ийн нийлбэр. Зэрэгцээ query дээр app-аас их байж болно. */
  dbMs: number;
  dbMaxMs: number;
  dbCount: number;
};

const als = new AsyncLocalStorage<TimingStore>();

function addMs(ms: number, apply: (store: TimingStore, rounded: number) => void): void {
  const store = als.getStore();
  if (!store || !Number.isFinite(ms) || ms < 0) return;
  apply(store, ms);
}

export function addQpayDuration(ms: number): void {
  addMs(ms, (store, value) => {
    store.qpayMs += value;
    store.qpayCalls += 1;
  });
}

export function addAuthDuration(ms: number): void {
  addMs(ms, (store, value) => {
    store.authMs += value;
  });
}

/** SQL текст лог хийхгүй. duration нь engine-ийн query хугацаа. */
export function addDbQuery(durationMs: number): void {
  addMs(durationMs, (store, value) => {
    store.dbMs += value;
    store.dbCount += 1;
    if (value > store.dbMaxMs) store.dbMaxMs = value;
  });
}

/** Зам дээрх id-г лог/Server-Timing-д бичихгүй. */
export function safeHttpPath(path: string): string {
  return path.replace(/[A-Za-z0-9_-]{16,}/g, ':id');
}

export function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  const store: TimingStore = {
    qpayMs: 0,
    qpayCalls: 0,
    authMs: 0,
    dbMs: 0,
    dbMaxMs: 0,
    dbCount: 0,
  };
  als.run(store, () => {
    const serverTimingValue = (total: number): string => {
      const qpay = Math.round(store.qpayMs);
      const auth = Math.round(store.authMs);
      const db = Math.round(store.dbMs);
      const dbMax = Math.round(store.dbMaxMs);
      const parts = [
        `app;dur=${total}`,
        `auth;dur=${auth}`,
        `db;dur=${db};desc="n=${store.dbCount},max=${dbMax}"`,
        `dbmax;dur=${dbMax}`,
      ];
      if (qpay > 0) {
        parts.push(`internal;dur=${Math.max(0, total - qpay)}`);
        parts.push(`qpay;dur=${qpay}`);
      }
      return parts.join(', ');
    };
    const applyServerTiming = (): number => {
      const total = Date.now() - started;
      const value = serverTimingValue(total);
      if (!res.headersSent) {
        res.setHeader('Server-Timing', value);
      }
      return total;
    };
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      const total = Date.now() - started;
      const value = serverTimingValue(total);
      if (!res.headersSent) {
        res.setHeader('Server-Timing', value);
      }
      for (const arg of args) {
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) continue;
        (arg as Record<string, string>)['Server-Timing'] = value;
      }
      return originalWriteHead(...args);
    }) as Response['writeHead'];
    const originalEnd = res.end.bind(res);
    res.end = ((...args: Parameters<Response['end']>) => {
      const total = applyServerTiming();
      if (req.method !== 'OPTIONS' && (req.path === '/health' || req.path.startsWith('/api'))) {
        const qpay =
          store.qpayMs > 0
            ? ` qpay=${Math.round(store.qpayMs)}ms/${store.qpayCalls}`
            : '';
        console.info(
          `[http] ${req.method} ${safeHttpPath(req.path)} ${total}ms auth=${Math.round(store.authMs)}ms db=${Math.round(store.dbMs)}ms/${store.dbCount} max=${Math.round(store.dbMaxMs)}ms${qpay}`,
        );
      }
      return originalEnd(...args);
    }) as Response['end'];
    next();
  });
}
