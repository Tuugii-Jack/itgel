"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PayMethodChoice } from "@/components/PayMethodChoice";
import { Button, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { clearCheckoutDraft, readCheckoutDraft } from "@/lib/checkoutDraft";
import { money } from "@/lib/format";
import { leasingFeeOf } from "@/lib/leasing";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import type { Store } from "@/lib/types";

/**
 * Сагсны дараах алхам — нийт дүн, төлбөрийн хэлбэр.
 * Лизингт шимтгэл төлөгдсөний дараа захиалга үүснэ.
 */
export default function CheckoutPage() {
  const cart = useCart();
  const session = useSession();
  const router = useRouter();
  const toast = useToast();

  const [leasing, setLeasing] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .store()
      .then(setStore)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!cart.ready || session.loading || busy) return;
    if (cart.lines.length === 0) {
      router.replace("/cart");
      return;
    }
    if (!session.me) router.replace("/cart");
  }, [cart.ready, cart.lines.length, session.loading, session.me, router, busy]);

  const placeOrder = async () => {
    if (!session.me) {
      toast.error("Эхлээд нэвтэрнэ үү.");
      router.replace("/cart");
      return;
    }
    const draft = readCheckoutDraft();
    const name = draft.name.trim() || session.me.name?.trim() || "";
    const phone = draft.phone.trim() || session.me.phone || "";
    setError(null);
    setBusy(true);
    try {
      if (phone !== (session.me.phone ?? "") || name !== (session.me.name ?? "")) {
        await api.updateMe({
          name: name || null,
          phone: phone || null,
        });
        await session.refresh();
      }
      const order = await api.createOrder({
        name: name || undefined,
        note: draft.note.trim() || undefined,
        leasing,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          selections: line.selections ?? undefined,
          size: line.size ?? undefined,
          color: line.color ?? undefined,
        })),
      });
      cart.clear();
      clearCheckoutDraft();
      if (!leasing) toast.success("Захиалга үүслээ.");
      router.push(`/success/${order.code}`);
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : "Захиалга үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  if (!cart.ready || session.loading || !session.me || (cart.lines.length === 0 && !busy)) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const orderTotal = cart.lines
    .filter((l) => l.type === "order")
    .reduce((sum, l) => sum + l.price * l.qty, 0);
  const readyTotal = cart.subtotal - orderTotal;
  const fee = leasing ? leasingFeeOf(cart.subtotal, store?.leasing?.feeTiers) : 0;

  return (
    <div className="screen flex flex-col pb-28 lg:pb-12">
      <div className="px-4 pt-6 lg:mx-auto lg:w-full lg:max-w-[420px] lg:px-0 lg:pt-10">
        <Link href="/cart" className="text-[13px] text-ink-2 no-underline">
          ← Сагс руу буцах
        </Link>
        <div className="mt-3 text-[20px] font-medium lg:text-[24px]">Төлбөр</div>

        <div className="mt-6 rounded-[12px] border border-line p-4 lg:p-6">
          <div className="tnum flex flex-col gap-2.5 text-[14px]">
            {orderTotal > 0 && readyTotal > 0 && (
              <>
                <SumRow label="Захиалгын бараа" value={money(orderTotal)} />
                <SumRow label="Бэлэн бараа" value={money(readyTotal)} />
                <div className="h-px bg-line" />
              </>
            )}
            <div className="flex justify-between gap-3 text-[17px] font-medium lg:text-[20px]">
              <span>Нийт</span>
              <span>{money(cart.subtotal)}</span>
            </div>
            {leasing && fee > 0 && (
              <p className="m-0 text-[13px] font-normal leading-[1.5] text-ink-2">
                Эхлээд шимтгэл {money(fee)}. Төлсний дараа захиалга үүснэ.
              </p>
            )}
          </div>

          <div className="mt-4">
            <PayMethodChoice
              compact
              leasing={leasing}
              onChange={setLeasing}
              subtotal={cart.subtotal}
              feeTiers={store?.leasing?.feeTiers}
              choiceHint={store?.leasing?.choiceHint}
            />
          </div>

          {error && (
            <div className="mt-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          <div className="mt-5 hidden lg:block">
            <Button full size="bar" onClick={() => void placeOrder()} loading={busy}>
              {leasing ? "Шимтгэл төлнө" : "Захиалах"}
            </Button>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-line bg-bg px-4 py-3 lg:hidden">
        <Button full size="bar" onClick={() => void placeOrder()} loading={busy}>
          {leasing ? "Шимтгэл төлнө" : "Захиалах"}
        </Button>
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
