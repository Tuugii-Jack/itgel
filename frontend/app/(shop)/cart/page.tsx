"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Divider, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart, type CartLine } from "@/lib/cart";
import { useSession } from "@/lib/session";
import { money, rangeLabel, relativeDay } from "@/lib/format";
import type { Store } from "@/lib/types";

type Step = "phone" | "code" | "verified";

export default function CartPage() {
  const cart = useCart();
  const session = useSession();
  const router = useRouter();

  const [store, setStore] = useState<Store | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("phone");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.store().then(setStore).catch(() => undefined);
  }, []);

  // Аль хэдийн нэвтэрсэн бол утсыг нь ашиглана.
  useEffect(() => {
    if (session.me) {
      setPhone(session.me.phone);
      setStep("verified");
    }
  }, [session.me]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const groups = useMemo(() => groupLines(cart.lines), [cart.lines]);
  const deposit = store?.depositPercent ?? 100;
  const payNow = Math.floor((cart.subtotal * deposit) / 100);
  const due = cart.subtotal - payNow;

  if (!cart.ready) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div>
        <Header title="Сагс" />
        <Empty>Сагс хоосон байна.</Empty>
        <div className="px-4">
          <Link href="/" className="no-underline">
            <Button full variant="outline">
              Бараа үзэх
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.sendOtp(phone);
      setDevCode(result.devCode ?? null);
      setCooldown(result.resendAfterSec);
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Код илгээж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.verifyOtp(phone, code);
      await session.signIn(result.token);
      setStep("verified");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Код шалгаж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const placeOrder = async () => {
    setError(null);
    setBusy(true);
    try {
      const order = await api.createOrder({
        phone,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          size: line.size ?? undefined,
          color: line.color ?? undefined,
        })),
      });
      cart.clear();
      router.push(`/success/${order.code}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Захиалга үүсгэж чадсангүй.");
      setBusy(false);
    }
  };

  return (
    <div className="screen pb-28">
      <Header title="Сагс ба захиалга" />

      {/* Блок 1 — сагсны бараанууд, төрлөөр бүлэглэсэн */}
      <div className="flex flex-col gap-6 px-4 pt-4">
        {groups.map((group) => (
          <section key={group.key}>
            <div className="mb-2 text-[13px] text-ink-2">{group.label}</div>
            <Card className="divide-y divide-line">
              {group.lines.map(({ line, index }) => (
                <CartRow
                  key={`${line.productId}-${line.size}-${line.color}`}
                  line={line}
                  onQty={(qty) => cart.setQty(index, qty)}
                  onRemove={() => cart.remove(index)}
                />
              ))}
            </Card>
          </section>
        ))}
      </div>

      {/* Блок 2 — утасны дугаар */}
      <div className="px-4 pt-6">
        <div className="mb-2 text-[15px] font-medium">Утасны дугаар</div>
        <Card className="flex flex-col gap-3 p-4">
          {step === "verified" ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="tnum text-[15px]">{phone}</div>
                <div className="text-[13px] text-ok">Баталгаажсан</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  session.signOut();
                  setStep("phone");
                  setCode("");
                }}
              >
                Солих
              </Button>
            </div>
          ) : step === "phone" ? (
            <>
              <Input
                value={phone}
                onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 8))}
                placeholder="8 оронтой дугаар"
                inputMode="numeric"
                maxLength={8}
              />
              <p className="m-0 text-[13px] text-ink-2">
                Бараа ирэхэд энэ дугаар руу мэдэгдэнэ.
              </p>
              <Button full onClick={sendCode} disabled={phone.length !== 8} loading={busy}>
                Үргэлжлүүлэх
              </Button>
            </>
          ) : (
            <>
              <p className="m-0 text-[13px] text-ink-2">
                <span className="tnum">{phone}</span> дугаар руу 4 оронтой код илгээлээ.
              </p>
              <Input
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))}
                placeholder="0000"
                inputMode="numeric"
                maxLength={4}
                autoFocus
              />
              {devCode && (
                <p className="m-0 text-[12px] text-muted">
                  Туршилтын код: <span className="tnum">{devCode}</span>
                </p>
              )}
              <Button full onClick={verify} disabled={code.length !== 4} loading={busy}>
                Баталгаажуулах
              </Button>
              <div className="flex items-center justify-between text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setCode("");
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 text-ink-2 underline"
                >
                  Дугаар солих
                </button>
                <span className="tnum text-muted">
                  {cooldown > 0 ? `${cooldown} сек` : "Дахин илгээж болно"}
                </span>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Блок 3 — төлбөрийн хураангуй */}
      <div className="px-4 pt-6">
        <div className="mb-2 text-[15px] font-medium">Төлбөр</div>
        <Card className="flex flex-col gap-2.5 p-4">
          <SumRow label="Барааны дүн" value={money(cart.subtotal)} />
          <SumRow label={`Урьдчилгаа (${deposit}%)`} value={money(payNow)} />
          <Divider />
          <SumRow label="Одоо төлөх" value={money(payNow)} strong />
          <SumRow
            label="Бараа ирэхэд төлөх"
            value={due === 0 ? "Үлдэгдэлгүй" : money(due)}
            muted={due === 0}
          />
          <p className="m-0 pt-1 text-[13px] text-ink-2">
            Хүргэлт эсвэл өөрөө авахаа бараа ирэхэд сонгоно.
          </p>
        </Card>
      </div>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-line bg-bg p-4">
        <Button
          full
          size="lg"
          onClick={placeOrder}
          disabled={step !== "verified"}
          loading={busy && step === "verified"}
        >
          Захиалга өгөх · {money(payNow)}
        </Button>
      </div>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg px-3 py-3">
      <Link href="/" aria-label="Буцах" className="no-underline">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4 L6 10 L12 16" />
        </svg>
      </Link>
      <span className="text-[15px]">{title}</span>
    </div>
  );
}

function CartRow({
  line,
  onQty,
  onRemove,
}: {
  line: CartLine;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const options = [line.size, line.color].filter(Boolean).join(" · ");
  const max = line.type === "ready" && line.stock > 0 ? line.stock : 50;

  return (
    <div className="flex gap-3 p-3.5">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border border-line">
        <ProductImage src={line.image} alt={line.name} className="h-full w-full" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="clamp-2 text-[14px] leading-[1.4]">{line.name}</div>
        {options && <div className="text-[13px] text-muted">{options}</div>}

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex h-9 items-center rounded-[8px] border border-line">
            <button
              type="button"
              aria-label="Хасах"
              onClick={() => onQty(line.qty - 1)}
              disabled={line.qty <= 1}
              className="h-full w-9 cursor-pointer border-0 bg-transparent text-ink disabled:opacity-30"
            >
              −
            </button>
            <span className="tnum w-7 text-center text-[14px]">{line.qty}</span>
            <button
              type="button"
              aria-label="Нэмэх"
              onClick={() => onQty(line.qty + 1)}
              disabled={line.qty >= max}
              className="h-full w-9 cursor-pointer border-0 bg-transparent text-ink disabled:opacity-30"
            >
              +
            </button>
          </div>
          <span className="tnum text-[15px] font-medium">{money(line.price * line.qty)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Устгах"
        className="h-8 w-8 shrink-0 cursor-pointer border-0 bg-transparent text-muted"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M3 4h10M6.5 4V2.8h3V4M5 4l.6 9h4.8L11 4" />
        </svg>
      </button>
    </div>
  );
}

function SumRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`text-[14px] ${muted ? "text-muted" : "text-ink-2"}`}>{label}</span>
      <span
        className={`tnum ${strong ? "text-[17px] font-medium" : "text-[14px]"} ${muted ? "text-muted" : "text-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Захиалгын бараа болон бэлэн барааг тусад нь бүлэглэнэ. */
function groupLines(lines: CartLine[]) {
  const groups = new Map<string, { key: string; label: string; lines: { line: CartLine; index: number }[] }>();

  lines.forEach((line, index) => {
    const key = line.type === "ready" ? "ready" : `${line.arriveFrom}|${line.arriveTo}`;
    const label =
      line.type === "ready"
        ? `Эдгээр ${relativeDay(line.arriveFrom).toLowerCase()} бэлэн`
        : `Эдгээр ${rangeLabel(line.arriveFrom, line.arriveTo)}-нд ирнэ`;
    const group = groups.get(key) ?? { key, label, lines: [] };
    group.lines.push({ line, index });
    groups.set(key, group);
  });

  return [...groups.values()];
}
