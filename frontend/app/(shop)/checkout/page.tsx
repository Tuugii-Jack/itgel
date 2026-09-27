"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PayMethodChoice } from "@/components/PayMethodChoice";
import { PhoneAuthForm } from "@/components/PhoneAuthForm";
import { Button, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart, type CartLine } from "@/lib/cart";
import {
  checkoutIdempotencyKey,
  rotateCheckoutIdempotencyKey,
} from "@/lib/checkoutIdempotency";
import { patchCheckoutDraft, readCheckoutDraft } from "@/lib/checkoutDraft";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import type { MyOrder, Store } from "@/lib/types";

/**
 * Сагсны дараах алхам — нийт дүн, QPay эсвэл лизинг дээр нэг даралт.
 * Лизингийн нөхцөл/хуваарь төлбөрийн дэлгэц дээр, лизинг сонгосны дараа. Төлбөр энд төлөгдөхгүй.
 */
export default function CheckoutPage() {
  const cart = useCart();
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const inFlight = useRef(false);

  const [store, setStore] = useState<Store | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [, setDraftTick] = useState(0);

  const draft = session.me ? readCheckoutDraft(session.me.id) : null;
  const pendingCode = draft?.pendingOrderCode ?? "";

  useEffect(() => {
    api
      .store()
      .then(setStore)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!cart.ready || session.loading || busy) return;
    if (cart.lines.length > 0) return;
    const pending = session.me ? readCheckoutDraft(session.me.id).pendingOrderCode : "";
    if (pending) return;
    router.replace("/cart");
  }, [cart.ready, cart.lines.length, session.loading, session.me, router, busy]);

  const shopLines = cart.lines.filter((l) => l.ownerKind !== "LEASING");
  const leasingLines = cart.lines.filter((l) => l.ownerKind === "LEASING");
  const mixedOwners = shopLines.length > 0 && leasingLines.length > 0;
  const shopSubtotal = shopLines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const leasingSubtotal = leasingLines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const canChooseLeasing = shopLines.length > 0;
  const orderTotal = cart.lines
    .filter((l) => l.type === "order")
    .reduce((sum, l) => sum + l.price * l.qty, 0);
  const readyTotal = cart.subtotal - orderTotal;

  const persist = (patch: Parameters<typeof patchCheckoutDraft>[1]) => {
    if (!session.me) return;
    patchCheckoutDraft(session.me.id, patch);
    setDraftTick((n) => n + 1);
  };

  const goToPayment = (code: string, extra: string[]) => {
    router.push(extra.length ? `/success/${code}?also=${extra.join(",")}` : `/success/${code}`);
  };

  const placeOrder = async (wantLeasing: boolean) => {
    if (inFlight.current || busy) return;
    if (!session.me) {
      toast.error("Эхлээд нэвтэрнэ үү.");
      router.replace("/cart");
      return;
    }
    if (cart.lines.length === 0) {
      setFieldError("Сагс");
      setError("Сагсанд бараа алга.");
      return;
    }
    const leasing = canChooseLeasing && wantLeasing;
    const payMethod = leasing ? "leasing" : "qpay";
    persist({ payMethod, step: "choose" });
    setError(null);
    setFieldError(null);
    inFlight.current = true;
    setBusy(true);
    try {
      const current = readCheckoutDraft(session.me.id);
      if (current.pendingOrderCode) {
        await api.setOrderPayMethod(current.pendingOrderCode, { leasing });
        persist({ payMethod, step: "choose" });
        goToPayment(current.pendingOrderCode, current.pendingAlso.filter(Boolean));
        return;
      }

      const idempotencyKey = checkoutIdempotencyKey();
      const body = {
        note: current.note.trim() || undefined,
        leasing,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          selections: line.selections ?? undefined,
          size: line.size ?? undefined,
          color: line.color ?? undefined,
        })),
      };
      const order = await api.createOrder(body, { idempotencyKey });
      const extra = (order.splitOrders ?? []).map((row) => row.code).filter(Boolean);
      persist({
        payMethod,
        step: "choose",
        pendingOrderCode: order.code,
        pendingAlso: extra,
      });
      goToPayment(order.code, extra);
    } catch (e) {
      const reused =
        e instanceof ApiError &&
        e.status === 409 &&
        Boolean(
          e.details &&
            typeof e.details === "object" &&
            "code" in e.details &&
            e.details.code === "IDEMPOTENCY_KEY_REUSED",
        );
      if (reused && session.me) {
        const recovered = await recoverPendingOrder(cart.lines, leasing, persist);
        if (recovered) {
          goToPayment(recovered.code, recovered.extra);
          return;
        }
        rotateCheckoutIdempotencyKey();
      }
      const option = fieldOptionOf(e);
      const message =
        e instanceof ApiError ? e.message : "Захиалга үүсгэж чадсангүй.";
      setFieldError(option);
      setError(message);
      toast.error(message);
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!cart.ready || session.loading || (cart.lines.length === 0 && !busy && !pendingCode)) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (!session.me) {
    return (
      <div className="screen flex flex-col pb-12">
        <div className="px-4 pt-6 lg:mx-auto lg:w-full lg:max-w-[420px] lg:px-0 lg:pt-10">
          <Link href="/cart" className="text-[13px] text-ink-2 no-underline">
            ← Сагс руу буцах
          </Link>
          <div className="mt-6">
            <PhoneAuthForm />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen flex flex-col pb-12">
      <div className="px-4 pt-6 lg:mx-auto lg:w-full lg:max-w-[420px] lg:px-0 lg:pt-10">
        <Link href="/cart" className="text-[13px] text-ink-2 no-underline">
          ← Сагс руу буцах
        </Link>
        <div className="mt-3 text-[20px] font-medium lg:text-[24px]">Төлбөрийн хэлбэр</div>

        <div className="mt-6 rounded-[12px] border border-line p-4 lg:p-6">
          <div className="tnum flex flex-col gap-2.5 text-[14px]">
            {orderTotal > 0 && readyTotal > 0 && (
              <>
                <SumRow label="Захиалгын бараа" value={money(orderTotal)} />
                <SumRow label="Бэлэн бараа" value={money(readyTotal)} />
                <div className="h-px bg-line" />
              </>
            )}
            {mixedOwners && (
              <>
                <SumRow label="Дэлгүүрийн бараа" value={money(shopSubtotal)} />
                <SumRow label="Лизингийн бэлэн бараа" value={money(leasingSubtotal)} />
                <p className="m-0 text-[13px] font-normal leading-[1.5] text-ink-2">
                  Төлбөрийг эзэмшигч бүрээр тусдаа захиалгаар төлнө. Лизингийн барааны мөнгө тухайн эзний дансанд орно.
                </p>
                <div className="h-px bg-line" />
              </>
            )}
            {!mixedOwners && leasingLines.length > 0 && (
              <p className="m-0 text-[13px] font-normal leading-[1.5] text-ink-2">
                Эзэмшигч бүрээр тусдаа захиалга болно. Төлбөр тухайн эзний дансанд орно.
              </p>
            )}
            <div className="flex justify-between gap-3 text-[17px] font-medium lg:text-[20px]">
              <span>Нийт</span>
              <span>{money(cart.subtotal)}</span>
            </div>
          </div>

          {canChooseLeasing ? (
            <div className="mt-4">
              <PayMethodChoice
                leasing={null}
                loading={busy}
                onChange={(nextLeasing) => void placeOrder(nextLeasing)}
                subtotal={shopSubtotal}
                feeTiers={store?.leasing?.feeTiers}
                choiceHint={store?.leasing?.choiceHint}
              />
            </div>
          ) : (
            <div className="mt-5">
              <Button full size="bar" loading={busy} onClick={() => void placeOrder(false)}>
                QPay-ээр төлөх
              </Button>
            </div>
          )}

          {fieldError && (
            <p className="mt-3 mb-0 text-[13px] leading-[1.5] text-danger">
              {fieldError}
            </p>
          )}
          {error && (
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function fieldOptionOf(e: unknown): string | null {
  if (!(e instanceof ApiError) || !e.details || typeof e.details !== "object") return null;
  if (!("option" in e.details)) return null;
  const option = e.details.option;
  return typeof option === "string" && option.trim() ? `${option} дутуу байна.` : null;
}

function cartFingerprint(lines: CartLine[]): string {
  return lines
    .map((line) => `${line.productId}:${line.qty}:${JSON.stringify(line.selections ?? {})}`)
    .sort()
    .join("|");
}

function orderFingerprint(order: MyOrder): string {
  return (order.items ?? [])
    .filter((item) => !item.cancelled)
    .map((item) => `${item.roundId ?? item.productId}:${item.qty}:${JSON.stringify(item.selections ?? {})}`)
    .sort()
    .join("|");
}

async function recoverPendingOrder(
  lines: CartLine[],
  leasing: boolean,
  persist: (patch: Parameters<typeof patchCheckoutDraft>[1]) => void,
): Promise<{ code: string; extra: string[] } | null> {
  try {
    const listed = await api.myOrders();
    const rows = Array.isArray(listed.data) ? listed.data : [];
    const wanted = cartFingerprint(lines);
    const match = rows.find(
      (row) =>
        row.status === "NEW" &&
        row.paidAmount - (row.refundedAmount ?? 0) <= 0 &&
        orderFingerprint(row) === wanted,
    );
    if (!match) return null;
    await api.setOrderPayMethod(match.code, { leasing });
    persist({
      payMethod: leasing ? "leasing" : "qpay",
      step: "choose",
      pendingOrderCode: match.code,
      pendingAlso: [],
    });
    return { code: match.code, extra: [] };
  } catch {
    return null;
  }
}
