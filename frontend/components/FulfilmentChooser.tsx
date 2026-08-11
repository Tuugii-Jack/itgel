"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Input, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, weekdayShort } from "@/lib/format";
import type { PublicOrder, Slot, Store } from "@/lib/types";

/**
 * 06 Бараа ирсэн — авах арга сонгох.
 *
 * Дизайны хэмжээ: гарчиг 24px, сонголтын карт 16px дотор зайтай, радио 18px,
 * дүүрэг 2 багана, өдөр 3 багана, доод мөр 12/16px дотор 48px товч.
 */
export function FulfilmentChooser({
  order,
  store,
  onDone,
}: {
  order: PublicOrder;
  store: Store;
  onDone: () => void;
}) {
  const session = useSession();
  const [type, setType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [district, setDistrict] = useState<string | null>(null);
  const [khoroo, setKhoroo] = useState("");
  const [address, setAddress] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .slots(9)
      .then((data) => setSlots(data.slots))
      .catch(() => undefined);
  }, []);

  // Хадгалсан хаяг байвал автоматаар оруулна.
  useEffect(() => {
    const saved = session.me?.address;
    if (!saved) return;
    if (saved.district) setDistrict(saved.district);
    if (saved.khoroo) setKhoroo(saved.khoroo);
    if (saved.addressText) setAddress(saved.addressText);
  }, [session.me]);

  const minFee = store.deliveryFees.length
    ? Math.min(...store.deliveryFees.map((d) => d.fee))
    : 5000;
  const fee =
    type === "DELIVERY" && district
      ? (store.deliveryFees.find((d) => d.district === district)?.fee ?? minFee)
      : 0;
  const total = order.dueAmount + fee;
  const liveItems = order.items.filter((i) => !i.cancelled);

  const submit = async () => {
    setError(null);
    if (type === "DELIVERY" && (!district || !day)) {
      setError("Дүүрэг болон хүргэлтийн өдрөө сонгоно уу.");
      return;
    }
    setBusy(true);
    try {
      await api.chooseFulfilment(order.code, {
        type,
        district: district ?? undefined,
        khoroo: khoroo || undefined,
        address: address || undefined,
        day: day ?? undefined,
      });
      // Дараагийн удаа автоматаар орохын тулд хаягийг хадгална.
      if (type === "DELIVERY" && session.me) {
        await api
          .updateMe({
            district,
            khoroo: khoroo || null,
            addressText: address || null,
          })
          .catch(() => undefined);
      }
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
      setBusy(false);
    }
  };

  return (
    <div className="pb-24 lg:px-10 lg:pb-12 lg:pt-8">
      <div className="px-4 pt-6 lg:max-w-[1120px] lg:px-0 lg:pt-0">
        <div className="tnum text-[13px] text-muted">{order.code}</div>
        <div className="mt-1 text-[24px] font-medium lg:text-[28px]">
          {liveItems.length} бараа ирлээ
        </div>
        <div className="mt-1 text-[14px] leading-[1.5] text-ink-2 lg:text-[15px]">
          Хэрхэн авахаа сонгоно уу.
        </div>
      </div>

      <div className="lg:mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
        <div className="lg:flex lg:flex-col lg:gap-6">

      {/* Ирсэн бараанууд */}
      <div className="flex flex-col gap-2 px-4 pt-5 lg:px-0 lg:pt-0">
        <div className="text-[13px] text-ink-2">Ирсэн бараа</div>
        <div className="overflow-hidden rounded-[12px] border border-line">
          {liveItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-b border-line p-3.5 last:border-b-0"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-ok bg-ok-bg">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#15803D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.2 L4.8 8.5 L9.5 3.5" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px]">{item.name}</span>
                <span className="block text-[13px] text-muted">
                  {[item.size, item.color].filter(Boolean).join(" · ")}
                  {[item.size, item.color].filter(Boolean).length > 0 ? " · " : ""}
                  {item.qty} ш
                </span>
              </span>
              <span className="tnum shrink-0 text-[14px]">{money(item.total)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pt-6 lg:px-0 lg:pt-0">
        <div className="text-[15px] font-medium lg:text-[17px]">Авах аргаа сонгоно уу</div>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-6 lg:grid lg:grid-cols-2 lg:px-0 lg:pt-3">
        <OptionCard
          selected={type === "PICKUP"}
          onSelect={() => setType("PICKUP")}
          title="Өөрөө ирж авах"
          right={<span className="whitespace-nowrap text-[14px] text-ok">Үнэгүй</span>}
        >
          <span className="mt-1.5 block text-[14px] leading-[1.5] text-ink-2">{store.address}</span>
          <span className="mt-0.5 block text-[14px] text-ink-2">{store.workHours}</span>
        </OptionCard>

        <OptionCard
          selected={type === "DELIVERY"}
          onSelect={() => setType("DELIVERY")}
          title="Хүргүүлэх"
          right={
            <span className="tnum whitespace-nowrap text-[14px] text-ink-2">
              {money(minFee)}-с
            </span>
          }
        >
          <span className="mt-1.5 block text-[14px] text-ink-2">Мя, Пү, Бя гаригт</span>
        </OptionCard>
      </div>

      {type === "DELIVERY" && (
        <div className="flex flex-col gap-6 px-4 pt-6 lg:rounded-[12px] lg:border lg:border-line lg:px-6 lg:py-6 lg:pt-6">
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-6">
          <Field label="Дүүрэг">
            <div className="grid grid-cols-2 gap-2">
              {store.deliveryFees.map((d) => (
                <Chip
                  key={d.district}
                  active={district === d.district}
                  onClick={() => setDistrict(d.district)}
                >
                  {d.district}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Хороо">
            <Input value={khoroo} onChange={setKhoroo} placeholder="Жишээ: 15-р хороо" />
          </Field>
          </div>

          <Field label="Дэлгэрэнгүй хаяг">
            <Textarea
              value={address}
              onChange={setAddress}
              placeholder="Байр, орц, тоот, чиглүүлэг"
              rows={3}
            />
          </Field>

          <Field label="Хүргэлтийн өдөр">
            <div className="grid grid-cols-3 gap-2 lg:max-w-[520px]">
              {slots.map((slot) => {
                const active = day === slot.day;
                return (
                  <button
                    key={slot.day}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => setDay(slot.day)}
                    className={`flex flex-col items-center gap-0.5 rounded-[8px] border px-1 py-2.5
                      ${active ? "border-ink bg-ink text-white" : "border-line bg-bg"}
                      ${slot.available ? "cursor-pointer" : "opacity-40"}`}
                  >
                    <span className={`text-[13px] ${active ? "opacity-70" : "text-muted"}`}>
                      {weekdayShort(slot.day)}
                    </span>
                    <span className="tnum whitespace-nowrap text-[14px]">
                      {Number(slot.day.slice(8))}
                    </span>
                    <span
                      className={`text-[12px] ${active ? "opacity-80" : slot.available ? "text-ok" : "text-muted"}`}
                    >
                      {slot.available ? `${slot.remaining} сул` : "Дүүрсэн"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      )}

      {error && (
        <div className="px-4 pb-3 lg:px-0 lg:pb-0">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
        </div>

        {/* Хураангуй — laptop дээр баруун талд наалдана */}
        <div className="px-4 pb-6 pt-6 lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4 lg:rounded-[12px] lg:border lg:border-line lg:p-6">
          <div className="hidden text-[17px] font-medium lg:block">Хураангуй</div>
          <div className="tnum flex flex-col gap-2.5 rounded-[12px] border border-line p-3.5 text-[14px] lg:rounded-none lg:border-0 lg:p-0">
            <Row label="Одоо авах" value={`${liveItems.length} бараа`} />
            <Row
              label="Барааны төлбөр"
              value={order.dueAmount > 0 ? money(order.dueAmount) : "Төлөгдсөн"}
              ok={order.dueAmount === 0}
            />
            <Row label="Хүргэлтийн хураамж" value={fee === 0 ? "Үнэгүй" : money(fee)} />
            <div className="h-px bg-line" />
            <div className="flex justify-between gap-3 text-[17px] font-medium lg:text-[20px]">
              <span>Одоо төлөх</span>
              <span>{money(total)}</span>
            </div>
          </div>

          {/* Laptop дээр товч хураангуйн дотор */}
          <div className="hidden lg:block">
            <Button full size="bar" onClick={submit} loading={busy}>
              Баталгаажуулах
            </Button>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-line bg-bg px-4 py-3 lg:hidden">
        <Button full size="bar" onClick={submit} loading={busy}>
          Баталгаажуулах
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[14px] text-ink-2">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 cursor-pointer rounded-[8px] border px-2 text-[14px]
        ${active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span className={ok ? "text-ok" : ""}>{value}</span>
    </div>
  );
}

/** Дизайны радио карт — 18px цэг, 17px гарчиг. */
function OptionCard({
  selected,
  onSelect,
  title,
  right,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  right: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full cursor-pointer gap-3 rounded-[12px] border p-4 text-left
        ${selected ? "border-ink bg-surface" : "border-line bg-bg"}`}
    >
      <span
        className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-bg
          ${selected ? "border-ink" : "border-line"}`}
      >
        {selected && <span className="size-[9px] rounded-full bg-ink" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] text-ink">{title}</span>
          {right}
        </span>
        {children}
      </span>
    </button>
  );
}
