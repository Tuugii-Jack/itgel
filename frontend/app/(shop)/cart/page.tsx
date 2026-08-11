"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { EmailAuthForm } from "@/components/EmailAuthForm";
import { Button, Empty, ErrorNote, Input, Spinner, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart, type CartLine } from "@/lib/cart";
import { useSession } from "@/lib/session";
import { money, rangeLabel, relativeDay } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { useToast } from "@/lib/toast";

/**
 * 03 Сагс ба захиалга — дизайны хэмжээг яг барина.
 *
 * Толгой 48px, хэсэг хооронд 24px, картын мөр 64px зурагтай grid, тоо
 * ширхэгийн хяналт 32px, доод мөр 12/16px дотор 48px товч.
 */
export default function CartPage() {
  const cart = useCart();
  const session = useSession();
  const router = useRouter();
  const toast = useToast();

  const [buyerName, setBuyerName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.me?.name) setBuyerName(session.me.name);
    if (session.me?.phone) setContactPhone(session.me.phone);
  }, [session.me]);

  const groups = useMemo(() => groupLines(cart.lines), [cart.lines]);

  if (!cart.ready || session.loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="screen">
        <Header />
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

  const placeOrder = async () => {
    if (!session.me) {
      toast.error("Эхлээд нэвтэрнэ үү.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const phone = contactPhone.trim() || null;
      if (phone !== (session.me.phone ?? null) || buyerName.trim() !== (session.me.name ?? "")) {
        await api.updateMe({
          name: buyerName.trim() || null,
          phone,
        });
        await session.refresh();
      }
      const order = await api.createOrder({
        name: buyerName.trim() || undefined,
        note: note.trim() || undefined,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          selections: line.selections ?? undefined,
          size: line.size ?? undefined,
          color: line.color ?? undefined,
        })),
      });
      cart.clear();
      toast.success("Захиалга үүслээ.");
      router.push(`/success/${order.code}`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Захиалга үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const orderTotal = cart.lines
    .filter((l) => l.type === "order")
    .reduce((sum, l) => sum + l.price * l.qty, 0);
  const readyTotal = cart.subtotal - orderTotal;

  return (
    <div className="screen flex flex-col pb-28 lg:pb-12">
      <Header />

      {/* Laptop-ийн хуудасны гарчиг — мобайл дээр толгой нь энэ үүргийг гүйцэтгэнэ. */}
      <div className="hidden px-10 pt-8 lg:block">
        <div className="text-[24px] font-medium">Сагс</div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8 lg:px-10 lg:pt-6">
        <div className="lg:flex lg:flex-col lg:gap-6">
      {/* Бараанууд — төрлөөр бүлэглэж, ирэх огноог картын хөлд */}
      {groups.map((group, i) => (
        <section key={group.key} className="px-4 pt-4 lg:px-0 lg:pt-0">
          {/* Ижил төрлийн бүлэг дараалбал шошгыг давтахгүй. */}
          {group.label !== groups[i - 1]?.label && (
            <div className="mb-2 text-[13px] text-ink-2">{group.label}</div>
          )}
          <div className="overflow-hidden rounded-[12px] border border-line">
            {group.lines.map(({ line, index }) => (
              <CartRow
                key={`${line.productId}-${JSON.stringify(line.selections)}`}
                line={line}
                onQty={(qty) => cart.setQty(index, qty)}
                onRemove={() => cart.remove(index)}
              />
            ))}
            <div className="bg-surface px-3.5 py-2.5 text-[13px] text-ink-2 lg:px-4 lg:py-3">
              {group.note}
            </div>
          </div>
        </section>
      ))}

      <div className="lg:hidden">
        <Rule />
      </div>

      {/* Захиалагчийн мэдээлэл */}
      <div className="flex flex-col gap-4 px-4 pt-6 lg:gap-5 lg:rounded-[12px] lg:border lg:border-line lg:px-6 lg:py-6">
        <div className="text-[15px] font-medium lg:text-[17px]">Захиалагчийн мэдээлэл</div>

        {!session.me ? (
          <EmailAuthForm variant="checkout" initialMode="register" />
        ) : (
          <>
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-ink-2">Нэр</span>
                <Input value={buyerName} onChange={setBuyerName} placeholder="Овог, нэр" />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-ink-2">И-мэйл</span>
                <div className="flex h-11 items-center justify-between gap-3 rounded-[8px] border border-line px-3">
                  <span className="truncate text-[15px]">{session.me.email}</span>
                  <button
                    type="button"
                    onClick={() => session.signOut()}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-ink-2 underline"
                  >
                    Гарах
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:col-span-2">
                <span className="text-[13px] text-ink-2">Утасны дугаар</span>
                <Input
                  value={contactPhone}
                  onChange={(v) => setContactPhone(v.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  placeholder="99112233"
                  className="tnum"
                />
                <div className="text-[13px] text-ink-2">
                  Хүргэлт, холбоо барихад ашиглана. Хоосон байж болно.
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-ink-2">Нэмэлт тэмдэглэл</span>
              <Textarea
                value={note}
                onChange={setNote}
                rows={2}
                placeholder="Жишээ: 18:00 цагаас хойш залгана уу"
              />
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="px-4 pt-4 lg:px-0">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

          {/* Мобайл дээр блок хоорондын зураас — дизайны 24px/16px */}
          <div className="lg:hidden">
            <Rule />
          </div>
        </div>

        {/* Төлбөрийн хураангуй — laptop дээр баруун талд наалдана */}
        <div className="px-4 pb-6 pt-6 lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4 lg:rounded-[12px] lg:border lg:border-line lg:p-6">
          <div className="mb-3 text-[15px] font-medium lg:mb-0 lg:text-[17px]">
            Төлбөрийн хураангуй
          </div>
          <div className="tnum flex flex-col gap-2.5 text-[14px]">
            {orderTotal > 0 && <SumRow label="Захиалгын бараа" value={money(orderTotal)} />}
            {readyTotal > 0 && <SumRow label="Бэлэн бараа" value={money(readyTotal)} />}
            <div className="h-px bg-line" />
            <div className="flex justify-between gap-3 text-[17px] font-medium lg:text-[20px]">
              <span>Одоо төлөх</span>
              <span>{money(cart.subtotal)}</span>
            </div>
          </div>

          {/* Laptop дээр товч хураангуйн дотор — тогтмол доод мөр хэрэггүй. */}
          <div className="hidden lg:block">
            <Button
              full
              size="bar"
              onClick={placeOrder}
              disabled={!session.me}
              loading={busy && Boolean(session.me)}
            >
              Дансны мэдээлэл авах
            </Button>
          </div>

          <p className="mt-4 mb-0 text-[13px] leading-[1.6] text-ink-2 lg:mt-0">
            Төлбөрөө дансаар бүтнээр шилжүүлнэ. Админ шалгаж баталгаажуулсны дараа захиалга
            баталгаажна.
          </p>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-line bg-bg px-4 py-3 lg:hidden">
        <Button
          full
          size="bar"
          onClick={placeOrder}
          disabled={!session.me}
          loading={busy && Boolean(session.me)}
        >
          Дансны мэдээлэл авах
        </Button>
      </div>
    </div>
  );
}

/** Дизайны толгой — 48px өндөр, 16px хажуугийн зай. */
function Header() {
  return (
    <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg px-4 lg:hidden">
      <Link
        href="/"
        aria-label="Буцах"
        className="-ml-3 flex h-11 w-11 items-center justify-center no-underline"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4 L6 10 L12 16" />
        </svg>
      </Link>
      <span className="text-[15px] font-medium">Сагс</span>
    </div>
  );
}

/** Блок хоорондын зураас — 24px дээд зайтай, 16px хажуугийн зайтай. */
function Rule() {
  return <div className="mx-4 mt-6 h-px bg-line" />;
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
  const options = formatSelections(line.selections, line.size, line.color);
  const max = line.type === "ready" && line.stock > 0 ? line.stock : 50;

  const qtyControl = (size: "sm" | "lg") => (
    <div
      className={`flex items-center rounded-[8px] border border-line ${size === "lg" ? "h-9" : "h-8"}`}
    >
      <button
        type="button"
        aria-label="Хасах"
        onClick={() => onQty(line.qty - 1)}
        disabled={line.qty <= 1}
        className={`h-full cursor-pointer border-0 bg-transparent text-[15px] text-ink-2 disabled:opacity-30 ${size === "lg" ? "w-9" : "w-8"}`}
      >
        −
      </button>
      <span className="tnum w-7 text-center text-[14px]">{line.qty}</span>
      <button
        type="button"
        aria-label="Нэмэх"
        onClick={() => onQty(line.qty + 1)}
        disabled={line.qty >= max}
        className={`h-full cursor-pointer border-0 bg-transparent text-[15px] text-ink-2 disabled:opacity-30 ${size === "lg" ? "w-9" : "w-8"}`}
      >
        +
      </button>
    </div>
  );

  return (
    <>
      {/* Мобайл — 64px зураг, тоо ба үнэ нэрийн доор */}
      <div className="grid grid-cols-[64px_1fr] gap-x-3 border-b border-line p-3.5 lg:hidden">
        <div className="h-16 w-16 overflow-hidden rounded-[8px] border border-line bg-surface">
          <ProductImage src={line.image} alt={line.name} className="h-full w-full" />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[14px] leading-[1.4]">{line.name}</div>
            <RemoveButton onRemove={onRemove} />
          </div>
          {options && <div className="text-[13px] text-muted">{options}</div>}
          <div className="flex items-center justify-between gap-2">
            {qtyControl("sm")}
            <div className="tnum text-[15px] font-medium">{money(line.price * line.qty)}</div>
          </div>
        </div>
      </div>

      {/* Laptop — 72px зураг, тоо ба үнэ тусдаа баганад */}
      <div className="hidden grid-cols-[72px_minmax(0,1fr)_120px_120px_40px] items-center gap-x-4 border-b border-line p-4 lg:grid">
        <div className="h-[72px] w-[72px] overflow-hidden rounded-[8px] border border-line bg-surface">
          <ProductImage src={line.image} alt={line.name} className="h-full w-full" />
        </div>

        <div className="min-w-0">
          <div className="text-[15px]">{line.name}</div>
          {options && <div className="text-[13px] text-muted">{options}</div>}
        </div>

        <div className="justify-self-start">{qtyControl("lg")}</div>

        <div className="tnum text-right text-[16px] font-medium">
          {money(line.price * line.qty)}
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Устгах"
          className="flex size-8 cursor-pointer items-center justify-center rounded-[8px] border border-line bg-bg text-muted"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M3 3 9 9 M9 3 3 9" />
          </svg>
        </button>
      </div>
    </>
  );
}

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Устгах"
      className="-my-2.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-end border-0 bg-transparent text-muted"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M4 4 L12 12 M12 4 L4 12" />
      </svg>
    </button>
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

function etaOf(line: CartLine): string {
  return line.type === "ready"
    ? `${relativeDay(line.arriveFrom)} бэлэн`
    : `${rangeLabel(line.arriveFrom, line.arriveTo)}-нд ирнэ`;
}

/**
 * Дизайны хоёр бүлэг — «Захиалгын бараа», «Бэлэн бараа».
 *
 * Ирэх огноо нь картын хөлд бичигддэг тул бүлгийг төрөл БА огноогоор нь
 * задална: ингэснээр карт бүр яг нэг огноотой болж, дизайны «Эдгээр …
 * ирнэ» гэсэн мөр үнэн болно.
 */
function groupLines(lines: CartLine[]) {
  const groups = new Map<
    string,
    { key: string; label: string; note: string; lines: { line: CartLine; index: number }[] }
  >();

  lines.forEach((line, index) => {
    const type = line.type === "ready" ? "ready" : "order";
    const eta = etaOf(line);
    const key = `${type}|${eta}`;
    const group = groups.get(key) ?? {
      key,
      label: type === "ready" ? "Бэлэн бараа" : "Захиалгын бараа",
      note: `Эдгээр ${eta.replace(/^./, (c) => c.toLowerCase())}`,
      lines: [],
    };
    group.lines.push({ line, index });
    groups.set(key, group);
  });

  // Захиалгын бараа эхэнд, дотор нь огноогоор нь эрэмбэлнэ.
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
