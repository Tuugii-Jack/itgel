"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EmailAuthForm } from "@/components/EmailAuthForm";
import { Badge, Card, Skeleton, Spinner, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { dayLabel, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { MyOrder, OrderStatus, PublicOrder, Store } from "@/lib/types";

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: "neutral",
  CONFIRMED: "info",
  IN_BATCH: "info",
  IN_TRANSIT: "info",
  ARRIVED: "ok",
  HANDED_OVER: "ok",
  CANCELLED: "danger",
};

const orderCache = new Map<string, PublicOrder>();
const inflight = new Map<string, Promise<PublicOrder>>();

export function peekTrackedOrder(code: string): PublicOrder | null {
  return orderCache.get(code.trim().toUpperCase()) ?? null;
}

export function fetchTrackedOrder(code: string): Promise<PublicOrder> {
  const key = code.trim().toUpperCase();
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = api
    .order(key)
    .then((order) => {
      orderCache.set(order.code, order);
      inflight.delete(key);
      return order;
    })
    .catch((error) => {
      inflight.delete(key);
      orderCache.delete(key);
      throw error;
    });
  inflight.set(key, request);
  return request;
}

export function prefetchTrackedOrder(code: string): void {
  const key = code.trim().toUpperCase();
  if (orderCache.has(key) || inflight.has(key)) return;
  void fetchTrackedOrder(key).catch(() => undefined);
}

type TrackShell = {
  store: Store | null;
  myOrders: MyOrder[];
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
};

const Ctx = createContext<TrackShell | null>(null);

export function useTrackShell(): TrackShell {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTrackShell нь TrackShellProvider дотор байх ёстой.");
  return ctx;
}

export function TrackShellProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [store, setStore] = useState<Store | null>(null);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [chromeHidden, setChromeHidden] = useState(false);
  const cacheOwner = useRef(session.me?.id ?? "");
  const sessionKey = session.me?.id ?? "";
  if (cacheOwner.current !== sessionKey) {
    cacheOwner.current = sessionKey;
    orderCache.clear();
    inflight.clear();
  }

  useEffect(() => {
    let alive = true;
    api
      .store()
      .then((value) => alive && setStore(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session.me) {
      setMyOrders([]);
      return;
    }
    let alive = true;
    api
      .myOrders()
      .then((result) => alive && setMyOrders(result.data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session.me]);

  const value = useMemo<TrackShell>(
    () => ({ store, myOrders, chromeHidden, setChromeHidden }),
    [store, myOrders, chromeHidden],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Чип/жагсаалт layout дээр үлдэнэ — код солиход бүтэн хуудас арилгахгүй.
 * Хоёр баганат laptop layout-ийг зөвхөн 2+ захиалгатай үед асаана.
 */
export function TrackChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const code = pathname.match(/^\/t\/([^/]+)$/)?.[1]?.toUpperCase();
  const { myOrders, chromeHidden } = useTrackShell();
  const session = useSession();

  if (session.loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (!session.me) {
    return (
      <div className="screen">
        <div className="px-4 pt-6 lg:mx-auto lg:max-w-[420px] lg:px-0 lg:pt-10">
          <div className="mb-4 text-[20px] font-medium lg:text-[24px]">Захиалга хянах</div>
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <p className="m-0 text-[13px] text-ink-2">
              Нэвтэрсний дараа зөвхөн өөрийн захиалгыг харна.
            </p>
            <EmailAuthForm />
          </Card>
        </div>
      </div>
    );
  }

  if (!code) return children;

  const multi = myOrders.length >= 2;

  return (
    <div className="screen max-w-full overflow-x-hidden pb-8">
      <div className={chromeHidden ? "hidden" : "hidden px-10 pt-8 lg:block"}>
        <div className="text-[24px] font-medium">Захиалга хянах</div>
      </div>

      <div
        className={`min-w-0 lg:items-start lg:px-10 lg:pt-6 ${
          multi && !chromeHidden ? "lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-8" : ""
        }`}
      >
        {multi ? (
          <div className={chromeHidden ? "hidden" : "contents"}>
            <OrderList orders={myOrders} current={code} />
          </div>
        ) : null}
        <div className="min-w-0 max-w-full overflow-x-hidden lg:flex lg:flex-col lg:gap-6">
          {multi ? (
            <div className={chromeHidden ? "hidden" : "contents"}>
              <OrderChips orders={myOrders} current={code} />
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

export function TrackDetailSkeleton() {
  return (
    <div className="px-4 pt-5 lg:px-0 lg:pt-0">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-28" />
      <div className="mt-6 grid grid-cols-3 gap-2">
        <Skeleton className="h-1 w-full rounded-full" />
        <Skeleton className="h-1 w-full rounded-full" />
        <Skeleton className="h-1 w-full rounded-full" />
      </div>
      <Skeleton className="mt-5 h-28 w-full rounded-[12px]" />
      <Skeleton className="mt-6 h-40 w-full rounded-[12px]" />
    </div>
  );
}

function OrderList({ orders, current }: { orders: MyOrder[]; current: string }) {
  return (
    <div className="hidden lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-2.5">
      {orders.map((order) => {
        const active = order.code === current;
        return (
          <Link
            key={order.code}
            href={`/t/${order.code}`}
            scroll={false}
            prefetch
            onMouseEnter={() => prefetchTrackedOrder(order.code)}
            onFocus={() => prefetchTrackedOrder(order.code)}
            onTouchStart={() => prefetchTrackedOrder(order.code)}
            className={`flex flex-col gap-2 rounded-[12px] border p-4 no-underline ${
              active ? "border-ink bg-surface" : "border-line bg-bg hover:bg-surface"
            }`}
          >
            <span className="flex w-full items-start justify-between gap-3">
              <span className="tnum text-[15px]">{order.code}</span>
              <Badge tone={STATUS_TONE[order.status]}>{order.statusLabel}</Badge>
            </span>
            <span className="flex w-full items-center justify-between gap-3 text-[13px] text-muted">
              <span className="tnum">{dayLabel(order.createdAt)}</span>
              <span className="tnum">{money(order.subtotal)}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function OrderChips({ orders, current }: { orders: MyOrder[]; current: string }) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto px-4 pt-3 lg:hidden">
      <div className="no-scrollbar flex w-max max-w-none gap-2">
        {orders.map((order) => {
          const active = order.code === current;
          return (
            <Link
              key={order.code}
              href={`/t/${order.code}`}
              scroll={false}
              prefetch
              onMouseEnter={() => prefetchTrackedOrder(order.code)}
              onFocus={() => prefetchTrackedOrder(order.code)}
              onTouchStart={() => prefetchTrackedOrder(order.code)}
              className={`tnum flex h-9 shrink-0 items-center rounded-[8px] border px-3 text-[13px] whitespace-nowrap no-underline ${
                active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
              }`}
            >
              {order.code}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
